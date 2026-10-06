import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings, orderGroups, sizeLabel, SIZES, METHODS, ST, type Order, type Customer } from "@/lib/pricing";
import { addressLines, plain, sizeLabel as pvSizeLabel, sizeOrder as pvSizeOrder, type PvOrder } from "@/lib/archive";

/**
 * One job, the same shape whether it's a portal order (#1461) or a Printavo order (#34110): what the phone menu, the
 * Zebra box labels and the press crew need. Scanned codes look like "34110", "#34110", "34110-2" (box 2) or a job link
 * (".../j/34110-2").
 */
export type JobRow = { style: string; color: string; desc: string; sizes: { label: string; qty: number }[]; total: number };
export type JobPrint = { location: string; method: string; colors: string; inks: string; size: string; drop: string; notes: string; designId?: string; image?: string };
export type JobGroup = { name: string; rows: JobRow[]; prints: JobPrint[] };
export type JobCard = {
  kind: "o" | "a"; id: string; number: string; name: string; customerId: string | null; customer: string; contact: string; phone: string;
  po: string; due: string | null; production: string | null; rush: boolean; status: string; qty: number;
  delivery: "ship" | "deliver" | "pickup"; shipMethod: string; tracking: string; shipTo: string[];
  /** wholesale jobs ship blind: the customer's name instead of ours */
  brand: string; blind: boolean;
  groups: JobGroup[];
  customerNote: string; productionNote: string;
  /** the shop's page for the job */
  href: string;
};

export function parseJobCode(text: string): { number: string; box: number | null } | null {
  const t = decodeURIComponent(String(text || "")).trim();
  const m = t.match(/\/j\/#?(\d{3,7})(?:-(\d{1,3}))?/) || t.match(/^#?(\d{3,7})(?:-(\d{1,3}))?$/) || t.match(/#?(\d{3,7})(?:-(\d{1,3}))?/);
  return m ? { number: m[1], box: m[2] ? +m[2] : null } : null;
}

const DELIV = (s: string): JobCard["delivery"] => (/ship|ups|fedex|usps|freight/i.test(s) ? "ship" : /deliver/i.test(s) ? "deliver" : "pickup");

export async function loadJobCard(admin: SupabaseClient, ref: { number: string } | { kind: "o" | "a"; id: string }): Promise<JobCard | null> {
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const shopName = mergeSettings(s?.data).shop.name || "FBS Print";
  const byId = "id" in ref;

  // a portal order first (its numbers are below Printavo's), then Printavo
  if (!byId || ref.kind === "o") {
    const q = admin.from("orders").select("*");
    const { data: od } = byId ? await q.eq("id", ref.id).maybeSingle() : await q.eq("number", +ref.number).maybeSingle();
    if (od) {
      const o = od as Order;
      const [{ data: c }, { data: inn }] = await Promise.all([
        o.customer_id ? admin.from("customers").select("*").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
        admin.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle(),
      ]);
      const cu = (c || {}) as Partial<Customer>;
      const blind = o.price_type === "wholesale";
      const groups: JobGroup[] = orderGroups(o).map((g, gi) => ({
        name: g.name?.trim() || `Group ${gi + 1}`,
        rows: g.lines.filter((l) => SIZES.some((z) => l.sizes?.[z])).map((l) => {
          const sizes = SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => ({ label: sizeLabel(z), qty: +(l.sizes?.[z] || 0) }));
          return { style: l.style || "", color: l.color || "", desc: l.garment || "", sizes, total: sizes.reduce((a, x) => a + x.qty, 0) };
        }),
        prints: g.imprints.map((d) => ({
          location: d.location || "", method: METHODS[d.method] || d.method || "", colors: d.method === "screen" ? (d.colors >= 11 ? "Full color" : `${d.colors} color${d.colors === 1 ? "" : "s"}`) : d.method === "embroidery" ? `${d.colors} thread${d.colors === 1 ? "" : "s"}` : "Full color",
          inks: d.inks || "", size: d.size || "", drop: d.drop ? `${d.drop}" from collar` : "", notes: d.notes || "", designId: d.design_id,
        })),
      }));
      return {
        kind: "o", id: o.id, number: String(o.number), name: o.nickname || "", customerId: o.customer_id || null, customer: cu.company || cu.name || "", contact: cu.company ? cu.name || "" : "", phone: cu.phone || "",
        po: o.po_number || "", due: o.due_date, production: o.production_date || null, rush: !!o.rush, status: ST[o.status as keyof typeof ST]?.label || o.status, qty: o.qty || groups.reduce((a, g) => a + g.rows.reduce((b, r) => b + r.total, 0), 0),
        delivery: (o.delivery_method as JobCard["delivery"]) || "pickup", shipMethod: o.ship_method || "", tracking: o.tracking || "",
        shipTo: o.delivery_method !== "pickup" && o.ship_to ? [...(!blind && (cu.company || cu.name) ? [cu.company || cu.name || ""] : []), ...o.ship_to.split(/\n/).map((x) => x.trim()).filter(Boolean)] : [],
        brand: blind ? cu.company || cu.name || "" : shopName, blind,
        groups, customerNote: o.notes || "", productionNote: (inn?.production_notes as string) || "", href: `/shop/orders/${o.id}`,
      };
    }
    if (byId) return null;
  }

  const q = admin.from("archived_orders").select("id, visual_id, nickname, status_name, due_date, qty, po_number, customer_id, data");
  const { data: a } = byId ? await q.eq("id", ref.id).maybeSingle() : await q.eq("visual_id", ref.number).maybeSingle();
  if (!a) return null;
  const d = (a.data || {}) as PvOrder;
  const { data: c } = a.customer_id ? await admin.from("customers").select("company, name, phone").eq("id", a.customer_id).maybeSingle() : { data: null };
  const groups: JobGroup[] = (d.groups || []).map((g, gi) => ({
    name: `Group ${gi + 1}`,
    rows: (g.lines || []).filter((l) => Object.values(l.sizes || {}).some((n) => +n > 0)).map((l) => {
      const sizes = Object.entries(l.sizes || {}).filter(([, n]) => +n > 0).sort(([x], [y]) => pvSizeOrder(x, y)).map(([k, n]) => ({ label: pvSizeLabel(k), qty: +n }));
      return { style: l.itemNumber || "", color: l.color || "", desc: [l.brand, l.description].filter(Boolean).join(" "), sizes, total: sizes.reduce((x, y) => x + y.qty, 0) };
    }),
    prints: (g.imprints || []).map((im) => ({ location: "", method: im.typeOfWork || "", colors: "", inks: "", size: "", drop: "", notes: plain(im.details), image: im.mockups?.[0]?.thumb || im.mockups?.[0]?.full || "" })),
  }));
  const blind = /wholesale/i.test((d.tags || []).join(" "));
  return {
    kind: "a", id: a.id, number: String(a.visual_id), name: a.nickname || d.nickname || "", customerId: a.customer_id || null, customer: c?.company || c?.name || d.customer?.companyName || "", contact: d.contact?.fullName || "", phone: d.contact?.phone || c?.phone || "",
    po: a.po_number || d.poNumber || "", due: a.due_date, production: d.startAt ? d.startAt.slice(0, 10) : null, rush: /rush/i.test([a.status_name, ...(d.tags || [])].join(" ")), status: a.status_name || "", qty: +(a.qty || d.totalQuantity || 0),
    delivery: DELIV(d.deliveryMethod || ""), shipMethod: /ups|fedex|usps/i.test(d.deliveryMethod || "") ? d.deliveryMethod : "", tracking: "",
    shipTo: DELIV(d.deliveryMethod || "") === "pickup" ? [] : addressLines(d.shippingAddress),
    brand: blind ? c?.company || c?.name || "" : shopName, blind,
    groups, customerNote: plain(d.customerNote), productionNote: plain(d.productionNote), href: `/shop/archive/${a.id}`,
  };
}
