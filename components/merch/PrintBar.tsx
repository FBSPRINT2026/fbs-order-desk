"use client";
import { useEffect } from "react";

/** The print pages' top bar (hidden on paper); opens the print dialog once the page is up. */
export default function PrintBar({ title, hint }: { title: string; hint: string }) {
  useEffect(() => { const t = setTimeout(() => window.print(), 600); return () => clearTimeout(t); }, []);
  return (
    <div className="mp-bar">
      <b>{title}</b><span>{hint}</span>
      <button type="button" onClick={() => window.print()}>Print</button>
    </div>
  );
}
