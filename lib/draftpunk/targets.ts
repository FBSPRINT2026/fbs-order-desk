/**
 * What a style should hit, as a ratio and not a range (Nick, Nov 24 2026: "30 IBU at 1.050 Oktoberfest is probably too
 * hoppy… it's the wrong ratio of bitterness to malt for that style"). Bitterness is judged against gravity: BU:GU =
 * IBU ÷ gravity points. Each style starts from its guide's middle (middle IBU over middle OG, the way the published
 * BU:GU charts are made) and learns from the beers that did well: medals and high scores in that style pull the target
 * toward what they had, more the better they did. The same for gravity: a competition beer aims for the upper part of
 * the style's range, where judges reward the bigger examples.
 */
import type { Style } from "./styles";

export type Point = { buGu: number; og: number; score?: number; medal?: boolean; dialed?: boolean };
export type Target = { buGu: number; band: [number, number]; og: [number, number]; from: "guide" | "learned"; n: number };

const mid = (x: [number, number]) => (x[0] + x[1]) / 2;
const pts = (og: number) => (og - 1) * 1000;
export const guideBuGu = (s: Style) => mid(s.ibu) / pts(mid(s.og));

/** how much a beer counts: a medal most, then each point a judge gave over 30; a recipe marked dialed in a little */
const weight = (p: Point) => (p.medal ? 3 : 0) + (p.score && p.score > 30 ? (p.score - 30) / 4 : 0) + (p.dialed ? 0.5 : 0);

export function styleTarget(s: Style, goal: "house" | "competition", points: Point[] = []): Target {
  const g = guideBuGu(s);
  const good = points.filter((p) => weight(p) > 0 && p.buGu > 0);
  const w = good.reduce((t, p) => t + weight(p), 0);
  // the guide counts as two average beers, so one result moves it a little and many move it a lot
  const buGu = (g * 2 + good.reduce((t, p) => t + p.buGu * weight(p), 0)) / (2 + w);
  const ogLearned = good.length ? good.reduce((t, p) => t + p.og * weight(p), 0) / w : 0;
  const [lo, hi] = s.og, span = hi - lo;
  let og: [number, number] = goal === "competition" ? [lo + span * 0.6, hi + 0.002] : [lo + span * 0.25, lo + span * 0.75];
  if (ogLearned && good.length >= 2) og = [Math.min(og[0], ogLearned - 0.002), Math.max(og[1], ogLearned + 0.002)];
  const tol = Math.max(0.03, buGu * 0.07);
  return { buGu, band: [buGu - tol, buGu + tol], og: [r3(og[0]), r3(og[1])], from: good.length ? "learned" : "guide", n: good.length };
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** one line saying what to do about the bitterness, in IBU */
export function bitternessAdvice(og: number, ibu: number, t: Target): string {
  const want = t.buGu * pts(og), d = Math.round(want - ibu);
  const ratio = ibu / Math.max(1, pts(og));
  if (ratio >= t.band[0] && ratio <= t.band[1]) return "Bitterness is right for the gravity";
  return d > 0 ? `Add about ${d} IBU for this gravity` : `Drop about ${-d} IBU for this gravity`;
}
export function gravityAdvice(og: number, t: Target, goal: "house" | "competition"): string {
  if (og < t.og[0]) return `${goal === "competition" ? "For competition, aim" : "Aim"} for ${t.og[0].toFixed(3)}–${t.og[1].toFixed(3)}`;
  if (og > t.og[1] + 0.004) return `Bigger than ${goal === "competition" ? "winning examples" : "the style"} usually go (${t.og[1].toFixed(3)})`;
  return goal === "competition" ? "Right where winning examples sit" : "In the sweet spot";
}
