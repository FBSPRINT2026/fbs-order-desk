"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { carrierOf, supplierLabel } from "@/lib/goods";
import { startTracker } from "@/lib/goodsTrack";
import { staffAddTracking, staffGoodsInfo } from "@/app/shop/goods-actions";

/**
 * The order's Goods panel (components/OrderGoodsPanel.tsx; Oct 29, Nick: "there's nothing on the order that indicates
 * that we ordered goods… a really little compact panel… below the totals… FBS ordered, customer supplied… what if we
 * ordered it from somewhere that you're not integrated with?"). One read of everything known about an order's goods:
 *   - FBS ordered: our goods orders (blank_orders: Order goods' S&S and SanMar orders, and any vendor typed or pasted
 *     here), with tracking from the order itself and from supplier manifests matched to it;
 *   - Customer supplied: where their goods come from (order_goods) and their tracking (goods_shipments, live).
 */
export type PanelTrack = { carrier: string; tracking: string; status?: string | null; detail?: string | null; eta?: string | null; delivered?: string | null };
export type PanelBuy = { id: string; vendor: string; po: string; pcs: number; total: number | null; expected: string | null; status: string; via: string; at: string; note: string; tracking: PanelTrack[] };
export type PanelCust = { status: string; vendor: string; po: string; shipDate: string | null; expected: string; tracking: PanelTrack[] };
export type GoodsPanel = { fbs: PanelBuy[]; cust: PanelCust | null };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
type BuyRow = { id: string; supplier: string | null; supplier_order: string | null; po: string | null; status: string | null; lines: { qty?: number }[] | null; total: number | string | null; expected_date: string | null; placed_via: string | null; created_at: string; received_at: string | null; note: string | null; tracking: PanelTrack[] | null };

export async function goodsPanel(orderId: string): Promise<{ ok: true; panel: GoodsPanel } | { ok: false; error: string }> {
  try {
    await staff();
    const admin = createAdminClient();
    const [{ data: buys }, { data: g }, { data: sh }, { data: ml }] = await Promise.all([
      admin.from("blank_orders").select("id, supplier, supplier_order, po, status, lines, total, expected_date, placed_via, created_at, received_at, note, tracking").eq("order_id", orderId).order("created_at"),
      admin.from("order_goods").select("status, supplier, supplier_po, ship_date, expected").eq("order_id", orderId).maybeSingle(),
      admin.from("goods_shipments").select("carrier, tracking, eta, track_status, track_detail, est_delivery, delivered_at").eq("order_id", orderId).order("created_at"),
      admin.from("supplier_manifest_lines").select("supplier, supplier_order, customer_po, tracking, method, track_status, track_detail, est_delivery, delivered_at").eq("order_id", orderId).eq("kind", "blanks"),
    ]);
    const mans = (ml || []) as { supplier: string; supplier_order: string; customer_po: string; tracking: string; method: string; track_status: string | null; track_detail: string | null; est_delivery: string | null; delivered_at: string | null }[];
    const fbs: PanelBuy[] = ((buys || []) as BuyRow[]).map((b) => {
      const own = (b.tracking || []).filter((t) => t && t.tracking);
      // a supplier manifest's boxes for this purchase (same supplier, its order number or our PO)
      const keys = new Set([b.supplier_order, b.po].flatMap((x) => String(x || "").split(/,\s*/)).filter(Boolean).map((x) => x.toLowerCase()));
      const fromMan = mans.filter((m) => (!b.supplier || !m.supplier || m.supplier === b.supplier) && (keys.has(String(m.supplier_order || "").toLowerCase()) || keys.has(String(m.customer_po || "").toLowerCase())));
      const seen = new Set(own.map((t) => t.tracking));
      const man: PanelTrack[] = [];
      for (const m of fromMan) if (m.tracking && !seen.has(m.tracking)) { seen.add(m.tracking); man.push({ carrier: carrierOf(m.tracking) || m.method || "", tracking: m.tracking, status: m.track_status, detail: m.track_detail, eta: m.est_delivery, delivered: m.delivered_at }); }
      return {
        id: b.id, vendor: supplierLabel(b.supplier) || "Vendor", po: String(b.supplier_order || b.po || ""), pcs: (b.lines || []).reduce((a, l) => a + (+(l.qty || 0) || 0), 0),
        total: b.total == null ? null : +b.total, expected: b.expected_date, status: b.received_at ? "received" : b.status || "ordered", via: b.placed_via || "", at: b.created_at, note: b.note || "", tracking: [...own, ...man],
      } as PanelBuy;
    });
    const ships = (sh || []) as { carrier: string; tracking: string; eta: string | null; track_status: string | null; track_detail: string | null; est_delivery: string | null; delivered_at: string | null }[];
    const go = g as { status: string; supplier: string | null; supplier_po: string | null; ship_date: string | null; expected: string | null } | null;
    const cust: PanelCust | null = go && (go.supplier || go.supplier_po || go.status !== "waiting") || ships.length
      ? { status: go?.status || "on_way", vendor: supplierLabel(go?.supplier) || "", po: go?.supplier_po || "", shipDate: go?.ship_date || null, expected: go?.expected || "",
          tracking: ships.filter((s) => s.tracking).map((s) => ({ carrier: s.carrier || carrierOf(s.tracking), tracking: s.tracking, status: s.track_status, detail: s.track_detail, eta: s.est_delivery || s.eta, delivered: s.delivered_at })) }
      : null;
    return { ok: true, panel: { fbs, cust } };
  } catch (e) { return fail(e); }
}

export type GoodsAdd = { who: "fbs" | "cust"; vendor: string; po: string; eta: string; carrier: string; tracking: string; note?: string; /** add to this goods order of ours */ buyId?: string };

/** Add what's known: our purchase from any vendor (or tracking on one we already have), or the customer's goods. */
export async function addGoodsInfo(orderId: string, a: GoodsAdd): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const tracking = String(a.tracking || "").replace(/\s+/g, "").slice(0, 60), vendor = String(a.vendor || "").trim().slice(0, 60), po = String(a.po || "").trim().slice(0, 60);
    const eta = /^\d{4}-\d{2}-\d{2}$/.test(a.eta || "") ? a.eta : null;
    if (!tracking && !vendor && !po) return { ok: false, error: "Add the vendor, an order number or tracking." };
    if (a.who === "cust") {
      if (vendor || po) {
        // what's already known stays (a pasted tracking email may not name the vendor again)
        const { data: was } = await admin.from("order_goods").select("supplier, supplier_po, ship_date").eq("order_id", orderId).maybeSingle();
        const key = /^s\s*&\s*s|^ss$|activewear/i.test(vendor) ? "ss" : /^san\s*mar/i.test(vendor) ? "sanmar" : vendor;
        const r = await staffGoodsInfo(orderId, { supplier: key || was?.supplier || "", supplier_po: po || was?.supplier_po || "", ship_date: was?.ship_date || null });
        if (!r.ok) return { ok: false, error: r.error || "Couldn't save." };
      }
      if (eta) await admin.from("order_goods").update({ expected: eta }).eq("order_id", orderId);
      if (tracking) { const r = await staffAddTracking(orderId, { carrier: a.carrier || carrierOf(tracking), tracking, boxes: null, eta, note: a.note || "", files: [] }); if (!r.ok) return { ok: false, error: r.error || "Couldn't save the tracking." }; }
      else if (!vendor && !po) await admin.from("order_goods").upsert({ order_id: orderId, status: "on_way", updated_by: v.email, updated_at: new Date().toISOString() });
      return { ok: true };
    }
    // ours: a vendor we name (SanMar / S&S by their key so Order goods' orders and these read the same)
    const key = /^s\s*&\s*s|^ss$|activewear/i.test(vendor) ? "ss" : /^san\s*mar/i.test(vendor) ? "sanmar" : vendor;
    const t: PanelTrack | null = tracking ? { carrier: a.carrier || carrierOf(tracking), tracking } : null;
    if (t) { const f = await startTracker(tracking, t.carrier).catch(() => null); if (f) Object.assign(t, { status: f.track_status, detail: f.track_detail, eta: f.est_delivery, delivered: f.delivered_at, tracker_id: f.tracker_id }); }
    const { data: mine } = await admin.from("blank_orders").select("id, supplier, supplier_order, po, tracking, expected_date").eq("order_id", orderId);
    const rows = (mine || []) as { id: string; supplier: string | null; supplier_order: string | null; po: string | null; tracking: PanelTrack[] | null; expected_date: string | null }[];
    // tracking (or a date) for a purchase we already have: the one picked, or the same vendor and number, or the only one from that vendor
    const same = a.buyId ? rows.find((r) => r.id === a.buyId)
      : rows.find((r) => po && [r.supplier_order, r.po].some((x) => String(x || "").toLowerCase() === po.toLowerCase()))
        || (!po && vendor ? rows.filter((r) => (r.supplier || "").toLowerCase() === key.toLowerCase()) : []).find((_, i, xs) => xs.length === 1)
        || (!po && !vendor && rows.length === 1 ? rows[0] : undefined);
    if (same) {
      const list = (same.tracking || []).filter((x) => !t || x.tracking !== t.tracking);
      const { error } = await admin.from("blank_orders").update({ tracking: t ? [...list, t] : list, ...(eta ? { expected_date: eta } : {}), ...(po && !same.supplier_order ? { supplier_order: po } : {}) }).eq("id", same.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { data: o } = await admin.from("orders").select("number, customer_id").eq("id", orderId).maybeSingle();
      const { error } = await admin.from("blank_orders").insert({ order_id: orderId, customer_id: o?.customer_id || null, label: `#${o?.number ?? ""}`, supplier: key || "other", supplier_order: po, po, status: "ordered", placed_via: "manual",
        lines: [], total: null, expected_date: eta, note: (a.note || "").slice(0, 500), created_by: v.email || "staff", tracking: t ? [t] : [] });
      if (error) return { ok: false, error: error.message };
    }
    await admin.from("order_events").insert({ order_id: orderId, kind: "goods", detail: `Goods we ordered: ${[supplierLabel(key) || vendor, po && `order ${po}`, t && `${t.carrier} ${t.tracking}`, eta && `arrives ${eta}`].filter(Boolean).join(" · ")}`, actor: v.email });
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Pasted words about the goods (a supplier's confirmation, a shipping email, a ClickUp note, a customer's text) read
 * into the Add form's fields for staff to check and save. The AI tool "Goods reader" (lib/aiTools.ts).
 */
export async function readGoodsPaste(orderId: string, text: string): Promise<{ ok: true; add: GoodsAdd } | { ok: false; error: string }> {
  try {
    const v = await staff();
    const t = String(text || "").trim().slice(0, 6000);
    if (!t) return { ok: false, error: "Paste something first." };
    const admin = createAdminClient();
    const { aiState, askClaude } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: false, error: st.reason || "AI isn't set up." };
    const { data: o } = await admin.from("orders").select("number, price_type").eq("id", orderId).maybeSingle();
    const r = await askClaude<{ who: "fbs" | "cust" | null; vendor: string; po: string; eta: string; carrier: string; tracking: string }>({
      task: "goods_read", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 300, admin, ctx: { by: v.email, order_id: orderId }, timeoutMs: 25_000,
      tool: { name: "goods", description: "What the pasted text says about this order's goods.", input_schema: { type: "object", required: ["who", "vendor", "po", "eta", "carrier", "tracking"], properties: {
        who: { type: ["string", "null"], enum: ["fbs", "cust", null], description: "fbs = FBS Print (the shop) bought the goods; cust = the customer bought them and is sending them to us; null = can't tell." },
        vendor: { type: "string", description: "Who sells the goods: SanMar, S&S Activewear, One Stop, Alpha, a store… Empty when not said." },
        po: { type: "string", description: "The vendor's order number or the PO on it. Empty when none." },
        eta: { type: "string", description: "Expected delivery date as YYYY-MM-DD, or empty." },
        carrier: { type: "string", description: "UPS, FedEx, USPS, DHL, a freight line… Empty when not said." },
        tracking: { type: "string", description: "The tracking (or PRO) number, no spaces. The first one if there are several. Empty when none." } } } },
      system: `You read what someone pasted about the goods (blank shirts, hats…) for a print shop's order #${o?.number ?? ""}. The shop is FBS Print; this order is ${o?.price_type === "wholesale" ? "wholesale (the customer usually supplies the goods)" : "retail (the shop usually buys the goods)"}. Pull out only what the text says; never invent numbers. Today is ${new Date().toISOString().slice(0, 10)}.`,
      prompt: t,
    });
    if (!r.ok) return { ok: false, error: r.error };
    const d = r.data;
    return { ok: true, add: { who: d.who === "fbs" || d.who === "cust" ? d.who : o?.price_type === "wholesale" ? "cust" : "fbs", vendor: d.vendor || "", po: d.po || "", eta: /^\d{4}-\d{2}-\d{2}$/.test(d.eta || "") ? d.eta : "", carrier: d.carrier || "", tracking: String(d.tracking || "").replace(/\s+/g, "") } };
  } catch (e) { return fail(e); }
}
