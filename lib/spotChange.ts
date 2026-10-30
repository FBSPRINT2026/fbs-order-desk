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
