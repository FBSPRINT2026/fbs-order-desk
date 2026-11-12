import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFObject } from "pdf-lib";

/**
 * A customer's separation film printed only its crop marks (Nov 12, Nick, #40380 PyramidSeason9.ai: "all we get… is the
 * crop marks and screen information on the film, not the art itself"). Their films draw the art in a spot color named for
 * the plate ("Black", "PMS 321 C"…) and the marks in Registration ("All"). FilmMaker prints a film as one plate, so only
 * "All", which lands on every plate, came out. A film is one plate, so every spot color on it is put on every plate: each
 * Separation color space is renamed All, keeping its tints, so the art prints at its own strength in solid black like the
 * marks do. Any PDF film (an Illustrator .ai saved with PDF content is one) goes through this; other files go as sent.
 * Returns null when the file isn't a PDF or has nothing to change.
 */
export async function filmAsOnePlate(bytes: Uint8Array): Promise<Uint8Array | null> {
  // a PDF, or an .ai with its PDF inside (starts %PDF within the first KB)
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  if (!head.includes("%PDF")) return null;
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch { return null; }
  const all = PDFName.of("All"), sep = PDFName.of("Separation"), devN = PDFName.of("DeviceN");
  let n = 0;
  const seen = new Set<PDFObject>();
  const walk = (o: PDFObject | undefined): void => {
    if (!o || seen.has(o)) return;
    seen.add(o);
    if (o instanceof PDFRef) return walk(doc.context.lookup(o));
    if (o instanceof PDFArray) {
      const k = o.get(0);
      if (k === sep && o.get(1) instanceof PDFName && o.get(1) !== all && o.get(1) !== PDFName.of("None")) { o.set(1, all); n++; }
      // a DeviceN of one colorant is the same thing
      else if (k === devN && o.get(1) instanceof PDFArray && (o.get(1) as PDFArray).size() === 1) { const nm = (o.get(1) as PDFArray).get(0); if (nm !== all && nm !== PDFName.of("None")) { (o.get(1) as PDFArray).set(0, all); n++; } }
      for (let i = 0; i < o.size(); i++) walk(o.get(i));
      return;
    }
    if (o instanceof PDFDict) { for (const [, v] of o.entries()) walk(v); return; }
    if (o instanceof PDFStream) { for (const [, v] of o.dict.entries()) walk(v); }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) walk(obj);
  if (!n) return null;
  return await doc.save({ useObjectStreams: false });
}
