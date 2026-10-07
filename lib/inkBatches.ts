import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** PMS batches mixed in the ink room (ink_batches, migration 110). */
export type Batch = { id: string; code: string; qt: number; grams: number | null; job: string; note: string; made_by: string; made_at: string };
export const BATCH_COLS = "id, code, qt, grams, job, note, made_by, made_at";

/** the last batches of each color (newest first); codes match without regard to case ("Cool Gray 7 C" / "COOL GRAY 7 C") */
export async function batchesFor(admin: SupabaseClient, codes: string[], per = 8): Promise<Batch[]> {
  const cs = [...new Set(codes.map((c) => c.replace(/[,()*%\\]/g, "").trim()).filter(Boolean))].slice(0, 40);
  if (!cs.length) return [];
  const { data } = await admin.from("ink_batches").select(BATCH_COLS).eq("system", "RX").is("archived_at", null).or(cs.map((c) => `code.ilike.${c}`).join(",")).order("made_at", { ascending: false }).limit(per * cs.length);
  const seen = new Map<string, number>();
  return ((data || []) as Batch[]).filter((b) => { const k = b.code.toUpperCase(); const n = seen.get(k) || 0; seen.set(k, n + 1); return n < per; });
}
