"use client";
import { myPrinter } from "@/lib/labelPrinter";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function LabelControls({ boxes, size, tight, job }: { boxes: number; size: string; tight?: boolean; job?: { kind: "o" | "a"; id: string } }) {
  const router = useRouter();
  const path = usePathname();
  const [n, setN] = useState(String(boxes));
  const [zmsg, setZmsg] = useState(""), [zbusy, setZbusy] = useState(false);
  // straight to the Zebra (ZPL, through the print computer or PrintNode): crisp, no print dialog
  async function zebra() {
    setZbusy(true); setZmsg("");
    const r = await fetch("/api/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "box", job, boxes: Math.max(1, parseInt(n, 10) || 1), printer: myPrinter() }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { message: "Offline." };
    setZbusy(false); setZmsg(j.message || j.error || "");
  }
  // opening the page is pressing Print: the computer's own print window comes straight up (Nick, Nov 23 2026)
  useEffect(() => { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t); }, []);
  const go = (b: string, s: string) => router.replace(`${path}?boxes=${Math.max(1, parseInt(b, 10) || 1)}&size=${s}${job?.kind === "a" ? "&a=1" : ""}`);
  return (
    <div className="no-print" style={{ maxWidth: 820, margin: "0 auto 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontFamily: "system-ui, sans-serif", fontSize: 14 }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Label size
        <select value={size} onChange={(e) => go(n, e.target.value)} style={{ padding: "5px 7px" }}>
          <option value="4x6">4 × 6 in (label printer)</option>
          <option value="letter">Half sheet (8.5 × 5.5 in, 2 per page)</option>
        </select>
      </label>
      {job && <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Zebra labels
        <input type="number" min={1} max={99} value={n} onChange={(e) => setN(e.target.value)} style={{ width: 56, padding: "5px 7px" }} />
      </label>}
      {job && <button type="button" disabled={zbusy} onClick={zebra} style={{ padding: "7px 14px", fontWeight: 700, background: "#141D2B", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>{zbusy ? "Sending…" : "Send to Zebra"}</button>}
      <button type="button" onClick={() => window.print()} style={{ padding: "7px 14px", fontWeight: 600, background: "#0A7BA6", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>Print labels</button>
      {zmsg && <span style={{ fontWeight: 600 }}>{zmsg}</span>}
      {tight && <span style={{ color: "#B8392A", fontWeight: 600 }}>This order has a lot of garments for a 4×6 label. Switch to half sheet if rows get cut off.</span>}
      <span style={{ color: "#555" }}>Zebra tip: in the print window choose your Zebra printer, paper size 4×6, margins None, and scale 100% (Actual size). <b>Set how many labels in Copies</b> (they're all alike).</span>
    </div>
  );
}
