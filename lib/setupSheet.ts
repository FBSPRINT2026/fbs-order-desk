"use client";
/**
 * A customer's mockup sheet (Oct 22, Nick on Hutchins' "T10A … Setup.pdf": "this is a two-page mockup… just like ours…
 * you've got to have a trigger that knows, hey, I'm looking at a mockup… a human would just read this and go, oh,
 * there's a little gray box. I just take the art off the top"). Page 1 shows the art big on a flat background panel
 * ("BACKGROUND LIGHT ORANGE DOES NOT PRINT") with a spec box (location, size, Pantone inks); page 2 shows it on the
 * shirt. Here the art is cut off the top (the panel, its background taken out) and the shirt page is drawn, both as
 * PNGs; the AI reads the specs.
 */
import { PDFJS, PDFJS_WORKER } from "@/lib/artPrep";
import { PHOTO_H, PHOTO_W, measureGarment } from "@/lib/mockup";

type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> }; getTextContent: () => Promise<{ items: { str?: string }[] }> };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const pdfjs = (await import(/* webpackIgnore: true */ PDFJS)) as { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> } };
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs.getDocument({ data }).promise;
}
async function draw(page: PdfPage, maxPx: number, clear = false): Promise<HTMLCanvasElement> {
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(12, maxPx / Math.max(v1.width, v1.height)) });
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const x = c.getContext("2d", { willReadFrequently: true })!;
  if (!clear) { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
  await page.render({ canvasContext: x, viewport: vp, ...(clear ? { background: "rgba(0,0,0,0)" } : {}) }).promise;
  return c;
}
const toFile = (c: HTMLCanvasElement, name: string) => new Promise<File | null>((res) => c.toBlob((b) => res(b ? new File([b], name, { type: "image/png" }) : null), "image/png"));
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/** words on a page that say it's a mockup sheet, not plain art */
const SHEET_WORDS = /does not print|screen ?print|pantone|\bpms\b|\d+(\.\d+)?\s*["”]?\s*w\s*x\s*\d+(\.\d+)?|colors?:/i;

/**
 * Is this PDF a customer mockup sheet? Two or more pages and the spec words on a page (or the AI said so). Returns the
 * page with the art (the one with the spec words) and the shirt page.
 */
export async function looksLikeSheet(data: ArrayBuffer): Promise<{ artPage: number; mockupPage: number } | null> {
  try {
    const doc = await openPdf(data.slice(0));
    if (doc.numPages < 2) return null;
    for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
      const t = (await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str || "").join(" ");
      if (SHEET_WORDS.test(t)) return { artPage: n, mockupPage: n === 1 ? 2 : 1 };
    }
  } catch { /* not readable */ }
  return null;
}

/**
 * The flat background panel the art sits on: the most common color that isn't the white page, covering a big
 * rectangle. Returns its color and box (in the canvas' pixels), or null when the art is straight on the white page.
 */
function findPanel(c: HTMLCanvasElement): { rgb: [number, number, number]; box: { x0: number; y0: number; x1: number; y1: number } } | null {
  const { width: w, height: h } = c, d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  const count = new Map<number, number>();
  for (let i = 0; i < d.length; i += 16) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 242 && g > 242 && b > 242) continue;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    count.set(k, (count.get(k) || 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const q = top[0], rgb: [number, number, number] = [((q >> 10) & 31) * 8 + 4, ((q >> 5) & 31) * 8 + 4, (q & 31) * 8 + 4];
  const near = (i: number) => Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < 30;
  // its box: rows and columns where it fills a good share (text in the same color elsewhere doesn't count)
  const rows: number[] = [], cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (near((y * w + x) * 4)) { n++; cols[x]++; }
    rows.push(n);
  }
  const rMin = w * 0.2, cMin = h * 0.2;
  let y0 = rows.findIndex((n) => n > rMin), y1 = h - 1 - [...rows].reverse().findIndex((n) => n > rMin);
  let x0 = cols.findIndex((n) => n > cMin), x1 = w - 1 - [...cols].reverse().findIndex((n) => n > cMin);
  if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null;
  // a real panel: a big part of the page
  if ((x1 - x0) * (y1 - y0) < w * h * 0.15) return null;
  y0 += 1; x0 += 1; y1 -= 1; x1 -= 1;
  return { rgb, box: { x0, y0, x1, y1 } };
}

/** cut to the inked art: rows and columns with any pixel that isn't clear */
function trim(c: HTMLCanvasElement, pad = 4): HTMLCanvasElement {
  const { width: w, height: h } = c, d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return c;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

export type SheetParts = { art: File; mockup: File | null; background: string | null; artPage: number; mockupPage: number };

/**
 * Cut the art off the art page (its background panel taken out: it never prints) and draw the shirt page. widthIn:
 * the print's width from the spec box, so the art comes out at about 300 dpi.
 */
export async function splitSheet(data: ArrayBuffer, o: { artPage?: number; mockupPage?: number; widthIn?: number; name?: string } = {}): Promise<SheetParts | null> {
  try {
    const doc = await openPdf(data.slice(0));
    const artPage = Math.min(Math.max(1, o.artPage || 1), doc.numPages);
    const mockupPage = Math.min(Math.max(1, o.mockupPage || (artPage === 1 ? 2 : 1)), doc.numPages);
    const page = await doc.getPage(artPage);
    // find the panel on a small drawing, then cut it from a sharp one
    const small = await draw(page, 900);
    const panel = findPanel(small);
    const v1 = page.getViewport({ scale: 1 });
    const panelW = panel ? (panel.box.x1 - panel.box.x0) / small.width : 1;
    // about 300 dpi at the print width (the panel is a bit wider than the art), at most 7000 px across the page
    const want = Math.min(7000, Math.max(2400, ((o.widthIn || 11) * 300 * 1.15) / Math.max(0.2, panelW)));
    const big = await draw(page, want * Math.max(1, v1.height / v1.width));
    const base = (o.name || "art").replace(/\.[^.]+$/, "");
    let out: HTMLCanvasElement;
    let background: string | null = null;
    if (panel) {
      const k = big.width / small.width, b = panel.box;
      const X0 = Math.round(b.x0 * k), Y0 = Math.round(b.y0 * k), W = Math.round((b.x1 - b.x0) * k), H = Math.round((b.y1 - b.y0) * k);
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.drawImage(big, X0, Y0, W, H, 0, 0, W, H);
      const img = x.getImageData(0, 0, W, H), d = img.data, [br, bg, bb] = panel.rgb;
      // the background color goes clear; its soft edge against the art fades out (it doesn't print)
      for (let i = 0; i < d.length; i += 4) {
        const dist = Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
        if (dist < 34) d[i + 3] = 0;
        else if (dist < 60) d[i + 3] = Math.round(d[i + 3] * ((dist - 34) / 26));
      }
      x.putImageData(img, 0, 0);
      out = trim(c);
      background = hex(br, bg, bb);
    } else {
      // straight on the white page: the page drawn clear, cut to the art (the spec box goes with it: check it)
      out = trim(await draw(page, want, true));
    }
    const art = await toFile(out, `${base} art.png`);
    if (!art) return null;
    let mockup: File | null = null;
    if (mockupPage !== artPage) mockup = await toFile(await draw(await doc.getPage(mockupPage), 2000), `${base} mockup.png`);
    return { art, mockup, background, artPage, mockupPage };
  } catch { return null; }
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });

/**
 * Where their mockup puts the print (Oct 22, Nick on Hutchins T11A: "theirs is lower on the shirt than ours… match the
 * customer's mockup placement, not just, oh, it's full front"). The spec box gives the print's real width, so the
 * mockup page has its own ruler: the art's width on the picture is that many inches. The drop is measured from the
 * bottom of the front neckline (the same seam every drop is measured from) to the top of the art.
 */
export async function measureDrop(mockup: File, widthIn: number): Promise<{ dropIn: number } | null> {
  if (!(widthIn > 0)) return null;
  const url = URL.createObjectURL(mockup);
  try {
    const img = await loadImage(url);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const c0 = document.createElement("canvas"); c0.width = iw; c0.height = ih;
    const x0c = c0.getContext("2d", { willReadFrequently: true })!;
    x0c.fillStyle = "#fff"; x0c.fillRect(0, 0, iw, ih); x0c.drawImage(img, 0, 0);
    const d0 = x0c.getImageData(0, 0, iw, ih).data;
    const ink = (i: number) => Math.min(d0[i], d0[i + 1], d0[i + 2]) < 235;
    // the shirt: rows and columns full of it (the title lines at the top corner don't count)
    const rows: number[] = [], cols = new Array(iw).fill(0);
    for (let y = 0; y < ih; y++) { let n = 0; for (let x = 0; x < iw; x++) if (ink((y * iw + x) * 4)) { n++; cols[x]++; } rows.push(n); }
    const y0 = rows.findIndex((n) => n > iw * 0.25), y1 = ih - 1 - [...rows].reverse().findIndex((n) => n > iw * 0.25);
    const xa = cols.findIndex((n) => n > ih * 0.15), xb = iw - 1 - [...cols].reverse().findIndex((n) => n > ih * 0.15);
    if (y0 < 0 || xa < 0 || y1 <= y0 || xb <= xa) return null;
    // back up to the collar (the shoulders are what fills a quarter of a row first)
    let top = y0; while (top > 0 && rows[top - 1] > iw * 0.03) top--;
    const pad = Math.round((xb - xa) * 0.04);
    const cx0 = Math.max(0, xa - pad), cy0 = Math.max(0, top - pad), cw = Math.min(iw, xb + pad) - cx0, ch = Math.min(ih, y1 + pad) - cy0;
    const crop = document.createElement("canvas"); crop.width = cw; crop.height = ch;
    const cx = crop.getContext("2d")!; cx.fillStyle = "#fff"; cx.fillRect(0, 0, cw, ch); cx.drawImage(c0, cx0, cy0, cw, ch, 0, 0, cw, ch);
    const shirt = await loadImage(crop.toDataURL("image/png"));
    const fit = measureGarment(shirt, "front", { tee: true });
    if (!fit?.neck) return null;
    // the same frame measureGarment works in
    const W = PHOTO_W, H = PHOTO_H, k = Math.min(W / cw, H / ch), dw = cw * k, dh = ch * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
    const f = document.createElement("canvas"); f.width = W; f.height = H;
    const fx = f.getContext("2d", { willReadFrequently: true })!; fx.fillStyle = "#fff"; fx.fillRect(0, 0, W, H); fx.drawImage(crop, ox, oy, dw, dh);
    const d = fx.getImageData(0, 0, W, H).data;
    const L = fit.body ? fit.body.l + 6 : ox + dw * 0.22, R = fit.body ? fit.body.r - 6 : ox + dw * 0.78, hem = fit.body ? fit.body.hem : oy + dh;
    // the shirt's color: the most common color across the chest
    const tally = new Map<number, number>();
    for (let y = Math.round(fit.neck + 20); y < hem; y += 3) for (let x = Math.round(L); x < R; x += 3) { const i = (y * W + x) * 4; const q = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); tally.set(q, (tally.get(q) || 0) + 1); }
    const q = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (q == null) return null;
    const sc = [((q >> 8) & 15) * 16 + 8, ((q >> 4) & 15) * 16 + 8, (q & 15) * 16 + 8];
    const art = (i: number) => Math.abs(d[i] - sc[0]) + Math.abs(d[i + 1] - sc[1]) + Math.abs(d[i + 2] - sc[2]) > 110;
    // the art: the first band of rows below the neckline with ink that isn't the shirt
    let artTop = -1, artBot = -1, ax0 = W, ax1 = -1, gap = 0;
    for (let y = Math.round(fit.neck + 6); y < hem; y++) {
      let n = 0, a = W, b = -1;
      for (let x = Math.round(L); x < R; x++) if (art((y * W + x) * 4)) { n++; if (x < a) a = x; if (x > b) b = x; }
      if (n >= 3) { if (artTop < 0) artTop = y; artBot = y; gap = 0; if (a < ax0) ax0 = a; if (b > ax1) ax1 = b; }
      else if (artTop >= 0 && ++gap > 40) break;
    }
    if (artTop < 0 || ax1 - ax0 < 20) return null;
    const ppi = (ax1 - ax0) / widthIn, drop = (artTop - fit.neck) / ppi;
    if (!(drop >= 0 && drop <= 10)) return null;
    void artBot;
    return { dropIn: Math.round(drop * 4) / 4 };
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
