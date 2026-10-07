"use client";
import { makePreview } from "./artPrep";

/**
 * A customer's own mockup, kept in the job's Production files as a reference: the picture with "CUSTOMER SUPPLIED
 * MOCKUP" repeated across it in gray, so nobody mistakes it for our mockup (we remake it in the Mockup Creator so
 * the separations and print sizes come from our own). PDFs / AI / HEIC are drawn from their first page first.
 */
export const STAMP_TAG = "Customer mockup";
const TEXT = "CUSTOMER SUPPLIED MOCKUP";

/** a short, stable key for a storage path (the stamped file's name carries it, so it's made once) */
export function stampKey(path: string) {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export const stampName = (path: string) => `custmockup-${stampKey(path)}.jpg`;

export async function stampCustomerMockup(blob: Blob, name: string): Promise<File | null> {
  let src: Blob = blob;
  if (!/^image\/(png|jpe?g|webp|gif|bmp)/i.test(blob.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) {
    const prev = await makePreview(new File([blob], name, { type: blob.type }));
    if (!prev) return null;
    src = prev;
  }
  const bmp = await createImageBitmap(src).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  // the words, repeated on a slant across the whole picture: gray with a faint light edge so they read on dark shirts too
  const fs = Math.max(14, Math.round(Math.min(c.width, c.height) / 16));
  x.save();
  x.translate(c.width / 2, c.height / 2);
  x.rotate(-Math.PI / 7);
  x.font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  x.textBaseline = "middle";
  const tw = x.measureText(TEXT).width, gapX = tw + fs * 2, gapY = fs * 3, R = Math.hypot(c.width, c.height);
  x.lineJoin = "round"; x.lineWidth = Math.max(2, fs / 9);
  x.strokeStyle = "rgba(255,255,255,0.28)"; x.fillStyle = "rgba(96,96,96,0.34)";
  for (let row = 0, y = -R / 2; y < R / 2; y += gapY, row++) {
    for (let xx = -R / 2 - (row % 2 ? gapX / 2 : 0); xx < R / 2; xx += gapX) { x.strokeText(TEXT, xx, y); x.fillText(TEXT, xx, y); }
  }
  x.restore();
  const out = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.88));
  return out ? new File([out], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : null;
}
