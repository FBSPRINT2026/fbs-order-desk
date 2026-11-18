/**
 * Print templates (Nov 18 2026, Nick: "just give you templates and you make them, you fill them in… change the name,
 * the title, and the address"). A template is a flat printed piece (a business card first) saved once: each side's fixed
 * art (logos, rules, colors: a PNG for the screen and the same art as a vector PDF for the printer) and the text lines on
 * it, each with its place, font, size and color. Staff pick the template on a paper printing order's item, type the
 * lines, and get the proof picture and the print-ready PDF (real text in the real font, over the vector art, with bleed).
 *
 * Templates live in `print_templates` (one row each, a customer's own or the shop's); their art in
 * public/print-templates/<slug>/. Every size here is in points (72 to the inch) on the trim, y down from the top.
 */

export type CardField = {
  key: string;
  /** what staff see beside the box ("Name", "Cell") */ label: string;
  /** the template's own text, filled in to start */ text: string;
  /** the anchor: left edge, center or right edge (per align), and the baseline, from the trim's top-left */ x: number; y: number;
  align?: "left" | "center" | "right";
  size: number;
  font: string; weight?: number; italic?: boolean;
  color: string;
  /** letter spacing in thousandths of the size */ tracking?: number;
  upper?: boolean;
  /** a fixed label before the text ("C:"), in its own weight; the text then starts at valueX */
  prefix?: { text: string; weight?: number; italic?: boolean; valueX?: number };
};
export type CardSide = {
  name: string;
  /** the fixed art: a picture for the screen, the same art as a vector PDF for print (both the same box) */
  png: string; pdf?: string;
  /** that box's size, and where the trim's top-left sits in it */ box: { w: number; h: number }; trim: { x: number; y: number };
  fields: CardField[];
};
export type TemplateData = { w: number; h: number; sides: CardSide[]; note?: string };
export type PrintTemplate = { id: string; name: string; customer_id: string | null; kind: string; data: TemplateData };
/** what an item saves: the template and every line as typed */
export type CardFill = { template: string; name?: string; values: Record<string, string> };

/** the fonts templates use, with their files (public/fonts/card, all SIL Open Font License) */
export const CARD_FONTS: Record<string, { label: string; files: Record<string, string>; note?: string }> = {
  "Open Sauce One": { label: "Open Sauce One", files: {
    "400": "OpenSauceOne-Regular.ttf", "500": "OpenSauceOne-Medium.ttf", "600": "OpenSauceOne-SemiBold.ttf", "700": "OpenSauceOne-Bold.ttf",
    "400i": "OpenSauceOne-Italic.ttf", "500i": "OpenSauceOne-MediumItalic.ttf", "700i": "OpenSauceOne-BoldItalic.ttf", "300": "OpenSauceOne-Light.ttf" } },
  // Myriad Pro is Adobe's and can't be shipped: Source Sans 3 is Adobe's open cousin of it, the same widths to 0.5%
  "Source Sans 3": { label: "Source Sans 3 (Myriad Pro)", note: "Myriad Pro's open stand-in", files: {
    "400": "SourceSans3-Regular.ttf", "600": "SourceSans3-Semibold.ttf", "700": "SourceSans3-Bold.ttf", "400i": "SourceSans3-It.ttf" } },
};
const nearest = (files: Record<string, string>, weight = 400, italic = false) => {
  const keys = Object.keys(files).filter((k) => k.endsWith("i") === italic);
  const pool = keys.length ? keys : Object.keys(files);
  return pool.sort((a, b) => Math.abs(parseInt(a, 10) - weight) - Math.abs(parseInt(b, 10) - weight))[0];
};
/** the file for a font, weight and slant (the nearest weight it has) */
export function fontFile(font: string, weight = 400, italic = false): string {
  const f = CARD_FONTS[font] || CARD_FONTS["Source Sans 3"];
  return `/fonts/card/${f.files[nearest(f.files, weight, italic)]}`;
}
/** @font-face rules for every template font, for the screen (each weight and slant its own face) */
export function cardFontCss(): string {
  return Object.entries(CARD_FONTS).flatMap(([fam, f]) => Object.entries(f.files).map(([k, file]) =>
    `@font-face{font-family:"${fam}";src:url(/fonts/card/${file}) format("truetype");font-weight:${parseInt(k, 10)};font-style:${k.endsWith("i") ? "italic" : "normal"};font-display:block}`)).join("");
}

/** a line's text as it prints (its typed value, else blank: an emptied line leaves its space) */
export function lineText(f: CardField, values: Record<string, string>): string {
  const v = (values[f.key] ?? f.text ?? "").replace(/\s+/g, " ").trim();
  return f.upper ? v.toUpperCase() : v;
}
export const startValues = (t: TemplateData): Record<string, string> => Object.fromEntries(t.sides.flatMap((s) => s.fields.map((f) => [f.key, f.text])));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * One side as an SVG (the trim, in points): the art, then each line. `art` is the art's address (a signed or public
 * URL, or a data: URL when the SVG is drawn to a canvas).
 */
export function sideSvg(side: CardSide, t: TemplateData, values: Record<string, string>, art: string, opts: { fontCss?: string } = {}): string {
  const anchor = (a?: string) => (a === "center" ? "middle" : a === "right" ? "end" : "start");
  const txt = side.fields.map((f) => {
    const v = lineText(f, values);
    if (!v) return "";
    const ls = f.tracking ? ` letter-spacing="${(f.tracking / 1000) * f.size}"` : "";
    const st = (w?: number, it?: boolean) => `font-family="${f.font}" font-weight="${w ?? f.weight ?? 400}" font-style="${it ?? f.italic ? "italic" : "normal"}"`;
    if (f.prefix) {
      return `<text x="${f.x}" y="${f.y}" font-size="${f.size}" fill="${f.color}" ${st(f.prefix.weight, f.prefix.italic)}${ls}>${esc(f.prefix.text)}</text>`
        + `<text x="${f.prefix.valueX ?? f.x}" y="${f.y}" font-size="${f.size}" fill="${f.color}" ${st()}${ls}>${esc(v)}</text>`;
    }
    return `<text x="${f.x}" y="${f.y}" font-size="${f.size}" fill="${f.color}" text-anchor="${anchor(f.align)}" ${st()}${ls}>${esc(v)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t.w} ${t.h}" width="${t.w}" height="${t.h}">`
    + (opts.fontCss ? `<style>${opts.fontCss}</style>` : "")
    + `<rect width="${t.w}" height="${t.h}" fill="#fff"/>`
    + `<image href="${art}" x="${-side.trim.x}" y="${-side.trim.y}" width="${side.box.w}" height="${side.box.h}" preserveAspectRatio="none"/>`
    + txt + `</svg>`;
}

const toDataUrl = async (url: string) => {
  const b = await (await fetch(url)).blob();
  return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b); });
};
/** the template fonts as inline @font-face rules (data: URLs), so a drawn SVG keeps them */
async function inlineFontCss(t: TemplateData): Promise<string> {
  const need = new Set<string>();
  for (const s of t.sides) for (const f of s.fields) { need.add(`${f.font}|${f.weight ?? 400}|${f.italic ? 1 : 0}`); if (f.prefix) need.add(`${f.font}|${f.prefix.weight ?? f.weight ?? 400}|${f.prefix.italic ? 1 : 0}`); }
  const css: string[] = [];
  for (const k of need) {
    const [fam, w, i] = k.split("|");
    css.push(`@font-face{font-family:"${fam}";src:url(${await toDataUrl(fontFile(fam, +w, i === "1"))});font-weight:${w};font-style:${i === "1" ? "italic" : "normal"}}`);
  }
  return css.join("");
}

/**
 * The proof picture: every side, side by side on a light gray table with a soft shadow, at `scale` pixels per point
 * (4 = 288 px to the inch). What the customer approves.
 */
export async function proofPng(t: TemplateData, values: Record<string, string>, scale = 4): Promise<Blob> {
  const fontCss = await inlineFontCss(t);
  const gap = 24, pad = 24, n = t.sides.length;
  const c = document.createElement("canvas");
  c.width = Math.round((pad * 2 + n * t.w + (n - 1) * gap) * scale); c.height = Math.round((pad * 2 + t.h) * scale);
  const x = c.getContext("2d")!;
  x.fillStyle = "#eef0f3"; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < n; i++) {
    const s = t.sides[i];
    const svg = sideSvg(s, t, values, await toDataUrl(s.png), { fontCss });
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const left = (pad + i * (t.w + gap)) * scale, top = pad * scale;
    x.save(); x.shadowColor = "rgba(0,0,0,.18)"; x.shadowBlur = 6 * scale; x.shadowOffsetY = 1.5 * scale;
    x.fillStyle = "#fff"; x.fillRect(left, top, t.w * scale, t.h * scale); x.restore();
    x.drawImage(img, left, top, t.w * scale, t.h * scale);
  }
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("The picture couldn't be made."))), "image/png"));
}

const FONTKIT = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm";
const hexRgb = (h: string) => { const v = h.replace("#", ""); return [0, 2, 4].map((i) => (parseInt(v.slice(i, i + 2), 16) || 0) / 255) as [number, number, number]; };
/**
 * The print-ready PDF: a page per side, the trim plus `bleedPt` all round (TrimBox and BleedBox set), the side's vector
 * art and every line as real text in its font (embedded). What goes to the printer.
 */
export async function printPdf(t: TemplateData, values: Record<string, string>, bleedPt = 9): Promise<Uint8Array> {
  const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, setCharacterSpacing } = await import("pdf-lib");
  const fontkit = ((await import(/* webpackIgnore: true */ FONTKIT)) as { default: unknown }).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as Parameters<typeof doc.registerFontkit>[0]);
  const fonts = new Map<string, Awaited<ReturnType<typeof doc.embedFont>>>();
  const font = async (fam: string, w: number, it: boolean) => {
    const file = fontFile(fam, w, it);
    if (!fonts.has(file)) fonts.set(file, await doc.embedFont(await (await fetch(file)).arrayBuffer(), { subset: true }));
    return fonts.get(file)!;
  };
  for (const s of t.sides) {
    const W = t.w + bleedPt * 2, H = t.h + bleedPt * 2;
    const page = doc.addPage([W, H]);
    page.setTrimBox(bleedPt, bleedPt, t.w, t.h);
    page.setBleedBox(0, 0, W, H);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
    // the art: its vector PDF where there is one (else its picture), the trim lined up
    const ox = bleedPt - s.trim.x, oyTop = bleedPt - s.trim.y; // the box's top-left on the page, from the page's top-left
    if (s.pdf) {
      const src = await PDFDocument.load(await (await fetch(s.pdf)).arrayBuffer());
      const [emb] = await doc.embedPdf(src, [0]);
      page.drawPage(emb, { x: ox, y: H - oyTop - s.box.h, width: s.box.w, height: s.box.h });
    } else {
      const png = await doc.embedPng(await (await fetch(s.png)).arrayBuffer());
      page.drawImage(png, { x: ox, y: H - oyTop - s.box.h, width: s.box.w, height: s.box.h });
    }
    for (const f of s.fields) {
      const v = lineText(f, values);
      if (!v) continue;
      const [r, g, b] = hexRgb(f.color);
      const cs = f.tracking ? (f.tracking / 1000) * f.size : 0;
      const draw = async (text: string, x: number, w: number, it: boolean) => {
        const fo = await font(f.font, w, it);
        const width = fo.widthOfTextAtSize(text, f.size) + cs * Math.max(0, text.length - 1);
        const left = f.prefix ? x : f.align === "center" ? x - width / 2 : f.align === "right" ? x - width : x;
        if (cs) page.pushOperators(pushGraphicsState(), setCharacterSpacing(cs));
        page.drawText(text, { x: bleedPt + left, y: H - bleedPt - f.y, size: f.size, font: fo, color: rgb(r, g, b) });
        if (cs) page.pushOperators(popGraphicsState());
      };
      if (f.prefix) {
        await draw(f.prefix.text, f.x, f.prefix.weight ?? f.weight ?? 400, f.prefix.italic ?? !!f.italic);
        await draw(v, f.prefix.valueX ?? f.x, f.weight ?? 400, !!f.italic);
      } else await draw(v, f.x, f.weight ?? 400, !!f.italic);
    }
  }
  return await doc.save();
}

/** the item's name from what was typed: "Business cards: Hugo Bejarano" */
export function cardItemName(t: PrintTemplate, values: Record<string, string>): string {
  const first = t.data.sides.flatMap((s) => s.fields).find((f) => /name/i.test(f.key) || /name/i.test(f.label));
  const who = first ? lineText({ ...first, upper: false }, values) : "";
  return `Business cards${who ? `: ${who}` : `: ${t.name}`}`;
}
