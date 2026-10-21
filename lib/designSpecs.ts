import type { SupabaseClient } from "@supabase/supabase-js";
import type { Group, Imprint } from "@/lib/pricing";

/**
 * Confirmed print specs (Oct 14, Nick: "once production confirms, those notes are the Bible, set in stone… we only do
 * this once for each design"). A reorder of an old Printavo job comes in with guesses (Imprint.confirm). When
 * production confirms a print (Reorder Details, or the order's Reorder section), how it printed is saved on the
 * customer's design (designs.specs):
 *  - `history`: every confirmation, never overwritten (a later one that differs is kept beside the earlier one);
 *  - each entry says which old job the order repeated (`job`, "Printavo #31174" / "#40012") and the order it was
 *    confirmed on.
 * The next reorder of the same job (or of the order it was confirmed on) takes the confirmed specs straight away, with
 * "Production confirmed Oct 14 (#40071)" on the print. Guesses never get here.
 */
export type SpecEntry = {
  location: string; method: string; size: string; drop: string; inks: string; colors: number; underbase?: boolean;
  garment?: string; notes?: string; /** it only runs on this press */ press?: { id: string; name: string };
  /** shirt color → screens left off on it */ skip?: Record<string, string[]>;
  /** times around the press */ rounds?: number;
  by: string; at: string; order_id: string; order_number: number; /** the old job this order repeated */ job?: string;
};
export type DesignSpecs = { history?: SpecEntry[] };

/** "Reorder of Printavo #31174." / "Reorder of #40012" → "Printavo #31174" / "#40012" */
export function reorderLabel(text: string | null | undefined): string | null {
  const m = String(text || "").match(/Reorder of (Printavo )?#(\d+)/);
  return m ? `${m[1] ? "Printavo " : ""}#${m[2]}` : null;
}

const loc = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** what differs between two confirmations of the same print, for "differs from what production confirmed on …" */
export function specDiff(a: SpecEntry, b: SpecEntry): string[] {
  const out: string[] = [];
  if ((a.size || "") !== (b.size || "")) out.push(`size ${a.size || "blank"} → ${b.size || "blank"}`);
  if ((a.inks || "") !== (b.inks || "")) out.push(`inks ${a.inks || "blank"} → ${b.inks || "blank"}`);
  if ((a.drop || "") !== (b.drop || "")) out.push(`drop ${a.drop || "standard"} → ${b.drop || "standard"}`);
  if (a.colors !== b.colors) out.push(`colors ${a.colors} → ${b.colors}`);
  if (a.underbase !== b.underbase) out.push(`underbase ${a.underbase === true ? "yes" : a.underbase === false ? "no" : "not sure"} → ${b.underbase === true ? "yes" : b.underbase === false ? "no" : "not sure"}`);
  return out;
}

/** adds a confirmation to a design's history (never replacing one); the differences from the last confirmation of the same print */
export function addSpec(specs: DesignSpecs | null | undefined, e: SpecEntry): { specs: DesignSpecs; differs: string; } {
  const history = [...(specs?.history || [])];
  const prev = [...history].reverse().find((h) => loc(h.location) === loc(e.location));
  history.push(e);
  const d = prev ? specDiff(prev, e) : [];
  return { specs: { ...(specs || {}), history: history.slice(-60) }, differs: d.length ? `differs from what production confirmed ${day(prev!.at)} on #${prev!.order_number}: ${d.join(", ")}` : "" };
}

/** the latest confirmation of each print location on a design */
export function latestSpecs(specs: DesignSpecs | null | undefined): SpecEntry[] {
  const m = new Map<string, SpecEntry>();
  for (const h of specs?.history || []) m.set(loc(h.location), h);
  return [...m.values()];
}

/** a confirmed spec onto a print: the values, the design, and "confirmed (from #N)" instead of the guess flag */
export function applySpec(im: Imprint, e: SpecEntry, designId: string) {
  im.size = e.size; im.inks = e.inks; im.drop = e.drop;
  if (e.colors >= 1 && e.colors <= 20) im.colors = e.colors;
  if (e.underbase === undefined) delete im.underbase; else im.underbase = e.underbase;
  if (e.size) im.sizeFrom = "film";
  if (e.press?.id) im.pressOnly = { id: e.press.id, name: e.press.name };
  if (e.skip && Object.keys(e.skip).length) im.byColor = { skip: e.skip };
  if (e.rounds && e.rounds > 1) im.rounds = e.rounds;
  im.design_id = designId;
  delete im.confirm;
  im.confirmed = { by: e.by, at: e.at, from: `#${e.order_number}` };
}

/**
 * A new reorder of a job production already confirmed (the same old Printavo job, or the order it was confirmed on):
 * each guessed print takes the confirmed specs of the same location. Returns what it took, for the order's history.
 */
export async function applyConfirmedSpecs(admin: SupabaseClient, customerId: string, job: string | null, groups: Group[]): Promise<string[]> {
  if (!job) return [];
  const guessed = groups.flatMap((g) => g.imprints).filter((im) => im.confirm && (im.confirm.size || im.confirm.ink));
  if (!guessed.length) return [];
  const { data } = await admin.from("designs").select("id, name, specs").eq("customer_id", customerId).not("specs->history", "is", null).limit(500);
  const cands: { id: string; e: SpecEntry }[] = [];
  for (const d of (data || []) as { id: string; specs: DesignSpecs }[]) for (const e of latestSpecs(d.specs)) if (e.job === job || `#${e.order_number}` === job) cands.push({ id: d.id, e });
  const took: string[] = [];
  for (const im of guessed) {
    const c = cands.filter((x) => loc(x.e.location) === loc(im.location)).sort((a, b) => b.e.at.localeCompare(a.e.at))[0];
    if (!c) continue;
    applySpec(im, c.e, c.id);
    took.push(`${im.location}: ${[c.e.size, c.e.inks].filter(Boolean).join(", ")} (production confirmed ${day(c.e.at)} on #${c.e.order_number})`);
  }
  return took;
}
