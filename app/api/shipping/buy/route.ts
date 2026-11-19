import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buyOrder, easypostConfigured, rateShipment } from "@/lib/easypost";
import { shipAccounts } from "@/lib/shipAccounts";
import { mergeSettings } from "@/lib/pricing";
import { addressReady, boxReady, shippingPrice, type BillTo, type Box } from "@/lib/shipping";
import { printSettings, queueLabels } from "@/lib/printQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Create Labels (Nick, Nov 19 2026: "when you click ship and you create a label, you're automatically taking the tracking…
 * and you're posting it to the order"). Buys one label a box on the service picked, on the account it was priced on
 * (lib/shipAccounts.ts), then: each box's tracking and label on the shipment, the shipment shipped, the order's tracking
 * and ship method, the labels to this computer's Zebra. The ship window does the rest (the order Completed, the Shipped
 * email) the same as Mark shipped. Spends money, so: staff only, a shipment saved first, never twice (a shipment with
 * tracking already is refused), and anything but Ground needs its reason.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!easypostConfigured()) return NextResponse.json({ error: "EasyPost isn't connected yet." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const sid = String(b.shipmentId || ""), carrier = String(b.carrier || ""), service = String(b.service || "");
  if (!sid || !carrier || !service) return NextResponse.json({ error: "Which shipment and which service?" }, { status: 400 });
  if (!/ground|home delivery|ground advantage|parcel select/i.test(service) && !String(b.why || "").trim()) return NextResponse.json({ error: "Say why it isn't going Ground first." }, { status: 400 });
  const admin = createAdminClient();
  const by = String((v.staff as { name?: string } | null)?.name || v.email || "shop");
  const { data: sh } = await admin.from("shipments").select("*").eq("id", sid).maybeSingle();
  if (!sh) return NextResponse.json({ error: "Save the shipment first." }, { status: 400 });
  const boxes = (sh.boxes || []) as Box[];
  if (sh.status === "shipped" || boxes.some((x) => (x.tracking || "").trim())) return NextResponse.json({ error: "This shipment already has labels. Check Shipped before buying again." }, { status: 409 });
  if (!boxes.length || !boxes.every(boxReady)) return NextResponse.json({ error: "Every box needs its size and weight." }, { status: 400 });
  if (!addressReady(sh.ship_to || {})) return NextResponse.json({ error: "The ship-to address isn't complete." }, { status: 400 });
  // claim it, so a double click can't buy twice
  const { data: claimed } = await admin.from("shipments").update({ status: "labeled", updated_at: new Date().toISOString() }).eq("id", sid).eq("status", sh.status).select("id").maybeSingle();
  if (!claimed) return NextResponse.json({ error: "Someone is already buying these labels." }, { status: 409 });
  const undo = () => admin.from("shipments").update({ status: sh.status }).eq("id", sid);
  // once bought, never undone (the shipment stays "labeled" with whatever was saved, so nobody buys it twice)
  let bought: string[] | null = null;
  try {
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const s = mergeSettings(st?.data).ship;
    if (!s.from.street1) { await undo(); return NextResponse.json({ error: "Add our street address in Shipping → Settings before buying labels." }, { status: 400 }); }
    const { shipOn, carrierAccounts } = await shipAccounts(admin, { shipOn: sh.ship_on || "fbs", customerId: sh.customer_id });
    const bill = (sh.bill_to || "fbs") as BillTo;
    const { data: o } = sh.order_id ? await admin.from("orders").select("number").eq("id", sh.order_id).maybeSingle() : { data: null };
    const { data: a } = sh.archived_order_id ? await admin.from("archived_orders").select("visual_id").eq("id", sh.archived_order_id).maybeSingle() : { data: null };
    const ref = `#${o?.number || a?.visual_id || ""}`;
    // priced fresh, then bought on that same quote
    // Phone isn't required here (Nick, Nov 19 2026); FedEx won't make a label without one for the ship-to (#50026:
    // "PHONENUMBER.EMPTY"), so a blank one goes to FedEx as our shop's number, only on the label, saved nowhere
    const phone = String(sh.ship_to?.phone || s.from.phone || "").trim();
    const to = { ...sh.ship_to, phone };
    const q = await rateShipment({ labelFormat: "ZPL", from: s.from, to, boxes, bill: shipOn ? "fbs" : bill, account: sh.bill_account || "", zip: sh.bill_zip || "", reference: ref, carrierAccounts });
    const rate = q.rates.find((r) => r.carrier === carrier && r.service === service);
    if (!rate) { await undo(); return NextResponse.json({ error: `${carrier} ${service} isn't offered for this shipment any more. Check rates again.` }, { status: 409 });
    }
    const got = await buyOrder(q.orderId, carrier, service);
    bought = got.boxes.map((x) => x.tracking).filter(Boolean);
    const cost = Math.round((got.boxes.reduce((t, x) => t + x.cost, 0) || rate.cost) * 100) / 100;
    const nb: Box[] = boxes.map((x, i) => ({ ...x, tracking: got.boxes[i]?.tracking || "", label_url: got.boxes[i]?.labelUrl || "", zpl_url: got.boxes[i]?.zplUrl || "", ep_id: got.boxes[i]?.shipmentId || "" }));
    const now = new Date().toISOString();
    const note = [String(sh.note || "").trim(), String(b.why || "").trim() ? `Not Ground: ${String(b.why).trim()}` : ""].filter(Boolean).join(" · ");
    const up = await admin.from("shipments").update({ boxes: nb, carrier, service, cost, price: shippingPrice(cost, nb.length, shipOn ? "fedex" : bill, s), status: "shipped", shipped_at: now, updated_at: now, note }).eq("id", sid);
    const nums = nb.map((x) => x.tracking).filter(Boolean) as string[];
    if (sh.order_id) {
      await admin.from("orders").update({ tracking: nums.join(", ") }).eq("id", sh.order_id);
      await admin.from("order_events").insert({ order_id: sh.order_id, kind: "note", detail: `Labels bought · ${carrier} ${service} · ${nums.join(", ")}${note ? ` · ${note}` : ""}`, actor: by });
    }
    // to this computer's Zebra (the PDFs stay on the shipment to print another way)
    let printed = "";
    const zpls = got.boxes.map((x, i) => ({ title: `${ref} ${carrier} label ${i + 1} of ${got.boxes.length}`, zpl: x.zpl, kind: "ship", order_id: sh.order_id, archived_order_id: sh.archived_order_id })).filter((x) => x.zpl);
    if (zpls.length) {
      await printSettings(admin);
      const r = await queueLabels(admin, zpls, by, typeof b.printer === "string" ? b.printer : null);
      printed = r.message;
    }
    // say so when they didn't go to the Zebra (#50026 printed nothing and said nothing)
    const noPrint = zpls.length < got.boxes.length ? `The label${got.boxes.length === 1 ? "" : "s"} didn't print${got.zplError ? ` (${got.zplError})` : ""}: open each box's Label on the order to print it, or press Reprint labels.` : "";
    return NextResponse.json({ ok: true, tracking: nums, labels: nb.map((x) => x.label_url).filter(Boolean), printed, saved: !up.error, warn: up.error ? `The labels are bought (${nums.join(", ")}) but saving them failed: ${up.error.message}` : noPrint ? `Labels bought (${nums.join(", ")}). ${noPrint}` : "" });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (bought) return NextResponse.json({ ok: true, tracking: bought, labels: [], printed: "", saved: false, warn: `The labels are bought (${bought.join(", ") || "no tracking back"}) but something after failed: ${m}. Don't buy again; check the shipment.` });
    await undo();
    return NextResponse.json({ error: m }, { status: 502 });
  }
}
