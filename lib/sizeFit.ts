/**
 * Sizes a garment style really comes in (Oct 30, Nick: "you brought in PC099Y as all of it… there's no PC099Y adult
 * sizes… this is an error"). A customer often writes one style for a whole size run (the youth number with adult sizes
 * on it, the adult number with YL on it, a tall style with M). The catalog knows each style's sizes, so a size the
 * style doesn't come in belongs on its sister style: youth ↔ adult, toddler, infant. Shared by the server
 * (lib/garmentSister.ts finds the sister) and every place an order's garments are set (components/SizeFit.tsx).
 */
import { BABY_SIZES, TODDLER_SIZES, YOUTH_SIZES, ONE_SIZE, SIZES, isWaist } from "@/lib/pricing";
import { sizeRank } from "@/lib/sizeOrder";

export type SizeKind = "infant" | "toddler" | "youth" | "adult";
export const KIND_WORD: Record<SizeKind, string> = { infant: "infant", toddler: "toddler", youth: "youth", adult: "adult" };

export function sizeKind(z: string): SizeKind | null {
  if (z === ONE_SIZE) return null;
  if ((BABY_SIZES as readonly string[]).includes(z)) return "infant";
  if ((TODDLER_SIZES as readonly string[]).includes(z)) return "toddler";
  if ((YOUTH_SIZES as readonly string[]).includes(z)) return "youth";
  // waist sizes (shorts, pants) have no youth / adult sister style to move to
  if (isWaist(z)) return null;
  return (SIZES as readonly string[]).includes(z) ? "adult" : null;
}

/** our sizes in a catalog run (a tall style's LT, XLT aren't ours: it just has none of ours) */
export const ourRun = (run: string[] | null | undefined) => (run || []).filter((z) => (SIZES as readonly string[]).includes(z));

/**
 * The quantities on a line its style doesn't come in, by size kind. Nothing when the run is unknown, or the style is a
 * one-size item (hats: their fitted size is a note, not a size).
 */
export function offRun(sizes: Record<string, number | string | undefined> | null | undefined, run: string[] | null | undefined): Partial<Record<SizeKind, Record<string, number>>> {
  const ours = ourRun(run);
  if (!ours.length || (ours.length === 1 && ours[0] === ONE_SIZE)) return {};
  const out: Partial<Record<SizeKind, Record<string, number>>> = {};
  for (const [z, v] of Object.entries(sizes || {})) {
    const q = Math.floor(+(v || 0));
    if (q <= 0 || ours.includes(z)) continue;
    const k = sizeKind(z); if (!k) continue;
    (out[k] ||= {})[z] = q;
  }
  return out;
}

/**
 * A youth-only style ordered in plain sizes (S, M, L) and nothing else: SanMar and S&S label youth sizes XS–XL, so they
 * may mean youth S, M, L, or the adult style. Asked, never guessed. Returns the youth sizes they'd be, or null.
 */
const AS_YOUTH: Record<string, string> = { XS: "YXS", S: "YS", M: "YM", L: "YL", XL: "YXL" };
export function asYouth(sizes: Record<string, number | string | undefined> | null | undefined, run: string[] | null | undefined): Record<string, number> | null {
  const ours = ourRun(run);
  if (!ours.length || !ours.every((z) => sizeKind(z) === "youth")) return null;
  const out: Record<string, number> = {};
  for (const [z, v] of Object.entries(sizes || {})) {
    const q = Math.floor(+(v || 0)); if (q <= 0) continue;
    const y = AS_YOUTH[z]; if (!y || !ours.includes(y)) return null; // a 2XL or a size it lacks: adult sizes, not youth
    out[y] = (out[y] || 0) + q;
  }
  return Object.keys(out).length ? out : null;
}

export const sizesText = (s: Record<string, number>) => Object.entries(s).sort(([a], [b]) => sizeRank(a) - sizeRank(b)).map(([z, q]) => `${z} ${q}`).join(", ");
export const pcsOf = (s: Record<string, number>) => Object.values(s).reduce((a, v) => a + (+v || 0), 0);
