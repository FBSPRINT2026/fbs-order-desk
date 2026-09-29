import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readXlsx } from "@/lib/xlsx";
import { parseCsv, type ImportPunch } from "@/lib/timeImport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function boss() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const { data } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  return ["owner", "admin"].includes((data?.role as string) || "") ? v : null;
}

/**
 * Importing hours from uAttend (or any report). A file upload returns its rows so the page can show them and map
 * the columns; { punches } saves them: employees are matched by their uAttend ID, then by name (and added when
 * new), and punches already imported are skipped (so the same report can be loaded twice safely).
 */
export async function POST(req: Request) {
  const v = await boss();
  if (!v) return NextResponse.json({ error: "Only an owner or admin can import hours." }, { status: 403 });
  const type = req.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const f = (await req.formData()).get("file");
    if (!(f instanceof File)) return NextResponse.json({ error: "No file." }, { status: 400 });
    const buf = Buffer.from(await f.arrayBuffer());
    const rows = /\.xlsx$/i.test(f.name) || buf.subarray(0, 2).toString() === "PK" ? readXlsx(buf) : parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
    return NextResponse.json({ name: f.name, rows: rows.slice(0, 60000) });
  }
  const b = await req.json().catch(() => ({}));
  const punches = (Array.isArray(b.punches) ? b.punches : []) as ImportPunch[];
  if (!punches.length) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });
  const admin = createAdminClient();
  const { data: emps } = await admin.from("employees").select("id, first_name, last_name, uattend_id");
  const byId = new Map<string, string>(), byName = new Map<string, string>();
  for (const e of (emps || []) as { id: string; first_name: string; last_name: string; uattend_id: string | null }[]) {
    if (e.uattend_id) byId.set(e.uattend_id.toLowerCase(), e.id);
    byName.set(`${e.first_name} ${e.last_name}`.trim().toLowerCase(), e.id);
    byName.set(`${e.last_name}, ${e.first_name}`.trim().toLowerCase(), e.id);
  }
  let added = 0;
  const empFor = async (p: ImportPunch) => {
    const idKey = p.employeeId.toLowerCase(), nameKey = p.employee.trim().toLowerCase();
    const hit = (idKey && byId.get(idKey)) || byName.get(nameKey);
    if (hit) return hit;
    // "Last, First" or "First Last"
    const [first, last] = p.employee.includes(",") ? [p.employee.split(",")[1]?.trim() || "", p.employee.split(",")[0].trim()] : [p.employee.trim().split(/\s+/)[0] || "", p.employee.trim().split(/\s+/).slice(1).join(" ")];
    const { data, error } = await admin.from("employees").insert({ first_name: first || p.employeeId || "Employee", last_name: last, department: p.department, uattend_id: p.employeeId || null, notes: "Added from the uAttend import" }).select("id").single();
    if (error) throw new Error(error.message);
    added++;
    if (idKey) byId.set(idKey, data.id); byName.set(nameKey, data.id);
    return data.id as string;
  };
  const rows: { employee_id: string; kind: string; at: string; source: string; uattend_id: string; note: string }[] = [];
  try {
    for (const p of punches) rows.push({ employee_id: await empFor(p), kind: p.kind, at: p.at, source: "uattend", uattend_id: p.key, note: "Imported from uAttend" });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await admin.from("time_punches").upsert(rows.slice(i, i + 500), { onConflict: "uattend_id", ignoreDuplicates: true }).select("id");
    if (error) return NextResponse.json({ error: error.message, saved, added }, { status: 500 });
    saved += (data || []).length;
  }
  return NextResponse.json({ saved, skipped: rows.length - saved, employeesAdded: added });
}
