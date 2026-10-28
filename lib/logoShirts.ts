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
