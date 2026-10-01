/**
 * A PDF of full-page pictures (one JPEG per page), written by hand (no library): what the Mockup Creator's
 * "Export PDF" sends the customer. Each page is drawn on a canvas first, so the PDF looks exactly like the screen.
 */
const enc = new TextEncoder();
const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?");

export type PdfPage = { jpeg: Uint8Array; px: number; py: number; /** page size in points (72 = 1") */ w: number; h: number };

export function imagePdf(pages: PdfPage[], title = "Mockup"): Uint8Array {
  const parts: Uint8Array[] = [], offsets: number[] = []; let pos = 0;
  const push = (x: Uint8Array | string) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n: number, body: (Uint8Array | string)[]) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of body) push(b); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1 catalog, 2 pages, then 3 objects a page (page, content, image)
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  pages.forEach((p, i) => {
    const n = 3 + i * 3, c = enc.encode(`q ${p.w} 0 0 ${p.h} 0 0 cm /Im0 Do Q\n`);
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${c.length} >>\nstream\n`, c, "\nendstream"]);
    obj(n + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.px} /Height ${p.py} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, "\nendstream"]);
  });
  const xref = pos, count = 3 + pages.length * 3;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) x += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${esc(title)}) /Creator (FBS Print Mockup Creator) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

/** a canvas as a PDF page (JPEG) of `w` × `h` points */
export async function canvasPage(c: HTMLCanvasElement, w: number, h: number, quality = 0.92): Promise<PdfPage> {
  const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/jpeg", quality));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), px: c.width, py: c.height, w, h };
}
