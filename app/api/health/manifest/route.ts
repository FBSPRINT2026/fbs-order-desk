import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { importManifest, parseManifest, unmatchedGroups } from "@/lib/manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** TEMPORARY: import a manifest sent as rows (same as the upload button). Removed after use. */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  try {
    const b = await req.json() as { supplier: "ss" | "sanmar"; fileName: string; rows: string[][] };
    const r = await importManifest(admin, b.supplier, parseManifest(b.rows), b.fileName);
    const pending = await unmatchedGroups(admin);
    return NextResponse.json({ ...r, pending: pending.map((g) => ({ who: g.customer_name, customer: g.customer?.name || null, us: g.us, po: g.customer_po, so: g.supplier_order, pcs: g.pcs, how: g.how, sugg: g.lines.filter((l) => l.suggest).length })) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
