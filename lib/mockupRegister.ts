"use client";
/**
 * Lay one shirt photo over another (Oct 22 2026, Nick: "take the first one… lay a shirt outline over it… and then
 * every time I add a color, you then fit the new graphic to that template and make it lay over top of it… set a
 * relative position and then crop to that each time").
 *
 * Both photos' shirt outlines (the masks the Mockup Creator already makes, PHOTO_W × PHOTO_H, opaque on the shirt)
 * are compared whole: the other photo is scaled and moved until its outline covers the template's as closely as
 * possible (most overlap). The answer maps a point p on the other photo to a·p + b on the template photo.
 */
import { PHOTO_H, PHOTO_W } from "@/lib/mockup";

export type Reg = { a: number; bx: number; by: number; /** how well the outlines match, 0–1 */ iou: number };

const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("mask")); im.src = src; });

/** the outline at 1/r size: on/off per pixel */
function grid(im: HTMLImageElement, r: number) {
  const w = Math.round(PHOTO_W / r), h = Math.round(PHOTO_H / r);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(im, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, on = new Uint8Array(w * h);
  let n = 0, sx = 0, sy = 0;
  const pts: number[] = [];
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 128) { on[i] = 1; n++; const px = i % w, py = (i / w) | 0; sx += px; sy += py; pts.push(px, py); }
  return { w, h, on, n, cx: n ? sx / n : w / 2, cy: n ? sy / n : h / 2, pts };
}

/** overlap ÷ union of the two outlines with the other laid on the template: each template pixel is looked up on the
 *  other photo (q = a·p + b, so p = (q − b) / a) */
function score(T: ReturnType<typeof grid>, O: ReturnType<typeof grid>, a: number, bx: number, by: number) {
  let hit = 0;
  const q = T.pts;
  for (let i = 0; i < q.length; i += 2) {
    const px = Math.round((q[i] - bx) / a), py = Math.round((q[i + 1] - by) / a);
    if (px >= 0 && py >= 0 && px < O.w && py < O.h && O.on[py * O.w + px]) hit++;
  }
  const union = T.n + O.n * a * a - hit;
  return union > 0 ? hit / union : 0;
}

/** the best a, b laying `other` over `template`, searched coarse then fine */
export async function registerMasks(template: string, other: string): Promise<Reg | null> {
  const [ti, oi] = await Promise.all([load(template), load(other)]);
  // coarse, at 1/8 size: start from the outlines' areas and centers, then look around
  let T = grid(ti, 8), O = grid(oi, 8);
  if (T.n < 200 || O.n < 200) return null;
  const a0 = Math.sqrt(T.n / O.n);
  let best = { a: a0, bx: T.cx - a0 * O.cx, by: T.cy - a0 * O.cy, s: 0 };
  best.s = score(T, O, best.a, best.bx, best.by);
  const look = (as: number[], ds: number[], bx0: number, by0: number) => {
    for (const a of as) for (const dx of ds) for (const dy of ds) {
      const s = score(T, O, a, bx0 + dx, by0 + dy);
      if (s > best.s) best = { a, bx: bx0 + dx, by: by0 + dy, s };
    }
  };
  { const as = Array.from({ length: 13 }, (_, i) => best.a - 0.06 + i * 0.01), ds = Array.from({ length: 13 }, (_, i) => i - 6); const b0 = { ...best }; look(as, ds, b0.bx, b0.by); }
  // fine, at 1/4 size, around the coarse answer
  const k = 2; // 1/8 → 1/4
  T = grid(ti, 4); O = grid(oi, 4);
  best = { a: best.a, bx: best.bx * k, by: best.by * k, s: 0 };
  best.s = score(T, O, best.a, best.bx, best.by);
  { const b0 = { ...best }; const as = Array.from({ length: 9 }, (_, i) => b0.a - 0.012 + i * 0.003), ds = Array.from({ length: 9 }, (_, i) => -2 + i * 0.5); look(as, ds, b0.bx, b0.by); }
  // back to full photo pixels
  return { a: best.a, bx: best.bx * 4, by: best.by * 4, iou: best.s };
}
