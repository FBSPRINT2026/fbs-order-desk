import { fitLocation, LOCATIONS, lineQty, persOf, SIZES, uid, type GLine, type Group } from "@/lib/pricing";
import { spotKey, spotOf } from "@/lib/spotChange";
import { isShortFor } from "@/lib/colorMatch";

/**
 * The order checked against the paperwork it came from, item by item (Oct 31, Nick after eight MEI store carts: "check
 * mine and see that I got all the details correct vs ClickUp"; CLAUDE.md: "check the result against the source itself").
 * #40324's Nike cover-up went on the Right Chest with the jacket when its cart said Left Chest; #40326's Columbia shirt
 * on the Left Chest (then "Right Side") when it said Right Chest; #40321's "Dark Gray" polo came in as Iron Gray; #40311's
 * Carhartt Crowley jacket was put on EB530, an Eddie Bauer style. Every one was in the paperwork, word for word.
 *
 * The whole family, for any customer and any layout where each item's details follow its name (a ClickUp task, a cart, a
 * PO table, an email list, a PDF's words run together): each garment line is found in the paperwork by its name (or its
 * style number), and the words after it, up to the next item, are that item's. From them:
 *  - location: the spots named (Left Chest, Right Chest, sleeves…) against where the line's prints sew it (a location
 *    change on the print counts, a personalization's spot counts);
 *  - color: the color named against the line's color (Starlight = Starlight Blue; Dark Gray ≠ Iron Gray), with the maker's
 *    name for the paperwork's color when the catalog has it;
 *  - sizes: the size run named against the line's (summed over lines of the same garment and color);
 *  - garment: the style number's catalog brand and name against the paperwork's garment (EB530 is Eddie Bauer's);
 *  - logo: the customer's logo whose name the item's words fit best against the print's logo (Primary vs Stacked);
 *  - colorway: a logo version named outright (All White, All Black) against the print's version.
 * Nothing here knows a customer, a file or a layout; it reads words. What it can't find, it doesn't judge.
 */

export type SrcCatalog = Record<string, { title: string; brand: string; colors: string[] }>;
export type SrcLogo = { id: string; name: string; brand?: string | null; colorways: string[]; /** how many orders staff said are right print it: when the words fit two logos the same ("Stacked" fits Secondary (stacked) and SMM (stacked)), the one the shop uses */ uses?: number };
export type SrcFinding = {
  kind: "location" | "color" | "sizes" | "style" | "logo" | "colorway";
  /** the group (index) and lines it's about */ group: number; lineIds: string[];
  /** the garment, as staff know it: "Nike 400099 Starlight Blue" */ what: string;
  paper: string; order: string;
  /** one plain sentence for staff */ say: string;
  /** what to put on the order: the location, the color (the maker's name when known) */ fix?: string;
  /** the logo it's about (a logo's version named in the paperwork) */ designId?: string;
  /** the logo the paperwork names instead (kind "logo") */ toDesign?: string;
};

type Tok = { w: string; at: number; end: number };
const norm = (w: string) => w.toLowerCase().replace(/grey/g, "gray").replace(/'s$/, "");
function toks(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /[A-Za-z0-9]+(?:'[A-Za-z]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ w: norm(m[0]), at: m.index, end: m.index + m[0].length });
  return out;
}
const words = (s: string) => toks(s).map((t) => t.w);
const STOP = new Set(["the", "and", "with", "for", "of", "a", "an", "by", "in", "on"]);
/** words that say what kind of garment, not which one (they don't tell a Crowley from an Eddie Bauer) */
const GENERIC = new Set(["jacket", "jac", "jacke", "shirt", "tee", "polo", "sweatshirt", "hoodie", "hooded", "hood", "soft", "shell", "vest", "long", "sleeve", "short", "pocket", "full", "zip", "quarter", "half", "fleece", "men", "mens", "women", "womens", "ladies", "youth", "heavyweight", "midweight", "lightweight", "performance", "cotton", "crew", "neck", "crewneck", "pullover", "sweater", "cap", "hat", "backpack", "bag", "large", "small", "cover", "up", "textured", "stretch", "knit", "flat", "core", "active", "duck", "lined", "thermal", "dri", "fit",
  // who it's cut for and what it's called in general: the cart's "Unisex CVC T-Shirt" is SanMar's "Adult CVC Tee"
  "unisex", "adult", "adults", "kids", "kid", "toddler", "infant", "girls", "boys", "tall", "tshirt", "tees",
  // how it was made, which makers word differently: the cart's "Garment-Dyed Heavyweight T-Shirt" is the 1717 "Heavyweight Ring Spun Tee"
  "garment", "dyed", "ring", "spun", "ringspun"]);

/** the spots words can name, longest first; a sleeve by any name is a sleeve */
const LOC_PHRASES: { w: string[]; loc: string }[] = [
  ...LOCATIONS.map((l) => ({ w: words(l), loc: l })),
  { w: ["upper", "back"], loc: "Upper Back (Yoke)" }, { w: ["yoke"], loc: "Upper Back (Yoke)" },
  { w: ["left", "arm"], loc: "Left Sleeve" }, { w: ["right", "arm"], loc: "Right Sleeve" },
  { w: ["left", "upper", "arm"], loc: "Left Upper Arm" }, { w: ["right", "upper", "arm"], loc: "Right Upper Arm" },
  { w: ["left", "cuff"], loc: "Left Cuff" }, { w: ["right", "cuff"], loc: "Right Cuff" },
  { w: ["left", "side"], loc: "Left Side" }, { w: ["right", "side"], loc: "Right Side" },
].flatMap((p) => (p.w.length > 1 ? [p, { w: [p.w.join("")], loc: p.loc }] : [p])) // "RightChest" run together
  .sort((a, b) => b.w.length - a.w.length);
/** two names for the same spot compare the same (Left Arm = Left Sleeve = Left Upper Arm) */
const locKey = (l: string) => l.toLowerCase().replace(/\(.*?\)/g, "").replace(/upper arm|arm/g, "sleeve").replace(/upper back|yoke/g, "upper back").replace(/\s+/g, " ").trim();

const SIZE_WORDS: Record<string, string> = {
  xs: "XS", xsmall: "XS", small: "S", sm: "S", s: "S", medium: "M", med: "M", md: "M", m: "M", large: "L", lg: "L", l: "L",
  xl: "XL", xlarge: "XL", "1x": "XL", "2xl": "2XL", "2xlarge": "2XL", xxl: "2XL", xxlarge: "2XL", "2x": "2XL",
  "3xl": "3XL", "3xlarge": "3XL", xxxl: "3XL", "3x": "3XL", "4xl": "4XL", "4xlarge": "4XL", "4x": "4XL", "5xl": "5XL", "5xlarge": "5XL", "5x": "5XL",
  os: "OS", osfa: "OS",
};
const QTY = new Set(["qty", "quantity", "pcs", "pieces"]);

const lineName = (l: GLine) => [l.brand, l.style, l.color].filter(Boolean).join(" ") || l.garment || "a garment";
const tokSet = (s: string) => new Set(words(s).filter((w) => !STOP.has(w)));
/** two color names for the same color: one's words inside the other's (Starlight / Starlight Blue, Charcoal / Charcoal Gray) */
export function sameColor(a: string, b: string): boolean {
  const x = tokSet(a), y = tokSet(b);
  if (!x.size || !y.size) return true;
  // or the maker's short name for it ("HthrGrey" = Heather Gray, "MilGreen" = Military Green)
  return [...x].every((w) => y.has(w)) || [...y].every((w) => x.has(w)) || isShortFor(a, b) || isShortFor(b, a);
}

/**
 * Does a style's catalog entry name the garment the paperwork names (Oct 31, #40329: "TravisMathew Sunnyvale Polo" was
 * put on TM1MW451, SanMar's Auckland Slub Polo; "Eddie Bauer Men's Full-Zip Fleece Vest" on F228, a Port Authority)?
 * Off when the catalog's brand isn't the line's, or the name's own words (not its brand, not "polo", "men's", "unisex")
 * mostly aren't in the catalog's name. Used by this check and by the reading's style finder (lib/ai/stylesFromHistory.ts).
 */
export function styleFits(name: string, brand: string, c: { title: string; brand: string }): { brandOff: boolean; nameOff: boolean } {
  const cb = tokSet(c.brand), lb = tokSet(brand || "");
  const brandOff = !!(cb.size && lb.size && ![...cb].some((x) => lb.has(x)));
  const ct = tokSet(c.title);
  const gw = [...new Set(words(name).filter((w) => w.length > 1 && !STOP.has(w)))];
  const distinct = gw.filter((x) => x.length >= 4 && !GENERIC.has(x) && !/^\d+$/.test(x) && !cb.has(x) && !lb.has(x));
  const nameOff = distinct.length > 0 && distinct.filter((x) => ct.has(x)).length < Math.ceil(distinct.length / 2);
  return { brandOff, nameOff };
}

type Item = { lines: { l: GLine; gi: number }[]; garment: string[]; color: string; style: string };
type Anchor = { i: number; last: number; score: number };

function anchorsFor(S: Tok[], G: string[], style: string): Anchor[] {
  const out: Anchor[] = [];
  const set = new Set(G);
  if (set.size) {
    const need = Math.min(2, set.size);
    for (let i = 0; i < S.length; i++) {
      if (!set.has(S[i].w)) continue;
      const seen = new Set<string>();
      let last = i;
      for (let j = i; j < Math.min(S.length, i + set.size + 3); j++) if (set.has(S[j].w) && !seen.has(S[j].w)) { seen.add(S[j].w); last = j; }
      const score = seen.size / set.size;
      if (seen.size >= need && score >= 0.75) out.push({ i, last, score });
    }
  }
  const st = style.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (st.length >= 4) S.forEach((t, i) => { if (t.w === st) out.push({ i, last: i, score: 1.01 }); });
  // the best of overlapping ones
  const kept: Anchor[] = [];
  for (const a of [...out].sort((p, q) => q.score - p.score || p.i - q.i)) if (!kept.some((k) => a.i <= k.last && k.i <= a.last)) kept.push(a);
  return kept.sort((p, q) => p.i - q.i);
}

type Window = { from: number; to: number; colorAt: number; color: string; afterColor: number };
function windowAt(text: string, S: Tok[], a: Anchor, ends: number[]): Window {
  const from = a.last + 1;
  let to = Math.min(S.length, from + 140);
  for (const e of ends) if (e > a.last && e < to) to = e;
  let colorAt = -1, color = "", afterColor = from;
  for (let k = from; k < to; k++) {
    if (S[k].w !== "color" && S[k].w !== "colour") continue;
    // "Full Color", "One Color", "2 Color" name a logo's version, not the garment's color
    if (k > 0 && /^(full|one|two|three|four|multi|single|\d)$/.test(S[k - 1].w) && !/:/.test(text.slice(S[k].end, S[k + 1]?.at ?? S[k].end))) continue;
    colorAt = k;
    const got: string[] = [];
    let j = k + 1;
    for (; j < to && got.length < 4; j++) {
      const t = S[j], gap = text.slice(S[j - 1].end, t.at);
      if (got.length && /[\n/|]/.test(gap)) break;
      if (SIZE_WORDS[t.w] && (got.length || /^\d/.test(t.w)) || /^\d+$/.test(t.w) || QTY.has(t.w) || t.w === "logo" || t.w === "size" || t.w === "sizes") break;
      if (t.w === "x" && S[j + 1] && /large/.test(S[j + 1].w)) break;
      got.push(text.slice(t.at, t.end));
    }
    color = got.join(" ");
    afterColor = j;
    break;
  }
  return { from, to, colorAt, color, afterColor };
}

function locationsIn(S: Tok[], from: number, to: number): string[] {
  const out: string[] = [];
  for (let k = from; k < to; k++) {
    const p = LOC_PHRASES.find((ph) => ph.w.every((w, n) => S[k + n]?.w === w) && k + ph.w.length <= to);
    if (!p) continue;
    if (!out.some((x) => locKey(x) === locKey(p.loc))) out.push(p.loc);
    k += p.w.length - 1;
  }
  return out;
}

function sizesIn(S: Tok[], from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let k = from; k < to; k++) {
    let sz = SIZE_WORDS[S[k].w], used = 0;
    if (S[k].w === "x" && S[k + 1]?.w === "large") { sz = "XL"; used = 1; }
    if (S[k].w === "xx" && S[k + 1]?.w === "large") { sz = "2XL"; used = 1; }
    if (S[k].w === "one" && S[k + 1]?.w === "size") { sz = "OS"; used = 1; }
    if (!sz && QTY.has(S[k].w) && /^\d+$/.test(S[k + 1]?.w || "") && !Object.keys(out).length) { out.OS = (out.OS || 0) + +S[k + 1].w; k++; continue; }
    if (!sz) continue;
    // the number that goes with it: right after, past "|", "/" or "qty"
    let j = k + used + 1;
    if (S[j] && QTY.has(S[j].w)) j++;
    const n = S[j] && /^\d{1,4}$/.test(S[j].w) ? +S[j].w : 0;
    if (!n) continue;
    out[sz] = (out[sz] || 0) + n;
    k = j;
  }
  return out;
}

/** each line's garment words: what the paperwork calls it (the line's garment name), else the catalog's */
function garmentWords(l: GLine, cat?: SrcCatalog[string]): string[] {
  const name = (l.garment || "").trim() || (cat?.title || "").replace(/\.\s*\S+$/, "");
  return [...new Set(words(name).filter((w) => w.length > 1 && !STOP.has(w)))];
}

export function sourceCheck(source: string, groups: Group[], ctx: { catalog?: SrcCatalog; logos?: SrcLogo[] } = {}): SrcFinding[] {
  const text = source || "";
  const S = toks(text);
  if (!S.length) return [];
  const cat = (st?: string) => (st ? ctx.catalog?.[st.toUpperCase()] || ctx.catalog?.[st] : undefined);
  // one item per garment, color and logos (a personalized piece split off its line is the same item; the same polo in
  // the same color with another logo is another item: Oct 31, #40330's Black Heather Sunnyvale was on the cart twice,
  // a Stacked M and an Icon L, and the two read as one "M 1, L 1")
  const items: (Item & { key: string })[] = [];
  groups.forEach((g, gi) => {
    const logos = [...new Set((g.imprints || []).map((im) => im.design_id || "").filter(Boolean))].sort().join(",");
    (g.lines || []).forEach((l) => {
      if (!lineQty(l)) return;
      const gw = garmentWords(l, cat(l.style));
      const key = `${gw.join(" ")}|${(l.style || "").toLowerCase()}|${words(l.color || "").join(" ")}|${logos}`;
      const it = items.find((x) => x.key === key);
      if (it) it.lines.push({ l, gi }); else items.push({ key, lines: [{ l, gi }], garment: gw, color: l.color || "", style: l.style || "" });
    });
  });
  const runOf = (r: Record<string, number>) => SIZES.filter((z) => r[z]).map((z) => `${z} ${r[z]}`).join(", ");
  const haveOf = (it: Item) => { const h: Record<string, number> = {}; for (const { l } of it.lines) for (const z of SIZES) { const q = +(l.sizes?.[z] || 0); if (q > 0) h[z] = (h[z] || 0) + q; } return h; };
  const cands = items.map((it) => anchorsFor(S, it.garment, it.style));
  // where an item's words end: the next item's name, or the shipping block
  const ends = [...new Set(cands.flat().map((a) => a.i))];
  S.forEach((t, k) => { if ((t.w === "shipping" || t.w === "ship") && /^(information|info|to|address)$/.test(S[k + 1]?.w || "")) ends.push(k); });
  ends.sort((a, b) => a - b);
  const win = new Map<string, Window>();
  const winOf = (a: Anchor) => { const k = `${a.i}`; if (!win.has(k)) win.set(k, windowAt(text, S, a, ends)); return win.get(k)!; };
  // each item its own place in the paperwork: its color settles a garment listed twice (a black and a dark gray polo)
  const used = new Set<number>(), at: (Anchor | null)[] = items.map(() => null);
  // the same garment and color listed more than once: the place whose sizes are this item's
  const sizesAt = (c: Anchor) => { const w = winOf(c); return runOf(sizesIn(S, w.colorAt >= 0 ? w.afterColor : w.from, w.to)); };
  items.forEach((it, n) => {
    const fit = cands[n].filter((c) => !used.has(c.i) && winOf(c).color && sameColor(winOf(c).color, it.color));
    const a = fit.find((c) => sizesAt(c) === runOf(haveOf(it))) || fit[0];
    if (a) { at[n] = a; used.add(a.i); }
  });
  items.forEach((it, n) => {
    if (at[n]) return;
    const claimed = (c: Anchor) => items.some((o, m) => m !== n && o.garment.join(" ") === it.garment.join(" ") && winOf(c).color && sameColor(winOf(c).color, o.color));
    const a = cands[n].find((c) => !used.has(c.i) && !claimed(c)) || null;
    if (a) { at[n] = a; used.add(a.i); }
  });

  const out: SrcFinding[] = [];
  items.forEach((it, n) => {
    const a = at[n];
    if (!a) return;
    const w = winOf(a);
    const first = it.lines[0], what = lineName(first.l), gi = first.gi, ids = it.lines.map((x) => x.l.id);
    // color
    if (w.color && it.color && !sameColor(w.color, it.color)) {
      const maker = cat(it.style)?.colors.find((c) => sameColor(c, w.color) && tokSet(c).size);
      out.push({ kind: "color", group: gi, lineIds: ids, what, paper: w.color, order: it.color, fix: maker || w.color, say: `${what}: the paperwork's color is ${w.color}${maker && maker.toLowerCase() !== w.color.toLowerCase() ? ` (${it.style}'s ${maker})` : ""}, the order has ${it.color}.` });
    }
    // the garment: a style number whose catalog brand or name isn't the paperwork's (then its colors say nothing)
    const c = cat(it.style);
    const off = c && first.l.brand ? styleFits((first.l.garment || "").trim() || c.title, first.l.brand, c) : { brandOff: false, nameOff: false };
    if (c && (off.brandOff || off.nameOff)) out.push({ kind: "style", group: gi, lineIds: ids, what, paper: (first.l.garment || "").trim() || first.l.brand || "", order: `${it.style} (${c.title.replace(/\.\s*\S+$/, "")})`, say: `${what}: ${it.style} is ${c.title.replace(/\.\s*\S+$/, "")}${off.brandOff ? ` (${c.brand})` : ""}, but the paperwork's garment is ${(first.l.garment || "").trim() || first.l.brand}.` });
    // a color the maker doesn't have for that style (the cart's "Iron Gray" is SanMar's NKAH6266 "Dark Grey")
    const cc = off.brandOff || off.nameOff ? [] : cat(it.style)?.colors || [];
    const flat = (x: string) => words(x).join("");
    if (it.color && cc.length && !out.some((f) => f.kind === "color" && f.lineIds[0] === ids[0]) && !cc.some((c) => sameColor(c, it.color) || flat(it.color).startsWith(flat(c)) || flat(c).startsWith(flat(it.color)))) {
      const near = w.color ? cc.find((c) => sameColor(c, w.color)) : undefined;
      out.push({ kind: "color", group: gi, lineIds: ids, what, paper: w.color || it.color, order: it.color, ...(near ? { fix: near } : {}), say: `${what}: ${it.color} isn't one of ${it.style}'s colors (${cc.slice(0, 8).join(", ")})${near ? `; ${near} is` : ""}.` });
    }
    // sizes
    const paperSizes = sizesIn(S, w.colorAt >= 0 ? w.afterColor : w.from, w.to);
    if (Object.keys(paperSizes).length) {
      const have: Record<string, number> = {};
      for (const { l } of it.lines) for (const z of SIZES) { const q = +(l.sizes?.[z] || 0); if (q > 0) have[z] = (have[z] || 0) + q; }
      const run = (r: Record<string, number>) => SIZES.filter((z) => r[z]).map((z) => `${z} ${r[z]}`).join(", ");
      const total = (r: Record<string, number>) => Object.values(r).reduce((x, y) => x + y, 0);
      const onlyQty = Object.keys(paperSizes).length === 1 && paperSizes.OS != null;
      if (onlyQty ? total(paperSizes) !== total(have) : run(paperSizes) !== run(have)) out.push({ kind: "sizes", group: gi, lineIds: ids, what, paper: run(paperSizes), order: run(have) || "none", say: `${what}: the paperwork has ${run(paperSizes)}, the order has ${run(have) || "none"}.` });
    }
    // location: the spots its words name, against where the order sews or prints it
    const locs = locationsIn(S, w.from, w.colorAt >= 0 ? w.colorAt : w.to);
    if (locs.length) {
      const g = groups[gi];
      const mine = new Set<string>();
      for (const im of g.imprints || []) if (im.location || im.spotBy) mine.add(spotOf(im, first.l));
      const pers = it.lines.flatMap(({ l }) => persOf(l).map((p) => p.loc || "Right Chest"));
      for (const p of pers) mine.add(p);
      const want = locs.map(locKey), have = [...mine].filter(Boolean).map(locKey);
      const missing = locs.filter((x) => !have.includes(locKey(x))), extra = [...mine].filter((x) => x && !want.includes(locKey(x)));
      if (missing.length || extra.length) {
        const logoSpots = locs.filter((x) => !pers.some((p) => locKey(p) === locKey(x)));
        out.push({ kind: "location", group: gi, lineIds: ids, what, paper: locs.join(" + "), order: [...mine].filter(Boolean).join(" + ") || "nowhere", ...(logoSpots.length === 1 ? { fix: logoSpots[0] } : {}), say: `${what}: the paperwork puts it on the ${locs.join(" + ")}, the order has the ${[...mine].filter(Boolean).join(" + ") || "no spot"}.` });
      }
    }
    // the logo and its version, for prints of the customer's logos
    const W = new Set(S.slice(w.from, w.to).map((t) => t.w));
    const WS = S.slice(w.from, w.to).map((t) => t.w).join(" ");
    for (const im of groups[gi].imprints || []) {
      const mineL = im.design_id ? ctx.logos?.find((x) => x.id === im.design_id) : null;
      if (!mineL) continue;
      const peers = (ctx.logos || []).filter((x) => (x.brand || "") === (mineL.brand || ""));
      if (peers.length > 1) {
        const everywhere = new Set([...tokSet(peers[0].name)].filter((x) => peers.every((p) => tokSet(p.name).has(x))));
        const score = (p: SrcLogo) => [...tokSet(p.name)].filter((x) => !everywhere.has(x) && x.length >= 3 && W.has(x)).length;
        const best = Math.max(...peers.map(score));
        // a tie in words goes to the logo the shop's right orders use (MEI's carts: "Stacked Logo" is always D-10316)
        const top0 = peers.filter((p) => score(p) === best), most = Math.max(...top0.map((p) => p.uses || 0));
        const top = top0.length > 1 && most > 0 ? top0.filter((p) => (p.uses || 0) === most) : top0;
        if (best > 0 && top.length === 1 && top[0].id !== mineL.id && (score(mineL) < best || (top[0].uses || 0) > (mineL.uses || 0))) out.push({ kind: "logo", group: gi, lineIds: ids, what, paper: top[0].name, order: mineL.name, designId: mineL.id, toDesign: top[0].id, say: `${what}: the paperwork names the ${top[0].name} logo, the order prints ${mineL.name}.` });
      }
      const named = [...mineL.colorways].sort((x, y) => y.length - x.length).find((cw) => { const cwW = words(cw).join(" "); return cwW && ` ${WS} `.includes(` ${cwW} `); });
      const now = Object.entries(im.colorwayBy || {}).find(([k]) => k.trim().toLowerCase() === it.color.trim().toLowerCase())?.[1] || im.colorway || "";
      // (a print with no version at all is off too: Oct 31, #40332's "Stacked Logo All Black" had none)
      if (named && words(named).join(" ") !== words(now).join(" ")) out.push({ kind: "colorway", group: gi, lineIds: ids, what, paper: named, order: now || "no version", designId: mineL.id, say: `${what}: the paperwork asks for the ${mineL.name} logo in ${named}, the order has ${now || "no version"}.` });
    }
  });
  return out;
}

/**
 * A location the paperwork names for one garment, put on the order (used right after the reading, before staff see it):
 * embroidery keeps the garment in its group as a location change (same logo, same sew file: Imprint.spotBy); any other
 * print moves the garment to a group printing the same logo at that spot (a new one when there isn't one). Only where
 * the group has one print and the paperwork names one spot for its logo; anything else is left for staff, said.
 */
export function applyLocationFixes(groups: Group[], findings: SrcFinding[], o: { /** a print other than embroidery may move a garment to another group (off while other parts of a reading point at groups by number) */ split?: boolean } = {}): { groups: Group[]; did: string[] } {
  const did: string[] = [];
  let gs = groups;
  for (const f of findings) {
    if (f.kind !== "location" || !f.fix) continue;
    const g = gs[f.group];
    if (!g || (g.imprints || []).length !== 1) continue;
    const im = g.imprints[0];
    const ls = g.lines.filter((l) => f.lineIds.includes(l.id));
    if (!ls.length) continue;
    const to = fitLocation(f.fix, ls);
    if (im.method === "embroidery") {
      const by = { ...(im.spotBy || {}) };
      for (const l of ls) { if (locKey(to) === locKey(im.location || "")) delete by[spotKey(l)]; else by[spotKey(l)] = to; }
      const live = g.lines.filter((l) => lineQty(l) > 0);
      // every garment at the other spot: that's the print's spot
      if (live.length && live.every((l) => by[spotKey(l)] && locKey(by[spotKey(l)]) === locKey(to))) { im.location = to; for (const l of live) delete by[spotKey(l)]; }
      if (Object.keys(by).length) im.spotBy = by; else delete im.spotBy;
      did.push(`${f.what}: sewn on the ${to}, as the paperwork says`);
      continue;
    }
    if (ls.length === g.lines.filter((l) => lineQty(l) > 0).length) { im.location = to; did.push(`${f.what}: printed on the ${to}, as the paperwork says`); continue; }
    if (o.split === false) continue;
    const home = gs.find((x) => x !== g && (x.imprints || []).length === 1 && x.imprints[0].design_id === im.design_id && x.imprints[0].method === im.method && (x.imprints[0].colorway || "") === (im.colorway || "") && locKey(x.imprints[0].location || "") === locKey(to));
    g.lines = g.lines.filter((l) => !ls.includes(l));
    if (home) home.lines = [...home.lines, ...ls];
    else {
      const ng: Group = { ...JSON.parse(JSON.stringify(g)), id: uid(), lines: ls, mockupThumbs: [] };
      ng.imprints = ng.imprints.map((x) => ({ ...x, id: uid(), location: to }));
      if (g.name && im.location && g.name.includes(im.location)) ng.name = g.name.replace(im.location, to);
      gs = [...gs.slice(0, f.group + 1), ng, ...gs.slice(f.group + 1)];
      // later findings' group numbers move with it
      for (const h of findings) if (h !== f && h.group > f.group) h.group++;
    }
    did.push(`${f.what}: printed on the ${to}, as the paperwork says`);
  }
  return { groups: gs.filter((g) => (g.lines || []).length || !(g.imprints || []).length), did };
}
