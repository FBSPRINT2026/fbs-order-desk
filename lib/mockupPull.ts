"use client";
import { artFromDrawnMockup, artFromMockupPdf, firstPageIn, pdfPicture, type ArtPiece } from "@/lib/printavoArt";

/**
 * Art that came already on a garment: the Mockup Creator's Helper, for every place an order is made (Oct 22, Nick:
 * "anytime you see a shirt, an image, a mockup… when it's on a person, when it's on a physical mockup and it's not our
 * mockup, or it is our mockup… on a customer's own software… you've got to go in and use the helper and pull it out";
 * McKenna's HUD 102026.ai, a man in the red tee, became the logo as it was: 10 colors). Before any file becomes a
 * print's logo: is the art on a shirt? Then the art comes off it (front and back, with its size and drop), and the
 * file itself is kept as their mockup.
 *
 * Reads PDFs and Illustrator files (saved PDF-compatible), the same two ways the Helper does: art over shirt photos
 * (ours or theirs, a person wearing it, our blank templates) and shirts drawn flat (a customer's design software).
 * null: no shirt on it, it's the art as is. A JPG/PNG photo has the art flattened into it and can't be pulled apart.
 */
export type Pulled = { kind: "photos" | "drawn"; pieces: ArtPiece[] };

/** a file named or read as a mockup / proof / layout (the drawn-shirt reader is only tried on these) */
export const mockupNamed = (name: string) => /mock|proof|layout|sheet|template|visual|draft/i.test(name);
export const pdfLike = (f: { name: string; type?: string }) => /\.(pdf|ai)$/i.test(f.name) || /pdf|postscript|illustrator/i.test(f.type || "");

export async function pullOffMockup(file: Blob, name: string, opt: { /** read shirts drawn flat too: only for a file known to be a mockup (a plain logo's big shapes could pass for shirts) */ drawn?: boolean } = { drawn: true }): Promise<Pulled | null> {
  if (!pdfLike({ name, type: file.type })) return null;
  const buf = await file.arrayBuffer();
  // a logo on its own artboard (Oct 23, McKenna's HUD 102026.ai: 2.2" × 3.2", the logo as one picture) isn't a mockup:
  // no shirt to pull it off, it's the art as is
  const pg = await firstPageIn(buf.slice(0)).catch(() => null);
  if (pg && Math.max(pg.w, pg.h) < 5) return null;
  const base = name.replace(/\.(pdf|ai)$/i, "").replace(/[ _-]*mock-?up$/i, "").replace(/_/g, " ").trim() || "Art";
  const photos = await artFromMockupPdf(buf.slice(0), base, { mergeIn: 1 }).catch(() => [] as ArtPiece[]);
  if (photos.length && opt.drawn === false) return { kind: "photos", pieces: photos };
  // a side the pictures didn't cover is read as drawn art too (Oct 23, All Star #34528: the front crest is a placed
  // picture, the back is drawn in navy on page 2; only the front came off and the order stopped to ask)
  if (photos.length) {
    const have = new Set(photos.map((x) => x.side));
    if (have.has("front") && have.has("back")) return { kind: "photos", pieces: photos };
    const more = await artFromDrawnMockup(buf.slice(0), base).catch(() => [] as ArtPiece[]);
    return { kind: "photos", pieces: [...photos, ...more.filter((x) => !have.has(x.side))] };
  }
  if (opt.drawn === false) return null;
  const drawn = await artFromDrawnMockup(buf.slice(0), base).catch(() => [] as ArtPiece[]);
  if (drawn.length) return { kind: "drawn", pieces: drawn };
  return null;
}

/** the piece for a print at this location: its side, the biggest one first, not one used already */
export function pieceFor(p: Pulled, location: string, used: Set<ArtPiece> = new Set()): ArtPiece | undefined {
  const side = /back|yoke|shoulder|nape/i.test(location) ? "back" : "front";
  return p.pieces.filter((x) => !used.has(x) && x.side === side).sort((a, b) => b.widthIn * b.heightIn - a.widthIn * a.heightIn)[0];
}

/** where a pulled print goes: by its side, size and how far off center it sat (the Helper's own rule) */
export const locOfPiece = (pc: Pick<ArtPiece, "side" | "widthIn" | "dropIn" | "offIn">) => pc.side === "back"
  ? (pc.widthIn <= 4.5 && pc.dropIn < 3.5 ? "Upper Back (Yoke)" : pc.widthIn <= 8 ? "Medium Back" : "Full Back")
  : pc.widthIn > 8 ? "Full Front" : pc.widthIn > 5 ? "Medium Front" : Math.abs(pc.offIn) >= 1.75 ? (pc.offIn > 0 ? "Left Chest" : "Right Chest") : "Center Chest";

/** a picture of the file's first page (to show next to what was pulled) */
export async function pagePicture(file: Blob): Promise<Blob | null> {
  try {
    const c = await pdfPicture(await file.arrayBuffer(), 700);
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), "image/png"));
  } catch { return null; }
}
