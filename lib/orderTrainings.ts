import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A customer's Create order trainings (order_trainings, migration 250; Oct 30, Nick: one customer can need several —
 * Nine18's orders for All My Sons, Armstrong, Johnson… each its own rules). Which ones a job uses: the trainings whose
 * words ("AMS, All My Sons") are in the job (whole words, any case); when none of those hit, the ones with no words
 * (every job of theirs). Used by the reader (lib/ai/emailOrder.ts), Create order's "make it with the rules" pop-up and
 * the training pages.
 */
export type Training = { id: string; customer_id: string; name: string; when_words: string; rules: string; updated_at?: string; updated_by?: string; defaults?: TrainingDefaults };
/**
 * A training's order defaults (order_trainings.defaults, migration 256; Oct 31, Nick on MEI: "the default shipping is
 * always FedEx Ground, unless he says something different in the ClickUp or email… always set to reorder by default with
 * no production confirmation"). Create order puts them on every order the training is for: shipping only when the job
 * itself doesn't name a carrier or pickup. Staff set them on the training; a field staff haven't set is learned from the
 * orders staff mark right (the last ones agree: that's how it's done), see `learnDefaults`.
 */
export type TrainingDefaults = {
  order_type?: "new" | "reorder" | "reorder_changes"; /** production confirms the prints' details (false: never) */ confirm?: boolean;
  delivery_method?: "pickup" | "ship" | "deliver"; ship_method?: string;
  /** they send their own separations (Nov 10, Nick on Tiger Blue: "he supplies… the separations… gives us visual
   *  mock-ups"): every screen print is printed from their films, their picture is the mockup (the proof), the inks are read
   *  off it, nothing goes to separations: the same as the Order helper's "their separations" files */ own_seps?: boolean;
  /** the fields staff set (learning leaves them alone) */ set?: string[];
  /** the fields learned, and from which orders ("#40311, #40314") */ learned?: Record<string, string>;
};
export const DEFAULT_FIELDS = ["order_type", "confirm", "delivery_method", "ship_method", "own_seps"] as const;
export type DefaultField = typeof DEFAULT_FIELDS[number];
/** the job names how it goes out (a carrier, a speed, a pickup or delivery): its own words win over a default */
export const SHIP_SAID = /\b(ups|usps|fed ?ex|dhl|on ?trac|overnight|next[- ]day|2nd[- ]day|second[- ]day|two[- ]day|3[- ]day|express saver|priority (mail|overnight)|ground|freight|ltl|pick ?up|picking (it |them )?up|will call|hand[- ]deliver|deliver (it|them)|drop (it|them) off)\b/i;
/** the defaults of the trainings a job uses (the first training that sets a field wins) */
export function defaultsOf(ts: Pick<Training, "defaults">[]): TrainingDefaults {
  const out: TrainingDefaults = {};
  for (const t of ts) for (const f of DEFAULT_FIELDS) { const v = t.defaults?.[f]; if (v !== undefined && v !== "" && out[f] === undefined) (out as Record<string, unknown>)[f] = v; }
  return out;
}
/** words for the defaults ("Reorder · no production confirmation · ship FedEx Ground"), for people (the reader is only
 *  told the shipping: "Reorder" here means known logos with nothing to confirm, never a copy of a past job) */
export function defaultsText(d: TrainingDefaults): string {
  return [
    d.order_type ? ({ new: "New order", reorder: "Reorder", reorder_changes: "Reorder with changes" } as const)[d.order_type] : "",
    d.confirm === false ? "no production confirmation" : d.confirm ? "production confirms details" : "",
    d.own_seps ? "their own separations" : "",
    d.delivery_method ? (d.delivery_method === "ship" ? `ship${d.ship_method ? ` ${d.ship_method}` : ""}` : d.delivery_method === "pickup" ? "pickup" : "we deliver") : d.ship_method ? `ship ${d.ship_method}` : "",
  ].filter(Boolean).join(" · ");
}
export const TRAINING_MAX = 8000;

export const trainingWords = (w: string) => (w || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
/** the training's words are in the text, as whole words */
export const trainingSaid = (t: Pick<Training, "when_words">, text: string) => trainingWords(t.when_words).some((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`, "i").test(text));

/** the trainings a job uses (see above) */
export function trainingsForText(all: Training[], text: string): Training[] {
  const live = all.filter((t) => (t.rules || "").trim());
  const named = live.filter((t) => trainingWords(t.when_words).length && trainingSaid(t, text));
  return named.length ? named : live.filter((t) => !trainingWords(t.when_words).length);
}

export async function customerTrainings(sb: SupabaseClient, customerId: string): Promise<Training[]> {
  const { data } = await sb.from("order_trainings").select("id, customer_id, name, when_words, rules, updated_at, updated_by, defaults").eq("customer_id", customerId).is("archived_at", null).order("created_at");
  return (data || []) as Training[];
}
