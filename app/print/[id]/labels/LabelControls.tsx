"use client";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

export default function LabelControls({ boxes, size, tight }: { boxes: number; size: string; tight?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [n, setN] = useState(String(boxes));
  const go = (b: string, s: string) => router.replace(`${path}?boxes=${Math.max(1, parseInt(b, 10) || 1)}&size=${s}`);
  return (
    <div className="no-print" style={{ maxWidth: 820, margin: "0 auto 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontFamily: "system-ui, sans-serif", fontSize: 14 }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Number of boxes
        <input type="number" min={1} max={50} value={n} onChange={(e) => setN(e.target.value)} onBlur={() => go(n, size)} onKeyDown={(e) => e.key === "Enter" && go(n, size)} style={{ width: 64, padding: "5px 7px" }} />
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Label size
        <select value={size} onChange={(e) => go(n, e.target.value)} style={{ padding: "5px 7px" }}>
          <option value="4x6">4 × 6 in (label printer)</option>
          <option value="letter">Half sheet (8.5 × 5.5 in, 2 per page)</option>
        </select>
      </label>
      <button type="button" onClick={() => window.print()} style={{ padding: "7px 14px", fontWeight: 600, background: "#0A7BA6", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>Print labels</button>
      {tight && <span style={{ color: "#B8392A", fontWeight: 600 }}>This order has a lot of garments for a 4×6 label. Switch to half sheet if rows get cut off.</span>}
      <span style={{ color: "#555" }}>Zebra tip: in the print window choose your Zebra printer, paper size 4×6, margins None, and scale 100% (Actual size).</span>
    </div>
  );
}
