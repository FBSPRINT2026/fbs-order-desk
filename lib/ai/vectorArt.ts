import "server-only";

/**
 * AI Design (the Design Lab): print-ready vector art from Recraft (real SVG, about $0.08 an image; RECRAFT_API_TOKEN).
 * The SVG comes back cleaned for a shirt:
 *  - one color: every dark shape becomes the layer's ink (currentColor, so it recolors like clip art); light shapes
 *    (the white background, highlights) are dropped, so the shirt shows through, as a one-screen print would.
 *  - full color: the background (a light shape across the whole picture) is dropped; everything else keeps its colors.
 * Anything that isn't plain shapes (scripts, links, embedded pictures, styles) is taken out.
 */

export type VectorStyle = "one" | "spot" | "full";
/** spots: the ink colors in spot-color art (2–4 colors), so the Design Lab counts and swaps them */
export type VectorArt = { body: string; vb: [number, number, number, number]; full: boolean; spots?: string[] };
export type Ink = { hex: string; name?: string };

const API = "https://external.api.recraft.ai/v1/images/generations";
export const recraftConfigured = () => !!process.env.RECRAFT_API_TOKEN?.trim();

const inkWords = (inks: Ink[]) => inks.map((k) => (k.name ? `${k.name} (${k.hex.toUpperCase()})` : k.hex.toUpperCase())).join(", ");
function promptFor(idea: string, style: VectorStyle, n: number, inks: Ink[]) {
  const base = idea.trim().replace(/\s+/g, " ").slice(0, 600);
  if (style === "one") return `${base}. Bold t-shirt screen print graphic in a single solid black ink only, no gradients, no gray tones, no shading, clean thick shapes, isolated on a plain white background.`;
  if (style === "spot") return `${base}. Bold t-shirt screen print graphic using exactly ${n} flat solid ink colors${inks.length ? `: ${inkWords(inks)}` : ""}, no gradients, no shading, no other colors, clean thick shapes, isolated on a plain white background.`;
  return `${base}. Bold colorful t-shirt graphic, flat vector illustration with solid colors${inks.length ? ` built around ${inkWords(inks)}` : ""}, clean shapes, isolated on a plain white background.`;
}
const rgbArr = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** One picture from Recraft: the SVG text. Colors asked for go to Recraft as its palette too (and the prompt says them);
 *  if Recraft won't take a palette for this model, it's asked again without one. */
async function generateOne(prompt: string, inks: Ink[] = []): Promise<string> {
  const call = (withColors: boolean) => fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RECRAFT_API_TOKEN!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: process.env.RECRAFT_MODEL?.trim() || "recraftv4_1_vector", ...(withColors ? { controls: { colors: inks.map((k) => ({ rgb: rgbArr(k.hex) })) } } : {}) }),
    cache: "no-store", signal: AbortSignal.timeout(90_000),
  });
  let r = await call(inks.length > 0);
  if (!r.ok && inks.length && r.status >= 400 && r.status < 500) r = await call(false);
  const j = (await r.json().catch(() => ({}))) as { data?: { url?: string; b64_json?: string }[]; message?: string; code?: string; error?: { message?: string } };
  if (!r.ok) throw new Error(j.message || j.error?.message || `Recraft: HTTP ${r.status}`);
  const u = j.data?.[0]?.url;
  if (!u) throw new Error("Recraft sent no picture.");
  const svg = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(30_000) }).then((x) => x.text());
  if (!/<svg[\s>]/i.test(svg)) throw new Error("Recraft sent a picture that isn't vector art.");
  return svg;
}

/** a color attribute value → [r, g, b] (hex, rgb(), a few names), or null for none / gradients / unknown */
function rgbOf(v: string | undefined): [number, number, number] | null {
  if (!v) return null;
  const c = v.trim().toLowerCase();
  if (c === "none" || c.startsWith("url(")) return null;
  if (c === "white") return [255, 255, 255];
  if (c === "black") return [0, 0, 0];
  let m = c.match(/^#([0-9a-f]{3})$/);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = c.match(/^#([0-9a-f]{6})/);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}
const lum = (c: [number, number, number]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

/** the shape's fill: its fill attribute, or fill in its style */
function fillOf(tag: string) {
  const a = tag.match(/\sfill\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\sfill\s*=\s*'([^']*)'/i)?.[1];
  const st = tag.match(/\sstyle\s*=\s*"([^"]*)"/i)?.[1]?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1];
  return (st ?? a)?.trim();
}
function setFill(tag: string, v: string) {
  let t = tag.replace(/\sfill\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/(\sstyle\s*=\s*")([^"]*)"/i, (_m, a, b) => `${a}${String(b).replace(/(^|;)\s*fill\s*:[^;]*/gi, "$1")}"`);
  t = t.replace(/^<(\w+)/, `<$1 fill="${v}"`);
  return t;
}
/** a shape's rough bounding box from the numbers in it (good enough to spot a background across the whole picture) */
function roughBox(tag: string): [number, number, number, number] | null {
  const name = tag.match(/^<(\w+)/)?.[1]?.toLowerCase();
  const num = (k: string) => { const x = tag.match(new RegExp(`\\s${k}\\s*=\\s*"([-\\d.]+)`, "i"))?.[1]; return x == null ? NaN : +x; };
  if (name === "rect") { const x = num("x") || 0, y = num("y") || 0, w = num("width"), h = num("height"); return Number.isFinite(w) && Number.isFinite(h) ? [x, y, x + w, y + h] : null; }
  if (name === "path") {
    if (/\stransform\s*=/i.test(tag)) return null;
    const d = tag.match(/\sd\s*=\s*"([^"]*)"/i)?.[1] || "";
    if (/[mlhvcsqta]/.test(d)) return null; // relative commands: skip
    const n = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    if (n.length < 4) return null;
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return null;
}

/** Clean Recraft's SVG for the Design Lab (see the top of this file). */
export function cleanVector(svg: string, style: VectorStyle, opts: { n?: number; inks?: Ink[] } = {}): VectorArt | null {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return null;
  let vb = root.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1]?.trim().split(/[\s,]+/).map(Number) as number[] | undefined;
  if (!vb || vb.length !== 4 || vb.some((x) => !Number.isFinite(x))) {
    const w = +(root.match(/\swidth\s*=\s*"([\d.]+)/i)?.[1] || 0), h = +(root.match(/\sheight\s*=\s*"([\d.]+)/i)?.[1] || 0);
    if (!w || !h) return null;
    vb = [0, 0, w, h];
  }
  let body = svg.slice(svg.indexOf(root) + root.length, svg.lastIndexOf("</svg>"));
  // nothing but shapes
  body = body
    .replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|foreignObject|image|a|metadata|title|desc)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|foreignObject|image|a|use)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(xlink:)?href\s*=\s*("[^"]*"|'[^']*')/gi, "");
  const [vx, vy, vw, vh] = vb;
  const covers = (b: [number, number, number, number] | null) => !!b && b[0] <= vx + vw * 0.02 && b[1] <= vy + vh * 0.02 && b[2] >= vx + vw * 0.98 && b[3] >= vy + vh * 0.98;
  const SHAPE = /<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*?\/?>/gi;
  let kept = 0;
  if (style === "one") {
    // One ink: the drawing becomes a mask, in its own order: dark shapes add ink (white in the mask), light shapes on
    // top of them cut it away (black in the mask), so the details show as the shirt, like a one-screen print. The ink
    // itself is one rectangle in currentColor through that mask (Oct 11 test: dropping the light shapes instead left
    // solid silhouettes, the white details were drawn over black).
    const tone = (c: [number, number, number] | null) => (c ? (lum(c) > 0.5 ? "#000" : "#fff") : "#fff");
    const masked = body.replace(SHAPE, (tag) => {
      const raw = fillOf(tag);
      if (raw && raw.toLowerCase() === "none") { const st = rgbOf(tag.match(/\sstroke\s*=\s*"([^"]*)"/i)?.[1]); kept++; return tag.replace(/\sstroke\s*=\s*"[^"]*"/i, ` stroke="${tone(st)}"`); }
      const c = rgbOf(raw);
      if (c && lum(c) <= 0.5) kept++;
      return setFill(tag, tone(c)).replace(/\sstroke\s*=\s*"(?!none)[^"]*"/i, ` stroke="${tone(c)}"`);
    }).replace(/(<g\b[^>]*?)\sfill\s*=\s*"[^"]*"/gi, "$1");
    if (!kept) return null;
    // the frame trimmed to the inked shapes (when every one can be measured), so the size on the shirt is the art's
    let fx = vx, fy = vy, fw = vw, fh = vh;
    const boxes: ([number, number, number, number] | null)[] = [];
    body.replace(SHAPE, (tag) => { const c = rgbOf(fillOf(tag)); if (c && lum(c) <= 0.5) boxes.push(roughBox(tag)); return tag; });
    if (boxes.length && boxes.every(Boolean)) {
      const bs = boxes as [number, number, number, number][];
      const x0 = Math.max(vx, Math.min(...bs.map((b) => b[0]))), y0 = Math.max(vy, Math.min(...bs.map((b) => b[1])));
      const x1 = Math.min(vx + vw, Math.max(...bs.map((b) => b[2]))), y1 = Math.min(vy + vh, Math.max(...bs.map((b) => b[3])));
      const pad = Math.max(vw, vh) * 0.01;
      if (x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) < vw * vh * 0.97) { fx = Math.max(vx, x0 - pad); fy = Math.max(vy, y0 - pad); fw = Math.min(vx + vw, x1 + pad) - fx; fh = Math.min(vy + vh, y1 + pad) - fy; }
    }
    body = `<defs><mask id="ink" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#000"/>${masked}</mask></defs><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="currentColor" mask="url(#ink)"/>`;
    return { body, vb: [fx, fy, fw, fh], full: false };
  }
  body = body.replace(SHAPE, (tag) => {
    const c = rgbOf(fillOf(tag));
    const light = c ? lum(c) > 0.82 : false;
    if (light && covers(roughBox(tag))) return ""; // the white background
    kept++; return tag;
  });
  if (!kept) return null;
  if (style !== "spot" || !opts.n) return { body: body.trim(), vb: [vx, vy, vw, vh], full: true };
  return spotColors(body.trim(), [vx, vy, vw, vh], opts.n, opts.inks || []);
}

/* ---------- spot colors: exactly n inks ---------- */
const hex2 = (c: [number, number, number]) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
function lab(c: [number, number, number]) {
  const f = (v: number) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [r, g, b] = c.map(f);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
}
const dE = (a: [number, number, number], b: [number, number, number]) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

/**
 * Spot-color art (2–4 inks): every shape's color is snapped to one of exactly `n` inks, the customer's when they
 * picked them (school colors), else the art's own most-used colors. Near-white shapes are knockouts (the shirt shows
 * through, cut with a mask in drawing order) unless white is one of the inks.
 */
function spotColors(body: string, vb: [number, number, number, number], n: number, inks: Ink[]): VectorArt | null {
  const SHAPE = /<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*?\/?>/gi;
  const counts = new Map<string, { c: [number, number, number]; k: number }>();
  body.replace(SHAPE, (tag) => { const c = rgbOf(fillOf(tag)); if (c && lum(c) <= 0.9) { const h = hex2(c); const e = counts.get(h) || { c, k: 0 }; e.k++; counts.set(h, e); } return tag; });
  const targets: [number, number, number][] = inks.slice(0, n).map((k) => rgbArr(k.hex) as [number, number, number]);
  for (const e of [...counts.values()].sort((a, b) => b.k - a.k)) {
    if (targets.length >= n) break;
    if (targets.every((t) => dE(t, e.c) > 25)) targets.push(e.c);
  }
  if (!targets.length) return null;
  const whiteInk = targets.some((t) => lum(t) > 0.9);
  const near = (c: [number, number, number]) => targets.reduce((best, t) => (dE(t, c) < dE(best, c) ? t : best), targets[0]);
  const used = new Set<string>();
  let cut = false;
  const mask: string[] = [], art: string[] = [];
  body.replace(SHAPE, (tag) => {
    const c = rgbOf(fillOf(tag));
    if (c && lum(c) > 0.9 && !whiteInk) { cut = true; mask.push(setFill(tag, "#000")); return tag; } // a knockout
    const t = c ? near(c) : targets[0];
    const h = hex2(t); used.add(h);
    mask.push(setFill(tag, "#fff"));
    art.push(setFill(tag, h).replace(/\sstroke\s*=\s*"(?!none)[^"]*"/i, ` stroke="${h}"`));
    return tag;
  });
  if (!art.length) return null;
  const [vx, vy, vw, vh] = vb;
  const out = cut
    ? `<defs><mask id="cut" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#000"/>${mask.join("")}</mask></defs><g mask="url(#cut)">${art.join("")}</g>`
    : art.join("");
  return { body: out, vb, full: true, spots: [...used] };
}

/** `n` designs for one idea, made side by side; each cleaned. Failed ones are left out (the first reason is kept). */
export async function vectorDesigns(idea: string, style: VectorStyle, n = 4, colors = 1, inks: Ink[] = []): Promise<{ art: VectorArt[]; error: string }> {
  const prompt = promptFor(idea, style, colors, inks);
  const got = await Promise.allSettled(Array.from({ length: n }, () => generateOne(prompt, style === "one" ? [] : inks)));
  const art: VectorArt[] = []; let error = "";
  for (const g of got) {
    if (g.status === "fulfilled") { const a = cleanVector(g.value, style, { n: colors, inks }); if (a) art.push(a); else error ||= "One design came back empty after cleaning."; }
    else error ||= g.reason instanceof Error ? g.reason.message : String(g.reason);
  }
  return { art, error };
}
