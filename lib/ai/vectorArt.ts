import "server-only";

/**
 * AI Design (the Design Lab): print-ready vector art from Recraft (real SVG, about $0.08 an image; RECRAFT_API_TOKEN).
 * The SVG comes back cleaned for a shirt:
 *  - one color: every dark shape becomes the layer's ink (currentColor, so it recolors like clip art); light shapes
 *    (the white background, highlights) are dropped, so the shirt shows through, as a one-screen print would.
 *  - full color: the background (a light shape across the whole picture) is dropped; everything else keeps its colors.
 * Anything that isn't plain shapes (scripts, links, embedded pictures, styles) is taken out.
 */

export type VectorStyle = "one" | "full";
export type VectorArt = { body: string; vb: [number, number, number, number]; full: boolean };

const API = "https://external.api.recraft.ai/v1/images/generations";
export const recraftConfigured = () => !!process.env.RECRAFT_API_TOKEN?.trim();

function promptFor(idea: string, style: VectorStyle) {
  const base = idea.trim().replace(/\s+/g, " ").slice(0, 600);
  return style === "one"
    ? `${base}. Bold t-shirt screen print graphic in a single solid black ink only, no gradients, no gray tones, no shading, clean thick shapes, isolated on a plain white background.`
    : `${base}. Bold colorful t-shirt graphic, flat vector illustration with a few solid colors, clean shapes, isolated on a plain white background.`;
}

/** One picture from Recraft: the SVG text. */
async function generateOne(prompt: string): Promise<string> {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RECRAFT_API_TOKEN!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: process.env.RECRAFT_MODEL?.trim() || "recraftv4_1_vector" }),
    cache: "no-store", signal: AbortSignal.timeout(90_000),
  });
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
export function cleanVector(svg: string, style: VectorStyle): VectorArt | null {
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
  body = body.replace(SHAPE, (tag) => {
    const c = rgbOf(fillOf(tag));
    const light = c ? lum(c) > 0.82 : false;
    if (style === "one") {
      if (!c) { if (/\sfill\s*=\s*"none"/i.test(tag)) { kept++; return tag.replace(/\sstroke\s*=\s*"[^"]*"/i, ' stroke="currentColor"'); } kept++; return setFill(tag, "currentColor"); }
      if (lum(c) > 0.5) return ""; // light: the shirt shows through
      kept++; return setFill(tag, "currentColor").replace(/\sstroke\s*=\s*"(?!none)[^"]*"/i, ' stroke="currentColor"');
    }
    if (light && covers(roughBox(tag))) return ""; // the white background
    kept++; return tag;
  });
  if (style === "one") body = body.replace(/(<g\b[^>]*?)\sfill\s*=\s*"[^"]*"/gi, "$1");
  if (!kept) return null;
  return { body: body.trim(), vb: [vx, vy, vw, vh], full: style !== "one" };
}

/** `n` designs for one idea, made side by side; each cleaned. Failed ones are left out (the first reason is kept). */
export async function vectorDesigns(idea: string, style: VectorStyle, n = 4): Promise<{ art: VectorArt[]; error: string }> {
  const prompt = promptFor(idea, style);
  const got = await Promise.allSettled(Array.from({ length: n }, () => generateOne(prompt)));
  const art: VectorArt[] = []; let error = "";
  for (const g of got) {
    if (g.status === "fulfilled") { const a = cleanVector(g.value, style); if (a) art.push(a); else error ||= "One design came back empty after cleaning."; }
    else error ||= g.reason instanceof Error ? g.reason.message : String(g.reason);
  }
  return { art, error };
}
