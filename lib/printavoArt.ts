"use client";
import { COLLAR_Y, PHOTO_H, PHOTO_W, PX_PER_IN } from "@/lib/mockup";
import { suggestInk } from "@/lib/inkColors";

/**
 * The print art out of an old Printavo mockup PDF (our Illustrator mockup sheet: the shirt photos with the art on
 * top, front on the left, back on the right). The shirt photos are left out while the page is drawn, so what's left
 * is the art itself, on a clear background; each piece sitting on a shirt photo is one print. Its size and drop come
 * from where it sits on the photo (the same supplier photos the Mockup Creator uses: 1000 px wide, 34 px per inch).
 */
export type ArtPiece = { side: "front" | "back"; file: File; widthIn: number; heightIn: number; dropIn: number; offIn: number; hex: string; ink: string };

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

/**
 * Draws the page with the big photos skipped: a picture drawn wider than 30% of the page (the shirt photos) is left
 * out and its place on the page recorded. pdf.js's own scratch canvases (page sized) still go through.
 */
async function drawWithoutPhotos(page: Page, scale: number, crop?: Rect) {
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  const W = crop ? Math.round(crop.x1 - crop.x0) : Math.round(vp.width), H = crop ? Math.round(crop.y1 - crop.y0) : Math.round(vp.height);
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const photos: Rect[] = [];
  const proxy = new Proxy(ctx, {
    get(t, p) {
      if (p === "drawImage") return (...a: unknown[]) => {
        const src = a[0] as { width: number; height: number };
        const [dx, dy, dw, dh] = a.length >= 9 ? (a.slice(5, 9) as number[]) : a.length >= 5 ? (a.slice(1, 5) as number[]) : [a[1] as number, a[2] as number, src.width, src.height];
        const m = t.getTransform();
        const xs = [dx, dx + dw].flatMap((x) => [dy, dy + dh].map((y) => m.a * x + m.c * y + m.e));
        const ys = [dx, dx + dw].flatMap((x) => [dy, dy + dh].map((y) => m.b * x + m.d * y + m.f));
        const r = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        const fullW = vp.width;
        if (r.x1 - r.x0 > fullW * 0.3 && src.width < fullW * 0.9 && src.width < 4000) { photos.push(r); return; }
        return (t.drawImage as (...x: unknown[]) => void).apply(t, a);
      };
      const v = Reflect.get(t, p);
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, p, v) { return Reflect.set(t, p, v); },
  });
  await page.render({ canvasContext: proxy, viewport: vp, background: "rgba(0,0,0,0)", ...(crop ? { transform: [1, 0, 0, 1, -crop.x0, -crop.y0] } : {}) }).promise;
  return { canvas: c, photos };
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

export async function artFromMockupPdf(buf: ArrayBuffer, name = "art"): Promise<ArtPiece[]> {
  const page = await openPage(buf);
  // 1. a quick look: where the photos and the art are
  const s1 = 3;
  const look = await drawWithoutPhotos(page, s1);
  const photos = look.photos.sort((a, b) => a.x0 - b.x0);
  if (!photos.length) return [];
  const found = pieces(look.canvas, 0.12 * 72 * s1).filter((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > 64);
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
    const offIn = ((cx - (p.x0 + p.x1) / 2) * k) / PX_PER_IN;
    // 2. the piece drawn again at print resolution (about 300 dpi at its real size, at most 5000 px)
    const want = Math.min(5000, Math.max(800, widthIn * 300));
    const s2 = s1 * (want / (r.x1 - r.x0));
    const pad = 4 * (s2 / s1);
    const crop = { x0: (r.x0 * s2) / s1 - pad, y0: (r.y0 * s2) / s1 - pad, x1: (r.x1 * s2) / s1 + pad, y1: (r.y1 * s2) / s1 + pad };
    const hi = await drawWithoutPhotos(page, s2, crop);
    const blob = await new Promise<Blob | null>((res) => hi.canvas.toBlob(res, "image/png"));
    if (!blob) continue;
    const hex = mainHex(hi.canvas), sug = suggestInk(hex);
    out.push({ side, file: new File([blob], `${name} ${side}.png`, { type: "image/png" }), widthIn: Math.round(widthIn * 4) / 4, heightIn: Math.round(heightIn * 4) / 4, dropIn: Math.round(dropIn * 4) / 4, offIn: Math.round(offIn * 4) / 4, hex, ink: sug.rec === "pms" ? sug.pms.name : sug.standard.name });
  }
  return out;
}

/**
 * A film file (FBS Film Folder/<customer>/<job>.ai): the size of each print on it, from every artboard. Registration
 * marks and labels (under an inch tall or wide) are left out. Films are at print size, so these are the real sizes.
 */
export type FilmPiece = { page: number; widthIn: number; heightIn: number };
export async function measureFilm(buf: ArrayBuffer): Promise<FilmPiece[]> {
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
      if (w >= 1 && h >= 1) out.push({ page: n, widthIn: Math.round(w * 100) / 100, heightIn: Math.round(h * 100) / 100 });
    }
  }
  return out;
}

/** the film piece that is this print: same shape (within ~12%) and a believable size next to the mockup's reading */
export function filmFor(widthIn: number, heightIn: number, film: FilmPiece[]) {
  const a = heightIn / widthIn;
  return film
    .filter((f) => Math.abs(Math.log(f.heightIn / f.widthIn / a)) < 0.12 && f.widthIn > widthIn * 0.6 && f.widthIn < widthIn * 1.6)
    .sort((x, y) => Math.abs(x.widthIn - widthIn) - Math.abs(y.widthIn - widthIn))[0] || null;
}
