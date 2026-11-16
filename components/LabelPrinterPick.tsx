"use client";
import { useEffect, useState } from "react";
import { myPrinter, setMyPrinter, type PrinterRow } from "@/lib/labelPrinter";

/** "Prints on: Press computer ▾" beside a label Print button (lib/labelPrinter.ts). Hidden when there's only one printer. */
export default function LabelPrinterPick({ className = "" }: { className?: string }) {
  const [list, setList] = useState<PrinterRow[] | null>(null), [mine, setMine] = useState("");
  useEffect(() => {
    setMine(myPrinter());
    const f = () => setMine(myPrinter());
    window.addEventListener("fbs:labelPrinter", f);
    void fetch("/api/print?list=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setList(j.printers || [])).catch(() => setList([]));
    return () => window.removeEventListener("fbs:labelPrinter", f);
  }, []);
  if (!list || list.length < 2) return null;
  const cur = list.find((p) => p.id === mine);
  return (
    <label className={"lpp " + className}>
      <span>Prints on</span>
      <select value={cur ? cur.id : ""} onChange={(e) => setMyPrinter(e.target.value)} aria-label="Which label printer">
        {!cur && <option value="">Pick this computer&apos;s printer…</option>}
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.live ? "" : " (not connected)"}</option>)}
      </select>
    </label>
  );
}
