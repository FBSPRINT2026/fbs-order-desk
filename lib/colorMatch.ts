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
  // hand-typed POs (Oct 22, Nick: "you're not going to get 6210 Banana Cream. You might get 6210 B.C. or 6210 Banana"):
  // run together ("NeonBlue"), initials ("B.C.", "BC"), or the start of each word ("Ban Crm") — staff confirm the guess
  const squash = (x: string) => key(x).replace(/ /g, "");
  const run = options.filter((o) => squash(o) === squash(asked));
  if (run.length === 1) return { color: run[0], sure: true };
  const letters = asked.replace(/[^a-z]/gi, "").toLowerCase();
  // initials are written with dots or spaces ("B.C.", "B C") or as capitals ("BC"), never a short word ("Red", "Navy")
  if (letters.length >= 2 && letters.length <= 4 && (/^([a-z]\.\s*|[a-z]\s+){1,3}[a-z]\.?$/i.test(asked.trim()) || /^[A-Z]{2,4}$/.test(asked.trim()))) {
    const ini = options.filter((o) => words(o).map((w) => w[0]).join("") === letters);
    if (ini.length === 1) return { color: ini[0], sure: false };
  }
  const pre = options.filter((o) => { const ow = words(o); return aw.length > 0 && aw.every((w) => ow.some((x) => x.startsWith(w))); }).sort((p, q) => words(p).length - words(q).length);
  if (pre.length && (pre.length === 1 || words(pre[0]).length < words(pre[1]).length)) return { color: pre[0], sure: false };
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

/**
 * The color box's search (Oct 20, Nick: "I type white royal, it should find White and Royal… white - royal, white royal,
 * white-royal… it doesn't have to be exact"). Spaces, dashes, slashes, "&" and dots are all the same; every word typed
 * must start a word of the color, in any order (so "wh roy" finds "White/ Royal"). Best first: the same name, then the
 * words in the order typed, then any order; fewer extra words first.
 */
export function rankColors(typed: string, options: string[]): string[] {
  if (!words(typed).length) return options;
  return rankScored(typed, options).map((x) => x.o);
}
function rankScored(typed: string, options: string[]) {
  const tw = words(typed);
  const scored: { o: string; s: number; extra: number }[] = [];
  for (const o of options) {
    const ow = words(o);
    const pos = tw.map((t) => ow.findIndex((w) => w === t || w.startsWith(t)));
    if (pos.some((p) => p < 0)) continue;
    const exact = ow.join(" ") === tw.join(" ") ? 0 : 1;
    const inOrder = pos.every((p, i) => i === 0 || p > pos[i - 1]) ? 0 : 1;
    const whole = tw.every((t) => ow.includes(t)) ? 0 : 1;
    scored.push({ o, s: exact * 100 + inOrder * 10 + whole, extra: ow.length - tw.length });
  }
  return scored.sort((a, b) => a.s - b.s || a.extra - b.extra || a.o.length - b.o.length);
}
/** the one color typing plainly means (best match, and nothing else as good), or null */
export function plainlyMeans(typed: string, options: string[]): string | null {
  if (!words(typed).length) return null;
  const r = rankScored(typed, options);
  if (!r.length) return null;
  if (r.length > 1 && r[1].s === r[0].s && r[1].extra === r[0].extra) return null;
  return r[0].o;
}
