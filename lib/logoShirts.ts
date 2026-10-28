import { orderGroups, type Order } from "@/lib/pricing";

/**
 * The shirt color each logo was printed on (newest order first), so a logo card always shows it on its shirt: never on
 * a bare white or checkered square (Oct 16–17, Nick: "dont even want a logo not on its background"). Its own first
 * background from Edit logo wins over this (ShirtView); this is for logos that never had one set.
 */
export function logoShirtsFrom(orders: Pick<Order, "groups" | "lines" | "created_at">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of [...orders].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))) {
    for (const g of orderGroups(o)) for (const im of g.imprints) {
      const col = (g.lines.find((l) => (l.color || "").trim()) || g.lines[0])?.color;
      if (im.design_id && col && !out[im.design_id]) out[im.design_id] = col;
    }
  }
  return out;
}

/** a print's ink colors by the file's colors (Imprint.inkMap.map): file hex → the ink it printed in ("none": not printed) */
export type InkMapping = Record<string, { hex: string; name: string }>;
/** how a logo last printed: the shirt, and the mockup's picture of it (shownArt) or the ink map to paint the logo with */
export type LogoPrint = { shirt: string; shown?: string; map?: InkMapping; ink?: string };

/**
 * How each logo last printed (newest order first), so the Artwork page's tiles look the way we ran it (Oct 28, Nick: "the
 * Battle for the Boneyard, those were white prints on red and purple, not black… The Bottles has a white banner… Jesus
 * Changes Everything has Bora Bora Sand on a sage… He Makes a Way is maroon. Why are the logos not looking like we
 * printed them?"). The mockup's own picture when it was saved with one (Imprint.shownArt); else the print's ink map (the
 * file's colors → the inks), else its one ink. The shirt is the group's color the ink shows best on.
 */
export function logoPrintFrom(orders: Pick<Order, "groups" | "lines" | "created_at">[], hexOf: (c: string) => string, near: (a: string, b: string) => number): Record<string, LogoPrint> {
  const out: Record<string, LogoPrint> = {};
  for (const o of [...orders].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))) {
    for (const g of orderGroups(o)) for (const im of g.imprints) {
      if (!im.design_id || out[im.design_id]) continue;
      const map = ((im as { inkMap?: { map?: InkMapping } }).inkMap?.map) || undefined;
      const inks = (im.inks || "").split(/\s*,\s*/).filter(Boolean);
      const main = Object.values(map || {}).find((x) => x.hex && x.name !== "none")?.hex || (inks[0] ? hexOf(inks[0]) : "");
      const colors = [...new Set(g.lines.map((l) => (l.color || "").trim()).filter(Boolean))];
      const shirt = main && colors.length > 1 ? [...colors].sort((a, b) => near(hexOf(b), main) - near(hexOf(a), main))[0] : colors[0] || "";
      if (!shirt && !im.shownArt) continue;
      out[im.design_id] = { shirt, ...(im.shownArt ? { shown: im.shownArt } : {}), ...(map && Object.keys(map).length ? { map } : {}), ...(!map && inks.length === 1 ? { ink: inks[0] } : {}) };
    }
  }
  return out;
}

/**
 * How each logo last printed (newest order first): the art as its mockup showed it (Imprint.shownArt, a path in the
 * proofs bucket: inks painted, background off) and that group's shirt color. The Artwork page's tiles show this, so a
 * logo looks the way we ran it (Oct 28, Nick: Keslow D-10252 "has the red square still instead of how we actually did it").
 */
export function logoShownFrom(orders: Pick<Order, "groups" | "lines" | "created_at">[]): Record<string, { path: string; shirt: string }> {
  const out: Record<string, { path: string; shirt: string }> = {};
  for (const o of [...orders].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))) {
    for (const g of orderGroups(o)) for (const im of g.imprints) {
      if (!im.design_id || !im.shownArt || out[im.design_id]) continue;
      out[im.design_id] = { path: im.shownArt, shirt: (g.lines.find((l) => (l.color || "").trim()) || g.lines[0])?.color || "" };
    }
  }
  return out;
}
