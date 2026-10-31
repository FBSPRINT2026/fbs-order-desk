/**
 * The digitizer's production worksheet (Wilcom EmbroideryStudio's PDF that comes with the DST and EMB). Oct 23, Nick:
 * "the PDF shows us the details and how to sew it and the color changes… a super complicated file… tons of colors…
 * it's a sequence: the same color might start and stop several times" (PBF DIGITIZE POLO-2: 12 threads, 58 stops).
 *
 * Read off the PDF's text: the totals (stitches, size, colors, color changes, stops, trims) and the stop sequence, each
 * stop's needle (N#), stitches, thread code, name and chart ("Madeira PolyNeon 40", "Madeira Classic 40", or "Default"
 * when the digitizer didn't pick real threads).
 */
export type Stop = { n: number; needle: number; stitches: number; code: string; name: string; chart: string };
export type SheetThread = { needle: number; code: string; name: string; chart: string; stitches: number; stops: number;
  /** the thread we really run on this needle (Oct 31, Nick: "the digitizer doesn't know what we have on the wall"): picked
   *  by staff on the logo's page ("staff"), or the logo color's standard thread nearest the worksheet's ("standard",
   *  lib/brands.ts withStandards). The worksheet's own code and name stay as it said */ ours?: string; oursFrom?: "staff" | "standard" };
export type Worksheet = {
  stitches: number; wIn: number; hIn: number; colors: number; changes: number; stops: number; trims: number;
  sequence: Stop[];
  /** each thread once, in the order it first sews, with its needle and how much of the design it sews */ threads: SheetThread[];
  /** the digitizer named real threads (not Wilcom's default chart) */ real: boolean;
};

const num = (s: string | undefined) => (s ? +s.replace(/,/g, "") || 0 : 0);

/** each thread once, in the order it first sews */
function threadsOf(seq: Stop[]): SheetThread[] {
  const threads: SheetThread[] = [];
  for (const s of seq) {
    const k = threads.find((x) => x.code === s.code && x.chart === s.chart);
    if (k) { k.stitches += s.stitches; k.stops++; if (!k.name && s.name) k.name = s.name; }
    else threads.push({ needle: s.needle, code: s.code, name: s.name, chart: s.chart, stitches: s.stitches, stops: 1 });
  }
  return threads;
}

/**
 * Hatch Embroidery's worksheet (Oct 30, Nick's All My Sons AMS01AP: "Design Worksheet… Color Sequence… Color: 1 Stop: 1
 * Code: 1800 Name: Black Chart: Madeira PolyNeon 40 Stitches: 902"): one block per stop, the color number as the needle.
 * Its header prints the labels apart from the values ("Height: Width: Stitches: … 1.18 in 4.21 in 11,833 3 10 18").
 */
function parseHatch(t: string): Worksheet | null {
  if (!/Hatch Embroidery|Color Sequence/i.test(t)) return null;
  const stop = /Color:\s*(\d{1,3})\s+Stop:\s*(\d{1,4})\s+Element:.*?Code:\s*(\S+)\s+Name:\s*(.*?)\s+Chart:\s*(.*?)\s+Stitches:\s*([\d,]+)/gi;
  const seen = new Set<number>(), seq: Stop[] = [];
  for (const m of t.matchAll(stop)) { const n = +m[2]; if (seen.has(n)) continue; seen.add(n); seq.push({ n, needle: +m[1], stitches: num(m[6]), code: m[3], name: m[4].trim(), chart: m[5].trim() }); }
  if (!seq.length) return null;
  seq.sort((a, b) => a.n - b.n);
  const threads = threadsOf(seq);
  // the header's values, in order: height, width, stitches, colors, color changes, trims
  const h = /([\d.]+)\s*in\s+([\d.]+)\s*in\s+([\d,]+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(t);
  return {
    stitches: h ? num(h[3]) : seq.reduce((a, s) => a + s.stitches, 0), wIn: h ? num(h[2]) : 0, hIn: h ? num(h[1]) : 0,
    colors: threads.length, changes: h ? num(h[5]) : Math.max(0, seq.length - 1), stops: seq.length, trims: h ? num(h[6]) : 0,
    sequence: seq, threads, real: threads.some((x) => !/^default$/i.test(x.chart)),
  };
}

export function parseWorksheet(text: string): Worksheet | null {
  const t = text.replace(/\s+/g, " ");
  if (!/Stop Sequence/i.test(t)) return parseHatch(t);
  const head = (re: RegExp) => num(re.exec(t)?.[1]);
  const sequence: Stop[] = [];
  const body = t.slice(t.search(/Stop Sequence/i));
  const row = /(\d{1,3})\.\s+(\d{1,2})\s+([\d,]+)\s+(\d{1,4})\s+(.*?)\s*(Madeira\s+(?:Classic|Poly\s?Neon|Polyneon|Rayon|Frosted Matt|Metallic|Supertwist|Burmilana)[A-Za-z #]*?\d*|Isacord\s*\d*|Default)(?=\s+\d{1,3}\.\s|\s+Production Worksheet|\s+Authors|\s*$)/gi;
  for (const m of body.matchAll(row)) sequence.push({ n: +m[1], needle: +m[2], stitches: num(m[3]), code: m[4], name: m[5].trim(), chart: m[6].trim() });
  // a sequence over two pages repeats nothing, but keep each stop number once
  const seen = new Set<number>(), seq = sequence.filter((s) => (seen.has(s.n) ? false : (seen.add(s.n), true))).sort((a, b) => a.n - b.n);
  const threads: SheetThread[] = [];
  for (const s of seq) {
    const k = threads.find((x) => x.code === s.code && x.chart === s.chart);
    if (k) { k.stitches += s.stitches; k.stops++; if (!k.name && s.name) k.name = s.name; }
    else threads.push({ needle: s.needle, code: s.code, name: s.name, chart: s.chart, stitches: s.stitches, stops: 1 });
  }
  return {
    stitches: head(/Stitches:\s*([\d,]+)/i), wIn: head(/Width:\s*([\d.]+)\s*in/i), hIn: head(/Height:\s*([\d.]+)\s*in/i),
    colors: head(/Colors:\s*(\d+)/i) || threads.length, changes: head(/Color changes:\s*(\d+)/i), stops: head(/Stops:\s*(\d+)/i) || seq.length, trims: head(/Trims:\s*(\d+)/i),
    sequence: seq, threads, real: threads.some((x) => !/^default$/i.test(x.chart)),
  };
}

/** a worksheet thread as the order names it: "Madeira 1842 True Blue", "Madeira Rayon 1374 Maroon", "Isacord 0015" */
export const sheetThreadName = (x: Pick<SheetThread, "code" | "name" | "chart">) =>
  /^default$/i.test(x.chart) ? `Needle ${x.code}${x.name ? ` ${x.name}` : ""}` : `${/isacord/i.test(x.chart) ? "Isacord" : /classic|rayon/i.test(x.chart) ? "Madeira Rayon" : "Madeira"} ${x.code}${x.name ? ` ${x.name}` : ""}`;
