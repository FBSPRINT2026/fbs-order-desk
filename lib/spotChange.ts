import { lineQty, type GLine, type Imprint } from "@/lib/pricing";

/**
 * Location change (Oct 30, Nick: "the same logo, same exact file, same exact process… the JST73s get sewn on the left
 * chest, the STC15s on the beanie cuff… like a color change, but make it a location change… only for embroidery"): one
 * embroidery print sewn at another spot on some of the group's garments. A is the print's own location; B, C… the other
 * spots, each on the garments set to it (Imprint.spotBy: garment → spot). One print, one sew file, one digitizing charge.
 */
export const spotKey = (l: Pick<GLine, "style" | "brand" | "id">) => (l.style || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "") || l.id;
/** the spot a garment line sews this print on */
export const spotOf = (im: Pick<Imprint, "location" | "spotBy" | "method">, l: Pick<GLine, "style" | "brand" | "id">) =>
  (im.method === "embroidery" && im.spotBy?.[spotKey(l)]) || im.location || "";
/** the print's spots in order: A (its own location) first, then each other spot */
export function spotsOf(im: Pick<Imprint, "location" | "spotBy" | "method">, lines: GLine[]): string[] {
  const out = [im.location || ""];
  if (im.method !== "embroidery") return out;
  for (const l of lines) { const s = spotOf(im, l); if (s && !out.includes(s)) out.push(s); }
  return out;
}
export const hasSpotChange = (im: Pick<Imprint, "location" | "spotBy" | "method">, lines: GLine[]) => spotsOf(im, lines).length > 1;
/** "A · Left Chest: JST73 (1)" … for the work order and read-outs */
export function spotLines(im: Pick<Imprint, "location" | "spotBy" | "method">, lines: GLine[]): { letter: string; spot: string; what: string; pcs: number }[] {
  return spotsOf(im, lines).map((spot, i) => {
    const ls = lines.filter((l) => spotOf(im, l) === spot && lineQty(l) > 0);
    const by = new Map<string, number>();
    for (const l of ls) by.set(l.style || l.garment || "Garment", (by.get(l.style || l.garment || "Garment") || 0) + lineQty(l));
    return { letter: String.fromCharCode(65 + i), spot, what: [...by].map(([k, q]) => `${k} (${q})`).join(", "), pcs: ls.reduce((a, l) => a + lineQty(l), 0) };
  }).filter((x) => x.pcs > 0 || x.letter === "A");
}

/**
 * The print's own spot (A) is a spot some garment in the group actually sews (Nov 1, Nick on #40345 All My Sons Rhode
 * Island: two jackets, the print said "Cuff" from the beanies' mockup and the jackets showed as location change B,
 * Left Chest: "that's funky"). When no garment sews it at A (the beanies weren't on this order, or were moved out), the
 * spot most pieces sew becomes A and those garments' own entries go; the others keep theirs. True when it changed.
 */
export function needsSettle(im: Pick<Imprint, "location" | "spotBy" | "method">, lines: GLine[]): boolean {
  if (im.method !== "embroidery" || !im.spotBy || !Object.keys(im.spotBy).length) return false;
  const ls = lines.filter((l) => lineQty(l) > 0);
  return ls.length > 0 && !ls.some((l) => spotOf(im, l) === (im.location || ""));
}
export function settleSpots(im: Imprint, lines: GLine[]): boolean {
  if (!needsSettle(im, lines)) return false;
  const pcs = new Map<string, number>();
  for (const l of lines) if (lineQty(l) > 0) { const s = spotOf(im, l); pcs.set(s, (pcs.get(s) || 0) + lineQty(l)); }
  const top = [...pcs].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return false;
  const old = im.location || "";
  im.location = top;
  const by = { ...(im.spotBy || {}) };
  // garments that sewed the new A spot need no entry; anything that sewed the old A (none here) keeps it as a change
  for (const [k, v] of Object.entries(by)) if (v === top) delete by[k];
  for (const l of lines) if (lineQty(l) > 0 && spotOf({ ...im, spotBy: by }, l) !== spotOf({ location: old, spotBy: im.spotBy, method: im.method }, l)) by[spotKey(l)] = spotOf({ location: old, spotBy: im.spotBy, method: im.method }, l);
  if (Object.keys(by).length) im.spotBy = by; else delete im.spotBy;
  return true;
}
