/**
 * Makes a flat logo look embroidered on the mockup (Oct 23, Nick: "make our mock-ups look like they're embroidered…
 * this FedEx logo… it should look like it's stitched"). Drawn on a canvas, no AI:
 *   - each thread color is a region; its stitches run in rows at its own angle (45°, -45°, 0°, 90°…), like a digitizer
 *     turns the fill direction from one area to the next
 *   - every row is a twisted thread: lighter down its middle, darker in the gaps between rows, with a little sheen
 *   - stitch ends are staggered row to row (the brick pattern of a fill stitch)
 *   - the edges are raised: light on the top-left edge, shade on the bottom-right, and a soft shadow on the fabric
 * The size of a thread row follows the print's real size when it's known (40 wt thread ≈ 0.4 mm rows).
 */
const ANGLES = [45, -45, 0, 90, 30, -60, 60, -30, 15, 75, -15, -75];

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("no image")); im.src = src; });
}

/** box blur of one channel (two passes make it close to a gaussian) */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}


/** distance (px) from each inside pixel to the nearest outside one (3-4 chamfer, two passes) */
function distance(mask: Uint8Array, w: number, h: number): Float32Array {
  const D = new Float32Array(w * h), BIG = 1e6;
  for (let i = 0; i < w * h; i++) D[i] = mask[i] ? BIG : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!D[i]) continue;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 3); else v = Math.min(v, 3);
    if (y > 0) { v = Math.min(v, D[i - w] + 3); if (x > 0) v = Math.min(v, D[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, D[i - w + 1] + 4); } else v = Math.min(v, 3);
    D[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!D[i]) continue;
    let v = D[i];
    if (x < w - 1) v = Math.min(v, D[i + 1] + 3); else v = Math.min(v, 3);
    if (y < h - 1) { v = Math.min(v, D[i + w] + 3); if (x < w - 1) v = Math.min(v, D[i + w + 1] + 4); if (x > 0) v = Math.min(v, D[i + w - 1] + 4); } else v = Math.min(v, 3);
    D[i] = v;
  }
  for (let i = 0; i < w * h; i++) D[i] /= 3;
  return D;
}
/** the largest value within r px (square window, two passes) */
function maxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (src[y * w + k] > m) m = src[y * w + k]; tmp[y * w + x] = m; }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] > m) m = tmp[k * w + x]; out[y * w + x] = m; }
  return out;
}

/**
 * The stitched look of a picture (a painted logo, see-through around it). `pxPerIn`: how many of its pixels make an
 * inch at the print size (to size the thread rows); left out, rows are ~3 px.
 */
export async function stitchLook(src: string, o: { pxPerIn?: number; maxSide?: number } = {}): Promise<string> {
  const img = await loadImg(src);
  const k = Math.min(1, (o.maxSide || 900) / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data;

  // the thread colors: the most used colors of the logo (soft edges join the nearest)
  const count = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = count.get(key); if (e) e.n++; else count.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  const pal = [...count.values()].sort((a, b) => b.n - a.n).filter((x, i, arr) => i < 12 && x.n > arr[0].n * 0.004);
  if (!pal.length) return src;

  // thread rows: 0.4 mm apart at the print size, never finer than 2 px (so they read on screen)
  const rowPx = Math.max(2.2, o.pxPerIn ? (o.pxPerIn * 0.4) / 25.4 * 1.6 : 3);
  const stitchLen = rowPx * 6; // a fill stitch is ~4 mm long
  const rad = ANGLES.map((a) => (a * Math.PI) / 180);

  const A = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) A[i] = d[i * 4 + 3] / 255;
  const B = blur(A, w, h, Math.max(1, Math.round(rowPx * 0.8)));
  const off = Math.max(1, Math.round(rowPx * 0.7));

  // narrow parts (lettering, outlines: under 5.5 mm wide) are satin: the thread runs across the stroke, edge to edge;
  // wider parts are fill, rows at the color's angle. One stroke's width is read off how far its middle is from its edges
  const pxMm = o.pxPerIn ? o.pxPerIn / 25.4 : 3.5;
  const satinHalf = Math.max(3, Math.round(2.75 * pxMm));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  const Dist = distance(mask, w, h);
  const Wide = maxFilter(Dist, w, h, Math.min(40, satinHalf));
  const Ds = blur(Dist, w, h, Math.max(1, Math.round(rowPx * 0.7)));
  const out = g.createImageData(w, h), q = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      const a = d[p + 3];
      if (a < 8) continue;
      // which thread
      let best = 0, bd = Infinity;
      for (let j = 0; j < pal.length; j++) { const e = pal[j], dd = (e.r - d[p]) ** 2 + (e.g - d[p + 1]) ** 2 + (e.b - d[p + 2]) ** 2; if (dd < bd) { bd = dd; best = j; } }
      let t = rad[best % rad.length];
      const satin = Wide[i] < satinHalf && Wide[i] > 0;
      if (satin) {
        // across the stroke: the way its distance from the edge rises
        const gx = Ds[y * w + Math.min(w - 1, x + 1)] - Ds[y * w + Math.max(0, x - 1)], gy = Ds[Math.min(h - 1, y + 1) * w + x] - Ds[Math.max(0, y - 1) * w + x];
        if (gx * gx + gy * gy > 0.01) t = Math.atan2(gx, -gy); // rows run along the stroke, so the thread lies across it
      }
      const cs = Math.cos(t), sn = Math.sin(t);
      const u = x * cs + y * sn, v = -x * sn + y * cs;
      // across the rows: the round of each thread
      const row = Math.floor(u / rowPx), fu = u / rowPx - row;
      const round = Math.sin(Math.PI * fu); // 0 in the gap, 1 on top of the thread
      // along the row: stitch ends, staggered by a third each row
      const fv = ((v / stitchLen + row * 0.37) % 1 + 1) % 1;
      // satin has no stitch ends in the middle: it shines along its length, brightest in the middle of the stroke
      const end = satin ? 0.9 + 0.2 * Math.min(1, Dist[i] / Math.max(1, Wide[i])) : fv < 0.06 ? 0.86 : 1;
      let lit = (0.72 + 0.36 * Math.pow(round, 0.6)) * end;
      // the twist of the thread catching the light
      lit += 0.16 * Math.pow(round, 10);
      // raised edges: lit from the top left
      const ix = Math.max(0, x - off), iy = Math.max(0, y - off), jx = Math.min(w - 1, x + off), jy = Math.min(h - 1, y + off);
      const bev = (B[iy * w + ix] - B[jy * w + jx]);
      lit *= 1 + bev * 0.45;
      // the inside of a big area sits a touch lower than its edges
      lit *= 0.96 + 0.04 * (1 - B[i]);
      const e = pal[best];
      // the thread's color (the logo color it was painted as), so soft edges don't get muddy
      q[p] = Math.max(0, Math.min(255, e.r * lit + (lit > 1 ? (lit - 1) * 90 : 0)));
      q[p + 1] = Math.max(0, Math.min(255, e.g * lit + (lit > 1 ? (lit - 1) * 90 : 0)));
      q[p + 2] = Math.max(0, Math.min(255, e.b * lit + (lit > 1 ? (lit - 1) * 90 : 0)));
      q[p + 3] = a;
    }
  }
  // a soft shadow where the stitches sit on the fabric, then the stitches
  const s = document.createElement("canvas"); s.width = w; s.height = h;
  const sg = s.getContext("2d")!;
  sg.putImageData(out, 0, 0);
  const f = document.createElement("canvas"); f.width = w; f.height = h;
  const fg = f.getContext("2d")!;
  fg.filter = `drop-shadow(${(rowPx * 0.4).toFixed(1)}px ${(rowPx * 0.6).toFixed(1)}px ${(rowPx * 0.8).toFixed(1)}px rgba(0,0,0,0.45))`;
  fg.drawImage(s, 0, 0);
  fg.filter = "none";
  return f.toDataURL("image/png");
}
