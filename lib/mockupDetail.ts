/**
 * What a saved mockup shows, read from its setup (snapshot): the garment and color, and each print with its size and
 * inks. Used by the mockup viewer (components/MockupViewer.tsx) on the customer's Artwork page and the shop's.
 */
export type MockupDetail = { garment: string; color: string; prints: { where: string; size: string; inks: { name: string; hex: string }[] }[] };

type Snap = { lines?: { garment?: string; brand?: string; style?: string; color?: string }[]; imprints?: { location?: string; size?: string; inks?: string; inkMap?: { map?: Record<string, { hex?: string; name?: string }> } | null; method?: string }[] } | null | undefined;

const clean = (s: string) => s.replace(/^Custom:\s*/i, "").replace(/\s*\(#[0-9a-f]{3,8}\)\s*/gi, " ").replace(/\s+/g, " ").trim();

export function mockupDetail(snap: Snap): MockupDetail | undefined {
  const l = snap?.lines?.[0];
  if (!l && !snap?.imprints?.length) return undefined;
  // "Comfort Colors 1717", else the garment's own name
  const garment = [l?.brand, l?.style].filter(Boolean).join(" ").trim();
  const prints = (snap?.imprints || []).filter((i) => i.location).map((i) => {
    const mapped = Object.values(i.inkMap?.map || {}).map((v) => ({ name: clean(String(v.name || "")), hex: String(v.hex || "") })).filter((v) => v.name);
    const named = mapped.length ? mapped : String(i.inks || "").split(/\s*[,;]\s*|\s+\+\s+/).map(clean).filter(Boolean).map((name) => ({ name, hex: (/#[0-9a-f]{6}/i.exec(String(i.inks || "")) || [""])[0] }));
    return { where: String(i.location), size: String(i.size || "").replace(/(\d)\.(\d)\d\b/g, "$1.$2"), inks: named };
  });
  return { garment: garment || String(l?.garment || ""), color: String(l?.color || ""), prints };
}
