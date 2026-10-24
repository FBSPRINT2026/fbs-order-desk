/**
 * Embroidery, kept apart from screen printing (Oct 23, Nick: "please keep this completely separate from everything we've
 * done so far. Making that drop down from screen printing to embroidery… creates a whole different process"). About
 * 15–20% of FBS's work: Maria Guzman runs it (embroidery@fbsprint.com) on the 12, 6, 4 and single head (sew-outs).
 *
 * What's here (no React, used by the Mockup Creator, the order, the thread room and the schedule):
 *   - threads: Madeira (Polyneon 40 first, Classic Rayon 40) and Isacord 40, each with its PMS where the maker lists one, and the
 *     closest thread for a color in the customer's logo ("Madeira 1843 Purple")
 *   - stitches: an estimate from the size and how much of the logo is stitched, until the digitized file says
 *   - run time: stitches ÷ stitches a minute, plus trims, color changes, hooping and thread breaks, per head cycle
 *   - backing (stabilizer) and topping by garment, the usual largest size per location, and places a needle can't go
 * The numbers are defaults with sources in the project doc (claude/embroidery.md); the shop's own are in Settings →
 * Production (spmFlat, spmCap…).
 */
import { deltaE, matchWord } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
import { MADEIRA_THREADS } from "@/lib/madeiraThreads";

export type Thread = { line: "Polyneon 40" | "Classic Rayon 40" | "Isacord 40"; code: string; name: string; hex: string; pms: string[] };
/** the thread lines we sew with: Madeira Polyneon (the standard) and Isacord (Oct 23, Nick: "the other thread
 *  brand we use is Isacord. It also has PMS matching"). Classic Rayon isn't offered (Nick: "we typically don't use the
 *  classic rayon, just focus on Polyneon") */
export const THREAD_LINES = ["Polyneon 40", "Isacord 40"] as const;
// (Classic Rayon stays in the thread data only to name and color the threads a digitizer's worksheet uses: Volikes'
// PBF sheet mixes Madeira Classic 40 and PolyNeon 40)
export const lineBrand = (line: string) => (/isacord/i.test(line) ? "Isacord" : "Madeira");
/** the line's name with its brand: "Madeira Polyneon 40", "Isacord 40" */
export const lineName = (line: string) => (/isacord/i.test(line) ? "Isacord 40" : `Madeira ${line}`);

/** Madeira Polyneon 40 is the shop's standard thread (Oct 23, Nick); Rayon and Isacord when asked for */
export const STANDARD_LINE: Thread["line"] = "Polyneon 40";
/** the threads with a color to compare (a thread with only its PMS gets the PMS's color). `alt`: the color of the
 *  PMS the maker matches it to, a second point to compare against (Madeira's chart is how the shop matches a logo's
 *  PMS to a thread; Oct 23, Nick sent Madeira's Polyneon PANTONE chart) */
let all: (Thread & { alt: string[] })[] | null = null;
export function threads(): (Thread & { alt: string[] })[] {
  if (all) return all;
  all = (MADEIRA_THREADS as Thread[]).map((t) => ({ ...t, hex: t.hex || pmsHex(t.pms[0] || "") || "", alt: t.pms.slice(0, 2).map(pmsHex).filter(Boolean) })).filter((t) => /^#[0-9a-f]{6}$/i.test(t.hex));
  return all;
}
const pmsHex = (p: string) => {
  if (!p) return "";
  const norm = (s: string) => s.replace(/^(pms|pantone)\s*/i, "").replace(/^process\s+/i, "").replace(/\s+[cu]$/i, "").trim().toLowerCase();
  const want = norm(p);
  const k = Object.keys(PMS_COATED).find((n) => norm(n) === want);
  return k ? PMS_COATED[k] : "";
};

/**
 * A thread's PMS (Oct 23, Nick: "map the PMS colors in the thread room"): the maker's own match from their conversion
 * chart when it has one, otherwise the closest Pantone coated color by eye (CIEDE2000), marked as not the maker's.
 */
export type ThreadPms = { name: string; hex: string; maker: boolean; dE: number | null };
const pmsMemo = new Map<string, ThreadPms | null>();
export function pmsOf(t: Pick<Thread, "line" | "code" | "hex" | "pms">): ThreadPms | null {
  const k = t.line + t.code;
  if (pmsMemo.has(k)) return pmsMemo.get(k) || null;
  let r: ThreadPms | null = null;
  const p = (t.pms[0] || "").trim();
  if (p) {
    const h = pmsHex(p);
    r = { name: p.replace(/^(pms|pantone)\s*/i, "").replace(/\s+C$/i, ""), hex: h, maker: true, dE: h && t.hex ? Math.round(deltaE(t.hex, h) * 10) / 10 : null };
  } else if (/^#[0-9a-f]{6}$/i.test(t.hex)) {
    let best = "", bd = Infinity;
    for (const [n, h] of Object.entries(PMS_COATED)) { const d = deltaE(t.hex, h); if (d < bd) { bd = d; best = n; } }
    if (best) r = { name: best.replace(/^PMS\s*/, "").replace(/\s+C$/, ""), hex: PMS_COATED[best], maker: false, dE: Math.round(bd * 10) / 10 };
  }
  pmsMemo.set(k, r);
  return r;
}

/** what a thread is called on the order, the work order and the thread room: "Madeira 1843 Purple" */
export const threadLabel = (t: Pick<Thread, "line" | "code" | "name">) => `${t.line === "Isacord 40" ? "Isacord " : t.line === "Classic Rayon 40" ? "Madeira Rayon " : "Madeira "}${t.code}${t.name ? " " + t.name : ""}`;
/** a name on an order that is one of our threads (an ink name never starts with Madeira or Isacord) */
export const isThreadName = (s: string) => /^(madeira|isacord)\b/i.test((s || "").trim());
/** the thread an order names ("Madeira 1843 Purple", "Madeira Rayon 1147", "Isacord 0015 White") */
export function threadByName(s: string): Thread | null {
  const m = /^(madeira|isacord)\s+(rayon\s+)?(\d{3,4})/i.exec((s || "").trim());
  if (!m) return null;
  const line = /isacord/i.test(m[1]) ? "Isacord 40" : m[2] ? "Classic Rayon 40" : "Polyneon 40";
  return threads().find((t) => t.line === line && t.code === m[3]) || null;
}
/** a stocked thread's key: Polyneon codes as-is, "R1147" Rayon, "I0015" Isacord (lib/threadStock.ts) */
export const threadKey = (line: string, code: string) => (/isacord/i.test(line) ? "I" : /rayon/i.test(line) ? "R" : "") + code;

/**
 * The Madeira threads closest to a color in the logo, closest first (CIEDE2000, the same measure the ink suggestions
 * use). `line` picks the thread line (Polyneon unless asked); `stock` (codes we carry) puts those first when as close.
 */
/** each line's own black and white: a logo's black (or white) is that thread, not the nearest dark brown */
const PLAIN: Record<string, { black: string; white: string }> = { "Polyneon 40": { black: "1800", white: "1801" }, "Isacord 40": { black: "0020", white: "0015" }, "Classic Rayon 40": { black: "1000", white: "1001" } };
export function closestThreads(hex: string, o: { line?: Thread["line"]; n?: number; stock?: Set<string> } = {}): (Thread & { dE: number; word: string; stocked: boolean })[] {
  const line = o.line || "Polyneon 40";
  const v = parseInt(hex.replace("#", ""), 16), r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const plain = Math.max(r, g, b) - Math.min(r, g, b) < 24 ? (Math.max(r, g, b) < 60 ? PLAIN[line]?.black : Math.min(r, g, b) > 235 ? PLAIN[line]?.white : "") : "";
  return threads().filter((t) => t.line === line)
    .map((t) => { const dE = Math.round(Math.min(deltaE(hex, t.hex), ...t.alt.map((a) => deltaE(hex, a))) * 10) / 10; return { ...t, dE, word: matchWord(dE), stocked: !!o.stock?.has(threadKey(t.line, t.code)) }; })
    // a thread we stock wins when it's about as close (under 1.5 apart): it's on the wall, nothing to order; black
    // and white are the line's own black and white
    .sort((a, b) => (a.code === plain ? -1 : 0) - (b.code === plain ? -1 : 0) || (a.dE + (a.stocked ? -1.5 : 0)) - (b.dE + (b.stocked ? -1.5 : 0)))
    .slice(0, o.n || 5);
}
/** one pick per logo color: the closest thread */
/**
 * The thread a logo color gets, the way a stock ink is picked (Oct 23, Nick: "make these threads our standard thread…
 * think of them like stock ink colors"): one of our standard colors when it's very close (under 3 apart) or about as
 * close as anything on the card (within 1.5); otherwise the closest thread on the card (a special order).
 */
export function closestThread(hex: string, o: { line?: Thread["line"]; stock?: Set<string> } = {}) {
  const near = closestThreads(hex, { ...o, n: 400 });
  const best = near[0] || null;
  if (!best || !o.stock?.size) return best;
  const std = near.find((t) => t.stocked);
  return std && (std.code === best.code || std.dE < 3 || std.dE <= best.dE + 1.5) ? std : best;
}

/** a thread found by what's typed: its number, name or PMS ("1843", "purple", "2745") */
export function findThreads(q: string, line?: Thread["line"], n = 30): Thread[] {
  const t = q.trim().toLowerCase().replace(/^(pms|pantone)\s*/, "");
  if (!t) return [];
  return threads().filter((x) => (!line || x.line === line) && (x.code.startsWith(t) || x.name.toLowerCase().includes(t) || x.pms.some((p) => p.toLowerCase().replace(/\s+/g, " ").includes(t)))).slice(0, n);
}

// ── stitches ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stitches in a square inch of stitched area. Small logos are mostly satin and lettering (dense); big ones are mostly
 * fill (tatami ~650 a square inch bare). So it falls from 2,400 when 2 in² or less is stitched to 1,000 at 20 in² or
 * more, plus 20% underlay. Against published counts: a 3.5 × 1.75" left chest at half coverage ≈ 8,500 (5,000–10,000
 * published); a 4.5 × 2" cap front ≈ 13,800 (8,000–15,000); a 10 × 10" back at 45% ≈ 54,000 (claude/embroidery.md).
 * Refit from real DST counts as they come in.
 */
// Calibrated Oct 23 on Volikes' Gateway "Icon Only" (1.65" × 2.01", about 45% stitched: 4,333 on their worksheet; the
// first figure, 1,800, came out ~25% low). Small logos are satin borders around fills: dense
export const densityFor = (stitchedSqIn: number) => (stitchedSqIn <= 2 ? 2400 : stitchedSqIn >= 20 ? 1000 : 2400 - ((stitchedSqIn - 2) / 18) * 1400);
export const UNDERLAY = 0.2;
/** tie-ins, tie-offs and trims, a color */
export const STITCHES_PER_COLOR = 20;
/** the fewest a stitched logo comes to */
export const MIN_STITCHES = 1000;

/**
 * Stitches for a logo before it's digitized: its size × how much of it is stitched (coverage, the share of the logo's
 * box that gets thread, read off the picture) × the density for that much area, plus underlay and a little per color.
 * The digitized file's count replaces it when it comes back (lib/dst.ts).
 */
export function estimateStitches(wIn: number, hIn: number, coverage: number, colors = 1, o: { puff?: boolean; stretchy?: boolean } = {}): number {
  if (!(wIn > 0) || !(hIn > 0)) return 0;
  const cov = Math.max(0.05, Math.min(1, coverage || 0.5));
  const area = wIn * hIn * cov;
  let n = area * densityFor(area) * (1 + UNDERLAY) + Math.max(1, colors) * STITCHES_PER_COLOR;
  if (o.puff) n *= 1.25; // satin sewn tall over foam
  if (o.stretchy) n *= 1.1;
  return Math.max(MIN_STITCHES, Math.round(n / 100) * 100);
}
/** how much of a picture is stitched: the share of its pixels that aren't see-through (and aren't the shirt) */
export function coverageOf(data: Uint8ClampedArray, w: number, h: number): number {
  let on = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 90000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { n++; if (data[(y * w + x) * 4 + 3] > 96) on++; }
  return n ? on / n : 0;
}

// ── run time ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EmbSpeed = { spmFlat: number; spmCap: number; hoopSecs: number; trimSecs: number; trimsPerDesign: number; breakMinPer10k: number };
/** slower for 3D puff (tall satin over foam), metallic thread (breaks), small detail (tiny lettering) */
export const SPEED_FACTOR = { puff: 0.75, metallic: 0.8, detail: 0.9 } as const;
/**
 * Minutes for one cycle (every head sews one piece at once): stitches at the machine's speed, a color change a color,
 * the trims, thread breaks, and hooping the next one. Pieces an hour = heads × 60 ÷ cycle.
 */
export function cycleMinutes(stitches: number, s: EmbSpeed, o: { cap?: boolean; colors?: number; puff?: boolean; metallic?: boolean; detail?: boolean } = {}) {
  let spm = o.cap ? s.spmCap : s.spmFlat;
  if (o.puff) spm *= SPEED_FACTOR.puff;
  if (o.metallic) spm *= SPEED_FACTOR.metallic;
  if (o.detail) spm *= SPEED_FACTOR.detail;
  const sew = stitches / Math.max(100, spm);
  const changes = Math.max(0, (o.colors || 1) - 1) * 3 / 60; // a color change is ~3 s on a multi-needle head
  const trims = (s.trimsPerDesign * s.trimSecs) / 60;
  const breaks = (stitches / 10000) * s.breakMinPer10k;
  const hoop = s.hoopSecs / 60;
  return { min: sew + changes + trims + breaks + hoop, spm: Math.round(spm), sew };
}
export const piecesPerHour = (cycleMin: number, heads: number) => (cycleMin > 0 ? Math.round((heads * 60) / cycleMin) : 0);

// ── where it goes, and how big ───────────────────────────────────────────────────────────────────────────────────────

/** the usual largest embroidery at each location, inches (wide × tall): most embroidery is small (stitches are time) */
export const EMB_MAX: Record<string, { w: number; h: number; usual: string }> = {
  "Left Chest": { w: 4, h: 4, usual: '3–4" wide' },
  "Right Chest": { w: 4, h: 4, usual: '3–4" wide' },
  "Center Chest": { w: 5, h: 4, usual: '4–5" wide' },
  "Full Front": { w: 10, h: 10, usual: '8–10" wide (a big one: lots of stitches)' },
  "Full Back": { w: 12, h: 12, usual: '10–12" wide (a big one: lots of stitches)' },
  "Upper Back (Yoke)": { w: 10, h: 3, usual: '8–10" wide' },
  "Left Sleeve": { w: 3.5, h: 3.5, usual: '2.5–3.5" wide' },
  "Right Sleeve": { w: 3.5, h: 3.5, usual: '2.5–3.5" wide' },
  "Back Neck": { w: 3.5, h: 1.5, usual: '2–3" wide' },
  "Nape": { w: 3.5, h: 1.5, usual: '2–3" wide' },
  "Pocket": { w: 3.5, h: 3, usual: '3" wide' },
  "Cap Front": { w: 4.5, h: 2.25, usual: '4–4.5" wide × 2–2.25" tall' },
  "Hat Front": { w: 4.5, h: 2.25, usual: '4–4.5" wide × 2–2.25" tall' },
  "Cap Side": { w: 2.5, h: 1.75, usual: '2" wide' },
  "Cap Back": { w: 3, h: 1.25, usual: '2.5–3" wide' },
};
export const embMax = (loc: string) => EMB_MAX[Object.keys(EMB_MAX).find((k) => k.toLowerCase() === (loc || "").trim().toLowerCase()) || ""] || null;

/** the kind of garment, for backing, speed and where a needle can't go */
export type EmbGarment = "polo" | "tee" | "performance" | "fleece" | "jacket" | "woven" | "cap" | "beanie" | "towel" | "bag" | "other";
export function embGarment(text: string): EmbGarment {
  const t = (text || "").toLowerCase();
  if (/\bbeanie|knit cap|toboggan/.test(t)) return "beanie";
  if (/\b(cap|hat|trucker|snapback|visor)\b|richardson|\b112\b|flexfit/.test(t)) return "cap";
  if (/\bpolo|sport shirt|\bk500\b|\bk540\b|\bl500\b|\bk110\b|pique/.test(t)) return "polo";
  if (/towel|terry|blanket/.test(t)) return "towel";
  if (/\b(bag|tote|backpack|duffel|cooler)\b/.test(t)) return "bag";
  if (/fleece|hoodie|hooded|sweatshirt|crewneck|quarter[- ]?zip|1\/4[- ]?zip|pullover/.test(t)) return "fleece";
  if (/jacket|vest|soft ?shell|windbreaker|coat/.test(t)) return "jacket";
  if (/button[- ]?down|oxford|twill|denim|woven|dress shirt|work shirt|camp shirt/.test(t)) return "woven";
  if (/performance|dri[- ]?fit|moisture|athletic|\bposi|tech tee/.test(t)) return "performance";
  if (/\b(tee|t-shirt|tshirt|long sleeve)\b/.test(t)) return "tee";
  return "other";
}
/**
 * What goes under it (backing / stabilizer) and on top (topping) for the garment. Knits stretch, so they get cutaway
 * (it stays and holds the stitches); wovens and caps get tearaway; terry, fleece and knit caps get a water-soluble
 * topping so the stitches don't sink into the pile.
 */
export const BACKINGS = ["Cutaway 2.5 oz", "Cutaway 3 oz", "No-show mesh (polymesh) 1.5 oz", "Tearaway 1.8 oz", "Tearaway 2.5 oz", "Cap backing (tearaway 3 oz)", "Washaway"] as const;
export const TOPPINGS = ["None", "Water-soluble topping (Solvy)"] as const;
export function backingFor(g: EmbGarment, o: { light?: boolean; big?: boolean } = {}): { backing: string; topping: string; why: string } {
  switch (g) {
    case "polo": return { backing: o.light ? "No-show mesh (polymesh) 1.5 oz" : "Cutaway 2.5 oz", topping: "None", why: o.light ? "A light polo: no-show mesh doesn't show through" : "Pique knit stretches: cutaway holds the stitches" };
    case "tee": return { backing: o.big ? "Cutaway 2.5 oz" : "No-show mesh (polymesh) 1.5 oz", topping: "None", why: "Thin knit: soft mesh cutaway that doesn't show through" };
    case "performance": return { backing: "No-show mesh (polymesh) 1.5 oz", topping: "None", why: "Thin stretchy polyester: light mesh cutaway, and a ballpoint needle" };
    case "fleece": return { backing: "Cutaway 2.5 oz", topping: "Water-soluble topping (Solvy)", why: "Fleece is a heavy knit with pile: cutaway under, topping so stitches sit on top" };
    case "jacket": return { backing: "Tearaway 2.5 oz", topping: "None", why: "Stable outer fabric: tearaway (cutaway if it's a stretchy soft shell)" };
    case "woven": return { backing: o.big ? "Cutaway 2.5 oz" : "Tearaway 1.8 oz", topping: "None", why: "Woven fabric doesn't stretch: tearaway" };
    case "cap": return { backing: "Cap backing (tearaway 3 oz)", topping: "None", why: "Structured cap: stiff tearaway cap backing" };
    case "beanie": return { backing: "Cutaway 2.5 oz", topping: "Water-soluble topping (Solvy)", why: "Stretchy knit: cutaway, and topping on the rib" };
    case "towel": return { backing: "Tearaway 2.5 oz", topping: "Water-soluble topping (Solvy)", why: "Terry loops: topping keeps stitches from sinking" };
    case "bag": return { backing: "Tearaway 2.5 oz", topping: "None", why: "Canvas or nylon: tearaway" };
    default: return { backing: "Cutaway 2.5 oz", topping: "None", why: "When unsure, cutaway: it never lets the design stretch out" };
  }
}
/** places a needle can't go, for the garment and location (Oct 23, Nick: "on this K500… you can't embroider over the buttons") */
export function embWarnings(g: EmbGarment, loc: string, wIn: number): string[] {
  const l = (loc || "").toLowerCase(), out: string[] = [];
  if (g === "polo" && /center chest|full front|across chest|medium front/.test(l)) out.push("A polo has a placket and buttons down the middle: embroidery can't go over the buttons. Use Left or Right Chest.");
  if (g === "polo" && /left chest|right chest/.test(l) && wIn > 4) out.push(`${wIn}" is wide for a polo chest: it runs into the placket. Keep it under 4".`);
  if ((g === "jacket" || g === "fleece") && /center chest|full front/.test(l)) out.push("Check for a zipper down the middle: embroidery can't cross it.");
  if (/pocket/.test(l)) out.push("Sewing on a pocket closes it unless the hoop goes inside it: say if it's sewn shut or not.");
  if (g === "cap" && /front/.test(l)) out.push('Cap front: about 2.25" tall at most, and a seam down the middle of 6-panel caps.');
  const mx = embMax(loc);
  if (mx && wIn > mx.w + 0.01) out.push(`${wIn}" is bigger than the usual ${loc} embroidery (${mx.usual}).`);
  return out;
}

/** the embroidery facts on a print (kept on the imprint, apart from the screen print fields) */
export type EmbSpec = {
  /** where the stitch count came from: our estimate, the digitized file, or typed */ stitchesFrom?: "estimate" | "file" | "staff";
  /** how much of the logo's box is stitched, read off the art (for the estimate) */ coverage?: number;
  backing?: string; topping?: string;
  puff?: boolean; metallic?: boolean; detail?: boolean;
  line?: Thread["line"];
  /** the digitized file (DST) for this print, with the EMB and the worksheet when they came with it */ file?: import("@/lib/digitizedFiles").DigitizedSet;
};
