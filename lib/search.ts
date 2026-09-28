/**
 * Order search: every word typed must appear somewhere in the order (number, name, PO, garments, colors,
 * imprint details, notes…), in any order. "#1234" matches order 1234.
 */
export function words(q: string) {
  return q.trim().toLowerCase().replace(/^#/, "").split(/\s+/).filter(Boolean);
}
export function matches(q: string, ...hay: (string | number | null | undefined)[]) {
  const w = words(q);
  if (!w.length) return true;
  const h = hay.map((x) => String(x ?? "")).join(" ").toLowerCase();
  return w.every((x) => h.includes(x));
}

type Searchable = { nickname?: string | null; po_number?: string | null; notes?: string | null;
  groups?: { name?: string; lines?: { style?: string; brand?: string; garment?: string; color?: string }[]; imprints?: { location?: string; method?: string; inks?: string; size?: string; notes?: string }[] }[] | null };
/** The text a new-style order can be found by (what the customer sees on it; no shop-only notes). */
export function orderSearchText(o: Searchable) {
  return [o.nickname, o.po_number, o.notes,
    ...(o.groups || []).flatMap((g) => [g.name, ...(g.lines || []).flatMap((l) => [l.style, l.brand, l.garment, l.color]), ...(g.imprints || []).flatMap((i) => [i.location, i.method, i.inks, i.size, i.notes])]),
  ].filter(Boolean).join(" ").toLowerCase();
}
