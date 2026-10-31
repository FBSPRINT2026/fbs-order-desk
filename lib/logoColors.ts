import { colorwaysOf, type Brand, type Colorway, type LogoColor } from "@/lib/brands";
import { colorHex } from "@/lib/inkColors";
import type { Design } from "@/lib/pricing";

/**
 * A logo's colors and its colorways' roles, for the logo's page (Oct 31, Nick: "here's the logo, here's the colors…
 * very visual… then you'd have colorways").
 */

/** "PMS 492 C" = "492C" = "pms 492c"; a name stays a name */
const key = (s: string) => {
  const t = (s || "").trim().toLowerCase().replace(/^pantone\s*/, "").replace(/^pms\s*/, "");
  return /\d/.test(t) ? "pms:" + t.replace(/\s+/g, "").replace(/(\d)$/, "$1c") : "n:" + t;
};

/** the color an ink is, among the logo's colors (by PMS or name), else its usual screen color */
export function inkColor(ink: string, colors: LogoColor[]): LogoColor {
  const k = key(ink);
  const hit = colors.find((c) => (c.pms && key(c.pms) === k) || key(c.name) === k);
  return hit || { name: ink, hex: colorHex(ink) || "#cccccc" };
}

/**
 * The logo's colors: the ones set on it (specs.colors), else worked out from its colorways' inks (and its own inks),
 * named by its brand's colors when the PMS or name matches ("PMS 492 C" → Maroon), in the order they first appear.
 */
export function logoColors(d: Pick<Design, "specs" | "inks">, brand: Pick<Brand, "colors"> | null | undefined): LogoColor[] {
  const set = ((d.specs || {}) as { colors?: LogoColor[] }).colors;
  if (Array.isArray(set) && set.length) return set;
  const inks = [...colorwaysOf(d).flatMap((c) => c.inks), ...(d.inks || "").split(/\s*,\s*/)].map((s) => s.trim()).filter(Boolean);
  const out: LogoColor[] = [];
  for (const ink of inks) {
    const c = inkColor(ink, brand?.colors || []);
    if (!out.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) out.push(c.pms || c.name !== ink ? c : { ...c, pms: /\d/.test(ink) ? ink : undefined });
  }
  return out;
}

/** when the brand uses a colorway, from its rules ("Light goods", "One color · dark goods") */
export function colorwayUses(cw: Pick<Colorway, "name">, brand: Pick<Brand, "rules"> | null | undefined): string[] {
  const k = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const r = brand?.rules || {}, n = k(cw.name);
  if (!n) return [];
  return [[r.light, "Light goods"], [r.dark, "Dark goods"], [r.one_light, "One color · light goods"], [r.one_dark, "One color · dark goods"]]
    .filter(([v]) => k(v as string) === n).map(([, l]) => l as string);
}

/** "name | PMS | #hex" lines, for editing a logo's colors */
export const colorsText = (cs: LogoColor[]) => cs.map((c) => [c.name, c.pms || "", c.hex].join(" | ")).join("\n");
export function parseColors(t: string): LogoColor[] {
  return t.split(/\n+/).map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]).map(([name, pms, hex]) => {
    const h = /^#?[0-9a-f]{6}$/i.test(hex || "") ? (hex.startsWith("#") ? hex : "#" + hex).toUpperCase() : colorHex(pms || name) || "#cccccc";
    return { name, ...(pms ? { pms } : {}), hex: h };
  });
}
