import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Goods & Receiving: shipments someone chose to ignore (not ours to count, a job that won't print, a duplicate…).
 * Kept in settings.data.receivingIgnored by row key: { at, by, label }. Ignored shipments leave every list and show
 * under the Ignored tab, where they can be restored. Entries older than 180 days are dropped.
 * Also settings.data.receivingSeparate: jobs whose shipments from several vendors should NOT show as one row.
 */
type Ign = Record<string, { at: string; by: string; label: string }>;
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export async function GET() {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as { receivingIgnored?: Ign; receivingSeparate?: Ign };
  return NextResponse.json({ ignored: d.receivingIgnored || {}, separate: d.receivingSeparate || {} });
}

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { key?: string; ignore?: boolean; label?: string; separate?: boolean } | null;
  const key = String(b?.key || "").slice(0, 300);
  if (!key) return NextResponse.json({ error: "Which shipment?" }, { status: 400 });
  const admin = createAdminClient();
  // read the latest settings right before writing (only this one key changes)
  const { data, error } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = ((data?.data as Record<string, unknown> | null) || {}) as Record<string, unknown>;
  // Uncombine: one job's shipments from several vendors show as separate rows again (key = the job's row key)
  if (typeof b?.separate === "boolean") {
    const sep: Ign = { ...((all.receivingSeparate as Ign) || {}) };
    if (b.separate) sep[key] = { at: new Date().toISOString(), by: v.email, label: String(b?.label || "").slice(0, 200) }; else delete sep[key];
    const w = await admin.from("settings").update({ data: { ...all, receivingSeparate: sep } }).eq("id", 1);
    if (w.error) return NextResponse.json({ error: w.error.message }, { status: 500 });
    return NextResponse.json({ ignored: (all.receivingIgnored as Ign) || {}, separate: sep });
  }
  const ign: Ign = { ...((all.receivingIgnored as Ign) || {}) };
  if (b?.ignore === false) delete ign[key];
  else ign[key] = { at: new Date().toISOString(), by: v.email, label: String(b?.label || "").slice(0, 200) };
  const cutoff = Date.now() - 180 * 86400000;
  for (const [k, x] of Object.entries(ign)) if (Date.parse(x.at) < cutoff) delete ign[k];
  const w = await admin.from("settings").update({ data: { ...all, receivingIgnored: ign } }).eq("id", 1);
  if (w.error) return NextResponse.json({ error: w.error.message }, { status: 500 });
  return NextResponse.json({ ignored: ign });
}
