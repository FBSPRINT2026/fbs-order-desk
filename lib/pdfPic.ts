"use client";
import { pdfPicture } from "@/lib/printavoArt";

/**
 * Pictures for the designs catalog (Oct 20, Nick: "default to be mock-ups… just don't let the thumbnail be a S&S
 * order page… it's very low resolution"). Printavo only kept a 100 px thumbnail; the full file is often a PDF, and a
 * job's files mix our mockup with the S&S purchase order. Each file is drawn here (a PDF's first page) and scored by
 * how much of it is solid picture: shirts and photos are big solid areas, an order page is thin text and table lines.
 */
export const isPdf = (url: string) => /\.pdf(\?|$)/i.test(url.split("?")[0]) || /\.pdf\?/i.test(url);

export async function drawPic(url: string, width = 900): Promise<HTMLCanvasElement | null> {
  try {
    if (isPdf(url)) {
      const r = await fetch(url); if (!r.ok) return null;
      return await pdfPicture(await r.arrayBuffer(), width);
    }
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, width / Math.max(1, img.naturalWidth));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch { return null; }
}

/** 0–1: the share of the picture that's solid (a pixel and the ones 3 px around it all inked). An order form or
 *  spreadsheet scores near 0; a shirt mockup or a photo well above 0.05. */
export function solidScore(c: HTMLCanvasElement) {
  const W = 300, H = Math.max(1, Math.round((c.height / c.width) * W));
  const s = document.createElement("canvas"); s.width = W; s.height = H;
  const x = s.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.drawImage(c, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; ink[i] = Math.min(r, g, b) < 225 ? 1 : 0; }
  let solid = 0; const R = 3;
  for (let y = R; y < H - R; y++) for (let xx = R; xx < W - R; xx++) {
    const i = y * W + xx;
    if (ink[i] && ink[i - R] && ink[i + R] && ink[i - R * W] && ink[i + R * W] && ink[i - R - R * W] && ink[i + R + R * W]) solid++;
  }
  return solid / (W * H);
}

/** an order form, spreadsheet or purchase order: table rules running across most of the page (an S&S order has
 *  4-35 at 600 px wide; mockups, photos and art have none: a photo's rows are long but they're an area, not lines) */
export function isForm(c: HTMLCanvasElement) {
  const W = 600, H = Math.max(1, Math.round((c.height / c.width) * W));
  const s = document.createElement("canvas"); s.width = W; s.height = H;
  const x = s.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.drawImage(c, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const long: boolean[] = [];
  for (let y = 0; y < H; y++) { let run = 0, best = 0; for (let xx = 0; xx < W; xx++) { const i = (y * W + xx) * 4; run = Math.min(d[i], d[i + 1], d[i + 2]) < 235 ? run + 1 : 0; if (run > best) best = run; } long.push(best > W * 0.6); }
  // a rule is a thin line: a full-width photo or a dark band has long rows too, but rows of them, not lines
  let n = 0;
  for (let y = 0; y < H; y++) if (long[y] && !long[y - 4] && !long[y + 4]) n++;
  return n >= 3;
}

/** how good a cover it makes: -1 an order form (never), 2+ a mockup or photo, 1+ the art alone */
export function picRank(c: HTMLCanvasElement) {
  if (isForm(c)) return -1;
  const s = solidScore(c);
  return s >= 0.15 ? 2 + s : 1 + s;
}

/** the picture trimmed of its white margin, as a JPEG data URL at most `max` px on its long side */
export function coverJpeg(c: HTMLCanvasElement, max = 900) {
  const x = c.getContext("2d")!; const { width: W, height: H } = c; const d = x.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) for (let xx = 0; xx < W; xx += 2) { const i = (y * W + xx) * 4; if (Math.min(d[i], d[i + 1], d[i + 2]) < 240 && d[i + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(1, max / Math.max(cw, ch));
  const o = document.createElement("canvas"); o.width = Math.round(cw * k); o.height = Math.round(ch * k);
  const ox = o.getContext("2d")!; ox.fillStyle = "#fff"; ox.fillRect(0, 0, o.width, o.height); ox.drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  return o.toDataURL("image/jpeg", 0.86);
}
