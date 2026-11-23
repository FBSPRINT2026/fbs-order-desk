import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { easypostConfigured, voidLabel } from "@/lib/easypost";
import type { Box } from "@/lib/shipping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Void labels (Nick, Nov 23 2026: "if we make a mistake on a label… we have to be able to void the labels so that we
 * don't get charged from EasyPost"). Every box's label on the shipment is refunded through EasyPost; the shipment is
 * voided, its tracking comes off the order, and it's logged on the order. The boxes, address and who pays stay saved, so
 * a new shipment for the job starts from them. A label the carrier already scanned can't be voided: that box says so
 * and keeps its tracking.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!easypostConfigured()) return NextResponse.json({ error: "EasyPost isn't connected yet." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const sid = String(b.shipmentId || ""), why = String(b.why || "").trim().slice(0, 300);
  if (!sid) return NextResponse.json({ error: "Which shipment?" }, { status: 400 });
  const admin = createAdminClient();
  const by = String((v.staff as { name?: string } | null)?.name || v.email || "shop");
  const { data: sh } = await admin.from("shipments").select("*").eq("id", sid).maybeSingle();
  if (!sh) return NextResponse.json({ error: "That shipment isn't here." }, { status: 404 });
  if (sh.status === "void") return NextResponse.json({ error: "Those labels are already voided." }, { status: 409 });
  const boxes = (sh.boxes || []) as Box[];
  const bought = boxes.filter((x) => (x as Box & { ep_id?: string }).ep_id);
  if (!bought.length) return NextResponse.json({ error: "These labels weren't bought here (no EasyPost label to void). Void them where they were made." }, { status: 400 });
  const results: { box: number; tracking: string; ok: boolean; status: string }[] = [];
  for (const x of bought) {
    const id = (x as Box & { ep_id?: string }).ep_id!;
    try { const r = await voidLabel(id); results.push({ box: x.n, tracking: x.tracking || "", ok: true, status: r.status }); }
    catch (e) { results.push({ box: x.n, tracking: x.tracking || "", ok: false, status: e instanceof Error ? e.message.replace(/^EasyPost:\s*/, "") : String(e) }); }
  }
  const okAll = results.every((r) => r.ok), okAny = results.some((r) => r.ok);
  const now = new Date().toISOString();
  if (okAny) {
    const voided = new Set(results.filter((r) => r.ok).map((r) => r.tracking));
    const nb = boxes.map((x) => (voided.has(x.tracking || "") ? { ...x, voided: x.tracking, tracking: "" } : x));
    const left = nb.map((x) => x.tracking).filter(Boolean) as string[];
    await admin.from("shipments").update({ boxes: nb, status: okAll ? "void" : sh.status, updated_at: now, note: [String(sh.note || "").trim(), `Voided ${now.slice(0, 10)} by ${by}${why ? `: ${why}` : ""}`].filter(Boolean).join(" · ") }).eq("id", sid);
    if (sh.order_id) {
      await admin.from("orders").update({ tracking: left.join(", ") }).eq("id", sh.order_id);
      // nothing left on its way: the job goes back to Ready to ship (it was Completed when the labels were made)
      if (!left.length) await admin.from("orders").update({ status: "ready" }).eq("id", sh.order_id).eq("status", "completed").is("declined_at", null);
      await admin.from("order_events").insert({ order_id: sh.order_id, kind: "note", detail: `Labels voided (${results.filter((r) => r.ok).map((r) => r.tracking).join(", ")})${why ? ` · ${why}` : ""}${okAll ? "" : ` · not voided: ${results.filter((r) => !r.ok).map((r) => `box ${r.box} (${r.status})`).join(", ")}`}`, actor: by });
    }
  }
  return NextResponse.json({ ok: okAny, all: okAll, results });
}
