import { colorwaysOf, type Brand, type Colorway, type LogoColor } from "@/lib/brands";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  // a color without its own thread takes its brand's standard thread for it (the same PMS or name)
  if (Array.isArray(set) && set.length) return set.map((c) => {
    if (c.thread) return c;
    const b = (brand?.colors || []).find((x) => (c.pms && x.pms && key(x.pms) === key(c.pms)) || key(x.name) === key(c.name));
    return b?.thread ? { ...c, thread: b.thread } : c;
  });
  const inks = [...colorwaysOf(d).flatMap((c) => c.inks), ...(d.inks || "").split(/\s*,\s*/)].map((s) => s.trim()).filter(Boolean);
  const out: LogoColor[] = [];
  // one color once: the same name, or (an ink with no PMS of its own) a color already there that looks the same (Oct 31,
  // Nick on D-10316: "why two black here?", its colorways' Black and its print's ink Black Diamond)
  const rgb = (h: string) => { const v = parseInt((h || "#cccccc").replace("#", "").slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const near = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 24; };
  for (const ink of inks) {
    const c = inkColor(ink, brand?.colors || []);
    if (out.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) continue;
    if (!c.pms && !/\d/.test(ink) && out.some((x) => near(x.hex, c.hex))) continue;
    out.push(c.pms || c.name !== ink ? c : { ...c, pms: /\d/.test(ink) ? ink : undefined });
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

/** "name | PMS" lines, for editing a logo's colors (the screen color comes from the PMS; Oct 31, Nick: "we don't need
 *  the hex information") */
export const colorsText = (cs: LogoColor[]) => cs.map((c) => [c.name, c.pms || ""].join(" | ").replace(/ \| $/, "")).join("\n");
/** the lines back into colors; each keeps the thread it had (by name), and a typed #hex still counts */
export function parseColors(t: string, was: LogoColor[] = []): LogoColor[] {
  return t.split(/\n+/).map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]).map(([name, pms, hex]) => {
    const old = was.find((c) => key(c.name) === key(name) || (!!pms && !!c.pms && key(c.pms) === key(pms)));
    const h = /^#?[0-9a-f]{6}$/i.test(hex || "") ? (hex.startsWith("#") ? hex : "#" + hex).toUpperCase() : colorHex(pms || name) || old?.hex || "#cccccc";
    return { name, ...(pms ? { pms } : {}), hex: h, ...(old?.thread ? { thread: old.thread } : {}) };
  });
}
/** a logo color matched to a brand color (the same PMS, else the same name) */
export const sameColor = (a: Pick<LogoColor, "name" | "pms">, b: Pick<LogoColor, "name" | "pms">) =>
  (!!a.pms && !!b.pms && key(a.pms) === key(b.pms)) || key(a.name) === key(b.name);

/**
 * A color's standard thread for a client's brand (Oct 31, Nick: "set as standard thread for this client"): saved on the
 * brand's color, and on the same color of every logo of that brand, so every sew file of theirs runs it from now on
 * (lib/brands.ts withStandards). The logo it was set from always takes it; another logo already set to a different
 * thread keeps its own (it was set on purpose). Returns how many other logos took it and how many kept their own.
 */
export async function setStandardThread(sb: SupabaseClient, o: { brand: Brand; from: Pick<Design, "id">; color: Pick<LogoColor, "name" | "pms" | "hex">; thread: string }): Promise<{ took: number; kept: number; error?: string }> {
  const bc = [...(o.brand.colors || [])];
  const at = bc.findIndex((c) => sameColor(c, o.color));
  if (at >= 0) bc[at] = { ...bc[at], thread: o.thread }; else bc.push({ name: o.color.name, ...(o.color.pms ? { pms: o.color.pms } : {}), hex: o.color.hex, thread: o.thread });
  const { error: be } = await sb.from("brands").update({ colors: bc }).eq("id", o.brand.id);
  if (be) return { took: 0, kept: 0, error: be.message };
  const brand = { ...o.brand, colors: bc };
  const { data } = await sb.from("designs").select("id, specs, inks").eq("brand_id", o.brand.id);
  let took = 0, kept = 0, error: string | undefined;
  for (const d of (data || []) as Pick<Design, "id" | "specs" | "inks">[]) {
    const mine = d.id === o.from.id;
    const cs = logoColors(d, brand);
    const i = cs.findIndex((c) => sameColor(c, o.color));
    if (i < 0 && !mine) continue;
    const own = ((d.specs || {}) as { colors?: LogoColor[] }).colors;
    const had = Array.isArray(own) ? own.find((c) => sameColor(c, o.color))?.thread : undefined;
    if (had && had !== o.thread && !mine) { kept++; continue; }
    const next = i >= 0 ? cs.map((c, j) => (j === i ? { ...c, thread: o.thread } : c)) : [...cs, { name: o.color.name, ...(o.color.pms ? { pms: o.color.pms } : {}), hex: o.color.hex, thread: o.thread }];
    const { error: de } = await sb.from("designs").update({ specs: { ...((d.specs || {}) as object), colors: next } }).eq("id", d.id);
    if (de) { if (mine) error = de.message; continue; }
    if (!mine) took++;
  }
  return { took, kept, error };
}
