import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { labelZpl } from "@/lib/easypost";
import { queueLabels } from "@/lib/printQueue";
import type { Box } from "@/lib/shipping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reprint labels (Nick, Nov 19 2026): a shipment's bought labels to this computer's Zebra again. Costs nothing. */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: sh } = await admin.from("shipments").select("id, order_id, archived_order_id, carrier, boxes").eq("id", String(b.shipmentId || "")).maybeSingle();
  if (!sh) return NextResponse.json({ error: "No shipment." }, { status: 404 });
  const boxes = ((sh.boxes || []) as Box[]).filter((x) => (x.tracking || "").trim());
  const only = Math.round(+b.box || 0);
  const pick = only ? boxes.filter((_, i) => i + 1 === only) : boxes;
  if (!pick.length) return NextResponse.json({ error: "No labels on this shipment." }, { status: 400 });
  const { data: o } = sh.order_id ? await admin.from("orders").select("number").eq("id", sh.order_id).maybeSingle() : { data: null };
  try {
    const zpls = [];
    for (const [i, x] of pick.entries()) zpls.push({ title: `#${o?.number || ""} ${sh.carrier} label ${only || i + 1} of ${boxes.length} (reprint)`, zpl: await labelZpl(x), kind: "ship", order_id: sh.order_id, archived_order_id: sh.archived_order_id });
    const by = String((v.staff as { name?: string } | null)?.name || v.email || "shop");
    const r = await queueLabels(admin, zpls, by, typeof b.printer === "string" ? b.printer : null);
    return NextResponse.json({ ok: r.ok, message: r.message });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
