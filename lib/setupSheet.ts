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

type PdfPage = { getViewport: (o: { scale: number; offsetX?: number; offsetY?: number }) => { width: number; height: number }; render: (o: Record<string, unknown>) => { promise: Promise<void> }; getTextContent: () => Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }> };
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

/**
 * A distributor's product sheet (Oct 26, Nick on Cedar Promo's Embark sheets: "it has a size breakdown… a visual
 * mock-up… it gives you the logo. It even says the dimensions… he is expecting us to pull sizing, make a mock-up, and
 * then use that to create the art also… that is your production file"). One page, several products: a product photo
 * (their mockup) with the logo drawn beside it over a width line ("3” W") and the specs. The reader says roughly where each
 * product's photo and logo are (fractions of the page); here they're cut exactly: the logo on a clear background at
 * about 300 dpi of its print width (the width line, the spec text and the white page left out), the photo as a picture.
 */
export type Box = [number, number, number, number];
export async function cutProduct(data: ArrayBuffer, o: { page?: number; logo?: Box | null; photo?: Box | null; widthIn?: number; name?: string }): Promise<{ art: File | null; mockup: File | null }> {
  const base = (o.name || "product").replace(/\.[^.]+$/, "");
  try {
    const doc = await openPdf(data.slice(0));
    const page = await doc.getPage(Math.min(Math.max(1, o.page || 1), doc.numPages));
    const v1 = page.getViewport({ scale: 1 });
    const ok = (b?: Box | null): b is Box => !!b && b.length === 4 && b.every((n) => Number.isFinite(n)) && b[2] > b[0] && b[3] > b[1];
    let art: File | null = null, mockup: File | null = null;
    if (ok(o.logo)) {
      const [lx0, ly0, lx1, ly1] = o.logo.map((n) => Math.min(1, Math.max(0, n)));
      const bw = lx1 - lx0, bh = ly1 - ly0;
      const rx0 = Math.max(0, lx0 - bw * 0.2), ry0 = Math.max(0, ly0 - bh * 0.35), rx1 = Math.min(1, lx1 + bw * 0.2), ry1 = Math.min(1, ly1 + bh * 0.35);
      // about 300 dpi across the print width, at most ~6000 px across the cut
      const scale = Math.min(40, Math.max(2, Math.min(((o.widthIn || 3) * 360) / (bw * v1.width), 6000 / ((rx1 - rx0) * v1.width))));
      const W = Math.round((rx1 - rx0) * v1.width * scale), H = Math.round((ry1 - ry0) * v1.height * scale);
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      const vp = page.getViewport({ scale, offsetX: -rx0 * v1.width * scale, offsetY: -ry0 * v1.height * scale });
      await page.render({ canvasContext: x, viewport: vp, background: "rgba(0,0,0,0)" }).promise;
      // the spec text around the logo (its width, "SCREEN PRINT ON LEFT ARM", the sizes) comes out
      const tc = await page.getTextContent().catch(() => ({ items: [] as { str?: string; transform?: number[]; width?: number; height?: number }[] }));
      for (const it of tc.items) {
        const t = it.transform; if (!t || !(it.str || "").trim()) continue;
        const fh = it.height || Math.abs(t[3]) || 8, fw = it.width || 0;
        const px0 = t[4] / v1.width, px1 = (t[4] + fw) / v1.width, pyTop = 1 - (t[5] + fh) / v1.height, pyBot = 1 - (t[5] - fh * 0.25) / v1.height;
        const cx = (px0 + px1) / 2, cy = (pyTop + pyBot) / 2;
        if (cx > lx0 + bw * 0.1 && cx < lx1 - bw * 0.1 && cy > ly0 + bh * 0.1 && cy < ly1 - bh * 0.1) continue; // text in the logo itself stays
        x.clearRect((px0 - rx0) * v1.width * scale - 3, (pyTop - ry0) * v1.height * scale - 3, (px1 - px0) * v1.width * scale + 6, (pyBot - pyTop) * v1.height * scale + 6);
      }
      const img = x.getImageData(0, 0, W, H), d = img.data;
      // the white page doesn't print
      for (let i = 0; i < d.length; i += 4) if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) d[i + 3] = 0;
      // pieces: connected inked pixels
      const lab = new Int32Array(W * H).fill(-1), comps: { n: number; x0: number; y0: number; x1: number; y1: number; red: number }[] = [], st: number[] = [];
      for (let p = 0; p < W * H; p++) {
        if (d[p * 4 + 3] < 40 || lab[p] >= 0) continue;
        const id = comps.length, cm = { n: 0, x0: W, y0: H, x1: 0, y1: 0, red: 0 };
        lab[p] = id; st.push(p);
        while (st.length) {
          const q = st.pop()!, qx = q % W, qy = (q / W) | 0; cm.n++;
          if (qx < cm.x0) cm.x0 = qx; if (qx > cm.x1) cm.x1 = qx; if (qy < cm.y0) cm.y0 = qy; if (qy > cm.y1) cm.y1 = qy;
          if (d[q * 4] > 170 && d[q * 4 + 1] < 90 && d[q * 4 + 2] < 90) cm.red++;
          for (const r of [qx > 0 ? q - 1 : -1, qx < W - 1 ? q + 1 : -1, qy > 0 ? q - W : -1, qy < H - 1 ? q + W : -1]) if (r >= 0 && lab[r] < 0 && d[r * 4 + 3] >= 40) { lab[r] = id; st.push(r); }
        }
        comps.push(cm);
      }
      // the width line and its end dots (thin, or small and red) never print
      const drop = comps.map((cm) => {
        const cw = cm.x1 - cm.x0 + 1, ch = cm.y1 - cm.y0 + 1;
        const line = ch <= Math.max(3, W * 0.012) && cw > W * 0.2;
        const redBit = cm.red > cm.n * 0.6 && (ch < H * 0.08 || cm.n < W * H * 0.004);
        return line || redBit || cm.n < 6;
      });
      // the logo: the biggest piece and the pieces close to it inside the logo's box
      const keep = new Set<number>();
      const inBox = (cm: (typeof comps)[number]) => { const cx = ((cm.x0 + cm.x1) / 2) / W * (rx1 - rx0) + rx0, cy = ((cm.y0 + cm.y1) / 2) / H * (ry1 - ry0) + ry0; return cx > lx0 - bw * 0.05 && cx < lx1 + bw * 0.05 && cy > ly0 - bh * 0.1 && cy < ly1 + bh * 0.1; };
      // the photo next to it reaches into the cut: a piece touching the cut's edge isn't the logo
      const edge = (cm: (typeof comps)[number]) => cm.x0 <= 1 || cm.y0 <= 1 || cm.x1 >= W - 2 || cm.y1 >= H - 2;
      const order = comps.map((_, i) => i).filter((i) => !drop[i] && !edge(comps[i])).sort((a, b) => comps[b].n - comps[a].n);
      const seed = order.find((i) => inBox(comps[i]));
      if (seed != null) {
        keep.add(seed);
        let u = { ...comps[seed] };
        for (let more = true; more;) {
          more = false;
          // letters of a word sit close: near the logo, measured against the logo's whole box
          const gap = Math.max(0.08 * Math.max(u.x1 - u.x0, u.y1 - u.y0, 20), 0.07 * (bw / (rx1 - rx0)) * W);
          for (const i of order) {
            if (keep.has(i)) continue;
            const cm = comps[i];
            if (cm.x0 > u.x1 + gap || cm.x1 < u.x0 - gap || cm.y0 > u.y1 + gap || cm.y1 < u.y0 - gap || !inBox(cm)) continue;
            keep.add(i); u = { ...u, x0: Math.min(u.x0, cm.x0), y0: Math.min(u.y0, cm.y0), x1: Math.max(u.x1, cm.x1), y1: Math.max(u.y1, cm.y1) }; more = true;
          }
        }
        // everything else goes, the soft edges of what went too (pixels too faint to be a piece)
        for (let p = 0; p < W * H; p++) {
          const px = p % W, py = (p / W) | 0;
          if ((lab[p] >= 0 && !keep.has(lab[p])) || px < u.x0 - 2 || px > u.x1 + 2 || py < u.y0 - 2 || py > u.y1 + 2) d[p * 4 + 3] = 0;
        }
        x.putImageData(img, 0, 0);
        art = await toFile(trim(c, 2), `${base} logo.png`);
      }
    }
    if (ok(o.photo)) {
      const [px0, py0, px1, py1] = o.photo.map((n) => Math.min(1, Math.max(0, n)));
      const ex = (px1 - px0) * 0.06, ey = (py1 - py0) * 0.06;
      const rx0 = Math.max(0, px0 - ex), ry0 = Math.max(0, py0 - ey), rx1 = Math.min(1, px1 + ex), ry1 = Math.min(1, py1 + ey);
      const scale = Math.min(12, 1800 / ((ry1 - ry0) * v1.height));
      const W = Math.round((rx1 - rx0) * v1.width * scale), H = Math.round((ry1 - ry0) * v1.height * scale);
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
      await page.render({ canvasContext: x, viewport: page.getViewport({ scale, offsetX: -rx0 * v1.width * scale, offsetY: -ry0 * v1.height * scale }) }).promise;
      // snap to the photo: the rows and columns it fills
      const d = x.getImageData(0, 0, W, H).data, ink = (i: number) => Math.min(d[i], d[i + 1], d[i + 2]) < 238;
      const rows: number[] = [], cols = new Array(W).fill(0);
      for (let y = 0; y < H; y++) { let n = 0; for (let xx = 0; xx < W; xx++) if (ink((y * W + xx) * 4)) { n++; cols[xx]++; } rows.push(n); }
      // the longest run of rows (then columns) the photo fills: a title above or below it is only partly filled
      const run = (a: number[], min: number): [number, number] => { let best: [number, number] = [-1, -2], s0 = -1; for (let i = 0; i <= a.length; i++) { if (i < a.length && a[i] > min) { if (s0 < 0) s0 = i; } else if (s0 >= 0) { if (i - 1 - s0 > best[1] - best[0]) best = [s0, i - 1]; s0 = -1; } } return best; };
      let [y0, y1] = run(rows, W * 0.8);
      const cols2 = new Array(W).fill(0);
      if (y1 > y0) for (let y = y0; y <= y1; y++) for (let xx = 0; xx < W; xx++) if (ink((y * W + xx) * 4)) cols2[xx]++;
      let [x0, x1] = run(cols2, (y1 - y0 + 1) * 0.8);
      if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0 || (x1 - x0) * (y1 - y0) < W * H * 0.3) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
      const o2 = document.createElement("canvas"); o2.width = x1 - x0 + 1; o2.height = y1 - y0 + 1;
      o2.getContext("2d")!.drawImage(c, x0, y0, o2.width, o2.height, 0, 0, o2.width, o2.height);
      mockup = await toFile(o2, `${base} mockup.png`);
    }
    return { art, mockup };
  } catch { return { art: null, mockup: null }; }
}
