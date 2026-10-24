"use client";
import { sameArtCandidates, saveArtHashes, type ArtCandidate } from "@/app/same-art-actions";

/**
 * Same art, uploaded again (Oct 24, Nick: "if a customer uploads a logo, the same art, same name… hey, we've already
 * got this. This seems to be the same file. Is this different than D10201? Or would you like to use that instead?").
 * Each logo gets a 64-bit difference hash of how it looks (on white, 9×8 gray); two logos whose hashes differ in 6 bits
 * or fewer look the same. A logo with the same name is asked about too. The question shows in <SameArtPrompt/>.
 */
export async function artHash(src: Blob | string): Promise<string | null> {
  try {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const im = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => no(new Error("img")); i.src = url; });
    if (typeof src !== "string") URL.revokeObjectURL(url);
    const c = document.createElement("canvas"); c.width = 9; c.height = 8;
    const x = c.getContext("2d", { willReadFrequently: true }); if (!x) return null;
    x.fillStyle = "#fff"; x.fillRect(0, 0, 9, 8);
    // fit the art into the box the same way every time (its own shape, centered)
    const r = Math.min(9 / (im.naturalWidth || 1), 8 / (im.naturalHeight || 1)), w = im.naturalWidth * r, h = im.naturalHeight * r;
    x.drawImage(im, (9 - w) / 2, (8 - h) / 2, w, h);
    const d = x.getImageData(0, 0, 9, 8).data;
    const g = (px: number, py: number) => { const i = (py * 9 + px) * 4; return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; };
    let bits = "";
    for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) bits += g(px, py) > g(px + 1, py) ? "1" : "0";
    let hex = ""; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    // a blank picture (all white) tells us nothing
    return /^0+$/.test(hex) ? null : hex;
  } catch { return null; }
}
const bitsOff = (a: string, b: string) => { let n = 0; for (let i = 0; i < 16; i++) { let v = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (v) { n += v & 1; v >>= 1; } } return n; };

export type SameArtMatch = { cand: ArtCandidate; why: "looks" | "name" };
type Ask = { match: SameArtMatch; fileName: string; preview: string; resolve: (use: boolean) => void };
const listeners = new Set<(a: Ask) => void>();
export function onSameArt(f: (a: Ask) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/**
 * Before a logo is saved: is it one they already have? Returns the logo to use instead (they said so), or null to go
 * ahead, plus this file's fingerprint to keep with the new logo.
 */
export async function checkSameArt(file: File, look: Blob | null, name: string, customerId?: string): Promise<{ use: ArtCandidate | null; hash: string | null }> {
  const hash = look ? await artHash(look) : null;
  if (!listeners.size) return { use: null, hash };
  const cands = await sameArtCandidates(customerId).catch(() => [] as ArtCandidate[]);
  if (!cands.length) return { use: null, hash };
  // logos without a fingerprint yet get one now (and keep it)
  const fresh: { id: string; hash: string }[] = [];
  await Promise.all(cands.filter((c) => !c.art_hash && c.url).slice(0, 40).map(async (c) => { const h = await artHash(c.url); if (h) { c.art_hash = h; fresh.push({ id: c.id, hash: h }); } }));
  if (fresh.length) void saveArtHashes(fresh, customerId);
  const nm = name.trim().toLowerCase().replace(/[_\s-]+/g, " ");
  let best: SameArtMatch | null = null, bestD = 99;
  if (hash) for (const c of cands) if (c.art_hash) { const dd = bitsOff(hash, c.art_hash); if (dd <= 6 && dd < bestD) { bestD = dd; best = { cand: c, why: "looks" }; } }
  if (!best && nm) { const c = cands.find((z) => z.name.trim().toLowerCase().replace(/[_\s-]+/g, " ") === nm); if (c) best = { cand: c, why: "name" }; }
  if (!best) return { use: null, hash };
  const preview = look ? URL.createObjectURL(look) : "";
  const use = await new Promise<boolean>((resolve) => { listeners.forEach((f) => f({ match: best!, fileName: file.name, preview, resolve })); });
  return { use: use ? best.cand : null, hash };
}
