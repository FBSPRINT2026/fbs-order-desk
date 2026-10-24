"use client";
import { COLLAR_Y, PHOTO_H, PHOTO_W, PX_PER_IN } from "@/lib/mockup";
import { suggestInk } from "@/lib/inkColors";

/**
 * The print art out of an old Printavo mockup PDF (our Illustrator mockup sheet: the shirt photos with the art on
 * top, front on the left, back on the right). The shirt photos are left out while the page is drawn, so what's left
 * is the art itself, on a clear background; each piece sitting on a shirt photo is one print. Its size and drop come
 * from where it sits on the photo (the same supplier photos the Mockup Creator uses: 1000 px wide, 34 px per inch).
 */
export type ArtPiece = { side: "front" | "back"; file: File; widthIn: number; heightIn: number; dropIn: number; offIn: number; hex: string; ink: string;
  /** measured off a photo that isn't our flat shirt photo (a person wearing it, their own photo): the art is right, its size
   *  and drop aren't to be trusted (Oct 23, McKenna's HUD 102026: a man in the red tee read as 12" wide, 9.25" down) */ approx?: boolean;
  /** a texture laid over the art in the file (its distress), white = texture, the same size as `file`; and how sharp it is at print size */ mask?: File; maskPpi?: number;
  /** the shirt's color around it on the mockup */ shirtHex?: string };

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
type Vp = { width: number; height: number };
type Page = { getViewport: (o: { scale: number }) => Vp; render: (o: Record<string, unknown>) => { promise: Promise<void> } };
type Rect = { x0: number; y0: number; x1: number; y1: number };

type Doc = { numPages: number; getPage: (n: number) => Promise<Page> };
async function openDoc(buf: ArrayBuffer): Promise<Doc> {
  const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<Doc> } };
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs.getDocument({ data: buf }).promise;
}
const openPage = async (buf: ArrayBuffer) => (await openDoc(buf)).getPage(1);
/** a PDF's words, page after page (the digitizer's worksheet: lib/worksheet.ts) */
export async function pdfText(buf: ArrayBuffer, maxPages = 6): Promise<string> {
  const doc = await openDoc(buf);
  const out: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const pg = await doc.getPage(n) as unknown as { getTextContent: () => Promise<{ items: { str?: string }[] }> };
    out.push((await pg.getTextContent()).items.map((x) => x.str || "").join(" "));
  }
  return out.join(" ").replace(/\s+/g, " ");
}
/**
 * The print sizes written on one of our mockup sheets ("Back Imprint · SIZE: W 10"", "Front Imprint · SIZE: W 3" H 3.21"")
 * (Oct 23, Nick on PO 92785: the back was measured off #32303's sheet at 14" wide, which we can't even print; the sheet
 * says W 10"). By side: front, back, left/right sleeve.
 */
/** one side of our mockup sheet: its size, its inks, and the screens that aren't inks (a white underbase, halftones) */
export type SheetSide = { /** inches wide; 0 = not written (the art pulled off the sized proof gives it) */ w: number; h?: number; inks?: string[]; ub?: boolean; halftones?: boolean; /** an ink's own note ("Navy: match trim") */ notes?: string[] };
export async function sizesOnSheet(buf: ArrayBuffer): Promise<Partial<Record<"front" | "back" | "left sleeve" | "right sleeve", SheetSide>>> {
  const doc = await openDoc(buf);
  const out: Partial<Record<"front" | "back" | "left sleeve" | "right sleeve", SheetSide>> = {};
  for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
    const pg = await doc.getPage(n) as unknown as { getTextContent: () => Promise<{ items: { str?: string }[] }> };
    const t = (await pg.getTextContent()).items.map((x) => x.str || "").join(" ").replace(/\s+/g, " ");
    // our sized proof, known by what's printed on every one (Oct 23, Nick: yes, recognize it by that, not only by how its
    // size is written): a side with its inks but no size it can read is still ours (w 0: the art pulled off it gives it)
    // or by the page itself (Oct 23, Nick: "visually… the whole bottom third of the sheet is the same on every one"): the
    // same page as our blank sized proof (35" × 42", the shirt and the standard imprint colors chart)
    const v = (pg as unknown as { getViewport: (o: { scale: number }) => { width: number; height: number } }).getViewport({ scale: 1 });
    void v;
    const ours = n === 1 ? (await looksLikeOurSheet(pg as unknown as Page).catch(() => 0)) >= 0.6 || /the above sized proof|standard imprint colou?rs/i.test(t) : /the above sized proof|standard imprint colou?rs/i.test(t);
    for (const m of t.matchAll(/(front|back|left sleeve|right sleeve)\s+imprint\b(?=(.{0,160}))/gi)) { // each side found, even one inside the side before's 160 letters
      const side = m[1].toLowerCase() as keyof typeof out;
      // this side's part only: up to the next "… Imprint" or the sheet's own text
      const part = m[2].split(/\b(?:front|back|left sleeve|right sleeve)\s+imprint\b|the above|standard imprint/i)[0];
      // its size, however the sheet writes it (Oct 23, #34528 All Star: "SIZE: 3.75”" and "SIZE: 11” X 15”"; HALFF:
      // "SIZE: W 3” H 0.7”"); 0 = a side not used
      const q = `["”″']?`;
      const sz = part.match(new RegExp(`\\bW\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*${q}(?:\\s*(?:x|×)?\\s*H\\s*:?\\s*(\\d+(?:\\.\\d+)?))?`, "i"))
        || part.match(new RegExp(`\\bsize\\s*:?\\s*(\\d+(?:\\.\\d+)?)\\s*${q}(?:\\s*(?:x|×|by)\\s*(\\d+(?:\\.\\d+)?)\\s*${q})?`, "i"));
      // its inks as listed ("COLORS 1. WHITE 2. SCARLET RED", "1. NAVY (MATCH TRIM) 2. GOLD 3. HALFTONES 4. UNDERBASE"):
      // the underbase and halftones are screens, not inks; a note in brackets stays with its ink
      const cl = part.match(/colou?rs?\s*:?\s*(.+)$/i)?.[1] || "";
      const listed = [...cl.matchAll(/\d+\.\s*([A-Za-z][A-Za-z0-9 #&\/\-()]*?)(?=\s+\d+\.|\s*$)/g)].map((x) => x[1].trim()).filter((x) => x && !/^n\/?a$/i.test(x));
      const tc = (t: string) => t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
      let ub = false, halftones = false;
      const inks: string[] = [], notes: string[] = [];
      for (const x of listed) {
        if (/^(white\s+)?under\s*-?base$/i.test(x)) { ub = true; continue; }
        if (/^half\s*-?tones?$/i.test(x)) { halftones = true; continue; }
        const nm = tc(x.replace(/\s*\(.*?\)\s*/g, " ").trim()), br = x.match(/\((.*?)\)/)?.[1];
        if (!nm) continue;
        inks.push(nm);
        if (br) notes.push(`${nm}: ${br.toLowerCase()}`);
      }
      if (!out[side] && ours && !(sz && +sz[1] > 0) && inks.length && !inks.every((x) => /^black$/i.test(x))) out[side] = { w: 0, ...(inks.length ? { inks: inks.slice(0, 8) } : {}), ...(ub ? { ub } : {}), ...(halftones ? { halftones } : {}), ...(notes.length ? { notes } : {}) };
      if (sz && !out[side] && +sz[1] > 0 && +sz[1] < 20) out[side] = { w: +sz[1], ...(sz[2] && +sz[2] > 0 ? { h: +sz[2] } : {}), ...(inks.length ? { inks: inks.slice(0, 8) } : {}), ...(ub ? { ub } : {}), ...(halftones ? { halftones } : {}), ...(notes.length ? { notes } : {}) };
    }
  }
  return out;
}
/**
 * Our mockup sheet, by looking at it (Oct 23, Nick: "look at a image of our mock-up and go, oh, this matches 95% of our
 * mock-up… the whole bottom third of the sheet is the same on every one"): the page drawn small next to our blank
 * sheets, and the bottom third compared (ours: 86–100% the same; a work order or PO: 3%). 60% = ours.
 */
const smallGray = async (page: Page, W = 200, H = 240) => {
  const v = page.getViewport({ scale: 1 }), sc = Math.min(W / v.width, H / v.height);
  const vp = page.getViewport({ scale: sc }), c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
  await page.render({ canvasContext: x, viewport: vp, background: "rgba(255,255,255,1)" }).promise;
  const d = x.getImageData(0, 0, W, H).data, g = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  return g;
};
let blankLooks: Promise<Uint8Array[]> | null = null;
export async function looksLikeOurSheet(page: Page): Promise<number> {
  blankLooks ||= loadTemplates().then((ds) => Promise.all(ds.map(async (d) => smallGray(await d.getPage(1)))));
  const blanks = await blankLooks, f = await smallGray(page), W = 200, H = 240, y0 = Math.round(H * 0.67);
  let best = 0;
  for (const b of blanks) {
    let same = 0, n = 0;
    // where our blank sheet has something drawn (the color chart, the notes), does this page have it too
    for (let i = y0 * W; i < W * H; i++) { if (b[i] > 215) continue; n++; if (Math.abs(f[i] - b[i]) < 45) same++; }
    if (n) best = Math.max(best, same / n);
  }
  return best;
}

/** the first page's size in inches (a logo's own artboard is a few inches; a mockup page is letter size or more) */
export async function firstPageIn(buf: ArrayBuffer): Promise<{ w: number; h: number }> {
  const doc = await openDoc(buf);
  const v = (await doc.getPage(1)).getViewport({ scale: 1 });
  return { w: v.width / 72, h: v.height / 72 };
}
/** a PDF (or a PDF-compatible AI file) opened to draw its pages (the quick look's own viewer) */
export const openPdf = openDoc;

/** a PDF's first page as a picture, about `width` px wide on white (the designs catalog's covers, Oct 20) */
export async function pdfPicture(buf: ArrayBuffer, width = 900, pageNo = 1): Promise<HTMLCanvasElement> {
  const doc = await openDoc(buf);
  const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, pageNo)));
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(4, width / Math.max(1, v1.width)) });
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(255,255,255,1)" }).promise;
  return c;
}

/**
 * Draws the page with the big photos skipped: a picture drawn wider than 30% of the page (the shirt photos) is left
 * out and its place on the page recorded. pdf.js's own scratch canvases (page sized) still go through.
 */
/**
 * mode "art" (default): everything but the shirt photos. "vector": no pictures at all (the art's own shapes: a distress
 * texture laid over it is left off, so the art comes out clean). "textures": only the pictures that aren't shirt photos
 * (a distress texture: Peticolas' scratched mask), no shapes. `texPx`: the sharpest texture's own pixels per canvas pixel.
 */
async function drawWithoutPhotos(page: Page, scale: number, crop?: Rect, known?: { photos: Rect[]; scale: number }, mode: "art" | "vector" | "textures" = "art") {
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  const W = crop ? Math.round(crop.x1 - crop.x0) : Math.round(vp.width), H = crop ? Math.round(crop.y1 - crop.y0) : Math.round(vp.height);
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const photos: Rect[] = [];
  let texPx = 0;
  const noop = () => {};
  const proxy = new Proxy(ctx, {
    get(t, p) {
      // textures only: the shapes aren't painted (pictures, and pdf.js's own layer copies, still are)
      if (mode === "textures" && (p === "fill" || p === "stroke" || p === "fillRect" || p === "strokeRect" || p === "fillText" || p === "strokeText")) return noop;
      if (p === "drawImage") return (...a: unknown[]) => {
        const src = a[0] as { width: number; height: number };
        // a picture in the file is painted with 9 arguments; pdf.js's own layer copies (groups, masks) with 3
        if (mode === "vector" && a.length >= 5) return;
        // textures only: a layer copy holds shapes drawn elsewhere (Mambo's grouped art), not a texture
        if (mode === "textures" && a.length < 5) return;
        const [dx, dy, dw, dh] = a.length >= 9 ? (a.slice(5, 9) as number[]) : a.length >= 5 ? (a.slice(1, 5) as number[]) : [a[1] as number, a[2] as number, src.width, src.height];
        const m = t.getTransform();
        const xs = [dx, dx + dw].flatMap((x) => [dy, dy + dh].map((y) => m.a * x + m.c * y + m.e));
        const ys = [dx, dx + dw].flatMap((x) => [dy, dy + dh].map((y) => m.b * x + m.d * y + m.f));
        const r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        const fullW = vp.width;
        // a flat one-color picture filling the page is the artboard's background (Oct 20, Little Groupies "The Bottles":
        // Illustrator saved a 4200 × 4800 plain gray picture under the vector art): left out, so the art is on clear
        if (r.x1 - r.x0 > fullW * 0.85 && r.y1 - r.y0 > vp.height * 0.85 && isFlat(src)) return;
        if (known) {
          // drawn again sharper: skip only the shirt photos found on the first look (same place on the page). pdf.js
          // paints masked art (an Illustrator opacity mask: a flat color + a soft mask holding the design) as one big
          // layer, which the size rule below took for a photo, leaving just the flat circle (Peticolas, Oct 10)
          const k = scale / known.scale, ox = crop ? crop.x0 : 0, oy = crop ? crop.y0 : 0;
          const same = known.photos.some((ph) => {
            const q = { x0: ph.x0 * k - ox, y0: ph.y0 * k - oy, x1: ph.x1 * k - ox, y1: ph.y1 * k - oy };
            const tol = 0.03 * (q.x1 - q.x0);
            return Math.abs(q.x0 - r.x0) < tol && Math.abs(q.x1 - r.x1) < tol && Math.abs(q.y0 - r.y0) < tol && Math.abs(q.y1 - r.y1) < tol;
          });
          if (same) return;
          if (mode === "textures" && a.length >= 5 && r.x1 > r.x0) texPx = Math.max(texPx, src.width / (r.x1 - r.x0));
          return (t.drawImage as (...x: unknown[]) => void).apply(t, a);
        }
        // a shirt photo is solid; a big picture with see-through parts is a texture over the art (Peticolas' mask)
        if (mode !== "textures" && r.x1 - r.x0 > fullW * 0.3 && src.width < fullW * 0.9 && src.width < 4000 && !hasClear(src)) { photos.push(r); return; }
        if (mode === "textures" && a.length >= 5 && r.x1 > r.x0) texPx = Math.max(texPx, src.width / (r.x1 - r.x0));
        return (t.drawImage as (...x: unknown[]) => void).apply(t, a);
      };
      const v = Reflect.get(t, p);
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, p, v) { return Reflect.set(t, p, v); },
  });
  await page.render({ canvasContext: proxy, viewport: vp, background: "rgba(0,0,0,0)", ...(crop ? { transform: [1, 0, 0, 1, -crop.x0, -crop.y0] } : {}) }).promise;
  return { canvas: c, photos, texPx };
}

/** a texture layer (drawn alone) as a mask picture: white where the texture is, black where it isn't (opaque, gray =
 *  how strong). Null when there's no texture there. */
async function maskFile(c: HTMLCanvasElement, name: string): Promise<File | null> {
  const x = c.getContext("2d", { willReadFrequently: true })!, img = x.getImageData(0, 0, c.width, c.height), px = img.data;
  let on = 0, seen = 0, mid = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 8) { seen++; if (px[i + 3] > 20 && px[i + 3] < 235) mid++; }
    const v = Math.round((px[i + 3] / 255) * Math.max(px[i], px[i + 1], px[i + 2]));
    if (v > 12) on++;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  // a texture is see-through in between (a scratched mask), not a solid picture (a placed logo)
  if (on < (c.width * c.height) / 100 || mid < seen * 0.25) return null;
  x.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  return blob ? new File([blob], name, { type: "image/png" }) : null;
}

/**
 * A distress mask file (a customer's: Peticolas_Film_Mask.pdf, the scratched texture alone): the texture as a mask
 * picture (white = texture), cropped to it. PDF/AI (the texture pictures in it, at their own resolution) or a picture
 * (white or see-through texture).
 */
export async function maskFromFile(f: File): Promise<File | null> {
  if (/pdf|postscript|illustrator/i.test(f.type) || /\.(pdf|ai)$/i.test(f.name)) {
    const page = await openPage(await f.arrayBuffer());
    const v1 = page.getViewport({ scale: 1 });
    // first at a small size to find how sharp the texture is, then at about its own resolution (at most 4000 px)
    const look = await drawWithoutPhotos(page, 1, undefined, undefined, "textures");
    const sc = Math.min(4000 / Math.max(v1.width, v1.height), Math.max(1, look.texPx || 2));
    const t = await drawWithoutPhotos(page, sc, undefined, undefined, "textures");
    const c = t.canvas, d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return null;
    const cc = document.createElement("canvas"); cc.width = x1 - x0 + 1; cc.height = y1 - y0 + 1;
    cc.getContext("2d")!.drawImage(c, x0, y0, cc.width, cc.height, 0, 0, cc.width, cc.height);
    return maskFile(cc, f.name.replace(/\.[^.]+$/, "") + " mask.png");
  }
  const bm = await createImageBitmap(f);
  const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height;
  c.getContext("2d")!.drawImage(bm, 0, 0);
  return maskFile(c, f.name.replace(/\.[^.]+$/, "") + " mask.png");
}

/** a picture with see-through parts (sampled small): a texture or cut-out art, not a shirt photo */
function hasClear(src: unknown) {
  try {
    const t = document.createElement("canvas"); t.width = 32; t.height = 32;
    const x = t.getContext("2d", { willReadFrequently: true })!; x.drawImage(src as CanvasImageSource, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data; let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
    return clear > 32 * 32 * 0.15;
  } catch { return false; }
}

/** a picture that's one flat color (sampled small): an artboard background, not art or a photo */
function isFlat(src: unknown) {
  try {
    const t = document.createElement("canvas"); t.width = 24; t.height = 24;
    const x = t.getContext("2d")!; x.drawImage(src as CanvasImageSource, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    for (let i = 4; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 12 || Math.abs(d[i + 3] - d[3]) > 12) return false;
    return d[3] > 200;
  } catch { return false; }
}

/** groups of opaque pixels (close bits joined), as boxes in canvas pixels */
function pieces(c: HTMLCanvasElement, join: number): Rect[] {
  const { width: W, height: H } = c;
  const a = c.getContext("2d")!.getImageData(0, 0, W, H).data;
  const cell = Math.max(2, Math.round(join / 2));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (a[(y * W + x) * 4 + 3] > 24) grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1;
  const seen = new Uint8Array(gw * gh), out: Rect[] = [];
  const reach = 2; // cells: bits this close belong to the same print
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    while (st.length) {
      const k = st.pop()!, x = k % gw, y = (k / gw) | 0;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (let yy = Math.max(0, y - reach); yy <= Math.min(gh - 1, y + reach); yy++) for (let xx = Math.max(0, x - reach); xx <= Math.min(gw - 1, x + reach); xx++) {
        const j = yy * gw + xx; if (grid[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
    }
    out.push({ x0: x0 * cell, y0: y0 * cell, x1: Math.min(W, (x1 + 1) * cell), y1: Math.min(H, (y1 + 1) * cell) });
  }
  return out;
}

/** the most common opaque color in the art (its ink) */
function mainHex(c: HTMLCanvasElement) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const n = new Map<number, number>();
  const step = Math.max(1, Math.floor((c.width * c.height) / 200000));
  for (let i = 0; i < d.length; i += 4 * step) if (d[i + 3] > 240) { const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); n.set(k, (n.get(k) || 0) + 1); }
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const ch = (v: number) => ((v & 31) << 3 | 4).toString(16).padStart(2, "0");
  return `#${ch(top >> 10)}${ch(top >> 5)}${ch(top)}`;
}

/** boxes this close (canvas px) become one: a design built from separate bits (Rahr's "VOLUNBIER" over "I ♥ BEIR") is one print */
function mergeRects(rs: Rect[], gap: number): Rect[] {
  const out = rs.map((r) => ({ ...r }));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)), dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
      if (dx <= gap && dy <= gap) { out[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; out.splice(j, 1); changed = true; break; }
    }
  }
  return out;
}

export async function artFromMockupPdf(buf: ArrayBuffer, name = "art", opt: { /** join bits closer than this many inches into one print */ mergeIn?: number } = {}): Promise<ArtPiece[]> {
  const page = await openPage(buf);
  // one of our blank templates filled in (the sized proof, the race sheet): read as drawn shirts, not photos
  if (await templateFor(page, 1).catch(() => null)) return [];
  // 1. a quick look: where the photos and the art are
  const s1 = 3;
  const look = await drawWithoutPhotos(page, s1);
  const photos = look.photos.sort((a, b) => a.x0 - b.x0);
  if (!photos.length) return [];
  let found = pieces(look.canvas, 0.12 * 72 * s1).filter((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > 64);
  if (opt.mergeIn) {
    // per shirt photo: its bits within mergeIn inches of each other are one print (an inch on that photo, in page px)
    const byPhoto = new Map<number, Rect[]>(), off: Rect[] = [];
    for (const r of found) {
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      const pi = photos.findIndex((p) => cx > p.x0 && cx < p.x1 && cy > p.y0 && cy < p.y1);
      if (pi < 0) off.push(r); else byPhoto.set(pi, [...(byPhoto.get(pi) || []), r]);
    }
    found = [...off, ...[...byPhoto.entries()].flatMap(([pi, rs]) => { const p = photos[pi]; return mergeRects(rs, opt.mergeIn! * PX_PER_IN * ((p.x1 - p.x0) / PHOTO_W)); })];
  }
  // the page as it looks (photos in), to read the shirt's color around each print
  const vpF = page.getViewport({ scale: s1 }), full = document.createElement("canvas");
  full.width = Math.round(vpF.width); full.height = Math.round(vpF.height);
  await page.render({ canvasContext: full.getContext("2d")!, viewport: vpF, background: "rgba(255,255,255,1)" }).promise;
  const fullPx = full.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, full.width, full.height).data;
  const out: ArtPiece[] = [];
  for (const r of found) {
    // on a shirt photo (the FBS logo in the header isn't)
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const pi = photos.findIndex((p) => cx > p.x0 && cx < p.x1 && cy > p.y0 && cy < p.y1);
    if (pi < 0) continue;
    const p = photos[pi];
    const side: "front" | "back" = photos.length > 1 && pi === photos.length - 1 ? "back" : "front";
    // photo pixels → inches (the supplier photo the Mockup Creator uses)
    const k = PHOTO_W / (p.x1 - p.x0);
    const widthIn = ((r.x1 - r.x0) * k) / PX_PER_IN, heightIn = ((r.y1 - r.y0) * k) / PX_PER_IN;
    const topPx = (r.y0 - p.y0) * (PHOTO_H / (p.y1 - p.y0));
    const dropIn = Math.max(0, (topPx - COLLAR_Y[side]) / PX_PER_IN);
    // our flat shirt photos are 4:5; any other photo (a person, their own shot) isn't measured by it
    const approx = Math.abs((p.x1 - p.x0) / Math.max(1, p.y1 - p.y0) - PHOTO_W / PHOTO_H) > 0.05;
    const offIn = ((cx - (p.x0 + p.x1) / 2) * k) / PX_PER_IN;
    // 2. the piece drawn again at print resolution (about 300 dpi at its real size, at most 5000 px)
    const want = Math.min(5000, Math.max(800, widthIn * 300));
    const s2 = s1 * (want / (r.x1 - r.x0));
    const pad = 4 * (s2 / s1);
    const crop = { x0: (r.x0 * s2) / s1 - pad, y0: (r.y0 * s2) / s1 - pad, x1: (r.x1 * s2) / s1 + pad, y1: (r.y1 * s2) / s1 + pad };
    // the art's own shapes (clean), and any texture laid over it apart (the distress: Peticolas' scratched mask)
    let hi = await drawWithoutPhotos(page, s2, crop, { photos: look.photos, scale: s1 }, "vector");
    const tex = await drawWithoutPhotos(page, s2, crop, { photos: look.photos, scale: s1 }, "textures");
    let mask = await maskFile(tex.canvas, `${name} ${side} mask.png`).catch(() => null);
    {
      // a logo placed as a picture (a customer's JPG on the shirt photo): the shapes alone miss it, so it keeps its pictures
      const opaque = (cv: HTMLCanvasElement) => { const dd = cv.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let i = 3; i < dd.length; i += 16) if (dd[i] > 128) k++; return k; };
      const all = await drawWithoutPhotos(page, s2, crop, { photos: look.photos, scale: s1 }, "art");
      if (opaque(hi.canvas) < 0.5 * opaque(all.canvas)) { hi = all; mask = null; }
    }
    const maskPpi = mask && tex.texPx ? Math.round(tex.texPx * (hi.canvas.width / Math.max(0.1, widthIn))) : 0;
    // the shirt's color right around the print (a ring just outside it on the full page)
    const ring: number[][] = [];
    for (let d = 3; d <= 9; d += 3) for (let t = 0; t < 1; t += 0.02) {
      const pts = [[r.x0 + (r.x1 - r.x0) * t, r.y0 - d], [r.x0 + (r.x1 - r.x0) * t, r.y1 + d], [r.x0 - d, r.y0 + (r.y1 - r.y0) * t], [r.x1 + d, r.y0 + (r.y1 - r.y0) * t]];
      for (const [x, y] of pts) { const X = Math.round(x), Y = Math.round(y); if (X < 0 || Y < 0 || X >= full.width || Y >= full.height) continue; const o = (Y * full.width + X) * 4; ring.push([fullPx[o], fullPx[o + 1], fullPx[o + 2]]); }
    }
    const med = (k: number) => { const v = ring.map((c) => c[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 255; };
    const shirt = [med(0), med(1), med(2)];
    const spread = ring.length ? Math.sqrt(ring.reduce((a, c) => a + (c[0] - shirt[0]) ** 2 + (c[1] - shirt[1]) ** 2 + (c[2] - shirt[2]) ** 2, 0) / ring.length) : 0;
    // knockouts faked with a piece of the shirt photo laid inside the logo (the heather texture shows through): the
    // shirt's own color in the pulled art is a hole, not ink (Peticolas Sit Down's chair and lettering)
    const isShirt = !(shirt[0] > 245 && shirt[1] > 245 && shirt[2] > 245) && spread < 40;
    // see-through bits become holes: a "distressed" texture laid over the whole logo at 15-50% (Illustrator
    // opacity masks, Peticolas Sit Down) leaves faint white over the knockouts, which the ink mapping then filled solid
    // cream. A screen can't print 20% white: under ~60% coverage is clear, the rest solid (edges stay smooth)
    {
      const cx2 = hi.canvas.getContext("2d", { willReadFrequently: true })!;
      const img = cx2.getImageData(0, 0, hi.canvas.width, hi.canvas.height), px = img.data;
      // shirt-colored (even lightened by the texture, ~40 away) is clear; edges fade out over the next stretch
      const lim = Math.max(50, spread * 3);
      for (let i = 3; i < px.length; i += 4) {
        px[i] = px[i] < 140 ? 0 : px[i] < 175 ? Math.round(((px[i] - 140) / 35) * 255) : 255;
        if (isShirt && px[i]) {
          const dist = Math.hypot(px[i - 3] - shirt[0], px[i - 2] - shirt[1], px[i - 1] - shirt[2]);
          if (dist < 2 * lim) px[i] = Math.round(px[i] * Math.max(0, (dist - lim) / lim));
        }
      }
      cx2.putImageData(img, 0, 0);
    }
    const blob = await new Promise<Blob | null>((res) => hi.canvas.toBlob(res, "image/png"));
    if (!blob) continue;
    const hex = mainHex(hi.canvas), sug = suggestInk(hex);
    const shirtHex = isShirt ? "#" + shirt.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") : undefined;
    out.push({ side, file: new File([blob], `${name} ${side}.png`, { type: "image/png" }), widthIn: Math.round(widthIn * 4) / 4, heightIn: Math.round(heightIn * 4) / 4, dropIn: Math.round(dropIn * 4) / 4, offIn: Math.round(offIn * 4) / 4, ...(approx ? { approx } : {}), hex, ink: sug.rec === "pms" ? sug.pms.name : sug.standard.name, ...(mask ? { mask, maskPpi } : {}), ...(shirtHex ? { shirtHex } : {}) });
  }
  return out;
}

/**
 * A customer's mockup with the shirts drawn (flat color shapes with outlines, not photos: Mambo Miles' race shirt, Oct 22).
 * Each big shape on the page is a shirt (left = front, right = back when there are two); inside it, what isn't the shirt's
 * color and isn't its outline (the lines that touch the page around it) is art. Bits within an inch of each other are one
 * print. Sizes come from the shirt's body width taken as an adult large (22"), so they're close, not exact. The art is
 * drawn again sharp with the shirt's color taken out (see-through, so knockouts stay holes).
 */
export async function artFromDrawnMockup(buf: ArrayBuffer, name = "art"): Promise<(ArtPiece & { shirtHex: string })[]> {
  // every page (our sized proof: the front on page 1, the back and sleeves on page 2); one shirt a page = front, then back
  const doc = await openDoc(buf);
  const per: { n: number; got: (ArtPiece & { shirtHex: string; shirts: number })[] }[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
    const page = await doc.getPage(n);
    const tpl = await templateFor(page, n).catch(() => null);
    per.push({ n, got: await drawnPage(page, name, tpl, n).catch((e) => { console.warn("drawnPage", n, e); return []; }) });
  }
  const withShirt = per.filter((p) => p.got.length);
  const onePerPage = withShirt.length > 1 && withShirt.every((p) => p.got.every((g) => g.shirts === 1));
  return withShirt.flatMap((p, pi) => p.got.map(({ shirts: _s, ...g }) => (onePerPage ? { ...g, side: (pi === 0 ? "front" : "back") as "front" | "back" } : g)));
}

/**
 * One page of drawn shirts. A page laid out at real size (our sized proof, 35" × 42"; Mambo's 68" × 32": Oct 22, Nick:
 * "these are sized, meaning when you pull the logos from the front, they're the size they should be") is measured by the
 * page itself; a small page (a letter-size mockup) by the shirt, taken as an adult large. Everything that isn't the
 * art is left: the shirt and its collar, seam and hem lines, and whatever sits off the shirts (the neck tag box, the
 * scale ruler, the labels, the standard imprint colors chart, the sleeve shapes).
 */
/**
 * Our blank mockup templates (Oct 22, Nick: "here are our blank templates that we used over the years… you can lock
 * anything on these when you're importing from these files, and the stuff sitting on top you pull"): a file the same
 * page size as one (the FBS sized proof, adult and youth medium; the race shirt sheet) has that template's own drawing
 * (shirt lines, collar, seams, hem, sleeves, ruler, labels, colors chart) taken away, so only what was put on top is art.
 * Same-size templates: the one whose drawing shows in the file the most.
 */
const TEMPLATES = ["/mockup-templates/fbs-adult.pdf", "/mockup-templates/fbs-youth-medium.pdf", "/mockup-templates/race-shirt-blank.pdf"];
let tplDocs: Promise<Doc[]> | null = null;
const loadTemplates = () => (tplDocs ||= Promise.all(TEMPLATES.map(async (u) => { try { const r = await fetch(u); return r.ok ? await openDoc(await r.arrayBuffer()) : null; } catch { return null; } })).then((ds) => ds.filter(Boolean) as Doc[]));
/** the template's drawing on a page, as a mask: not the paper, not its shirt's color */
async function tplInk(page: Page, scale: number, crop?: Rect) {
  const vp = page.getViewport({ scale });
  const W = crop ? Math.round(crop.x1 - crop.x0) : Math.round(vp.width), H = crop ? Math.round(crop.y1 - crop.y0) : Math.round(vp.height);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(255,255,255,1)", ...(crop ? { transform: [1, 0, 0, 1, -crop.x0, -crop.y0] } : {}) }).promise;
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const n = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4 * 7) { if (d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232) continue; const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); n.set(k, (n.get(k) || 0) + 1); }
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  const fill = top < 0 ? [255, 255, 255] : [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
  const m = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    if (d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232) continue;
    if (Math.hypot(d[i] - fill[0], d[i + 1] - fill[1], d[i + 2] - fill[2]) < 30) continue;
    m[j] = 1;
  }
  return { m, W, H, d };
}
/** grow a mask by r pixels (square) */
function grow(m: Uint8Array, W: number, H: number, r: number) {
  const a = new Uint8Array(W * H), b = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= r) a[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) a[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (a[y * W + x]) last = y; if (y - last <= r) b[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (a[y * W + x]) last = y; if (last - y <= r) b[y * W + x] = 1; } }
  return b;
}
async function templateFor(page: Page, n: number): Promise<Page | null> {
  const v = page.getViewport({ scale: 1 });
  const docs = await loadTemplates();
  const same: Page[] = [];
  for (const d of docs) {
    if (d.numPages < n) continue;
    const tp = await d.getPage(n), tv = tp.getViewport({ scale: 1 });
    if (Math.abs(tv.width - v.width) < 2 && Math.abs(tv.height - v.height) < 2) same.push(tp);
  }
  if (same.length < 2) return same[0] || null;
  // the template whose drawing is in the file: at a small size, how much of its drawing the file has too
  const sc = 600 / Math.max(v.width, v.height);
  const f = await tplInk(page, sc);
  let best: Page | null = null, bs = -1;
  for (const tp of same) {
    const t = await tplInk(tp, sc);
    let hit = 0, all = 0;
    for (let i = 0; i < t.m.length; i++) if (t.m[i]) { all++; if (f.m[i]) hit++; }
    const sc2 = all ? hit / all : 0;
    if (sc2 > bs) { bs = sc2; best = tp; }
  }
  // the same page size as our sized proof is ours already (Oct 23, Nick: "visually… it's our mock-up"); of the same-size
  // templates, the closest (All Star #34528's back page scored 0.399: its big navy print covers the template's lines)
  return best;
}

async function drawnPage(page: Page, name: string, tpl: Page | null = null, pageNo = 1): Promise<(ArtPiece & { shirtHex: string; shirts: number })[]> {
  const v1 = page.getViewport({ scale: 1 });
  const sized = Math.max(v1.width, v1.height) / 72 >= 20;
  // sharp enough to tell a seam line from art (about 50 px an inch on a real-size page, at most ~5 million pixels)
  const s = Math.min(6, Math.sqrt(5e6 / (v1.width * v1.height)));
  const vp = page.getViewport({ scale: s });
  const W = Math.round(vp.width), H = Math.round(vp.height);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(255,255,255,1)" }).promise;
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  // the template's own drawing, grown a little (its lines' soft edges): never art
  const tm = tpl ? await tplInk(tpl, s).then((t) => (t.W === W && t.H === H ? grow(t.m, W, H, 2) : null)).catch(() => null) : null;
  // the page around the shirts: light pixels reached from the edges
  const outside = new Uint8Array(W * H), st: number[] = [];
  const light = (i: number) => d[i * 4] > 232 && d[i * 4 + 1] > 232 && d[i * 4 + 2] > 232;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (light(i) && !outside[i]) { outside[i] = 1; st.push(i); } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (light(i) && !outside[i]) { outside[i] = 1; st.push(i); } }
  while (st.length) {
    const i = st.pop()!, x = i % W, y = (i / W) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !outside[j] && light(j)) { outside[j] = 1; st.push(j); }
  }
  // the shapes on it; the big ones are shirts
  const lab = new Int32Array(W * H);
  const comps: { id: number; n: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (outside[i0] || lab[i0]) continue;
    const id = comps.length + 1, q = [i0]; lab[i0] = id;
    const cp = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0 };
    while (q.length) {
      const i = q.pop()!, x = i % W, y = (i / W) | 0; cp.n++;
      if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !outside[j] && !lab[j]) { lab[j] = id; q.push(j); }
    }
    comps.push(cp);
  }
  let shirts = comps.filter((cp) => cp.n > W * H * 0.04 && cp.x1 - cp.x0 > W * 0.15).sort((a, b) => a.x0 - b.x0);
  // a white shirt drawn in lines too light to stop the page around it (Oct 23, All Star #34528: our sized proof with its
  // shirt left white): no shirt is found in the file, so our template's shirt is where it is (the page around it and
  // the shirt itself taken from the template's drawing, its body only: not the sleeve boxes)
  let viaTpl = false;
  if (!shirts.length && tpl) {
    const tc = document.createElement("canvas"); tc.width = W; tc.height = H;
    await tpl.render({ canvasContext: tc.getContext("2d")!, viewport: tpl.getViewport({ scale: s }), background: "rgba(255,255,255,1)" }).promise;
    const td = tc.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const tLight = (i: number) => td[i * 4] > 232 && td[i * 4 + 1] > 232 && td[i * 4 + 2] > 232;
    const tOut = new Uint8Array(W * H), ts: number[] = [];
    for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (tLight(i) && !tOut[i]) { tOut[i] = 1; ts.push(i); } }
    for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (tLight(i) && !tOut[i]) { tOut[i] = 1; ts.push(i); } }
    while (ts.length) {
      const i = ts.pop()!, x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !tOut[j] && tLight(j)) { tOut[j] = 1; ts.push(j); }
    }
    const tLab = new Int32Array(W * H), tComps: typeof comps = [];
    for (let i0 = 0; i0 < W * H; i0++) {
      if (tOut[i0] || tLab[i0]) continue;
      const id = tComps.length + 1, q = [i0]; tLab[i0] = id;
      const cp = { id, n: 0, x0: W, y0: H, x1: 0, y1: 0 };
      while (q.length) {
        const i = q.pop()!, x = i % W, y = (i / W) | 0; cp.n++;
        if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !tOut[j] && !tLab[j]) { tLab[j] = id; q.push(j); }
      }
      tComps.push(cp);
    }
    const body = tComps.filter((cp) => cp.n > W * H * 0.04 && cp.x1 - cp.x0 > W * 0.15).sort((a, b) => b.n - a.n)[0];
    if (body) { outside.set(tOut); lab.set(tLab); shirts = [body]; viaTpl = true; }
  }
  const out: (ArtPiece & { shirtHex: string; shirts: number })[] = [];
  const { REF_BODY } = await import("@/lib/garmentBody");
  for (const [si, sh] of shirts.entries()) {
    // its color: the most common one inside it
    const n = new Map<number, number>();
    for (let y = sh.y0; y <= sh.y1; y += 2) for (let x = sh.x0; x <= sh.x1; x += 2) { const i = y * W + x; if (lab[i] !== sh.id) continue; const k = ((d[i * 4] >> 3) << 10) | ((d[i * 4 + 1] >> 3) << 5) | (d[i * 4 + 2] >> 3); n.set(k, (n.get(k) || 0) + 1); }
    const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const fill = [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
    const far = (i: number, lim: number) => Math.hypot(d[i * 4] - fill[0], d[i * 4 + 1] - fill[1], d[i * 4 + 2] - fill[2]) > lim;
    // the body's width a bit over halfway down (under the sleeves): an adult large's 22"
    const by = Math.round(sh.y0 + (sh.y1 - sh.y0) * 0.62);
    let bl = -1, br = -1;
    for (let x = sh.x0; x <= sh.x1; x++) if (lab[by * W + x] === sh.id) { if (bl < 0) bl = x; br = x; }
    if (bl < 0 || br - bl < 20) continue;
    // a shirt has sleeves: wider across the shoulders than at the body (Oct 23, McKenna's HUD 102026.ai: the round logo
    // on its own artboard was read as a shirt and its middle as a 12" print 9.25" down). Our template's shirt is a shirt.
    if (!viaTpl) {
      let topW = 0;
      for (let y = Math.round(sh.y0 + (sh.y1 - sh.y0) * 0.12); y <= Math.round(sh.y0 + (sh.y1 - sh.y0) * 0.35); y += 2) {
        let a = -1, b = -1;
        for (let x = sh.x0; x <= sh.x1; x++) if (lab[y * W + x] === sh.id) { if (a < 0) a = x; b = x; }
        if (a >= 0) topW = Math.max(topW, b - a);
      }
      if (topW < 1.15 * (br - bl)) continue;
    }
    const ppi = sized ? s * 72 : (br - bl) / REF_BODY.widthIn, mid = (bl + br) / 2;
    let neck = sh.y0;
    for (let y = sh.y0; y <= sh.y1; y++) if (lab[y * W + Math.round(mid)] === sh.id) { neck = y; break; }
    // art = not the shirt's color; its outline = those bits that touch the page around it (spread through each other)
    const art = new Uint8Array(W * H), line = new Uint8Array(W * H), q: number[] = [];
    for (let y = sh.y0; y <= sh.y1; y++) for (let x = sh.x0; x <= sh.x1; x++) {
      const i = y * W + x; if (lab[i] !== sh.id || !far(i, 60) || (tm && tm[i])) continue;
      art[i] = 1;
      if ((x > 0 && outside[i - 1]) || (x < W - 1 && outside[i + 1]) || (y > 0 && outside[i - W]) || (y < H - 1 && outside[i + W])) { line[i] = 1; q.push(i); }
    }
    while (q.length) {
      const i = q.pop()!, x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx; if (art[j] && !line[j]) { line[j] = 1; q.push(j); }
      }
    }
    // lines drawn on the shirt (a collar, a sleeve seam, a hem; no template to take them off): bits so thin nothing of
    // them is left when shrunk by about 0.03" are lines, not art (letters and logos are thicker)
    {
      const keepA = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) if (art[i] && !line[i]) keepA[i] = 1;
      // thin by the shirt's measure or by the page's: a stroke under ~2pt on the page is a drawn line (on a small mockup
      // the collar is drawn thicker than 0.03" of shirt: Art Car's neck came off as a 6.75" print, Oct 22)
      // the page's measure only for long pieces (a collar or seam runs inches): small lettering drawn thin stays art
      const rS = Math.max(1, Math.round(0.03 * ppi)), rP = Math.max(rS, Math.round(1.1 * s));
      // shrink = not grown from the outside
      const inv = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) inv[i] = keepA[i] ? 0 : 1;
      const coreS = grow(inv, W, H, rS), coreP = rP > rS ? grow(inv, W, H, rP) : coreS;
      const seen = new Uint8Array(W * H);
      for (let i0 = 0; i0 < W * H; i0++) {
        if (!keepA[i0] || seen[i0]) continue;
        const q = [i0], comp: number[] = []; seen[i0] = 1; let thickS = false, thickP = false;
        let x0 = W, x1 = 0, y0 = H, y1 = 0;
        while (q.length) {
          const i = q.pop()!, x = i % W, y = (i / W) | 0; comp.push(i); if (!coreS[i]) thickS = true; if (!coreP[i]) thickP = true;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const j = yy * W + xx; if (keepA[j] && !seen[j]) { seen[j] = 1; q.push(j); } }
        }
        const long = Math.max(x1 - x0, y1 - y0) >= 1.5 * ppi;
        if (!thickS || (long && !thickP)) for (const i of comp) line[i] = 1;
      }
    }
    const m = document.createElement("canvas"); m.width = W; m.height = H;
    const mx = m.getContext("2d")!, md = mx.createImageData(W, H);
    let cnt = 0;
    for (let i = 0; i < W * H; i++) if (art[i] && !line[i]) { md.data[i * 4 + 3] = 255; cnt++; }
    if (!cnt) continue;
    mx.putImageData(md, 0, 0);
    // bits, less stray lines (a seam drawn inside the shirt: long, thin, mostly empty box) and specks
    const count = (r: Rect) => { let k = 0; for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (md.data[(y * W + x) * 4 + 3]) k++; return k; };
    const bits = pieces(m, 0.12 * ppi).filter((r) => {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      if (w < 0.15 * ppi && h < 0.15 * ppi) return false;
      return !(Math.max(w, h) > 1.5 * ppi && count(r) / (w * h) < 0.035);
    });
    for (const r of mergeRects(bits, 1 * ppi)) {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      if (w < 0.5 * ppi && h < 0.5 * ppi) continue;
      const widthIn = w / ppi, heightIn = h / ppi;
      // drawn again sharp (about 300 dpi at its size, at most 5000 px), the shirt's color made see-through
      const want = Math.min(5000, Math.max(800, widthIn * 300)), k = want / w, s2 = s * k, pad = 6;
      const box = { x0: r.x0 * k - pad, y0: r.y0 * k - pad, x1: r.x1 * k + pad, y1: r.y1 * k + pad };
      let cc = (await drawWithoutPhotos(page, s2, box, undefined, "vector")).canvas;
      const tex = await drawWithoutPhotos(page, s2, box, undefined, "textures");
      let mask = await maskFile(tex.canvas, `${name} mask.png`).catch(() => null);
      // art that's a picture (a placed logo, not shapes): the shapes alone miss it, so it's drawn with its pictures
      {
        const inkPx = (cv: HTMLCanvasElement) => { const dd = cv.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let i = 0; i < dd.length; i += 16) if (dd[i + 3] > 128 && Math.hypot(dd[i] - fill[0], dd[i + 1] - fill[1], dd[i + 2] - fill[2]) > 60) k++; return k; };
        const all = (await drawWithoutPhotos(page, s2, box, undefined, "art")).canvas;
        if (inkPx(cc) < 0.5 * inkPx(all)) { cc = all; mask = null; }
      }
      const cx2 = cc.getContext("2d", { willReadFrequently: true })!, img = cx2.getImageData(0, 0, cc.width, cc.height), px = img.data, lim = 40;
      // the template's lines inside this box, where nothing covers them (the same color there as the template's)
      const tc = tpl ? await tplInk(tpl, s2, box).catch(() => null) : null;
      const tg = tc && tc.W === cc.width && tc.H === cc.height ? grow(tc.m, tc.W, tc.H, 2) : null;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        if (tg && tc && tg[i / 4] && Math.hypot(px[i] - tc.d[i], px[i + 1] - tc.d[i + 1], px[i + 2] - tc.d[i + 2]) < 70) { px[i + 3] = 0; continue; }
        const dist = Math.hypot(px[i] - fill[0], px[i + 1] - fill[1], px[i + 2] - fill[2]);
        if (dist < 2 * lim) px[i + 3] = Math.round(px[i + 3] * Math.max(0, (dist - lim) / lim));
      }
      cx2.putImageData(img, 0, 0);
      const blob = await new Promise<Blob | null>((res) => cc.toBlob(res, "image/png"));
      if (!blob) continue;
      // our sized proof read by its template: page 1 is the front, page 2 the back
      const side: "front" | "back" = viaTpl ? (pageNo >= 2 ? "back" : "front") : shirts.length > 1 && si === shirts.length - 1 ? "back" : "front";
      const hex = mainHex(cc), sug = suggestInk(hex), q4 = (v: number) => Math.round(v * 4) / 4;
      const shirtHex = "#" + fill.map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("");
      out.push({ shirts: shirts.length, side, file: new File([blob], `${name} ${side}.png`, { type: "image/png" }), widthIn: q4(widthIn), heightIn: q4(heightIn), dropIn: q4(Math.max(0, (r.y0 - neck) / ppi)), offIn: q4(((r.x0 + r.x1) / 2 - mid) / ppi), hex, ink: sug.rec === "pms" ? sug.pms.name : sug.standard.name, shirtHex, ...(mask ? { mask, maskPpi: tex.texPx ? Math.round(tex.texPx * (cc.width / Math.max(0.1, widthIn))) : 0 } : {}) });
    }
  }
  return out;
}

/**
 * What our sized proof says in its own words, per print (Oct 22, Nick: "you still have to read the mockups… for colors
 * and size and imprints"): "Front Imprint · SIZE: W 11" H 11" · COLORS 1. BLACK…". The blank template's untouched
 * defaults (all BLACK, NA, a 0" size) are left out.
 */
export async function proofNotes(buf: ArrayBuffer): Promise<{ where: string; w?: number; h?: number; colors: string[] }[]> {
  try {
    const doc = await openDoc(buf), out: { where: string; w?: number; h?: number; colors: string[] }[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
      const pg = await doc.getPage(n) as unknown as { getTextContent: () => Promise<{ items: { str?: string }[] }> };
      const t = (await pg.getTextContent()).items.map((x) => x.str || "").join(" ").replace(/\s+/g, " ");
      const re = /(Front|Back|Left Sleeve|Right Sleeve|Sleeve)\s*Imprint\s*SIZE:?\s*W\s*([\d.]+)\D{0,4}H\s*([\d.]+)\D{0,3}\s*COLORS?:?\s*((?:\d+\.\s*[A-Za-z0-9#&/ -]+?\s*)+?)(?=(?:Front|Back|Left|Right|Sleeve|STANDARD|The above|$))/gi;
      for (const m of t.matchAll(re)) {
        const colors = [...m[4].matchAll(/\d+\.\s*([A-Za-z0-9#&/ -]+?)(?=\s*\d+\.|$)/g)].map((x) => x[1].trim()).filter((c) => c && !/^NA$/i.test(c));
        const allBlack = colors.length >= 5 && colors.every((c) => /^black$/i.test(c));
        const w = +m[2], h = +m[3];
        const e = { where: m[1].replace(/\b\w/g, (c) => c.toUpperCase()), ...(w > 0 ? { w, h } : {}), colors: allBlack ? [] : [...new Set(colors)] };
        if (e.w || e.colors.length) out.push(e);
      }
    }
    return out;
  } catch { return []; }
}

/** PMS colors written on the page (a mockup's swatches: "PMS 283C", "PMS 1625 C (30%)"), as "PMS 283 C" */
export async function pmsOnPage(buf: ArrayBuffer): Promise<string[]> {
  try {
    const page = await openPage(buf) as unknown as { getTextContent: () => Promise<{ items: { str?: string }[] }> };
    const t = (await page.getTextContent()).items.map((x) => x.str || "").join(" ");
    const out: string[] = [];
    for (const m of t.matchAll(/(?:PMS|Pantone)\s*#?\s*(\d{3,4})\s*-?\s*([CU])?\b/gi)) { const n = `PMS ${m[1]} ${(m[2] || "C").toUpperCase()}`; if (!out.includes(n)) out.push(n); }
    return out;
  } catch { return []; }
}

/**
 * A film file (FBS Film Folder/<customer>/<job>.ai): the size of each print on it, from every artboard. Registration
 * marks and labels (under an inch tall or wide) are left out. Films are at print size, so these are the real sizes.
 */
export type FilmPiece = { page: number; widthIn: number; heightIn: number; /** the art itself (black), when asked for */ file?: File };
export async function measureFilm(buf: ArrayBuffer, withArt = false, name = "film"): Promise<FilmPiece[]> {
  const doc = await openDoc(buf);
  const out: FilmPiece[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 3000 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp, background: "rgba(0,0,0,0)" }).promise;
    for (const r of pieces(c, 0.15 * 72 * scale)) {
      const w = (r.x1 - r.x0) / scale / 72, h = (r.y1 - r.y0) / scale / 72;
      if (w < 1 || h < 1) continue;
      const piece: FilmPiece = { page: n, widthIn: Math.round(w * 100) / 100, heightIn: Math.round(h * 100) / 100 };
      if (withArt) {
        // the art at about 300 dpi of its real size (films are 1:1), at most 4000 px
        const s2 = Math.min(300 / 72, 4000 / Math.max(w * 72, h * 72));
        const k = s2 / scale, pad = 6;
        const vp2 = page.getViewport({ scale: s2 });
        const cc = document.createElement("canvas");
        cc.width = Math.round((r.x1 - r.x0) * k + pad * 2); cc.height = Math.round((r.y1 - r.y0) * k + pad * 2);
        await page.render({ canvasContext: cc.getContext("2d")!, viewport: vp2, background: "rgba(0,0,0,0)", transform: [1, 0, 0, 1, -(r.x0 * k - pad), -(r.y0 * k - pad)] }).promise;
        const blob = await new Promise<Blob | null>((res) => cc.toBlob(res, "image/png"));
        if (blob) piece.file = new File([blob], `${name} film ${out.length + 1}.png`, { type: "image/png" });
      }
      out.push(piece);
    }
  }
  return out;
}

/** the film piece that is this print: same shape (within ~12%) and a believable size next to the mockup's reading */
export function filmFor(widthIn: number, heightIn: number, film: FilmPiece[], sizeKnown = true) {
  const a = heightIn / widthIn;
  // the same shape (an original art file can be cropped a little differently than the film: more slack)
  const shaped = film.filter((f) => Math.abs(Math.log(f.heightIn / f.widthIn / a)) < (sizeKnown ? 0.12 : 0.25));
  // the original art file (its shape, no size): the biggest film piece with that shape
  if (!sizeKnown) return shaped.sort((x, y) => y.widthIn * y.heightIn - x.widthIn * x.heightIn)[0] || null;
  return shaped
    .filter((f) => f.widthIn > widthIn * 0.6 && f.widthIn < widthIn * 1.6)
    .sort((x, y) => Math.abs(x.widthIn - widthIn) - Math.abs(y.widthIn - widthIn))[0] || null;
}

/**
 * The original art among an old Printavo job's pictures: a see-through PNG (the logo on nothing) rather than a photo
 * of the garment. Returns its shape (height / width of the art itself) or null when it's a mockup photo.
 */
export async function artShape(blob: Blob): Promise<{ ratio: number } | null> {
  const bm = await createImageBitmap(blob).catch(() => null);
  if (!bm) return null;
  const k = Math.min(1, 600 / Math.max(bm.width, bm.height));
  const w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(bm, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let clear = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (d[(yy * w + xx) * 4 + 3] < 20) { clear++; continue; }
    if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
  }
  // a photo is solid; art has the background cut away
  if (clear < w * h * 0.1 || x1 < x0) return null;
  return { ratio: (y1 - y0 + 1) / (x1 - x0 + 1) };
}

/**
 * An old job's PDF that is the art itself, not a mockup sheet (the customer's Illustrator file: "LA Shakers Final.pdf",
 * the logo on an empty page, no shirt photos). The first page, drawn on a clear background at about 3000 px and cropped
 * to the art. Null when the PDF has shirt photos (a mockup) or nothing on a clear background.
 */
export async function artFromArtPdf(buf: ArrayBuffer, name = "art"): Promise<{ file: File; ratio: number; mask?: File } | null> {
  const doc = await openDoc(buf);
  // a sheet of labels (Little Groupies' "onesies_labels.pdf": 300 small pages of barcodes) is never the print art
  if (doc.numPages > 20) return null;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  if (Math.max(vp1.width, vp1.height) < 300 && doc.numPages > 2) return null;
  const scale = Math.min(3000 / Math.max(vp1.width, vp1.height), 8);
  // vector art with a texture laid over it (Peticolas' logos with their scratched mask, Oct 22): the art clean, and the
  // texture apart as its distress
  {
    const tex = await drawWithoutPhotos(page, scale, undefined, undefined, "textures");
    const tm = await maskFile(tex.canvas, `${name} mask.png`).catch(() => null);
    if (tm) {
      const vec = (await drawWithoutPhotos(page, scale, undefined, undefined, "vector")).canvas;
      const w = vec.width, h = vec.height, d = vec.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
      let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 20) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (n > (w * h) / 4 * 0.02) {
        x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(w - 1, x1 + 4); y1 = Math.min(h - 1, y1 + 4);
        const crop = (src: CanvasImageSource) => { const cc = document.createElement("canvas"); cc.width = x1 - x0 + 1; cc.height = y1 - y0 + 1; cc.getContext("2d")!.drawImage(src, x0, y0, cc.width, cc.height, 0, 0, cc.width, cc.height); return cc; };
        const art = crop(vec), mbm = await createImageBitmap(tm), mk = crop(mbm);
        const [ab, mb] = await Promise.all([new Promise<Blob | null>((res) => art.toBlob(res, "image/png")), new Promise<Blob | null>((res) => mk.toBlob(res, "image/png"))]);
        if (ab) return { file: new File([ab], `${name}.png`, { type: "image/png" }), ratio: art.height / art.width, ...(mb ? { mask: new File([mb], `${name} mask.png`, { type: "image/png" }) } : {}) };
      }
    }
  }
  const { canvas: c0, photos } = await drawWithoutPhotos(page, scale);
  let c = c0;
  if (photos.length) {
    // the art saved as one picture filling the page on a flat background (Oct 20, Little Groupies "The Bottles": the
    // design on gray): the background is taken off from the edges in, so the art comes out on clear
    const vp = page.getViewport({ scale });
    const big = photos.some((r) => r.x1 - r.x0 > vp.width * 0.85 && r.y1 - r.y0 > vp.height * 0.85);
    if (photos.length > 1 || !big) return null;
    const full = document.createElement("canvas");
    full.width = Math.round(vp.width); full.height = Math.round(vp.height);
    await page.render({ canvasContext: full.getContext("2d")!, viewport: vp, background: "rgba(255,255,255,1)" }).promise;
    if (!knockOutBackground(full)) return null;
    c = full;
  }
  const w = c.width, h = c.height;
  const bounds = () => {
    const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    let clear = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      if (d[(y * w + x) * 4 + 3] < 20) { clear++; continue; }
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { clear, x0, y0, x1, y1 };
  };
  let b = bounds();
  // nothing see-through: a big picture filling the page (a full-size one isn't skipped as a shirt photo) on a flat
  // background (Oct 20, The Bottles on gray, 2nd try): the background is taken off from the edges in
  if (b.x1 >= b.x0 && b.clear < (w * h) / 4 * 0.1 && knockOutBackground(c)) b = bounds();
  let { x0, y0, x1, y1 } = b;
  if (x1 < x0 || b.clear < (w * h) / 4 * 0.1) return null;
  x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(w - 1, x1 + 4); y1 = Math.min(h - 1, y1 + 4);
  const cc = document.createElement("canvas");
  cc.width = x1 - x0 + 1; cc.height = y1 - y0 + 1;
  cc.getContext("2d")!.drawImage(c, x0, y0, cc.width, cc.height, 0, 0, cc.width, cc.height);
  const blob = await new Promise<Blob | null>((res) => cc.toBlob(res, "image/png"));
  return blob ? { file: new File([blob], `${name}.png`, { type: "image/png" }), ratio: cc.height / cc.width } : null;
}

/**
 * Clears a flat background from the edges in (flood fill, so the same color inside the art stays): the four corners
 * must agree on one color. Returns false when there's no flat background to take off.
 */
export function knockOutBackground(c: HTMLCanvasElement, tol = 28, /** also the same color inside the art: between letters and legs, not just from the edges in (Oct 20, Nick: "it didn't remove the non-contiguous ones") */ everywhere = false): boolean {
  const w = c.width, h = c.height, x = c.getContext("2d")!, img = x.getImageData(0, 0, w, h), d = img.data;
  const at = (px: number, py: number) => (py * w + px) * 4;
  const cs = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)];
  const [r0, g0, b0] = [d[cs[0]], d[cs[0] + 1], d[cs[0] + 2]];
  const near = (i: number) => Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) <= tol;
  if (!cs.every(near)) return false;
  const seen = new Uint8Array(w * h), stack: number[] = [];
  const push = (px: number, py: number) => { const k = py * w + px; if (seen[k]) return; seen[k] = 1; if (near(k * 4)) stack.push(k); };
  for (let i = 0; i < w; i++) { push(i, 0); push(i, h - 1); }
  for (let j = 0; j < h; j++) { push(0, j); push(w - 1, j); }
  let n = 0;
  while (stack.length) {
    const k = stack.pop()!; d[k * 4 + 3] = 0; n++;
    const px = k % w, py = (k - px) / w;
    if (px > 0) push(px - 1, py); if (px < w - 1) push(px + 1, py); if (py > 0) push(px, py - 1); if (py < h - 1) push(px, py + 1);
  }
  if (n < w * h * 0.1) return false;
  if (everywhere) {
    // every other pixel of the background's color, wherever it is
    for (let k = 0; k < w * h; k++) if (d[k * 4 + 3] && near(k * 4)) d[k * 4 + 3] = 0;
    // the soft edge where the art meets the background: half-way colors fade instead of leaving a gray rim
    const dist = (i: number) => Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0);
    const a0 = new Uint8Array(w * h); for (let k = 0; k < w * h; k++) a0[k] = d[k * 4 + 3];
    for (let py = 1; py < h - 1; py++) for (let px = 1; px < w - 1; px++) {
      const k = py * w + px; if (!a0[k]) continue;
      if (a0[k - 1] && a0[k + 1] && a0[k - w] && a0[k + w]) continue;
      const dd = dist(k * 4);
      if (dd < tol * 3) d[k * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, (dd - tol) / (tol * 2))));
    }
  }
  x.putImageData(img, 0, 0);
  return true;
}

/** a picture with one color taken out (the shirt's color inside the art: the shirt shows through there), soft at the edge */
export async function knockColor(f: File, hex: string, lim = 34): Promise<File> {
  const bm = await createImageBitmap(f);
  const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height;
  const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(bm, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height), px = img.data;
  const t = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const dist = Math.hypot(px[i] - t[0], px[i + 1] - t[1], px[i + 2] - t[2]);
    if (dist < 2 * lim) px[i + 3] = Math.round(px[i + 3] * Math.max(0, (dist - lim) / lim));
  }
  x.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  return blob ? new File([blob], f.name, { type: "image/png" }) : f;
}
