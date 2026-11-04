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

/** where a print can't be digitizing any more */
const PAST = new Set(["ready", "completed", "void"]);

/** the logos' digitizing requests (designs.specs) for these orders' embroidered prints */
export async function designSpecsFor(db: { from: (t: string) => any }, orders: Order[]): Promise<Record<string, unknown>> {
  const ids = [...new Set(orders.filter((o) => !PAST.has(o.status)).flatMap((o) => (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery" && im.design_id).map((im) => im.design_id as string))))];
  const out: Record<string, unknown> = {};
  for (let k = 0; k < ids.length; k += 200) {
    const { data } = await db.from("designs").select("id, specs").in("id", ids.slice(k, k + 200));
    for (const d of (data || []) as { id: string; specs: unknown }[]) out[d.id] = d;
  }
  return out;
}

/**
 * The customer's status while a logo on the order is in digitizing (Nov 4, Nick: "when we send the… email and you
 * request it to be digitized, that's the same thing as… a status change. So the customer knows, oh, we've sent this off
 * to be digitized already"): "Digitizing" from the request to the digitizer until the sew-out goes to them, then "Approve
 * your sew-out". Any order, sent in or confirmed; none once it's ready or done.
 */
export function digitizeNote(o: Pick<Order, "status" | "groups">, specs: Record<string, unknown>): "" | "Digitizing" | "Approve your sew-out" {
  if (PAST.has(o.status)) return "";
  const states = (o.groups || []).flatMap((g) => (g.imprints || []).filter((im) => im.method === "embroidery").map((im) => digitizeState(im, im.design_id ? (specs[im.design_id] as never) : null, undefined).state));
  return states.includes("sent") ? "Approve your sew-out" : states.some((x) => x === "asked" || x === "done") ? "Digitizing" : "";
}

export type Working = { /** sent in, and we're building it */ working?: boolean; /** a logo on it is in digitizing (digitizeNote) */ digitizing?: string };

type Kept = Partial<Pick<Order, "groups" | "fees" | "nickname" | "due_date" | "po_number" | "delivery_method" | "notes" | "qty" | "price_type">> & { lines?: unknown; ship_to?: unknown };

/** the order as the customer sees it: its digitizing note, and an order they sent in shown as sent while we build it */
export function asCustomerSees<T extends Order>(o: T, settings?: Settings, specs: Record<string, unknown> = {}): T & Working {
  const digitizing = digitizeNote(o, specs);
  if (o.status !== "quote" || !o.submitted_at) return { ...o, digitizing };
  const orig = ((o as { request_original?: Kept | null }).request_original || null) as Kept | null;
  const sent = orig ? ({ ...o, ...Object.fromEntries(Object.entries(orig).filter(([k, v]) => k !== "kept_at" && v !== undefined)) } as T) : o;
  const total = orig && settings ? calcOrder({ ...sent, discount: 0 } as T, settings, []).total : 0;
  return { ...sent, status: "request", total, working: true, digitizing };
}
