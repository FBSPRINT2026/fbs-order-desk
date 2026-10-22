/**
 * How a file opens in the browser (Oct 21, Nick: "why I can't open this AI file from my email?"). Illustrator files are
 * almost always saved PDF-compatible: their bytes start with %PDF. A phone can't show "application/postscript", but it
 * can show a PDF, so those open as a PDF preview. Pictures and PDFs open in the browser; anything else downloads.
 */
export function fileHeaders(bytes: Uint8Array, name: string, type: string, cache = "private, no-store"): Record<string, string> {
  const pdfInside = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  const t = pdfInside ? "application/pdf" : type || "application/octet-stream";
  const inline = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)/i.test(t);
  const safe = name.replace(/["\\\r\n]/g, "_");
  return { "Content-Type": t, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
}
