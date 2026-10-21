/**
 * A Photoshop file's picture, drawn in the browser (Oct 21, Nick: reorders of old Printavo jobs often have the art as
 * a .psd, "I can't figure out if it's a front or a back without the image"). A PSD carries a flattened copy of the
 * whole image (the "composite", there unless "maximize compatibility" was turned off) and a small preview (up to
 * 160 px). The composite is read here, only the rows needed for the size asked; else the preview.
 * Handles PSD and PSB, 8 and 16 bit, RGB, CMYK, grayscale, indexed and duotone; raw or RLE compressed.
 */
const MODE = { bitmap: 0, gray: 1, indexed: 2, rgb: 3, cmyk: 4, multi: 7, duotone: 8, lab: 9 };

export function isPsd(name: string, type = "") {
  return /\.(psd|psb)(\?|$)/i.test(name.split("?")[0]) || /photoshop/i.test(type);
}

/** the picture at most `width` px wide, or null when the file can't be read */
export async function psdPicture(buf: ArrayBuffer, width = 1400): Promise<HTMLCanvasElement | null> {
  const p = parsePsd(buf);
  if (!p) return null;
  const big = p.composite ? drawComposite(buf, p, width) : null;
  // a composite that's all white (saved without "maximize compatibility") or unreadable: the preview instead
  if (big && !blank(big)) return big;
  if (p.thumb) {
    try {
      const bmp = await createImageBitmap(new Blob([p.thumb.buffer as ArrayBuffer], { type: "image/jpeg" }));
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      return c;
    } catch { /* fall through */ }
  }
  return big;
}

type Parsed = { psb: boolean; channels: number; h: number; w: number; depth: number; mode: number; palette: Uint8Array | null; thumb: Uint8Array | null; composite: number | null };

export function parsePsd(buf: ArrayBuffer): Parsed | null {
  const dv = new DataView(buf), n = buf.byteLength;
  if (n < 34 || dv.getUint32(0) !== 0x38425053) return null; // "8BPS"
  const version = dv.getUint16(4);
  if (version !== 1 && version !== 2) return null;
  const psb = version === 2;
  const channels = dv.getUint16(12), h = dv.getUint32(14), w = dv.getUint32(18), depth = dv.getUint16(22), mode = dv.getUint16(24);
  let off = 26;
  const cmLen = dv.getUint32(off); off += 4;
  const palette = mode === MODE.indexed && cmLen >= 768 ? new Uint8Array(buf, off, 768) : null;
  off += cmLen;
  if (off + 4 > n) return null;
  // image resources: the preview is resource 1036 (1033 in very old files), a JPEG after a 28-byte header
  const irLen = dv.getUint32(off); off += 4;
  const irEnd = off + irLen;
  let thumb: Uint8Array | null = null;
  let r = off;
  while (r + 12 <= irEnd && r + 12 <= n) {
    if (dv.getUint32(r) !== 0x3842494d) break; // "8BIM"
    const id = dv.getUint16(r + 4);
    const nameLen = dv.getUint8(r + 6);
    let q = r + 6 + ((nameLen + 2) & ~1); // pascal string, padded to even
    const size = dv.getUint32(q); q += 4;
    if ((id === 1036 || id === 1033) && size > 28 && q + size <= n && dv.getUint32(q) === 1) thumb = new Uint8Array(buf.slice(q + 28, q + size));
    r = q + ((size + 1) & ~1);
  }
  off = irEnd;
  if (off + (psb ? 8 : 4) > n) return { psb, channels, h, w, depth, mode, palette, thumb, composite: null };
  // layers: skipped
  const lmLen = psb ? Number(dv.getBigUint64(off)) : dv.getUint32(off);
  off += (psb ? 8 : 4) + lmLen;
  const composite = off + 2 <= n ? off : null;
  return { psb, channels, h, w, depth, mode, palette, thumb, composite };
}

function drawComposite(buf: ArrayBuffer, p: Parsed, width: number): HTMLCanvasElement | null {
  const r = compositeRGBA(buf, p, width);
  if (!r) return null;
  const c = document.createElement("canvas"); c.width = r.W; c.height = r.H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(r.W, r.H); img.data.set(r.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** the flattened image as RGBA, at most `width` px wide */
export function compositeRGBA(buf: ArrayBuffer, p: Parsed, width: number): { W: number; H: number; data: Uint8ClampedArray } | null {
  try {
    const { w, h, depth, mode, channels } = p;
    if (!w || !h || (depth !== 8 && depth !== 16) || mode === MODE.bitmap || mode === MODE.lab) return null;
    const bytes = new Uint8Array(buf), dv = new DataView(buf);
    let off = p.composite!;
    const comp = dv.getUint16(off); off += 2;
    if (comp !== 0 && comp !== 1) return null; // zip: rare in the composite
    const bpc = depth / 8, rowLen = w * bpc;
    const k = Math.min(1, width / w);
    const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    const srcX = new Int32Array(W); for (let x = 0; x < W; x++) srcX[x] = Math.min(w - 1, Math.floor(x / k)) * bpc;
    const srcY = new Int32Array(H); for (let y = 0; y < H; y++) srcY[y] = Math.min(h - 1, Math.floor(y / k));
    const use = mode === MODE.rgb ? 3 : mode === MODE.cmyk ? 4 : 1;
    if (channels < use) return null;
    // where each channel's row starts (RLE: from the byte count table, so only the rows needed are unpacked)
    let rowAt: (c: number, y: number) => number, rowSize: (c: number, y: number) => number;
    if (comp === 0) {
      rowAt = (c, y) => off + (c * h + y) * rowLen;
      rowSize = () => rowLen;
    } else {
      const cw = p.psb ? 4 : 2, rows = channels * h;
      const counts = new Uint32Array(rows), starts = new Float64Array(rows);
      let at = off + rows * cw;
      for (let i = 0; i < rows; i++) { counts[i] = cw === 2 ? dv.getUint16(off + i * 2) : dv.getUint32(off + i * 4); starts[i] = at; at += counts[i]; }
      rowAt = (c, y) => starts[c * h + y];
      rowSize = (c, y) => counts[c * h + y];
    }
    const row = new Uint8Array(rowLen);
    const read = (c: number, y: number) => {
      const s = rowAt(c, y), len = rowSize(c, y);
      if (s + len > bytes.length) { row.fill(comp === 0 ? 255 : 0); return; }
      if (comp === 0) { row.set(bytes.subarray(s, s + rowLen)); return; }
      // PackBits
      let i = s, o = 0; const e = s + len;
      while (i < e && o < rowLen) {
        const b = bytes[i++];
        if (b < 128) { const m = Math.min(b + 1, rowLen - o); row.set(bytes.subarray(i, i + m), o); i += b + 1; o += m; }
        else if (b > 128) { const m = Math.min(257 - b, rowLen - o); row.fill(bytes[i++], o, o + m); o += m; }
        else i++; // 128: no-op
      }
      if (o < rowLen) row.fill(0, o);
    };
    const d = new Uint8ClampedArray(W * H * 4);
    const plane = Array.from({ length: use }, () => new Uint8Array(W));
    for (let y = 0; y < H; y++) {
      for (let ch = 0; ch < use; ch++) { read(ch, srcY[y]); const pl = plane[ch]; for (let x = 0; x < W; x++) pl[x] = row[srcX[x]]; }
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        if (mode === MODE.rgb) { d[o] = plane[0][x]; d[o + 1] = plane[1][x]; d[o + 2] = plane[2][x]; }
        else if (mode === MODE.cmyk) {
          // stored inverted: 255 = no ink
          const K = plane[3][x];
          d[o] = (plane[0][x] * K) / 255; d[o + 1] = (plane[1][x] * K) / 255; d[o + 2] = (plane[2][x] * K) / 255;
        } else if (mode === MODE.indexed && p.palette) {
          const v = plane[0][x]; d[o] = p.palette[v]; d[o + 1] = p.palette[256 + v]; d[o + 2] = p.palette[512 + v];
        } else { const v = plane[0][x]; d[o] = v; d[o + 1] = v; d[o + 2] = v; }
        d[o + 3] = 255;
      }
    }
    return { W, H, data: d };
  } catch { return null; }
}

/** nearly every pixel white: Photoshop's stand-in when the flattened copy wasn't saved */
function blank(c: HTMLCanvasElement) {
  const s = 64, t = document.createElement("canvas"); t.width = s; t.height = s;
  const x = t.getContext("2d")!; x.drawImage(c, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let ink = 0; for (let i = 0; i < d.length; i += 4) if (Math.min(d[i], d[i + 1], d[i + 2]) < 245) ink++;
  return ink < s * s * 0.002;
}
