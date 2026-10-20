import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCatalog, type CatalogRules } from "@/lib/designCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A customer's designs catalog (lib/designCatalog.ts): GET ?customer=<id>. POST changes how it's grouped:
 *  { customer, op: "rename", key, name } · { op: "merge", key, into } · { op: "move", ref, into } (a job to another
 *  design; into "" = not a design) · { op: "hide" | "show", key } · { op: "reset", key } (undo staff's changes to it).
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const cid = new URL(req.url).searchParams.get("customer") || "";
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  try { return NextResponse.json(await buildCatalog(createAdminClient(), cid)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { customer?: string; op?: string; key?: string; name?: string; into?: string; ref?: string };
  const cid = String(b.customer || "");
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle();
  const r: CatalogRules = { names: {}, merge: {}, jobs: {}, hidden: [], ...((row?.rules || {}) as CatalogRules) };
  const key = String(b.key || "").slice(0, 200), into = String(b.into ?? "").slice(0, 200);
  switch (b.op) {
    case "rename": if (!key) break; if ((b.name || "").trim()) r.names![key] = String(b.name).trim().slice(0, 120); else delete r.names![key]; break;
    case "merge": if (!key || !into || key === into) break; r.merge![key] = into; break;
    case "move": if (!b.ref) break; r.jobs![String(b.ref).slice(0, 120)] = into; break;
    case "hide": if (key && !r.hidden!.includes(key)) r.hidden!.push(key); break;
    case "show": r.hidden = r.hidden!.filter((k) => k !== key); break;
    case "reset": delete r.names![key]; delete r.merge![key]; for (const [k, t] of Object.entries(r.merge!)) if (t === key) delete r.merge![k]; r.hidden = r.hidden!.filter((k) => k !== key); break;
    default: return NextResponse.json({ error: "What change?" }, { status: 400 });
  }
  const { error } = await admin.from("customer_designs").upsert({ customer_id: cid, rules: r, updated_at: new Date().toISOString(), updated_by: v.email || "" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(await buildCatalog(admin, cid));
}
