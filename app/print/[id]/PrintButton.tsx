"use client";
import { useEffect } from "react";

export default function PrintButton() {
  // on a phone the letter-size sheets are shrunk to fit the screen (printing is unchanged)
  useEffect(() => {
    const fit = () => {
      const k = Math.min(1, (window.innerWidth - 16) / 816);
      document.querySelectorAll<HTMLElement>(".pdoc .sheet").forEach((el) => { el.style.zoom = k < 1 ? String(k) : ""; });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <>
      <button className="btn primary" type="button" onClick={() => window.print()}>Print or save as PDF</button>
      <button className="btn ghost" type="button" onClick={() => window.close()}>Close</button>
    </>
  );
}
