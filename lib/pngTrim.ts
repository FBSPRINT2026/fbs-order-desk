import { deflateSync, inflateSync } from "node:zlib";

/**
 * Crop a see-through PNG down to its art on the server (art that comes in by email, before it becomes a design).
 * A logo saved with empty see-through space around it would otherwise be sized by the whole canvas, so it hits the
 * 12" limit long before the art is the size it should be. No image library: PNG is zlib-compressed rows.
 *
 * Handles 8-bit RGBA, grey + alpha, and palette images with transparency (what logos are saved as). Anything else
 * (no transparency, 16-bit, interlaced, very large) comes back as null and the file is used as it is.
 * The crop keeps a 2 px edge; pixels under ~5% opacity count as empty. Nothing is cropped when there's under 3% to
 * gain on every side.
 */

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export type Trimmed = { buf: Buffer; w: number; h: number; box: { x: number; y: number; w: number; h: number }; of: { w: number; h: number } };

export function trimPng(src: Buffer, minAlpha = 12): Trimmed | null {
  if (src.length < 40 || !src.subarray(0, 8).equals(SIG)) return null;
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let plte: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p + 8 <= src.length) {
    const len = src.readUInt32BE(p), t = src.toString("ascii", p + 4, p + 8), d = src.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === "PLTE") plte = d;
    else if (t === "tRNS") trns = d;
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  const ch = type === 6 ? 4 : type === 4 ? 2 : type === 3 ? 1 : 0;
  const okDepth = depth === 8 || (type === 3 && [1, 2, 4].includes(depth));
  if (!w || !h || !okDepth || interlace || !ch || (type === 3 && (!plte || !trns)) || w * h > 40_000_000) return null;
  const raw = inflateSync(Buffer.concat(idat));
  // bytes per row and per pixel as stored (palettes can pack 2, 4 or 8 pixels in a byte)
  const stride = Math.ceil((w * ch * depth) / 8), bpp = Math.max(1, (ch * depth) / 8);
  const rows = Buffer.alloc(h * stride);
  // undo the per-row filters
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[o + x - bpp] : 0, b = y ? rows[o - stride + x] : 0, c = x >= bpp && y ? rows[o - stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      rows[o + x] = v & 0xff;
    }
  }
  // one byte per channel per pixel
  let px = rows;
  if (depth < 8) {
    px = Buffer.alloc(w * h);
    const per = 8 / depth, mask = (1 << depth) - 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (rows[y * stride + Math.floor(x / per)] >> (8 - depth * (1 + (x % per)))) & mask;
  }
  const alphaAt = type === 6 ? (i: number) => px[i * 4 + 3] : type === 4 ? (i: number) => px[i * 2 + 1] : (i: number) => (px[i] < trns!.length ? trns![px[i]] : 255);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alphaAt(y * w + x) >= minAlpha) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) return null;
  const pad = 2, bx = Math.max(0, x0 - pad), by = Math.max(0, y0 - pad), bw = Math.min(w - bx, x1 - x0 + 1 + pad * 2), bh = Math.min(h - by, y1 - y0 + 1 + pad * 2);
  if (bw >= w * 0.97 && bh >= h * 0.97) return null;
  // the cropped art, written back as 8-bit RGBA
  const out = Buffer.alloc(bh * (bw * 4 + 1));
  for (let y = 0; y < bh; y++) {
    const o = y * (bw * 4 + 1);
    out[o] = 0;
    for (let x = 0; x < bw; x++) {
      const i = (by + y) * w + (bx + x), q = o + 1 + x * 4;
      if (type === 6) px.copy(out, q, i * 4, i * 4 + 4);
      else if (type === 4) { out[q] = out[q + 1] = out[q + 2] = px[i * 2]; out[q + 3] = px[i * 2 + 1]; }
      else { const k = px[i]; out[q] = plte![k * 3]; out[q + 1] = plte![k * 3 + 1]; out[q + 2] = plte![k * 3 + 2]; out[q + 3] = k < trns!.length ? trns![k] : 255; }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(bw, 0); ihdr.writeUInt32BE(bh, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const buf = Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(out, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
  return { buf, w: bw, h: bh, box: { x: bx, y: by, w: bw, h: bh }, of: { w, h } };
}
