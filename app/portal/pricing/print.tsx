"use client";
/** Print or save the price list as a PDF (the browser's own print). */
export default function PrintButton() {
  return <button type="button" className="btn" onClick={() => window.print()}>Print or save PDF</button>;
}
