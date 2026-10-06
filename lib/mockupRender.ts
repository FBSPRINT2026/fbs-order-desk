"use client";
import { PHOTO_H, PHOTO_W, basePlacement, measureGarment, printWidth, spotFor, type View } from "@/lib/mockup";

/**
 * One product mockup, made in the browser: the blank's photo with the design placed where it prints (the same
 * measuring and placement the Mockup Creator uses), cut to the shirt's outline. Returns a PNG.
 */
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("Couldn't load a picture")); im.src = src; });
}

export async function renderMockup(o: { photo: string; art: string; location: string; widthIn?: number; artRatio?: number; youth?: boolean; size?: number }): Promise<Blob> {
  const spot = spotFor(o.location);
  const view: View = spot.view === "back" ? "back" : "front";
  const [bg, art] = await Promise.all([load(o.photo), load(o.art)]);
  const ratio = o.artRatio || (art.naturalWidth ? art.naturalHeight / art.naturalWidth : 1);
  const fit = measureGarment(bg, view);
  const wIn = o.widthIn ? Math.min(o.widthIn, printWidth("MAX", o.location, ratio)) : printWidth(spot.defW ? `${spot.defW}` : "11", o.location, ratio);
  const p = basePlacement(o.location, wIn, ratio, null, o.youth ? 22 / 18 : 1, view, fit);
  const out = o.size || 900, k = out / PHOTO_W;
  const c = document.createElement("canvas");
  c.width = out; c.height = Math.round(PHOTO_H * k);
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bg, 0, 0, c.width, c.height);
  // the art on its own layer, then cut to the shirt's outline
  const layer = document.createElement("canvas"); layer.width = c.width; layer.height = c.height;
  const lx = layer.getContext("2d")!;
  lx.save();
  lx.translate((p.x + p.w / 2) * k, (p.y + p.h / 2) * k);
  if (p.rot) lx.rotate((p.rot * Math.PI) / 180);
  lx.drawImage(art, (-p.w / 2) * k, (-p.h / 2) * k, p.w * k, p.h * k);
  lx.restore();
  if (fit?.mask) {
    const m = await load(fit.mask).catch(() => null);
    if (m) { lx.globalCompositeOperation = "destination-in"; lx.drawImage(m, 0, 0, c.width, c.height); }
  }
  x.drawImage(layer, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture"))), "image/png"));
}
