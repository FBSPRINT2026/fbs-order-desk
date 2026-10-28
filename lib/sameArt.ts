"use client";
import { sameArtCandidates, saveArtHashes, type ArtCandidate } from "@/app/same-art-actions";

/**
 * Same art, uploaded again (Oct 24, Nick: "if a customer uploads a logo, the same art, same name… hey, we've already
 * got this. This seems to be the same file. Is this different than D10201? Or would you like to use that instead?").
 * Each logo gets a fingerprint of how it looks (artHash below); two logos close enough by artDistance look the same. A logo with the same name is asked about too. The question shows in <SameArtPrompt/>.
 */
/**
 * The fingerprint (v2, Oct 28: Nick showed the ShipStation Global logo matched to MEI SMM; the old 9×8 gray hash made
 * every wide logo on white look alike). Now: the art is cropped to its ink first, then a 17×16 difference hash
 * (256 bits) of its shape, plus its shape's width : height and its ink color. Written as "2" + ratio×100 (3 hex) +
 * ink color (6 hex) + 64 hex. Old 16-hex fingerprints are worked out again the new way.
 */
export async function artHash(src: Blob | string): Promise<string | null> {
  try {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const im = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => no(new Error("img")); i.src = url; });
    if (typeof src !== "string") URL.revokeObjectURL(url);
    // 1) the art on white at up to 300px, and where its ink is (not white, not see-through)
    const W0 = im.naturalWidth || 1, H0 = im.naturalHeight || 1, k = Math.min(1, 300 / Math.max(W0, H0));
    const bw = Math.max(1, Math.round(W0 * k)), bh = Math.max(1, Math.round(H0 * k));
    const b = document.createElement("canvas"); b.width = bw; b.height = bh;
    const bx = b.getContext("2d", { willReadFrequently: true }); if (!bx) return null;
    bx.fillStyle = "#fff"; bx.fillRect(0, 0, bw, bh); bx.drawImage(im, 0, 0, bw, bh);
    const px = bx.getImageData(0, 0, bw, bh).data;
    let x0 = bw, y0 = bh, x1 = -1, y1 = -1, n = 0, sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y * bw + x) * 4, r = px[i], g = px[i + 1], bl = px[i + 2];
      if (r > 235 && g > 235 && bl > 235) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++; sr += r; sg += g; sb += bl;
    }
    if (!n) return null; // a blank picture tells us nothing
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    // 2) the cropped ink at 17×16, its own shape centered
    const c = document.createElement("canvas"); c.width = 17; c.height = 16;
    const x = c.getContext("2d", { willReadFrequently: true }); if (!x) return null;
    x.fillStyle = "#fff"; x.fillRect(0, 0, 17, 16);
    const r = Math.min(17 / cw, 16 / ch), w = cw * r, h = ch * r;
    x.drawImage(b, x0, y0, cw, ch, (17 - w) / 2, (16 - h) / 2, w, h);
    const d = x.getImageData(0, 0, 17, 16).data;
    const gr = (qx: number, qy: number) => { const i = (qy * 17 + qx) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
    let bits = "";
    for (let qy = 0; qy < 16; qy++) for (let qx = 0; qx < 16; qx++) bits += gr(qx, qy) > gr(qx + 1, qy) + 2 ? "1" : "0";
    let hex = ""; for (let i = 0; i < 256; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    const ratio = Math.min(4095, Math.round((cw / ch) * 100)).toString(16).padStart(3, "0");
    const ink = [sr, sg, sb].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
    return `2${ratio}${ink}${hex}`;
  } catch { return null; }
}
export const isArtHash = (h: string) => /^2[0-9a-f]{73}$/.test(h);
type Print = { ratio: number; ink: number[]; bits: string };
const read = (h: string): Print => ({ ratio: parseInt(h.slice(1, 4), 16) / 100, ink: [4, 6, 8].map((i) => parseInt(h.slice(i, i + 2), 16)), bits: h.slice(10) });
const bitsOff = (a: string, b: string) => { let n = 0; for (let i = 0; i < a.length; i++) { let v = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (v) { n += v & 1; v >>= 1; } } return n; };
const bitsOr = (a: string, b: string) => { let n = 0; for (let i = 0; i < a.length; i++) { let v = parseInt(a[i], 16) | parseInt(b[i], 16); while (v) { n += v & 1; v >>= 1; } } return n; };
/** how far apart two logos look (0 = the same), or null when they plainly aren't the same logo */
export function artDistance(a: string, b: string): number | null {
  if (!isArtHash(a) || !isArtHash(b)) return null;
  const p = read(a), q = read(b);
  if (Math.abs(Math.log((p.ratio || 0.01) / (q.ratio || 0.01))) > 0.12) return null; // a different shape
  // of the edges either logo has, how many don't line up (0 = all; tested on Cedar Promos' logos Oct 28: the same art
  // came out 0–0.11, different logos of the same shape 0.56 and up)
  const off = bitsOff(p.bits, q.bits), any = bitsOr(p.bits, q.bits);
  if (any < 8) return null; // too little to go on
  const miss = off / any;
  const inkOff = Math.hypot(p.ink[0] - q.ink[0], p.ink[1] - q.ink[1], p.ink[2] - q.ink[2]);
  // the same art in other colors (a white or one-color version) still asks, but its shape has to match closer
  return miss <= (inkOff < 70 ? 0.3 : 0.18) ? Math.round(miss * 100) : null;
}

export type SameArtMatch = { cand: ArtCandidate; why: "looks" | "name"; /** the same art in other colors: it can be added as a colorway */ recolor?: boolean };
/** what they said: use the one on file, add it as a colorway of it, or keep it as a new logo */
export type SameArtChoice = "use" | "colorway" | "new";
/** the two inks far apart (the art's average ink color) */
export function inkDiffers(a: string, b: string): boolean {
  if (!isArtHash(a) || !isArtHash(b)) return false;
  const p = read(a).ink, q = read(b).ink;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= 70;
}
type Ask = { match: SameArtMatch; fileName: string; preview: string; colorways: boolean; resolve: (c: SameArtChoice) => void };
const listeners = new Set<(a: Ask) => void>();
export function onSameArt(f: (a: Ask) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/**
 * Before a logo is saved: is it one they already have? Returns the logo to use instead (they said so), or null to go
 * ahead, plus this file's fingerprint to keep with the new logo.
 */
export async function checkSameArt(file: File, look: Blob | null, name: string, customerId?: string, o: { colorways?: boolean } = {}): Promise<{ use: ArtCandidate | null; hash: string | null; colorwayOf?: ArtCandidate }> {
  const hash = look ? await artHash(look) : null;
  if (!listeners.size) return { use: null, hash };
  const cands = await sameArtCandidates(customerId).catch(() => [] as ArtCandidate[]);
  if (!cands.length) return { use: null, hash };
  // logos without a fingerprint yet get one now (and keep it)
  const fresh: { id: string; hash: string }[] = [];
  await Promise.all(cands.filter((c) => !(c.art_hash && isArtHash(c.art_hash)) && c.url).slice(0, 80).map(async (c) => { const h = await artHash(c.url); if (h) { c.art_hash = h; fresh.push({ id: c.id, hash: h }); } }));
  if (fresh.length) void saveArtHashes(fresh, customerId);
  const nm = name.trim().toLowerCase().replace(/[_\s-]+/g, " ");
  let best: SameArtMatch | null = null, bestD = 99;
  if (hash) for (const c of cands) if (c.art_hash) { const dd = artDistance(hash, c.art_hash); if (dd !== null && dd < bestD) { bestD = dd; best = { cand: c, why: "looks", recolor: inkDiffers(hash, c.art_hash) }; } }
  if (!best && nm) { const c = cands.find((z) => z.name.trim().toLowerCase().replace(/[_\s-]+/g, " ") === nm); if (c) best = { cand: c, why: "name" }; }
  if (!best) return { use: null, hash };
  const preview = look ? URL.createObjectURL(look) : "";
  const choice = await new Promise<SameArtChoice>((resolve) => { listeners.forEach((f) => f({ match: best!, fileName: file.name, preview, colorways: !!o.colorways, resolve })); });
  return { use: choice === "use" ? best.cand : null, hash, ...(choice === "colorway" ? { colorwayOf: best.cand } : {}) };
}
