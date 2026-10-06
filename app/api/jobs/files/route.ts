import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A job's shop-only production files and notes: photos of the printed piece, press setup changes, ink / color
 * changes. Staff, or employees signed in to the employee app. Never shown to customers.
 */
type Ref = { kind: "o" | "a"; id: string };
const refOf = (k: unknown, id: unknown): Ref | null => ((k === "o" || k === "a") && typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? { kind: k, id } : null);
const col = (r: Ref) => (r.kind === "o" ? "order_id" : "archived_order_id");

async function customerOf(admin: ReturnType<typeof createAdminClient>, r: Ref) {
  const { data } = await admin.from(r.kind === "o" ? "orders" : "archived_orders").select("customer_id").eq("id", r.id).maybeSingle();
  return data ? ((data.customer_id as string) || null) : undefined;
}

export async function GET(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = refOf(sp.get("kind"), sp.get("id"));
  const admin = createAdminClient();
  // a customer's photos and notes across their jobs (Customer → Artwork → Production files)
  const cust = sp.get("customer");
  if (!r && !(cust && who.kind === "staff")) return NextResponse.json({ error: "Which job?" }, { status: 400 });
  const q = admin.from("job_files").select("*").eq("archived", sp.get("archived") === "1").order("created_at", { ascending: false }).limit(cust ? 120 : 300);
  const { data, error } = r ? await q.eq(col(r), r.id) : await q.eq("customer_id", cust!);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data || []) as { id: string; kind: string; file_path: string; order_id: string | null; archived_order_id: string | null }[];
  const paths = rows.filter((x) => x.file_path).map((x) => x.file_path);
  const signed = paths.length ? (await admin.storage.from("proofs").createSignedUrls(paths, 3600)).data || [] : [];
  const url = new Map(paths.map((p, i) => [p, signed[i]?.signedUrl || ""]));
  // job numbers, for the customer view
  let nums = new Map<string, string>();
  if (cust) {
    const oIds = [...new Set(rows.map((x) => x.order_id).filter(Boolean))] as string[], aIds = [...new Set(rows.map((x) => x.archived_order_id).filter(Boolean))] as string[];
    const [{ data: os }, { data: as }] = await Promise.all([
      oIds.length ? admin.from("orders").select("id, number, nickname").in("id", oIds) : Promise.resolve({ data: [] }),
      aIds.length ? admin.from("archived_orders").select("id, visual_id, nickname").in("id", aIds) : Promise.resolve({ data: [] }),
    ]);
    nums = new Map([...((os || []) as { id: string; number: number; nickname: string }[]).map((o) => [o.id, `#${o.number} ${o.nickname || ""}`.trim()] as [string, string]), ...((as || []) as { id: string; visual_id: string; nickname: string }[]).map((o) => [o.id, `#${o.visual_id} ${o.nickname || ""}`.trim()] as [string, string])]);
  }
  return NextResponse.json({ items: rows.map((x) => ({ ...x, url: x.file_path ? url.get(x.file_path) || "" : "", job: nums.get(x.order_id || x.archived_order_id || "") || "" })) });
}

/** Add a note (JSON) or a photo / file (multipart form: kind, id, file, tag, body). */
export async function POST(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const admin = createAdminClient();
  const by = { by_name: who.name, by_email: who.email, employee_id: who.employeeId };
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const f = await req.formData();
    const r = refOf(f.get("kind"), f.get("id"));
    const file = f.get("file");
    if (!r || !(file instanceof File) || !file.size) return NextResponse.json({ error: "Pick a photo." }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "That file is too big (12 MB most)." }, { status: 400 });
    const cust = await customerOf(admin, r);
    if (cust === undefined) return NextResponse.json({ error: "That job doesn't exist." }, { status: 404 });
    const name = (file.name || "photo.jpg").replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `production/jobs/${r.kind}-${r.id}/${Date.now()}-${name}`;
    const up = await admin.storage.from("proofs").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream" });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    const { data, error } = await admin.from("job_files").insert({ [col(r)]: r.id, customer_id: cust, kind: /^image\//.test(file.type) ? "photo" : "file", tag: String(f.get("tag") || "").slice(0, 40), body: String(f.get("body") || "").slice(0, 2000), file_path: path, file_name: name, file_type: file.type || "", size: file.size, ...by }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: data });
  }
  const b = await req.json().catch(() => ({}));
  const r = refOf(b.kind, b.id);
  const body = String(b.body || "").trim().slice(0, 4000);
  if (!r || !body) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  const cust = await customerOf(admin, r);
  if (cust === undefined) return NextResponse.json({ error: "That job doesn't exist." }, { status: 404 });
  const { data, error } = await admin.from("job_files").insert({ [col(r)]: r.id, customer_id: cust, kind: "note", tag: String(b.tag || "").slice(0, 40), body, ...by }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

/** Archive or restore (staff; nothing is ever deleted). */
export async function PATCH(req: Request) {
  const who = await jobActor();
  if (!who || who.kind !== "staff") return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string") return NextResponse.json({ error: "Which one?" }, { status: 400 });
  const { error } = await createAdminClient().from("job_files").update({ archived: !!b.archived }).eq("id", b.id);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
