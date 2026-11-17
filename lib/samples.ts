/**
 * Sample runs (Nov 11 2026, Nick). Two kinds, both made with the one Sample tool (components/tools/SampleRunTool.tsx):
 *  - Order + sample: a pre-production sample inside the order ("they want us to run one of each size and send it to him
 *    for a photo shoot… we would produce 500 minus the ones we sampled"). It is its own group on the order (Group.sample,
 *    kind "pre"), its own small card on the schedule, and the order's other groups wait for the customer's OK.
 *  - Sample only: an order of samples on its own ("The Bar has samples… 15 different samples… we don't know if they're
 *    gonna order it"), each group a sample (kind "only"). "Make the order" starts the real order from one of them,
 *    linked both ways (Order.from_sample / GroupSample.made).
 * How samples are charged is "all over the map", so there's no rule: each charge is its own row (a flat sample fee, a
 * setup, PMS, the pieces, anything typed), and each can be credited back on the full run (paid on the sample, taken
 * off the real order: "we'll charge you for the screens… if you use the screens in the end").
 */
import type { GLine, Group } from "@/lib/pricing";

export type SampleKind = "pre" | "only";
/** where the sample's pieces come from: off the top of the order's own goods (the run is that many fewer), extra
 *  pieces the customer sent for it, or extra blanks we order for it */
export type SampleSource = "top" | "customer" | "extra";
export type SampleStage = "planned" | "pulled" | "printed" | "approved";
export type SampleCharge = { id: string; label: string; amount: number | "";
  /** paid on the sample and taken off the full run (a credit on the real order) */ credit?: boolean };
export type GroupSample = {
  kind: SampleKind; source: SampleSource; charges: SampleCharge[];
  /** the day it's meant to print (yyyy-mm-dd) */ runOn?: string; note?: string; stage?: SampleStage;
  /** when each stage was reached, and by whom */ at?: Partial<Record<SampleStage, { at: string; by?: string }>>;
  /** a sample-only design made into an order: that order (Make the order) */ made?: { id: string; number: number };
  /** a pre-production sample of the run itself (Nick, Nov 17 2026, #50122: "we're just running one first… the rest would
   *  come, same artwork, same everything… mockups would be shared"): the run group it follows. Its prints, mockups and
   *  garments' looks are always that group's (syncSamples); only its pieces are its own */ follows?: string;
};
/** an order started from a sample (Make the order): the sample order and its group, and the credit carried over */
export type FromSample = { id: string; number: number; group: string; name?: string; credit: number };

export const SAMPLE_STAGES: { k: SampleStage; label: string }[] = [
  { k: "planned", label: "Planned" }, { k: "pulled", label: "Pulled" }, { k: "printed", label: "Printed" }, { k: "approved", label: "Approved" },
];
export const SOURCE_LABEL: Record<SampleSource, string> = { top: "Off the top", customer: "Extra from customer", extra: "Order extra blanks" };

const n = (v: unknown) => (v === "" || v == null || isNaN(+v) ? 0 : +v);
const r2 = (x: number) => Math.round(x * 100) / 100;
const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

/** the charges a new sample starts with: a flat sample fee; staff add, remove or change anything */
export function startCharges(fee = 20): SampleCharge[] {
  return [{ id: uid(), label: "Sample fee", amount: fee }];
}
/** what the sample costs on this order: every charge (a credited one is still paid here) */
export const sampleCharged = (s: GroupSample | null | undefined) => r2((s?.charges || []).reduce((a, c) => a + n(c.amount), 0));
/** what's credited back on the full run */
export const sampleCredit = (s: GroupSample | null | undefined) => r2((s?.charges || []).filter((c) => c.credit).reduce((a, c) => a + n(c.amount), 0));

/** a group's pieces (every size of every line) */
const pieces = (l: Pick<GLine, "sizes">) => Object.values(l.sizes || {}).reduce((a: number, v) => a + n(v), 0);
export const samplePieces = (g: Pick<Group, "lines">) => (g.lines || []).reduce((a, l) => a + pieces(l), 0);

/** the order's pre-production sample groups that take their pieces off the top of another line: by that line's id,
 *  the pieces per size the run prints fewer of (GLine.sampleOf links a sample line to the line it's pulled from) */
export function offTheTop(groups: Group[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const g of groups) {
    if (g.sample?.kind !== "pre" || g.sample.source !== "top") continue;
    for (const l of g.lines || []) {
      if (!l.sampleOf) continue;
      const m = out.get(l.sampleOf) || {};
      for (const [k, v] of Object.entries(l.sizes || {})) if (n(v)) m[k] = (m[k] || 0) + n(v);
      out.set(l.sampleOf, m);
    }
  }
  return out;
}
/** the order waits on a sample: a pre-production sample not approved yet (the other groups don't run until it is) */
export const waitsOnSample = (groups: Group[]) => groups.some((g) => g.sample?.kind === "pre" && g.sample.stage !== "approved");
export const isSampleGroup = (g: Pick<Group, "sample">) => !!g.sample;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ART_KEYS = ["mockupThumbs", "mockupArt", "mockupKind", "mockupSize", "mockupOffsets", "mockupZoom", "mockupAt", "visualMockup", "customerMockups", "mockupBg", "youthSet"] as const;
/**
 * A pre-production sample that follows its run (GroupSample.follows) takes the run's art every time the order is read or
 * changed: the same prints (each keeps a stable id of its own, `<run print id>~s`), the same mockups, and each sample line
 * the look of the line it's pulled from (its sizes stay its own). One set of art, so the sample and the run can't drift
 * (Nov 17, #50122: a mockup made on the sample group moved its prints and left the run with none). In place; returns groups.
 */
export function syncSamples<G extends Group>(groups: G[]): G[] {
  if (!groups?.some((g) => g.sample?.follows)) return groups;
  for (const g of groups) {
    const f = g.sample?.follows; if (!f) continue;
    const run = groups.find((x) => x.id === f && !x.sample);
    if (!run) continue;
    g.imprints = (run.imprints || []).map((p) => ({ ...clone(p), id: `${p.id}~s`, fromPrint: p.id, changeOf: undefined }));
    const gr = g as unknown as Record<string, unknown>, rr = run as unknown as Record<string, unknown>;
    for (const k of ART_KEYS) { if (rr[k] !== undefined) gr[k] = clone(rr[k]); else delete gr[k]; }
    g.lines = (g.lines || []).map((l) => {
      const src = l.sampleOf ? run.lines.find((x) => x.id === l.sampleOf) : undefined;
      return src ? { ...clone(src), id: l.id, sizes: l.sizes, priceOverride: null, sampleOf: src.id, extras: undefined, shopUse: undefined } as GLine : l;
    }).filter((l) => !l.sampleOf || run.lines.some((x) => x.id === l.sampleOf));
  }
  return groups;
}
/** the sample that follows this run group, if any */
export const sampleOfRun = <G extends Group>(groups: G[], runId: string): G | undefined => groups.find((g) => g.sample?.kind === "pre" && g.sample.follows === runId);
/** the sample's pieces in words: "M 1", "S 1 · M 1 · L 1" */
export const samplePiecesText = (g: Pick<Group, "lines">) => {
  const by = new Map<string, number>();
  for (const l of g.lines || []) for (const [k, v] of Object.entries(l.sizes || {})) if (n(v)) by.set(k, (by.get(k) || 0) + n(v));
  return [...by].map(([k, v]) => `${k} ${v}`).join(" · ");
};

/** the order's groups as production runs them, in two parts (the schedule, the work order): the sample's groups, and
 *  the rest with the pieces taken off the top for the sample left out */
export function runParts(groups: Group[]): { sample: Group[]; rest: Group[] } {
  syncSamples(groups);
  const top = offTheTop(groups);
  const sample = groups.filter((g) => g.sample?.kind === "pre");
  const rest = groups.filter((g) => g.sample?.kind !== "pre").map((g) => (g.lines.some((l) => top.has(l.id)) ? { ...g, lines: g.lines.map((l) => {
    const m = top.get(l.id); if (!m) return l;
    const sizes = Object.fromEntries(Object.entries(l.sizes || {}).map(([k, v]) => [k, Math.max(0, n(v) - (m[k] || 0))])) as GLine["sizes"];
    return { ...l, sizes };
  }) } : g));
  return { sample, rest };
}
/** the day a pre-production sample runs (the earliest one's), if set */
export const sampleRunOn = (groups: Group[]) => groups.filter((g) => g.sample?.kind === "pre" && g.sample.runOn).map((g) => g.sample!.runOn!).sort()[0] || null;
/** the groups whose pieces are goods: a sample taken off the top is the order's own pieces (never counted or ordered
 *  twice); extra pieces the customer sends are counted in but never ordered from a supplier */
export const goodsGroups = <G extends Pick<Group, "sample">>(groups: G[], ordering = false) =>
  groups.filter((g) => !(g.sample?.kind === "pre" && (g.sample.source === "top" || (ordering && g.sample.source === "customer"))));

/**
 * A sample's charges on its own garment lines, as the customer reads them (Nick, Nov 17 2026, #50122: "the invoice doesn't
 * show the… fee for the sample… It should be $20"): the printed invoice and QuickBooks show the sample's pieces at what the
 * sample costs (1 × $20.00 = $20.00), never at $0.00 with the fee as a row under them. Its charges are spread over its
 * pieces (the last line takes any odd cent); a credit back on the full run stays its own row. With no pieces, the charges
 * stay rows. `lines` are the group's calc lines in order; returns them changed and the charge rows still to show.
 */
export function sampleOnLines<L extends { qty: number; each: number; sub: number }, C extends { id: string; amount: number | "" }>(lines: L[], charges: C[]): { lines: L[]; rows: C[] } {
  const fold = charges.filter((c) => n(c.amount) > 0), rest = charges.filter((c) => !(n(c.amount) > 0));
  const fee = r2(fold.reduce((a, c) => a + n(c.amount), 0)), q = lines.reduce((a, l) => a + (l.qty || 0), 0);
  if (!fee || !q) return { lines, rows: charges };
  let left = fee; const last = lines.map((l) => l.qty > 0).lastIndexOf(true);
  const out = lines.map((l, i) => {
    if (!(l.qty > 0)) return l;
    const sub = i === last ? r2(left) : r2((fee * l.qty) / q); left = r2(left - sub);
    return { ...l, each: r2((l.sub + sub) / l.qty), sub: r2(l.sub + sub) };
  });
  return { lines: out, rows: rest };
}
