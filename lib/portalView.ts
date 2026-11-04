import { calcOrder, type Order, type Settings } from "@/lib/pricing";
import { digitizeState } from "@/lib/digitizeStatus";

/**
 * An order the customer sent in never disappears from their portal (Nov 4, Nick: "if they send in an order, it can never
 * disappear from their system… it should just remain in the status it was until we send it to the customer… so we're
 * working on it at that point"). While we build it (status "quote", not sent yet) they see what they sent, still "Sent
 * to FBS", never our draft or its prices. When an embroidered logo on it is out for digitizing, the note says so (the
 * customer has to see a sew-out before we quote it).
 *
 * The portal's order reads use `SENT_OR_SHOWN` instead of hiding every unsent quote, and pass each order through
 * `asCustomerSees`.
 */
export const SENT_OR_SHOWN = "status.neq.quote,submitted_at.not.is.null";

/** the logos' digitizing requests (designs.specs) for these orders' embroidered prints */
export async function designSpecsFor(db: { from: (t: string) => any }, orders: Order[]): Promise<Record<string, unknown>> {
  const ids = [...new Set(orders.filter((o) => o.status === "quote" && o.submitted_at).flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery" && im.design_id).map((im) => im.design_id as string))))];
  if (!ids.length) return {};
  const { data } = await db.from("designs").select("id, specs").in("id", ids.slice(0, 300));
  return Object.fromEntries(((data || []) as { id: string; specs: unknown }[]).map((d) => [d.id, d]));
}

export type Working = { /** sent in, and we're building it */ working?: boolean; /** a logo on it is being digitized */ digitizing?: boolean };

type Kept = Partial<Pick<Order, "groups" | "fees" | "nickname" | "due_date" | "po_number" | "delivery_method" | "notes" | "qty" | "price_type">> & { lines?: unknown; ship_to?: unknown };

export function asCustomerSees<T extends Order>(o: T, settings?: Settings): T & Working {
  if (o.status !== "quote" || !o.submitted_at) return o;
  const designs = (o as { designSpecs?: Record<string, unknown> }).designSpecs || {};
  const digitizing = (o.groups || []).some((g) => (g.imprints || []).some((im) => im.method === "embroidery" && ["asked", "done", "sent"].includes(digitizeState(im, im.design_id ? (designs[im.design_id] as never) : null, undefined).state)));
  const orig = ((o as { request_original?: Kept | null }).request_original || null) as Kept | null;
  const sent = orig ? ({ ...o, ...Object.fromEntries(Object.entries(orig).filter(([k, v]) => k !== "kept_at" && v !== undefined)) } as T) : o;
  const total = orig && settings ? calcOrder({ ...sent, discount: 0 } as T, settings, []).total : 0;
  return { ...sent, status: "request", total, working: true, digitizing };
}
