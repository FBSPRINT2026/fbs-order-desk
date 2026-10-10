/**
 * Customer color → the garment's real color name (Nick, Oct 9). Customers write "forest green"; the Next Level 6210
 * comes in "Heather Forest Green". The asked color is kept (GLine.colorAsked) and the line gets the catalog's name;
 * staff can pick another from the style's colors. `sure` is false when it's a guess worth a look.
 */
const MODIFIERS = new Set(["heather", "heathered", "dark", "light", "antique", "vintage", "tri", "triblend", "neon", "true", "solid", "deep", "midnight", "pigment", "garment", "dyed", "washed", "classic", "safety", "sport", "athletic", "blend", "cvc"]);
const SAME: Record<string, string> = { gray: "grey", hthr: "heather", htr: "heather", hthrd: "heather", heathered: "heather", lt: "light", dk: "dark", wht: "white", blk: "black", nvy: "navy", maroon: "maroon", burgundy: "maroon", charcoal: "charcoal", tan: "tan", khaki: "tan" };
const words = (s: string) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => SAME[w] || w);
const key = (s: string) => words(s).join(" ");

/** printing-trade names suppliers spell differently: rust / burnt orange are the Next Level "Redwood" family */
const ALIAS: Record<string, string> = { rust: "redwood", "burnt orange": "redwood", forest: "forest green", wine: "maroon", burgundy: "maroon", "vintage black": "black" };

export function matchColor(asked: string, options: string[]): { color: string; sure: boolean } | null {
  // "Rust/Burnt Orange", "Vintage Black/Charcoal": an old job's two names for one color; the best match of either
  const parts = asked.split(/\s*\/\s*/).filter(Boolean);
  if (parts.length > 1) {
    const each = parts.map((x) => matchColor(x, options)).filter(Boolean) as { color: string; sure: boolean }[];
    return each.find((x) => x.sure) ? { ...each.find((x) => x.sure)!, sure: false } : each[0] || null;
  }
  const al = ALIAS[key(asked)];
  if (al && al !== key(asked)) { const m = matchColor(al, options); if (m) return { color: m.color, sure: false }; }
  return matchOne(asked, options);
}

function matchOne(asked: string, options: string[]): { color: string; sure: boolean } | null {
  const a = key(asked);
  if (!a || !options.length) return null;
  // the same name (any case or spelling of gray/grey)
  const exact = options.find((o) => key(o) === a);
  if (exact) return { color: exact, sure: true };
  const aw = words(asked);
  // every word they wrote is in the option's name: "forest green" ⊂ "heather forest green"; fewest extra words wins
  const sub = options.map((o) => ({ o, w: words(o) })).filter((x) => aw.every((w) => x.w.includes(w)))
    .map((x) => ({ ...x, extra: x.w.filter((w) => !aw.includes(w)) })).sort((p, q) => p.extra.length - q.extra.length || p.o.length - q.o.length);
  if (sub.length) {
    const best = sub[0], tie = sub.filter((x) => x.extra.length === best.extra.length).length > 1;
    return { color: best.o, sure: !tie && best.extra.every((w) => MODIFIERS.has(w)) };
  }
  // closest by shared words and letters (a guess: staff confirm it)
  const score = (o: string) => {
    const ow = words(o), shared = aw.filter((w) => ow.includes(w)).length;
    const bi = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
    const A = bi(a.replace(/ /g, "")), B = bi(key(o).replace(/ /g, "")); let n = 0; A.forEach((x) => { if (B.has(x)) n++; });
    return shared * 2 + (2 * n) / Math.max(1, A.size + B.size);
  };
  const ranked = options.map((o) => ({ o, s: score(o) })).sort((p, q) => q.s - p.s);
  return ranked[0] && ranked[0].s >= 1.4 ? { color: ranked[0].o, sure: false } : null;
}
