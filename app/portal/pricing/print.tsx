"use client";
import { useSearchParams } from "next/navigation";

/** Save the price list as a PDF: opens the contract price sheet (app/print/pricing), which downloads it as one long page */
export default function PrintButton() {
  const sp = useSearchParams();
  const as = sp?.get("as");
  return <a className="btn" href={`/print/pricing?save=1${as ? `&as=${encodeURIComponent(as)}` : ""}`} target="_blank" rel="noreferrer">Save PDF</a>;
}
