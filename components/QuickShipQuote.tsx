"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings } from "@/lib/pricing";
import { money } from "@/lib/format";

type Rate = { carrier: string; service: string; cost: number; price: number; days: number | null; deliveryDate?: string | null };

/** Dashboard tool: ZIP + weight (+ box size, box count) → UPS / FedEx rates from our ZIP, cheapest and fastest first. */
export default function QuickShipQuote() {
  const [boxes, setBoxes] = useState<{ name: string; l: number; w: number; h: number }[]>([]);
  const [box, setBox] = useState("");
  const [zip, setZip] = useState(""), [lb, setLb] = useState(""), [n, setN] = useState("1");
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => {
    createClient().from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => {
      const s = mergeSettings(data?.data).ship as unknown as { boxes: { name: string; l?: number; w?: number; h?: number; length?: number; width?: number; height?: number }[]; defaultBox: string };
      const bs = (s.boxes || []).map((b) => ({ name: b.name, l: +(b.l ?? b.length ?? 0), w: +(b.w ?? b.width ?? 0), h: +(b.h ?? b.height ?? 0) }));
      setBoxes(bs); setBox(s.defaultBox || bs[0]?.name || "");
    });
  }, []);
  async function quote(e: React.FormEvent) {
    e.preventDefault();
    const b = boxes.find((x) => x.name === box) || boxes[0];
    if (!b) return setErr("Set up box sizes in Shipping Center → Settings.");
    setBusy(true); setErr(""); setRates(null);
    const count = Math.max(1, Math.min(50, Math.round(+n || 1)));
    const r = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quick: true, to: { zip: zip.trim() }, bill: "fbs", boxes: Array.from({ length: count }, (_, i) => ({ n: i + 1, length: b.l, width: b.w, height: b.h, weight: +lb })) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) return setErr(j.error || "Couldn't get rates.");
    setRates(((j.rates || []) as Rate[]).sort((a, b) => a.price - b.price));
  }
  const fastest = rates?.length ? [...rates].sort((a, b) => (a.days ?? 99) - (b.days ?? 99) || a.price - b.price)[0] : null;
  return (
    <div className="qs">
      <form className="qs-f" onSubmit={quote}>
        <label>ZIP<input inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="75204" required /></label>
        <label>lb / box<input type="number" min={0.1} step={0.1} value={lb} onChange={(e) => setLb(e.target.value)} placeholder="25" required /></label>
        <label>Boxes<input type="number" min={1} max={50} value={n} onChange={(e) => setN(e.target.value)} /></label>
        <label>Size<select value={box} onChange={(e) => setBox(e.target.value)}>{boxes.map((b) => <option key={b.name} value={b.name}>{b.name} {b.l}×{b.w}×{b.h}</option>)}</select></label>
        <button type="submit" className="btn primary sm" disabled={busy}>{busy ? "…" : "Quote"}</button>
      </form>
      {err && <div className="bad" style={{ fontSize: 12.5 }}>{err}</div>}
      {rates && (rates.length ? (
        <ul className="qs-r">{rates.slice(0, 8).map((r, i) => (
          <li key={r.carrier + r.service + i}>
            <span><b>{r.carrier}</b> {r.service.replace(/_/g, " ")}{r === rates[0] && <span className="qs-tag cheap">Cheapest</span>}{r === fastest && r !== rates[0] && <span className="qs-tag fast">Fastest</span>}</span>
            <span className="faint">{r.days ? `${r.days} day${r.days === 1 ? "" : "s"}` : ""}</span>
            <span className="qs-p"><b>{money(r.price)}</b><small>cost {money(r.cost)}</small></span>
          </li>
        ))}</ul>
      ) : <div className="db-empty">No rates for that ZIP.</div>)}
    </div>
  );
}
