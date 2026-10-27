import type { DstInfo } from "@/lib/dst";

/**
 * A DST drawn thread by thread (Oct 27, Nick: "treat every connection point as a thread with shading… a more visual
 * mockup… it should be similar to the logo the way it appears on [Wilcom's worksheet]"). Every stitch, needle hole to
 * needle hole, is its own piece of thread in the order the machine sews it: about 0.45 mm wide lying flat, rounded
 * across, darker at both holes where it dives into the fabric and lit in the middle, with a fine fiber grain; later
 * stitches lie over earlier ones.
 *
 * Jump stitches are left out (Nick: "between the S and the H, there's a little stitch. That's called a jump stitch. We
 * either cut that out… or… use a black Sharpie to cover that up… you wouldn't need the jump stitch between letters"):
 * a stitch that isn't a satin zigzag and that, once left out, leaves its two ends in different parts of the design.
 */
export type Seg = { x0: number; y0: number; x1: number; y1: number; block: number };

/** the needle-to-needle stitches (a jump lifts the needle: no thread drawn across it) */
export function stitchesOf(info: DstInfo): Seg[] {
  const out: Seg[] = [];
  info.blocks.forEach((b, bi) => {
    let prev: { x: number; y: number } | null = null;
    for (const p of b) {
      if (p.jump) { prev = null; continue; }
      if (prev && (prev.x !== p.x || prev.y !== p.y)) out.push({ x0: prev.x, y0: prev.y, x1: p.x, y1: p.y, block: bi });
      prev = p;
    }
  });
  return out;
}

const heading = (s: Seg) => Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
const turn = (a: number, b: number) => Math.abs(((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);

/** the jump stitches between parts (indexes into the stitches) */
export function jumpStitches(segs: Seg[], r = 2.3): Set<number> {
  const n = segs.length;
  if (n < 3) return new Set();
  const hd = segs.map(heading);
  // candidates: 0.5 mm or longer and not a satin stitch (a satin stitch's neighbors turn back across it)
  const cand: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = segs[i];
    if (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) < 5) continue;
    const satin = (i === 0 || turn(hd[i], hd[i - 1]) > 2.0) && (i === n - 1 || turn(hd[i], hd[i + 1]) > 2.0);
    if (!satin) cand.push(i);
  }
  if (!cand.length) return new Set();
  // the design's parts without them: drawn small, then the connected areas labelled
  const xs = segs.flatMap((s) => [s.x0, s.x1]), ys = segs.flatMap((s) => [s.y0, s.y1]);
  const minX = Math.min(...xs) - 10, minY = Math.min(...ys) - 10, k = 2;
  const W = Math.ceil((Math.max(...xs) - minX + 10) * k), H = Math.ceil((Math.max(...ys) - minY + 10) * k);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.strokeStyle = "#000"; g.lineWidth = Math.max(1, Math.floor(r * 2 * k)); g.lineCap = "butt";
  const skip = new Set(cand);
  g.beginPath();
  segs.forEach((s, i) => { if (skip.has(i)) return; g.moveTo((s.x0 - minX) * k, (s.y0 - minY) * k); g.lineTo((s.x1 - minX) * k, (s.y1 - minY) * k); });
  g.stroke();
  const a = g.getImageData(0, 0, W, H).data;
  const lab = new Int32Array(W * H);
  let next = 0;
  const stack: number[] = [];
  for (let p = 0; p < W * H; p++) {
    if (lab[p] || a[p * 4 + 3] < 128) continue;
    next++; lab[p] = next; stack.push(p);
    while (stack.length) {
      const q = stack.pop()!, x = q % W, y = (q - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const o = ny * W + nx;
        if (!lab[o] && a[o * 4 + 3] >= 128) { lab[o] = next; stack.push(o); }
      }
    }
  }
  const part = (x: number, y: number) => {
    const cx = Math.round((x - minX) * k), cy = Math.round((y - minY) * k), seen = new Map<number, number>();
    for (let yy = cy - 3; yy <= cy + 3; yy++) for (let xx = cx - 3; xx <= cx + 3; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const v = lab[yy * W + xx]; if (v) seen.set(v, (seen.get(v) || 0) + 1);
    }
    let best = 0, bn = 0; for (const [v, m] of seen) if (m > bn) { best = v; bn = m; }
    return best;
  };
  const out = new Set<number>();
  for (const i of cand) { const s = segs[i], p = part(s.x0, s.y0), q = part(s.x1, s.y1); if (p && q && p !== q) out.add(i); }
  return out;
}

const rgb = (h: string): [number, number, number] => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0x333333; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
/** a small steady random (the same picture every time) */
const rand = (seed: number) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/**
 * The picture. colors: each color block's thread (hex), in sewing order. fabric: the garment's color behind it, or "" to
 * leave it see-through. width: the picture's width in pixels.
 */
export function renderThreads(info: DstInfo, colors: string[], opts: { width?: number; fabric?: string; trimJumps?: boolean; pad?: number } = {}): HTMLCanvasElement {
  let segs = stitchesOf(info);
  const hidden = opts.trimJumps === false ? new Set<number>() : jumpStitches(segs);
  segs = segs.filter((_, i) => !hidden.has(i));
  const c = document.createElement("canvas");
  if (!segs.length) { c.width = c.height = 1; return c; }
  const xs = segs.flatMap((s) => [s.x0, s.x1]), ys = segs.flatMap((s) => [s.y0, s.y1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const Wt = Math.max(60, Math.round(opts.width || 600)), pad = opts.pad ?? Math.round(Wt * 0.03);
  const sc = (Wt - 2 * pad) / Math.max(1, maxX - minX); // px per 0.1 mm
  const W = Math.ceil((maxX - minX) * sc) + 2 * pad, H = Math.ceil((maxY - minY) * sc) + 2 * pad;
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H), d = img.data;
  // what's under the thread: the fabric with a fine knit (or nothing)
  const fab = opts.fabric ? rgb(opts.fabric) : null;
  const rnd = rand(7);
  const col = new Float32Array(W * H * 3), al = new Float32Array(W * H);
  const r = 2.3 * sc; // a 40 wt thread lying flat: ~0.45 mm
  const L = [-0.45, -0.55, 0.7], ln0 = Math.hypot(L[0], L[1], L[2]); L[0] /= ln0; L[1] /= ln0; L[2] /= ln0;
  const Hv = [L[0], L[1], L[2] + 1], hn = Math.hypot(Hv[0], Hv[1], Hv[2]); Hv[0] /= hn; Hv[1] /= hn; Hv[2] /= hn;
  const bases = info.blocks.map((_, i) => rgb(colors[i % Math.max(1, colors.length)] || "#2a2a2a"));
  for (const s of segs) {
    const ax = (s.x0 - minX) * sc + pad, ay = (s.y0 - minY) * sc + pad, bx = (s.x1 - minX) * sc + pad, by = (s.y1 - minY) * sc + pad;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const tx = dx / len, ty = dy / len, base = bases[s.block] || bases[0], ph = rnd() * 6.28;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 2)), i1 = Math.min(W, Math.ceil(Math.max(ax, bx) + r + 2));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 2)), j1 = Math.min(H, Math.ceil(Math.max(ay, by) + r + 2));
    for (let y = j0; y < j1; y++) for (let x = i0; x < i1; x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t0 = px * tx + py * ty, t = Math.min(len, Math.max(0, t0));
      const endf = Math.min(t, len - t) / Math.max(r * 1.5, 1e-6);
      const rr = r * (0.86 + 0.14 * Math.min(1, endf));
      const ex = px - t * tx, ey = py - t * ty, dist = Math.hypot(ex, ey) / rr;
      if (dist >= 1 || t0 < -0.35 * rr || t0 > len + 0.35 * rr) continue;
      // the thread's surface: rounded across, flattened where it lies on the fabric, dipping at the needle holes
      const sAcross = Math.max(-0.999, Math.min(0.999, (px * ty - py * tx) / rr));
      const nz = Math.pow(Math.sqrt(1 - sAcross * sAcross), 0.35);
      const tilt = Math.max(0, 1 - endf) * 0.35 * Math.sign(t - len / 2);
      let nx = ty * sAcross + tx * tilt, ny = -tx * sAcross + ty * tilt, nzz = nz; const nl = Math.hypot(nx, ny, nzz); nx /= nl; ny /= nl; nzz /= nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nzz * L[2]);
      const spec = Math.pow(Math.max(0, nx * Hv[0] + ny * Hv[1] + nzz * Hv[2]), 14);
      const fib = 0.07 * Math.sin(sAcross * 9 + ph) + 0.04 * Math.sin(sAcross * 21 + ph * 2) + (rnd() - 0.5) * 0.08;
      const along = 0.66 + 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t / len))), 0.6);
      const shade = (0.9 + 0.14 * diff + fib) * along;
      const a = Math.max(0, Math.min(1, (1 - dist) * rr));
      const p = y * W + x;
      for (let k = 0; k < 3; k++) col[p * 3 + k] = Math.min(1, base[k] * shade + 0.12 * spec) * a + col[p * 3 + k] * (1 - a);
      al[p] = a + al[p] * (1 - a);
    }
  }
  // a soft shadow of the thread on the fabric (down and to the right)
  const sh = new Float32Array(W * H), off = Math.max(1, Math.round(sc * 0.5)), rad = Math.max(1, Math.round(sc * 0.9));
  if (fab) {
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { let acc = 0; for (let x = -rad; x < W + rad; x++) { if (x + rad < W) acc += al[y * W + x + rad]; if (x - rad - 1 >= 0) acc -= al[y * W + x - rad - 1]; if (x >= 0 && x < W) tmp[y * W + x] = acc / (2 * rad + 1); } }
    for (let x = 0; x < W; x++) { let acc = 0; for (let y = -rad; y < H + rad; y++) { if (y + rad < H) acc += tmp[(y + rad) * W + x]; if (y - rad - 1 >= 0) acc -= tmp[(y - rad - 1) * W + x]; if (y >= 0 && y < H) { const yy = y + off, xx = x + off; if (yy < H && xx < W) sh[yy * W + xx] = acc / (2 * rad + 1); } } }
  }
  for (let p = 0, y = 0; y < H; y++) for (let x = 0; x < W; x++, p++) {
    const a = al[p];
    let fr = 0, fg = 0, fb = 0, fa = 0;
    if (fab) {
      const knit = 0.035 * Math.sin((x * 2 * Math.PI) / (sc * 7)) * Math.sin((y * 2 * Math.PI) / (sc * 9)) + (rnd() - 0.5) * 0.04;
      const k = (1 + knit) * (1 - 0.28 * sh[p]);
      fr = fab[0] * k; fg = fab[1] * k; fb = fab[2] * k; fa = 1;
    }
    const cr = a > 0 ? col[p * 3] / a : 0, cg = a > 0 ? col[p * 3 + 1] / a : 0, cb = a > 0 ? col[p * 3 + 2] / a : 0;
    const oa = a + fa * (1 - a);
    d[p * 4] = Math.round(255 * Math.min(1, oa ? (cr * a + fr * fa * (1 - a)) / oa : 0));
    d[p * 4 + 1] = Math.round(255 * Math.min(1, oa ? (cg * a + fg * fa * (1 - a)) / oa : 0));
    d[p * 4 + 2] = Math.round(255 * Math.min(1, oa ? (cb * a + fb * fa * (1 - a)) / oa : 0));
    d[p * 4 + 3] = Math.round(255 * oa);
  }
  g.putImageData(img, 0, 0);
  return c;
}
