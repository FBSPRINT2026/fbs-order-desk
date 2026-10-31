import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A customer's Create order trainings (order_trainings, migration 250; Oct 30, Nick: one customer can need several —
 * Nine18's orders for All My Sons, Armstrong, Johnson… each its own rules). Which ones a job uses: the trainings whose
 * words ("AMS, All My Sons") are in the job (whole words, any case); when none of those hit, the ones with no words
 * (every job of theirs). Used by the reader (lib/ai/emailOrder.ts), Create order's "make it with the rules" pop-up and
 * the training pages.
 */
export type Training = { id: string; customer_id: string; name: string; when_words: string; rules: string; updated_at?: string; updated_by?: string };
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
  const { data } = await sb.from("order_trainings").select("id, customer_id, name, when_words, rules, updated_at, updated_by").eq("customer_id", customerId).is("archived_at", null).order("created_at");
  return (data || []) as Training[];
}
