/**
 * The sister style that carries sizes a style doesn't come in (Oct 30, Nick: PC099Y written for the whole run, adult
 * sizes included: "there's no PC099Y adult sizes"). Server only. Where it looks, best first:
 *   1. a pair staff picked before (garment_size_pairs, and Add youth's garment_youth both ways): used as is;
 *   2. the style number's siblings (PC099Y → PC099, 5000B → 5000, PC54 → PC54Y, ST350 → YST350, PC61 → PC61T);
 *   3. the brand's catalog styles in that kind (youth / adult / toddler / infant) whose name matches once the kind words
 *      are taken out ("Youth Beach Wash Garment-Dyed Tee" ↔ "Beach Wash Garment-Dyed Tee");
 *   4. SanMar's own companion styles, when nothing above is clear.
 * A sister has to come in every one of the sizes; one that doesn't come in the line's color is marked so.
 * `sure`: a remembered pair, or one clear match in that color. Anything else is asked (components/SizeFit.tsx).
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { sanmarCompanions, sanmarConfigured } from "@/lib/sanmar";
import { ourRun, type SizeKind } from "@/lib/sizeFit";

type Admin = ReturnType<typeof createAdminClient>;
export type StyleRun = { style: string; brand: string; title: string; sizes: string[]; colors: string[] };
export type Sister = StyleRun & { from: "known" | "name" | "catalog" | "companion"; score: number; colorOk: boolean | null; covers: boolean; sure?: boolean };

const up = (s: string) => String(s || "").trim().toUpperCase();
const normBrand = (b: string) => String(b || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "").replace(/company$/, "co");
const sameBrand = (a: string, b: string) => { const x = normBrand(a), y = normBrand(b); return !x || !y || x === y || x.startsWith(y) || y.startsWith(x); };
const normColor = (c: string) => String(c || "").toLowerCase().replace(/gr[ae]y/g, "gray").replace(/[^a-z0-9]/g, "");
const hasColor = (colors: string[], c: string): boolean | null => (!c || !colors.length ? null : colors.some((x) => normColor(x) === normColor(c)));

/** what a garment's name says it's cut for */
type TitleKind = SizeKind | "ladies" | "tall";
export function titleKind(title: string, style: string, sizes: string[]): TitleKind {
  const t = ` ${title.toLowerCase()} `;
  if (/toddler/.test(t)) return "toddler";
  if (/infant|baby|onesie|bodysuit/.test(t)) return "infant";
  if (/youth|\bkids?\b|\bboys\b|\bgirls\b/.test(t)) return "youth";
  if (/\btall\b/.test(t)) return "tall";
  if (/ladies|women|womens|\bwomen's\b|juniors/.test(t)) return "ladies";
  const ours = ourRun(sizes);
  if (ours.length && ours.every((z) => /^Y/.test(z))) return "youth";
  if (/Y$/.test(style) && !ours.some((z) => /^(S|M|L|XL|2XL)$/.test(z))) return "youth";
  return "adult";
}
const KIND_WORDS = new Set(["youth", "kids", "kid", "boys", "girls", "toddler", "infant", "baby", "tall", "ladies", "women", "womens", "women's", "juniors", "adult", "unisex", "mens", "men's", "the", "and", "with", "a"]);
const words = (title: string, brand: string, style: string) => {
  const drop = new Set([...normBrandWords(brand), style.toLowerCase()]);
  return new Set(title.toLowerCase().replace(/[^a-z0-9%' ]+/g, " ").split(/\s+/).filter((w) => w && !KIND_WORDS.has(w) && !drop.has(w) && !/^[a-z]{0,4}\d/.test(w)));
};
function normBrandWords(b: string) { return String(b || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).concat(["co", "company"]); }
const like = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n); };

/** a style's catalog record: S&S / our garments first (by brand when it's given), then SanMar's list */
export async function styleRun(admin: Admin, style: string, brand = ""): Promise<StyleRun | null> {
  const st = up(style); if (!st) return null;
  const plain = st.replace(/^(NL|BC|G|PC|DT|DM|ST|LAT|AA)(?=\d)/, "");
  const [{ data: gs }, { data: ss }] = await Promise.all([
    admin.from("garments").select("style, brand, description, sizes, colors, color_images").in("style", [...new Set([st, plain, style.trim()])]).limit(20),
    admin.from("sanmar_styles").select("style, brand, title, sizes, colors").ilike("style", st).limit(5),
  ]);
  type G = { style: string; brand: string | null; description: string | null; sizes: string[] | null; colors: string[] | null; color_images: Record<string, unknown> | null };
  const g = ((gs || []) as G[]).filter((x) => (x.sizes || []).length).sort((a, b) => +sameBrand(b.brand || "", brand) - +sameBrand(a.brand || "", brand) || +(up(b.style) === st) - +(up(a.style) === st))[0];
  if (g && (!brand || sameBrand(g.brand || "", brand))) return { style: g.style, brand: g.brand || "", title: g.description || "", sizes: g.sizes || [], colors: [...new Set([...(g.colors || []), ...Object.keys(g.color_images || {})])] };
  type S = { style: string; brand: string; title: string; sizes: string[] | null; colors: string[] | null };
  const s = ((ss || []) as S[]).find((x) => (x.sizes || []).length && (!brand || sameBrand(x.brand, brand))) || ((ss || []) as S[]).find((x) => (x.sizes || []).length);
  if (s) return { style: s.style, brand: s.brand, title: s.title || "", sizes: s.sizes || [], colors: s.colors || [] };
  return g ? { style: g.style, brand: g.brand || "", title: g.description || "", sizes: g.sizes || [], colors: [...new Set([...(g.colors || []), ...Object.keys(g.color_images || {})])] } : null;
}

/** the style number's likely siblings: PC099Y → PC099, 5000B → 5000, PC54 → PC54Y / PC54B, ST350 → YST350, PC61 → PC61T */
export function siblingNumbers(style: string): string[] {
  const st = up(style);
  const bases = new Set([st]);
  for (const re of [/YCVC$/, /Y$/, /B$/, /T$/, /LT$/]) if (re.test(st) && st.replace(re, "").length >= 2) bases.add(st.replace(re, ""));
  if (/^Y[A-Z]{1,3}\d/.test(st)) bases.add(st.slice(1));
  const out = new Set<string>();
  for (const b of bases) for (const v of [b, `${b}Y`, `${b}B`, `${b}T`, `Y${b}`, `${b}YCVC`]) if (v !== st) out.add(v);
  return [...out];
}

/** what's remembered for this style and size kind (staff's pick, or Add youth's pair the right way round) */
async function knownPair(admin: Admin, style: string, kind: SizeKind): Promise<{ style: string; brand: string } | null> {
  const st = up(style);
  const { data: p } = await admin.from("garment_size_pairs").select("sister, sister_brand").eq("style", st).eq("kind", kind).maybeSingle();
  if (p?.sister) return { style: p.sister, brand: p.sister_brand || "" };
  if (kind === "youth") { const { data } = await admin.from("garment_youth").select("youth, youth_brand").eq("adult", st).maybeSingle(); if (data?.youth) return { style: data.youth, brand: data.youth_brand || "" }; }
  if (kind === "adult") { const { data } = await admin.from("garment_youth").select("adult, adult_brand").eq("youth", st).limit(1).maybeSingle(); if (data?.adult) return { style: data.adult, brand: data.adult_brand || "" }; }
  return null;
}

export async function findSisters(admin: Admin, o: { style: string; brand: string; title?: string; color: string; kind: SizeKind; need: string[] }): Promise<Sister[]> {
  const st = up(o.style);
  const covers = (r: StyleRun) => o.need.every((z) => r.sizes.includes(z));
  const fitsKind = (r: StyleRun) => { const k = titleKind(r.title, up(r.style), r.sizes); return k === o.kind; };
  const me = words(o.title || "", o.brand, st);
  const out = new Map<string, Sister>();
  const add = (r: StyleRun, from: Sister["from"], bonus: number) => {
    const k = up(r.style); if (k === st) return;
    const colorOk = hasColor(r.colors, o.color);
    const score = bonus + like(me, words(r.title, r.brand, k)) + (colorOk === false ? -0.3 : 0);
    const prev = out.get(k);
    if (!prev || prev.score < score) out.set(k, { ...r, from: prev?.from === "known" ? "known" : from, score: prev?.from === "known" ? Math.max(prev.score, score) : score, colorOk, covers: covers(r) });
  };

  const known = await knownPair(admin, st, o.kind);
  if (known) { const r = await styleRun(admin, known.style, known.brand); add(r || { style: known.style, brand: known.brand, title: "", sizes: o.need, colors: [] }, "known", 3); }

  // the style number's siblings, then the brand's catalog in this kind
  const sib = siblingNumbers(st);
  const [{ data: sm }, { data: gm }] = await Promise.all([
    admin.from("sanmar_styles").select("style, brand, title, sizes, colors").in("style", sib),
    admin.from("garments").select("style, brand, description, sizes, colors").in("style", sib),
  ]);
  const sibRuns: StyleRun[] = [
    ...((gm || []) as { style: string; brand: string | null; description: string | null; sizes: string[] | null; colors: string[] | null }[]).map((g) => ({ style: g.style, brand: g.brand || "", title: g.description || "", sizes: g.sizes || [], colors: g.colors || [] })),
    ...((sm || []) as { style: string; brand: string; title: string; sizes: string[] | null; colors: string[] | null }[]).map((s) => ({ style: s.style, brand: s.brand, title: s.title || "", sizes: s.sizes || [], colors: s.colors || [] })),
  ];
  for (const r of sibRuns) if (sameBrand(r.brand, o.brand) && fitsKind(r) && covers(r)) add(r, "name", 0.35);

  if (o.brand) {
    const first = o.brand.split(/[\s&+]+/).filter((w) => w.length > 1)[0] || o.brand;
    const { data: cat } = await admin.from("sanmar_styles").select("style, brand, title, sizes, colors").eq("sellable", true).ilike("brand", `${first}%`).overlaps("sizes", o.need).limit(800);
    for (const r of (cat || []) as { style: string; brand: string; title: string; sizes: string[] | null; colors: string[] | null }[]) {
      const run = { style: r.style, brand: r.brand, title: r.title || "", sizes: r.sizes || [], colors: r.colors || [] };
      if (!sameBrand(run.brand, o.brand) || !fitsKind(run) || !covers(run)) continue;
      if (like(me, words(run.title, run.brand, up(run.style))) < 0.5) continue;
      add(run, "catalog", 0);
    }
  }

  // SanMar's companions, only when nothing is clear yet (it's a slow call)
  const clear = () => { const t = [...out.values()].filter((x) => x.covers).sort((a, b) => b.score - a.score); return !!t[0] && t[0].score >= 0.9; };
  if (!clear() && sanmarConfigured()) {
    const comp = await Promise.race([sanmarCompanions(st).catch(() => [] as string[]), new Promise<string[]>((ok) => setTimeout(() => ok([]), 9000))]);
    if (comp.length) {
      const { data: cs } = await admin.from("sanmar_styles").select("style, brand, title, sizes, colors").in("style", comp);
      for (const r of (cs || []) as { style: string; brand: string; title: string; sizes: string[] | null; colors: string[] | null }[]) {
        const run = { style: r.style, brand: r.brand, title: r.title || "", sizes: r.sizes || [], colors: r.colors || [] };
        if (fitsKind(run) && covers(run)) add(run, "companion", 0.6);
      }
    }
  }

  const list = [...out.values()].sort((a, b) => +b.covers - +a.covers || b.score - a.score).slice(0, 5);
  const [a, b] = list;
  if (a && a.covers && a.colorOk !== false && (a.from === "known" || (a.score >= 0.75 && (!b || !b.covers || a.score - b.score >= 0.2)))) a.sure = true;
  return list;
}

/** remember staff's pick (or one clear catalog match) for everyone; youth ↔ adult pairs also go to Add youth's list */
export async function rememberPair(admin: Admin, p: { style: string; kind: SizeKind; sister: string; sisterBrand: string; source: "staff" | "catalog"; by: string; styleBrand?: string }) {
  const style = up(p.style), sister = up(p.sister);
  if (!style || !sister || style === sister) return;
  await admin.from("garment_size_pairs").upsert({ style, kind: p.kind, sister, sister_brand: p.sisterBrand || "", source: p.source, by: p.by, at: new Date().toISOString() }, { onConflict: "style,kind" });
  // Add youth's list: only staff's picks (a catalog match is found again anyway), never over a pair someone keyed in
  if (p.source !== "staff") return;
  if (p.kind === "youth") await admin.from("garment_youth").upsert({ adult: style, adult_brand: p.styleBrand || "", youth: sister, youth_brand: p.sisterBrand || "", source: "staff", by: p.by, at: new Date().toISOString() }, { onConflict: "adult" });
  if (p.kind === "adult") await admin.from("garment_youth").upsert({ adult: sister, adult_brand: p.sisterBrand || "", youth: style, youth_brand: p.styleBrand || "", source: "staff", by: p.by, at: new Date().toISOString() }, { onConflict: "adult" });
}
