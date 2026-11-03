"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The price calculator, as a button at the top on a phone that opens it in a sheet (Nov 3, Nick: "people on the go
 * would just like to pull up a little calculator at the top of the screen… that's the only reason they would be using
 * this on their phone"). On a computer it's the calculator panel where it always was; the button and the sheet's frame
 * only show on a phone (globals.css pcs-*).
 */
export default function CalcSheet({ label = "Price calculator", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  return (
    <div className={"pcs-w" + (open ? " open" : "")}>
      <button type="button" className="pcs-btn" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="2.5" width="14" height="19" rx="2.5" /><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15v3M8.5 18.5h.01M12 18.5h.01" /></svg>
        {label}
      </button>
      <div className="pcs-bg" onClick={() => setOpen(false)} aria-hidden />
      <div className="pcs-in" role={open ? "dialog" : undefined} aria-modal={open || undefined} aria-label={open ? label : undefined}>
        <button type="button" className="pcs-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        {children}
      </div>
    </div>
  );
}
