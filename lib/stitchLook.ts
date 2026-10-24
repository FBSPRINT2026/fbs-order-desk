/**
 * Makes a flat logo look embroidered on the mockup (Oct 23, Nick: "make our mock-ups look like they're embroidered…
 * this FedEx logo… it should look like it's stitched"; then on stitch direction, with sew-outs of FedEx, Coca-Cola, LV
 * and a satin "ABC / FAUX Stitch": "it usually starts flat, just at like 90 degrees and then goes up… stays the same…
 * then it gets the end caps, and the caps go a different direction… the Coca-Cola one kind of flows around… FedEx,
 * those are big stitches"). Drawn on a canvas, no AI, the way a digitizer lays satin:
 *   - every stroke is a satin column: each stitch goes straight across it, edge to edge, and keeps that angle the
 *     whole way (Nick: "the threads jump across and never cross over… the F… a perfectly level stitch all the way up…
 *     the middle bar… straight up and down… sew the middle bar first so that sits behind, and then you jump over top
 *     of it"). Each stroke is found by measuring, at every point, how far the color runs on past it in 16 directions:
 *     the direction it goes on furthest both ways is the stroke's line. So a stem going on past a bar owns the join and
 *     the bar tucks under it (a shadow on the bar along the join); where two strokes turn a corner (the top of an F,
 *     an outline's corners) the join splits on the diagonal, a mitred corner; bowls and script turn their stitches
 *     with the curve
 *   - a part too wide for one stitch (over ~12 mm) is a fill sewn the same way, with staggered needle points
 *   - each column is round: bright along its top, gray at its edges, the edge ragged where the stitch ends are; the
 *     threads show as fine streaks along each stitch; dark threads still get a gray sheen
 *   - the edges are raised, lit from the top left, with a soft shadow on the fabric
 * Sizes follow the print's real size when it's known (pxPerIn); otherwise the logo is taken as about 3.5" wide.
 */
const DIRS = 16;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => rej(new Error("no image")); im.src = src; });
}

/** box blur of one channel (two passes make it close to a gaussian) */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
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

/**
 * How far each pixel's color runs from it along one direction (x steps of `dx` = ±1, y moving `t` per step), in px.
 * Swept column by column; the next column's run is read between its two nearest pixels, so any angle works.
 * `L` is laid out W wide, H tall.
 */
/** distance (px) from each pixel to the edge of its own color (3-4 chamfer, two passes) */
function distance(lab: Int16Array, w: number, h: number): Float32Array {
  const D = new Float32Array(w * h), BIG = 1e6;
  for (let i = 0; i < w * h; i++) D[i] = lab[i] >= 0 ? BIG : 0;
  const pass = (y: number, x: number, nb: [number, number, number][]) => {
    const i = y * w + x; if (!D[i]) return;
    let v = D[i];
    for (const [dx, dy, c] of nb) { const X = x + dx, Y = y + dy; const q = Y * w + X;
      v = Math.min(v, X < 0 || Y < 0 || X >= w || Y >= h || lab[q] !== lab[i] ? c : D[q] + c); }
    D[i] = v;
  };
  const A: [number, number, number][] = [[-1, 0, 3], [0, -1, 3], [-1, -1, 4], [1, -1, 4]], Bn: [number, number, number][] = [[1, 0, 3], [0, 1, 3], [1, 1, 4], [-1, 1, 4]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pass(y, x, A);
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) pass(y, x, Bn);
  for (let i = 0; i < w * h; i++) D[i] /= 3;
  return D;
}

function run(L: Int16Array, W: number, H: number, dx: 1 | -1, t: number, step: number, out: Float32Array) {
  const dy = t * dx;
  for (let k = 0; k < W; k++) {
    const x = dx > 0 ? W - 1 - k : k, nx = x + dx;
    for (let y = 0; y < H; y++) {
      const i = y * W + x, c = L[i];
      if (c < 0) { out[i] = 0; continue; }
      if (nx < 0 || nx >= W) { out[i] = step; continue; }
      const yy = y + dy, y0 = Math.floor(yy), f = yy - y0;
      let v = 0;
      if (y0 >= 0 && y0 < H && L[y0 * W + nx] === c) v += out[y0 * W + nx] * (1 - f);
      if (y0 + 1 >= 0 && y0 + 1 < H && L[(y0 + 1) * W + nx] === c) v += out[(y0 + 1) * W + nx] * f;
      out[i] = step + v;
    }
  }
}

/**
 * The stitched look of a picture (a painted logo, see-through around it). `pxPerIn`: how many of its pixels make an
 * inch at the print size; left out, the logo is taken as about 3.5" wide.
 */
export async function stitchLook(src: string, o: { pxPerIn?: number; maxSide?: number; debug?: boolean | "obj"; tune?: Record<string, number> } = {}): Promise<string> {
  const img = await loadImg(src);
  const tune = (k: string, d: number) => (o.tune && typeof o.tune[k] === "number" ? o.tune[k] : d);
  const k = Math.min(1, (o.maxSide || 900) / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k)), N = w * h;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data;

  // the thread colors: the most used colors of the logo (soft edges join the nearest)
  const count = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = count.get(key); if (e) { e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; } else count.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  const pal = [...count.values()].sort((a, b) => b.n - a.n).filter((x, i, arr) => i < 12 && x.n > arr[0].n * 0.004).map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
  if (!pal.length) return src;
  const pxMm = (o.pxPerIn ? o.pxPerIn * k : w / 3.5) / 25.4;

  // which thread each pixel is (-1: fabric)
  const lab = new Int16Array(N), labAll = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    let best = 0, bd = Infinity;
    for (let j = 0; j < pal.length; j++) { const e = pal[j], dd = (e.r - d[p]) ** 2 + (e.g - d[p + 1]) ** 2 + (e.b - d[p + 2]) ** 2; if (dd < bd) { bd = dd; best = j; } }
    labAll[i] = best; lab[i] = d[p + 3] >= 128 ? best : -1;
  }
  // each letter is its own piece (Oct 23, Nick: "the machine… sews the F, then stops, then sews the E… it sews the D
  // and the E separately. There's a space between them still"). Letters that touch in the art (FedEx's are kerned
  // into each other) are pulled apart: shrink every color area by ~0.5 mm, the touching spots let go, each piece left
  // is a letter, and every pixel goes back to the letter it grew from. Fine lettering that would vanish stays whole
  {
    const Dc = distance(lab, w, h), r = Math.max(1.5, 0.5 * pxMm);
    const comp = (keep: (i: number) => boolean) => {
      const id = new Int32Array(N).fill(-1); let n = 0; const st: number[] = [];
      for (let s0 = 0; s0 < N; s0++) {
        if (id[s0] >= 0 || !keep(s0)) continue;
        id[s0] = n; st.push(s0);
        while (st.length) { const i = st.pop()!, x = i % w, y = (i - x) / w;
          for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const X = x + u, Y = y + v;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const q = Y * w + X;
            if (id[q] < 0 && keep(q) && lab[q] === lab[i]) { id[q] = n; st.push(q); } } }
        n++;
      }
      return { id, n };
    };
    const whole = comp((i) => lab[i] >= 0), core = comp((i) => lab[i] >= 0 && Dc[i] > r);
    // grow the cores back out, staying inside their own whole area
    const obj = new Int32Array(N).fill(-1), q: number[] = [];
    for (let i = 0; i < N; i++) if (core.id[i] >= 0) { obj[i] = core.id[i]; q.push(i); }
    for (let k = 0; k < q.length; k++) { const i = q[k], x = i % w, y = (i - x) / w;
      for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X;
        if (obj[j] < 0 && lab[j] >= 0 && whole.id[j] === whole.id[i]) { obj[j] = obj[i]; q.push(j); } } }
    // areas with no core (fine lettering) stay whole
    for (let i = 0; i < N; i++) if (lab[i] >= 0 && obj[i] < 0) obj[i] = core.n + whole.id[i];
    // letters fused into a neighbor (FedEx's F runs into the e, the e into the d): a letter with a counter (e, d, o…)
    // is the ring of thread around that counter. Each counter's ring is as thick as the letter's stroke (read off
    // where the ring meets the fabric); what's left past it is another letter when it's big (the F), or part of the
    // same letter when it's small (the top of the d's stem goes with the d)
    const holeId = new Int32Array(N).fill(-1), holes: { px: number[]; border: boolean }[] = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (lab[s0] >= 0 || holeId[s0] >= 0) continue;
      const hp: number[] = [s0]; let border = false; holeId[s0] = holes.length;
      for (let k = 0; k < hp.length; k++) { const i = hp[k], x = i % w, y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X;
          if (lab[j] < 0 && holeId[j] < 0) { holeId[j] = holes.length; hp.push(j); } } }
      holes.push({ px: hp, border });
    }
    const ringOf = new Int32Array(N).fill(-1), ringD = new Float32Array(N).fill(Infinity), dist = new Float32Array(N).fill(-1);
    const minHole = (1.2 * pxMm) ** 2, cap = 15 * pxMm, ringArea = new Map<number, number>(), ringX = new Map<number, [number, number]>();
    holes.forEach((H, hi) => {
      if (H.border || H.px.length < minHole) return;
      // a letter's own counter is closed in by that letter alone (not a gap closed in by two letters touching)
      const by = new Map<number, number>(); let tot = 0;
      for (const i of H.px) { const x = i % w, y = (i - x) / w;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (lab[j] >= 0) { by.set(obj[j], (by.get(obj[j]) || 0) + 1); tot++; } } }
      let own = -1, ownN = 0;
      for (const [k2, n2] of by) if (n2 > ownN) { ownN = n2; own = k2; }
      if (own < 0 || ownN < 0.85 * tot) return;
      const seen: number[] = [], qq: number[] = [];
      for (const i of H.px) { const x = i % w, y = (i - x) / w;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (lab[j] >= 0 && obj[j] === own && dist[j] < 0) { dist[j] = 1; qq.push(j); seen.push(j); } } }
      for (let k = 0; k < qq.length; k++) { const i = qq[k], x = i % w, y = (i - x) / w; if (dist[i] >= cap) continue;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (lab[j] >= 0 && dist[j] < 0 && obj[j] === obj[i]) { dist[j] = dist[i] + 1; qq.push(j); seen.push(j); } } }
      // the ring's thickness: how far its outside edge is from the counter, most of the way round
      const edge: number[] = [];
      for (const i of seen) { const x = i % w, y = (i - x) / w;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v;
          const outside = X < 0 || Y < 0 || X >= w || Y >= h || (lab[Y * w + X] < 0 && holeId[Y * w + X] !== hi) || (lab[Y * w + X] >= 0 && obj[Y * w + X] !== obj[i]);
          if (outside) { edge.push(dist[i]); break; } } }
      if (edge.length >= 8) {
        edge.sort((p1, p2) => p1 - p2);
        const T = edge[Math.floor(edge.length * 0.25)] * 1.12 + 1;
        let area = 0, x0 = w, x1 = 0;
        for (const i of seen) if (dist[i] <= T && dist[i] < ringD[i]) { ringD[i] = dist[i]; ringOf[i] = hi; area++; const x = i % w; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        ringArea.set(hi, area); ringX.set(hi, [x0, x1]);
      }
      for (const i of seen) dist[i] = -1;
    });
    if (ringArea.size) {
      // what's left outside the rings, piece by piece
      const left = new Int32Array(N).fill(-1); const pieces: { px: number[]; rings: Set<number> }[] = [];
      for (let s0 = 0; s0 < N; s0++) {
        if (lab[s0] < 0 || ringOf[s0] >= 0 || left[s0] >= 0) continue;
        const pc = { px: [s0], rings: new Set<number>() }; left[s0] = pieces.length;
        for (let k = 0; k < pc.px.length; k++) { const i = pc.px[k], x = i % w, y = (i - x) / w;
          for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const j = Y * w + X; if (lab[j] < 0 || obj[j] !== obj[i]) continue;
            if (ringOf[j] >= 0) pc.rings.add(ringOf[j]); else if (left[j] < 0) { left[j] = pieces.length; pc.px.push(j); } } }
        pieces.push(pc);
      }
      const ids = new Map<string, number>(); let next = 0;
      const idOf = (k: string) => { let v = ids.get(k); if (v === undefined) { v = next++; ids.set(k, v); } return v; };
      const nobj = new Int32Array(N).fill(-1), grow: number[] = [];
      for (let i = 0; i < N; i++) if (ringOf[i] >= 0) { nobj[i] = idOf(`r${ringOf[i]}:${obj[i]}`); grow.push(i); }
      pieces.forEach((pc, k) => {
        // another letter sits beside the ring (the F left of the e); the rest of the same letter sits over or under it
        // (the e's tail under its eye, the top of the d's stem over its bowl)
        let inside = 0;
        for (const i of pc.px) { const x = i % w; for (const r2 of pc.rings) { const xr = ringX.get(r2); if (xr && x >= xr[0] && x <= xr[1]) { inside++; break; } } }
        const other = !pc.rings.size || (inside < 0.5 * pc.px.length && pc.px.length >= 0.3 * Math.max(...[...pc.rings].map((r2) => ringArea.get(r2) || 0)));
        if (other) for (const i of pc.px) nobj[i] = idOf(`p${k}`);
      });
      // small pieces join the ring they touch (the nearest one, pixel by pixel)
      for (let k = 0; k < grow.length; k++) { const i = grow[k], x = i % w, y = (i - x) / w;
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + u, Y = y + v; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X; if (lab[j] >= 0 && nobj[j] < 0 && obj[j] === obj[i]) { nobj[j] = nobj[i]; grow.push(j); } } }
      for (let i = 0; i < N; i++) if (lab[i] >= 0) obj[i] = nobj[i] >= 0 ? nobj[i] : idOf(`o${obj[i]}`);
    }
    for (let i = 0; i < N; i++) if (lab[i] >= 0) lab[i] = obj[i] % 32000;
  }
  if (o.debug === "obj") { const dbg = g.createImageData(w, h); for (let i = 0; i < N; i++) { if (lab[i] < 0) continue; const k2 = (lab[i] + 1) * 2654435761 >>> 0; dbg.data[i * 4] = k2 & 255; dbg.data[i * 4 + 1] = (k2 >> 8) & 255; dbg.data[i * 4 + 2] = (k2 >> 16) & 255; dbg.data[i * 4 + 3] = 255; } g.putImageData(dbg, 0, 0); return c.toDataURL(); }
  const labT = new Int16Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labT[x * h + y] = lab[y * w + x];

  // each stroke's own line: at every pixel, the longest straight run through it (16 directions). A stem's longest run
  // is up its length, a bar's along the bar, a curve's along the curve; where two strokes meet the longer one owns the
  // spot (the F's stem goes on up through where its bars join it)
  // the way the nearby edges run (smoothed over ~1 mm): in a bowl or a script curve the stroke follows its edges, so
  // a long straight run cutting across a curve (into a stem it touches) doesn't win there
  const Dd = distance(lab, w, h), Dsm = blur(Dd, w, h, 1);
  const Jxx = new Float32Array(N), Jyy = new Float32Array(N), Jxy = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (lab[i] < 0) continue;
    const gx = (Dsm[i + 1] - Dsm[i - 1]) / 2, gy = (Dsm[i + w] - Dsm[i - w]) / 2;
    Jxx[i] = gx * gx; Jyy[i] = gy * gy; Jxy[i] = gx * gy;
  }
  const rj = Math.max(1, Math.round(0.6 * pxMm));
  const Sxx = blur(blur(Jxx, w, h, rj), w, h, rj), Syy = blur(blur(Jyy, w, h, rj), w, h, rj), Sxy = blur(blur(Jxy, w, h, rj), w, h, rj);
  const lens = new Uint16Array(DIRS * N), lensRaw = new Uint16Array(DIRS * N), mins = new Uint16Array(DIRS * N), bestScore = new Float32Array(N), runLen = new Float32Array(N);
  const F = new Float32Array(N), B = new Float32Array(N), Ft = new Float32Array(N), Bt = new Float32Array(N);
  for (let a = 0; a < DIRS; a++) {
    const ang = (a * Math.PI) / DIRS, cs = Math.cos(ang), sn = Math.sin(ang);
    const steep = Math.abs(sn) > Math.abs(cs);
    let fw: Float32Array, bw: Float32Array;
    if (!steep) { const t = sn / cs, st = 1 / Math.abs(cs); run(lab, w, h, cs > 0 ? 1 : -1, t, st, F); run(lab, w, h, cs > 0 ? -1 : 1, t, st, B); fw = F; bw = B; }
    else { const t = cs / sn, st = 1 / Math.abs(sn); run(labT, h, w, sn > 0 ? 1 : -1, t, st, Ft); run(labT, h, w, sn > 0 ? -1 : 1, t, st, Bt); fw = Ft; bw = Bt; }
    const st = 1 / Math.max(Math.abs(cs), Math.abs(sn));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (lab[i] < 0) continue;
      const j = steep ? x * h + y : i;
      // how far the stroke goes on past this point both ways (the nearer end), plus a little of its whole length: a
      // stem going on up past a bar owns the join (the bar tucks under it); where two strokes turn a corner the join
      // splits on the diagonal (a mitred corner, like the top of an F or the corners of an outline)
      const len = fw[j] + bw[j] - st;
      lensRaw[a * N + i] = Math.min(65535, Math.round(len * 4)); mins[a * N + i] = Math.min(65535, Math.round(Math.min(fw[j], bw[j]) * 4));
    }
  }
  // only a way the stroke actually runs (well longer than the stroke is wide) can own a spot by how far it goes on:
  // the short way across a bar never does, so a bar runs straight on out to its end, no cap (Nick: "this font has no
  // serif… you should have just continued on")
  const LAMBDA = tune("lambda", 0.3), BETA = tune("curve", 0.6);
  for (let i = 0; i < N; i++) {
    if (lab[i] < 0) continue;
    let wmin = Infinity;
    for (let a = 0; a < DIRS; a++) wmin = Math.min(wmin, lensRaw[a * N + i]);
    const tr = Sxx[i] + Syy[i], coh = tr > 1e-6 ? Math.sqrt((Sxx[i] - Syy[i]) ** 2 + 4 * Sxy[i] ** 2) / tr : 0;
    const tang = 0.5 * Math.atan2(2 * Sxy[i], Sxx[i] - Syy[i]) + Math.PI / 2;
    for (let a = 0; a < DIRS; a++) {
      const len = lensRaw[a * N + i] / 4, mn = mins[a * N + i] / 4, ca = Math.cos((a * Math.PI) / DIRS - tang);
      const runs = lensRaw[a * N + i] >= tune("runs", 1.6) * wmin;
      const sc = ((runs ? mn : 0) + LAMBDA * len) * (1 + BETA * coh * coh * ca * ca);
      lens[a * N + i] = Math.min(65535, Math.round(sc * 8));
      if (sc > bestScore[i]) { bestScore[i] = sc; runLen[i] = len; }
    }
  }
  // the stroke's line: the longest direction, fine-tuned between its two neighbors (so curves turn smoothly, while a
  // stem and the bar that meets it never blend)
  let ax = new Float32Array(N), ay = new Float32Array(N); // the line as a doubled angle (0° and 180° agree)
  const C2 = Array.from({ length: DIRS }, (_, a) => Math.cos((2 * a * Math.PI) / DIRS)), S2 = Array.from({ length: DIRS }, (_, a) => Math.sin((2 * a * Math.PI) / DIRS));
  for (let i = 0; i < N; i++) {
    if (lab[i] < 0) continue;
    // every direction votes by its run to the 6th power, as a doubled angle: across-the-stroke votes point the
    // opposite way to along-the-stroke ones, so they cancel instead of blending, and the long way wins cleanly
    // two strokes crossing (the x of FedEx): both go on well past this point both ways. One is sewn whole and the
    // other goes under it, so the longer one (or, when they're as long, always the same one) takes the crossing
    let wmin = Infinity;
    for (let a = 0; a < DIRS; a++) wmin = Math.min(wmin, lensRaw[a * N + i]);
    let c1 = -1, c2 = -1;
    for (let a = 0; a < DIRS; a++) {
      if (mins[a * N + i] < 0.8 * wmin || lensRaw[a * N + i] < 2 * wmin) continue;
      if (c1 < 0 || lensRaw[a * N + i] > lensRaw[c1 * N + i]) { c2 = c1; c1 = a; } else if (c2 < 0 || lensRaw[a * N + i] > lensRaw[c2 * N + i]) c2 = a;
    }
    if (c1 >= 0 && c2 >= 0) {
      const gap = Math.min((c1 - c2 + DIRS) % DIRS, (c2 - c1 + DIRS) % DIRS);
      if (gap >= DIRS / 4) {
        const pick = lensRaw[c1 * N + i] > lensRaw[c2 * N + i] * 1.15 ? c1 : Math.min(c1, c2);
        ax[i] = C2[pick]; ay[i] = S2[pick]; runLen[i] = lensRaw[pick * N + i] / 4 * 1.25; continue;
      }
    }
    let mx = 0;
    for (let a = 0; a < DIRS; a++) mx = Math.max(mx, lens[a * N + i]);
    let sx = 0, sy = 0;
    for (let a = 0; a < DIRS; a++) { const v = Math.pow(lens[a * N + i] / (mx || 1), tune("power", 16)); sx += v * C2[a]; sy += v * S2[a]; }
    const m = Math.hypot(sx, sy) || 1; ax[i] = sx / m; ay[i] = sy / m;
  }
  // specks: a few pixels pointing their own way inside a stroke take the way most of their neighbors go
  for (let pass = 0; pass < 2; pass++) {
    const nx = ax.slice(), ny = ay.slice(), rr = Math.max(2, Math.round(0.6 * pxMm));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (lab[i] < 0) continue;
      let n = 0, agree = 0;
      for (let v = -rr; v <= rr; v += 1) { const Y = y + v; if (Y < 0 || Y >= h) continue;
        for (let u = -rr; u <= rr; u += 1) { const X = x + u; if (X < 0 || X >= w) continue;
          const q = Y * w + X; if (lab[q] !== lab[i]) continue; n++;
          if (ax[q] * ax[i] + ay[q] * ay[i] > 0.77) agree++; } }
      if (agree >= n * 0.3) continue;
      // the most common way among the neighbors: the neighbor that agrees with the most others
      let best = -1, bestC = -1;
      for (let v = -rr; v <= rr; v += 2) { const Y = y + v; if (Y < 0 || Y >= h) continue;
        for (let u = -rr; u <= rr; u += 2) { const X = x + u; if (X < 0 || X >= w) continue;
          const q = Y * w + X; if (lab[q] !== lab[i]) continue;
          let c = 0;
          for (let v2 = -rr; v2 <= rr; v2 += 2) { const Y2 = y + v2; if (Y2 < 0 || Y2 >= h) continue;
            for (let u2 = -rr; u2 <= rr; u2 += 2) { const X2 = x + u2; if (X2 < 0 || X2 >= w) continue;
              const q2 = Y2 * w + X2; if (lab[q2] === lab[i] && ax[q2] * ax[q] + ay[q2] * ay[q] > 0.77) c++; } }
          if (c > bestC) { bestC = c; best = q; } } }
      if (best >= 0) { nx[i] = ax[best]; ny[i] = ay[best]; }
    }
    ax = nx; ay = ny;
  }
  // even it out inside each stroke only: neighbors on another line (more than ~20° off) don't count
  const rs = Math.max(1, Math.round(tune("smooth", 0.7) * pxMm)), agreeMin = Math.cos((2 * tune("agree", 25) * Math.PI) / 180);
  for (let pass = 0; pass < tune("passes", 3); pass++) {
    const nx = new Float32Array(N), ny = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (lab[i] < 0) continue;
      let sx = 0, sy = 0;
      for (let v = -rs; v <= rs; v++) { const Y = y + v; if (Y < 0 || Y >= h) continue;
        for (let u = -rs; u <= rs; u++) { const X = x + u; if (X < 0 || X >= w) continue;
          const q = Y * w + X; if (lab[q] !== lab[i]) continue;
          if (ax[q] * ax[i] + ay[q] * ay[i] < agreeMin) continue;
          sx += ax[q]; sy += ay[q]; } }
      const m = Math.hypot(sx, sy) || 1; nx[i] = sx / m; ny[i] = sy / m;
    }
    ax = nx; ay = ny;
  }
  // the stitch goes straight across the line; measure it edge to edge within its own stroke (it stops where it runs
  // into another stroke, so the stem's stitches end where a bar's begin)
  const tx = new Float32Array(N), ty = new Float32Array(N);
  for (let i = 0; i < N; i++) { if (lab[i] < 0) continue; const th = 0.5 * Math.atan2(ay[i], ax[i]) + Math.PI / 2; tx[i] = Math.cos(th); ty[i] = Math.sin(th); }
  const cmin = new Float32Array(N), along = new Float32Array(N), satin = new Uint8Array(N);
  const satinMax = 25 * pxMm, reach = Math.ceil(satinMax * 1.3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (lab[i] < 0) continue;
    const side = [0, 0];
    for (let sg = 0; sg < 2; sg++) {
      const dx = (sg ? -1 : 1) * tx[i], dy = (sg ? -1 : 1) * ty[i];
      let n = 0;
      while (n < reach) {
        const X = Math.round(x + dx * (n + 1)), Y = Math.round(y + dy * (n + 1));
        if (X < 0 || Y < 0 || X >= w || Y >= h) break;
        const q = Y * w + X; if (lab[q] !== lab[i]) break;
        if (ax[q] * ax[i] + ay[q] * ay[i] < agreeMin) break;
        n++;
      }
      side[sg] = n;
    }
    const ch = side[0] + side[1] + 1;
    cmin[i] = ch; along[i] = (side[1] + 0.5) / ch;
    if (ch <= satinMax) satin[i] = 1;
  }

  if (o.debug) { // the stitch directions as colors (for tuning)
    const dbg = g.createImageData(w, h);
    for (let i = 0; i < N; i++) { if (lab[i] < 0) continue; const th = (Math.atan2(ty[i], tx[i]) + Math.PI) % Math.PI, k6 = (th / Math.PI) * 6, f = k6 - Math.floor(k6), sec = Math.floor(k6) % 6;
      const rgb = [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][sec]; dbg.data[i * 4] = rgb[0] * 255; dbg.data[i * 4 + 1] = rgb[1] * 255; dbg.data[i * 4 + 2] = rgb[2] * 255; dbg.data[i * 4 + 3] = satin[i] ? 255 : 120; }
    g.putImageData(dbg, 0, 0); return c.toDataURL();
  }
  // the threads: fine noise smeared along each stitch (line integral convolution), staying in the same column
  const raw = new Float32Array(N);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) raw[i] = rnd() + rnd() + rnd() - 1.5;
  const grain = tune("grain", 1);
  if (grain > 1) { const r2 = raw.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = r2[Math.floor(y / grain) * w + Math.floor(x / grain)]; }
  const sm = blur(raw, w, h, 1);
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) noise[i] = (1 - tune("soft", 0.25)) * raw[i] + tune("soft", 0.25) * 1.6 * sm[i];
  const tex = new Float32Array(N), S = 18;
  let var_ = 0, nIn = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (lab[i] < 0) continue;
    const half = satin[i] ? Math.min(8 * pxMm, Math.max(2, cmin[i] * 0.6)) : 2 * pxMm;
    let acc = noise[i], n = 1;
    for (const sg of [1, -1]) {
      for (let j = 1; j <= S; j++) {
        const dd = (sg * half * j) / S, X = Math.round(x + dd * tx[i]), Y = Math.round(y + dd * ty[i]);
        if (X < 0 || Y < 0 || X >= w || Y >= h) break;
        const q = Y * w + X;
        if (lab[q] !== lab[i]) break;
        const dot = tx[q] * tx[i] + ty[q] * ty[i];
        if (2 * dot * dot - 1 < 0.6) break; // turned more than ~27°: another column
        acc += noise[q]; n++;
      }
    }
    tex[i] = acc / Math.sqrt(n); var_ += tex[i] * tex[i]; nIn++;
  }
  const sd = Math.sqrt(var_ / Math.max(1, nIn)) || 1;

  // raised edges (light from the top left) and the shadow under them
  const A = new Float32Array(N);
  for (let i = 0; i < N; i++) A[i] = d[i * 4 + 3] / 255;
  const rb = Math.max(1, Math.round(0.35 * pxMm)), Ab = blur(blur(A, w, h, rb), w, h, rb);
  const sheenRef = (-20 * Math.PI) / 180;
  const out = g.createImageData(w, h), q = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4, a = d[p + 3];
    if (a < 8) continue;
    const L = labAll[i], e = pal[L];
    // fine lettering (under ~2 mm) is a thin smooth satin line: little texture, no seams
    const thin = lab[i] >= 0 && cmin[i] < 2 * pxMm;
    const T = lab[i] >= 0 ? (tex[i] / sd) * (thin ? 0.3 : 1) : 0;
    let lit: number, round = 0.5;
    const th = Math.atan2(ty[i], tx[i]);
    const isSatin = lab[i] >= 0 && satin[i] === 1;
    const sheen = 1 + (isSatin ? tune("sheen", 0.05) : 0.02) * Math.cos(2 * (th - sheenRef));
    if (lab[i] < 0) lit = 0.82; // a soft edge pixel: the ragged end of a stitch
    else if (isSatin) {
      // the round of the column: gray at the edges, bright on top, the edge ragged thread by thread
      const ue = Math.min(1, Math.max(0, along[i] + tune("ragged", 0.04) * T));
      round = Math.max(0, Math.sin(Math.PI * ue));
      lit = (tune("edge", 0.78) + (1.04 - tune("edge", 0.78)) * Math.pow(round, 0.7)) * sheen * (1 + tune("tex", 0.03) * T);
    } else {
      // too wide for one stitch: a fill sewn the same way, rows of shorter stitches with staggered needle points
      const ct = tx[i], st = ty[i];
      const pu = (x * ct + y * st) / (3.5 * pxMm), row = Math.floor((-x * st + y * ct) / (0.45 * pxMm));
      const ph = (((pu + (((row % 4) + 4) % 4) * 0.25) % 1) + 1) % 1;
      const z = ((ph - 0.5) * 3.5 * pxMm) / 0.5, dot = Math.exp(-z * z);
      lit = 0.95 * sheen * (1 + 0.05 * T) * (1 - 0.18 * dot);
    }
    // a seam where the stitches turn: two columns meeting. The shorter stroke was sewn first and sits under the
    // longer one, so it takes a shadow along the join
    if (lab[i] >= 0 && !thin) {
      let seam = 0, under = 0;
      const rr = Math.max(1, Math.round(0.4 * pxMm));
      for (let v = -rr; v <= rr; v++) for (let u = -rr; u <= rr; u++) {
        const X = x + u, Y = y + v; if (X < 0 || X >= w || Y < 0 || Y >= h || (!u && !v)) continue;
        const j = Y * w + X; if (lab[j] !== lab[i]) continue;
        const dt = tx[j] * tx[i] + ty[j] * ty[i], agree = 2 * dt * dt - 1;
        if (agree > 0.55) continue;
        const near = 1 - Math.hypot(u, v) / (rr + 1);
        if (Math.abs(u) <= 1 && Math.abs(v) <= 1) seam = Math.max(seam, Math.min(1, (0.55 - agree) / 0.9));
        if (runLen[j] > runLen[i] * 1.1) under = Math.max(under, near);
      }
      lit *= (1 - tune("seam", 0.14) * seam) * (1 - tune("under", 0.14) * under);
    }
    // raised edges
    const off = rb, ix = Math.max(0, x - off), iy = Math.max(0, y - off), jx = Math.min(w - 1, x + off), jy = Math.min(h - 1, y + off);
    lit *= 1 + 0.2 * (Ab[iy * w + ix] - Ab[jy * w + jx]);
    // light threads keep room for the shading; dark ones still shine (a gray sheen along the top of each column)
    const lum = (e.r + e.g + e.b) / 3, kk = lum > 200 ? 0.9 : 1;
    const dark = (1 - lum / 255) ** 2;
    const gloss = (isSatin ? Math.pow(round, 1.5) : 0.5) * sheen * (1 + 0.3 * T);
    const add = Math.max(0, lit - 0.92) * 160 + dark * 30 * Math.min(2, Math.max(0, gloss));
    q[p] = Math.max(0, Math.min(255, e.r * kk * lit + add));
    q[p + 1] = Math.max(0, Math.min(255, e.g * kk * lit + add));
    q[p + 2] = Math.max(0, Math.min(255, e.b * kk * lit + add));
    q[p + 3] = a;
  }
  // a soft shadow where the stitches sit on the fabric, then the stitches
  const s = document.createElement("canvas"); s.width = w; s.height = h;
  s.getContext("2d")!.putImageData(out, 0, 0);
  const f = document.createElement("canvas"); f.width = w; f.height = h;
  const fg = f.getContext("2d")!;
  fg.filter = `drop-shadow(${(0.35 * pxMm + 1).toFixed(1)}px ${(0.5 * pxMm + 1).toFixed(1)}px ${(0.6 * pxMm + 1).toFixed(1)}px rgba(0,0,0,0.45))`;
  fg.drawImage(s, 0, 0);
  fg.filter = "none";
  return f.toDataURL("image/png");
}
