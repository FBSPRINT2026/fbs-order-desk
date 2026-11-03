"use client";
import { useEffect } from "react";

/** the sheet's own Print button (hidden on paper), and opening the print dialog when asked (?print=1) */
export default function SheetPrint({ auto }: { auto: boolean }) {
  useEffect(() => { if (auto) { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t); } }, [auto]);
  return <div className="pls-bar"><button type="button" className="btn primary" onClick={() => window.print()}>Print or save PDF</button></div>;
}
