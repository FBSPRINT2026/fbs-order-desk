"use client";
import { useSearchParams } from "next/navigation";

/** Print or save the price list as a PDF: opens the one-page contract price sheet (app/print/pricing) and its print dialog */
export default function PrintButton() {
  const sp = useSearchParams();
  const as = sp?.get("as");
  return <a className="btn" href={`/print/pricing?print=1${as ? `&as=${encodeURIComponent(as)}` : ""}`} target="_blank" rel="noreferrer">Print or save PDF</a>;
}
