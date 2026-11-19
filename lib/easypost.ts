import "server-only";
import type { ShipAddress } from "@/lib/pricing";
import type { BillTo, Box, Rate } from "@/lib/shipping";

/**
 * EasyPost (UPS, FedEx and USPS through one connection). Uses the carrier accounts connected in FBS's EasyPost
 * dashboard, so rates are FBS's own. Third-party shipments are billed to the customer's UPS / FedEx account.
 * Getting rates costs nothing; buying labels is a separate step.
 */
const EP = "https://api.easypost.com/v2";
export const easypostConfigured = () => !!process.env.EASYPOST_API_KEY?.trim();

async function ep<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.EASYPOST_API_KEY?.trim();
  if (!key) throw new Error("EasyPost isn't connected yet (EASYPOST_API_KEY is missing in Vercel).");
  const r = await fetch(EP + path, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(key + ":").toString("base64") },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null) as (T & { error?: { message?: string; errors?: { field?: string; message?: string }[] } }) | null;
  if (!r.ok || !j || j.error) {
    const e = j?.error;
    throw new Error("EasyPost: " + ([e?.message, ...(e?.errors || []).map((x) => [x.field, x.message].filter(Boolean).join(" "))].filter(Boolean).join("; ") || `HTTP ${r.status}`));
  }
  return j;
}

async function epGet<T>(path: string): Promise<T> {
  const key = process.env.EASYPOST_API_KEY?.trim();
  if (!key) throw new Error("EasyPost isn't connected yet (EASYPOST_API_KEY is missing in Vercel).");
  const r = await fetch(EP + path, { cache: "no-store", headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64") } });
  const j = await r.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!r.ok || !j || j.error) throw new Error("EasyPost: " + (j?.error?.message || `HTTP ${r.status}`));
  return j;
}

const addr = (a: ShipAddress) => ({ name: a.name || undefined, company: a.company || undefined, street1: a.street1 || undefined, street2: a.street2 || undefined, city: a.city || undefined, state: a.state || undefined, zip: a.zip, country: a.country || "US", phone: a.phone || undefined, email: a.email || undefined });

type EpRate = { id: string; carrier: string; service: string; rate: string; delivery_days: number | null; delivery_date: string | null };

/** Rates for a multi-box shipment (one EasyPost "order" with a shipment per box). */
export async function rateShipment(p: { from: ShipAddress; to: ShipAddress; boxes: Box[]; bill: BillTo; account: string; zip: string; reference: string;
  /** the label's format when it's bought: ZPL for the Zebra (Create labels), PDF otherwise */ labelFormat?: "PDF" | "ZPL";
  /** the carrier accounts to rate on (EasyPost ids): a customer's own account, else FBS's; none = every connected one */ carrierAccounts?: string[] }): Promise<{ orderId: string; rates: Omit<Rate, "price">[] }> {
  const payment = p.bill === "fbs" ? undefined : { type: "THIRD_PARTY", account: p.account, country: "US", postal_code: p.zip };
  const o = await ep<{ id: string; rates: EpRate[]; messages?: { carrier: string; message: string }[] }>("/orders", {
    order: {
      reference: p.reference,
      ...(p.carrierAccounts?.length ? { carrier_accounts: p.carrierAccounts.map((id) => ({ id })) } : {}),
      to_address: addr(p.to), from_address: addr(p.from),
      shipments: p.boxes.map((b) => ({
        parcel: { length: +b.length, width: +b.width, height: +b.height, weight: Math.round(+b.weight * 16 * 10) / 10 }, // weight in ounces
        options: { print_custom_1: p.reference, label_format: p.labelFormat || "PDF", label_size: "4x6", ...(payment ? { payment } : {}) },
      })),
    },
  });
  const want = p.bill === "ups" ? /ups/i : p.bill === "fedex" ? /fedex/i : /./;
  return {
    orderId: o.id,
    rates: (o.rates || []).filter((r) => want.test(r.carrier)).map((r) => ({ id: r.id, carrier: r.carrier, service: r.service, cost: +r.rate || 0, days: r.delivery_days, deliveryDate: r.delivery_date }))
      .sort((a, b) => a.cost - b.cost),
  };
}

/** Rates for one box between two places (the transit map, quick quotes). Nothing is bought. */
export async function rateParcel(p: { from: ShipAddress; to: ShipAddress; parcel: { length: number; width: number; height: number; weightLb: number } }): Promise<Omit<Rate, "price">[]> {
  const sh = await ep<{ id: string; rates: EpRate[] }>("/shipments", {
    shipment: {
      to_address: addr(p.to), from_address: addr(p.from),
      parcel: { length: p.parcel.length, width: p.parcel.width, height: p.parcel.height, weight: Math.round(p.parcel.weightLb * 16 * 10) / 10 },
    },
  });
  return (sh.rates || []).map((r) => ({ id: r.id, carrier: r.carrier, service: r.service, cost: +r.rate || 0, days: r.delivery_days, deliveryDate: r.delivery_date }));
}

/**
 * The carrier accounts connected in FBS's EasyPost dashboard (Oct 30, Nick: "we have two complete separate accounts put
 * into our FedEx Ship Manager… we have to ship from a separate, a new account number through EasyPost… can you check?").
 * Only what identifies each account (its id, carrier, description and account number); never its credentials.
 */
let acctCache: { at: number; list: Awaited<ReturnType<typeof carrierAccounts>> } | null = null;
/** carrierAccounts, kept 10 minutes (every rate request asks which accounts are FBS's) */
export async function carrierAccountsCached() {
  if (acctCache && Date.now() - acctCache.at < 600_000) return acctCache.list;
  const list = await carrierAccounts();
  acctCache = { at: Date.now(), list };
  return list;
}
export async function carrierAccounts(): Promise<{ id: string; type: string; description: string; reference: string; account: string; readable: string }[]> {
  const key = process.env.EASYPOST_API_KEY?.trim();
  if (!key) throw new Error("EasyPost isn't connected yet (EASYPOST_API_KEY is missing in Vercel).");
  const r = await fetch(EP + "/carrier_accounts", { cache: "no-store", headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64") } });
  const j = await r.json().catch(() => null) as { id: string; type: string; description?: string; reference?: string; readable?: string; credentials?: Record<string, unknown> }[] | null;
  if (!r.ok || !Array.isArray(j)) throw new Error(`EasyPost: HTTP ${r.status}`);
  return j.map((a) => ({ id: a.id, type: a.type, description: a.description || "", reference: a.reference || "", readable: a.readable || "",
    account: String(a.credentials?.account_number || a.credentials?.shipper_id || "") }));
}

/**
 * Buy the labels for an order rated by rateShipment (Nick, Nov 19 2026: Create Labels). One label a box, on the carrier
 * and service picked; each box's tracking number, its PDF label and its ZPL for the Zebra come back. This spends money:
 * only app/api/shipping/buy calls it, once per shipment.
 */
export async function buyOrder(orderId: string, carrier: string, service: string): Promise<{ boxes: { tracking: string; labelUrl: string; zplUrl: string; zpl: string; cost: number; shipmentId: string }[]; zplError: string }> {
  type Lbl = { label_url?: string; label_zpl_url?: string; label_pdf_url?: string };
  type EpShip = { id: string; tracking_code: string; postage_label?: Lbl | null; selected_rate?: { rate?: string } | null };
  const o = await ep<{ id: string; shipments: EpShip[] }>(`/orders/${orderId}/buy`, { carrier, service });
  const out: { tracking: string; labelUrl: string; zplUrl: string; zpl: string; cost: number; shipmentId: string }[] = [];
  let zplError = "";
  for (const sh of o.shipments || []) {
    // bought as ZPL (Nov 19 2026: a FedEx label bought as a PDF couldn't be turned into ZPL afterwards, so #50026 never printed)
    let lbl: Lbl = sh.postage_label || {};
    if (!lbl.label_zpl_url) {
      try { lbl = { ...lbl, ...((await epGet<EpShip>(`/shipments/${sh.id}/label?file_format=ZPL`)).postage_label || {}) }; } catch (e) { zplError = e instanceof Error ? e.message : String(e); }
    }
    const zplUrl = lbl.label_zpl_url || (/\.zpl(\?|$)/i.test(lbl.label_url || "") ? lbl.label_url! : "");
    const zpl = zplUrl ? await fetch(zplUrl, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => "") : "";
    if (!zpl && !zplError) zplError = "FedEx didn't send the label in the Zebra's format.";
    // a PDF too, to open and print another way
    if (!lbl.label_pdf_url) { try { lbl = { ...lbl, ...((await epGet<EpShip>(`/shipments/${sh.id}/label?file_format=PDF`)).postage_label || {}) }; } catch { /* the Zebra's is enough */ } }
    const view = lbl.label_pdf_url || (/\.(pdf|png)(\?|$)/i.test(lbl.label_url || "") ? lbl.label_url! : "");
    out.push({ tracking: sh.tracking_code || "", labelUrl: view, zplUrl, zpl, cost: Math.round((+(sh.selected_rate?.rate || 0) || 0) * 100) / 100, shipmentId: sh.id });
  }
  return { boxes: out, zplError };
}

/** a bought label again, in the Zebra's format (Reprint labels): by its EasyPost shipment, else by its ZPL file */
export async function labelZpl(box: { ep_id?: string; zpl_url?: string }): Promise<string> {
  let u = box.zpl_url || "";
  if (!u && box.ep_id) u = (await epGet<{ postage_label?: { label_zpl_url?: string } }>(`/shipments/${box.ep_id}/label?file_format=ZPL`)).postage_label?.label_zpl_url || "";
  if (!u) throw new Error("No Zebra label for this box (bought before labels came as ZPL): print its PDF instead.");
  const t = await fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (!t) throw new Error("Couldn't load the label from FedEx. Try again.");
  return t;
}
