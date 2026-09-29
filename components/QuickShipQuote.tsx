"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings } from "@/lib/pricing";
import { money } from "@/lib/format";
import { serviceName } from "@/lib/transit";

type Rate = { carrier: string; service: string; cost: number; price: number; days: number | null; deliveryDate?: string | null };

/** The day a package lands, counting business days from today when the carrier doesn't give a date. */
function arrives(r: Rate) {
  if (r.deliveryDate) return new Date(r.deliveryDate);
  if (r.days == null) return null;
  const d = new Date(); let n = r.days;
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d;
}

/**
 * Rate & transit calculator: ZIP to ZIP, weight, boxes, box size → every UPS / FedEx service with business days, the
 * day it lands, our cost and what the customer pays. Nothing is bought.
 */
export default function QuickShipQuote({ compact = false }: { compact?: boolean }) {
  const [boxes, setBoxes] = useState<{ name: string; l: number; w: number; h: number }[]>([]);
  const [ourZip, setOurZip] = useState("");
  const [box, setBox] = useState("");
  const [from, setFrom] = useState(""), [zip, setZip] = useState(""), [lb, setLb] = useState(""), [n, setN] = useState("1");
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [only, setOnly] = useState<"all" | "UPS" | "FedEx">("all");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => {
    createClient().from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => {
      const s = mergeSettings(data?.data).ship as unknown as { from: { zip: string }; boxes: { name: string; l?: number; w?: number; h?: number; length?: number; width?: number; height?: number }[]; defaultBox: string };
      const bs = (s.boxes || []).map((b) => ({ name: b.name, l: +(b.l ?? b.length ?? 0), w: +(b.w ?? b.width ?? 0), h: +(b.h ?? b.height ?? 0) }));
      setBoxes(bs); setBox(s.defaultBox || bs[0]?.name || ""); setOurZip(s.from?.zip || ""); setFrom(s.from?.zip || "");
    });
  }, []);
  async function quote(e: React.FormEvent) {
    e.preventDefault();
    const b = boxes.find((x) => x.name === box) || boxes[0];
    if (!b) return setErr("Set up box sizes in Shipping Center → Settings.");
    setBusy(true); setErr(""); setRates(null);
    const count = Math.max(1, Math.min(50, Math.round(+n || 1)));
    const r = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quick: true, fromZip: from.trim(), to: { zip: zip.trim() }, bill: "fbs", boxes: Array.from({ length: count }, (_, i) => ({ n: i + 1, length: b.l, width: b.w, height: b.h, weight: +lb })) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) return setErr(j.error || "Couldn't get rates.");
    setRates(((j.rates || []) as Rate[]).filter((x) => /ups|fedex/i.test(x.carrier)).map((x) => ({ ...x, carrier: /ups/i.test(x.carrier) ? "UPS" : "FedEx" })).sort((a, b) => a.price - b.price));
  }
  const shown = useMemo(() => (rates || []).filter((r) => only === "all" || r.carrier === only), [rates, only]);
  const cheapest = shown[0] || null;
  const fastest = shown.length ? [...shown].sort((a, b) => (a.days ?? 99) - (b.days ?? 99) || a.price - b.price)[0] : null;
  const ground = shown.find((r) => /ground/i.test(r.service) && !/home/i.test(r.service)) || null;

  return (
    <div className={"qs" + (compact ? " qs-compact" : "")}>
      <form className="qs-f" onSubmit={quote}>
        <label>From ZIP<input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={ourZip || "75081"} /></label>
        <label>To ZIP<input inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="75204" required /></label>
        <label>lb per box<input type="number" min={0.1} step={0.1} value={lb} onChange={(e) => setLb(e.target.value)} placeholder="25" required /></label>
        <label>Boxes<input type="number" min={1} max={50} value={n} onChange={(e) => setN(e.target.value)} /></label>
        <label className="qs-size">Box size<select value={box} onChange={(e) => setBox(e.target.value)}>{boxes.map((b) => <option key={b.name} value={b.name}>{b.name} {b.l}×{b.w}×{b.h}</option>)}</select></label>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Getting rates…" : "Get Rates"}</button>
      </form>
      {err && <div className="pv-err">{err}</div>}
      {rates && (rates.length ? (
        <>
          <div className="qs-sum">
            {cheapest && <div><span>Cheapest</span><b>{money(cheapest.price)}</b><small>{cheapest.carrier} {serviceName(cheapest.carrier, cheapest.service)}{cheapest.days ? ` · ${cheapest.days} day${cheapest.days === 1 ? "" : "s"}` : ""}</small></div>}
            {ground && <div><span>Ground</span><b>{ground.days ?? "?"} day{ground.days === 1 ? "" : "s"}</b><small>{ground.carrier} · {money(ground.price)}</small></div>}
            {fastest && <div><span>Fastest</span><b>{arrives(fastest)?.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) || "—"}</b><small>{fastest.carrier} {serviceName(fastest.carrier, fastest.service)} · {money(fastest.price)}</small></div>}
          </div>
          <div className="qs-only rv-seg" role="group" aria-label="Carrier">
            {(["all", "UPS", "FedEx"] as const).map((c) => <button key={c} type="button" className={only === c ? "on" : ""} onClick={() => setOnly(c)}>{c === "all" ? "All" : c}</button>)}
          </div>
          <ul className="qs-r">{shown.slice(0, compact ? 6 : 20).map((r, i) => { const a = arrives(r); return (
            <li key={r.carrier + r.service + i}>
              <span className="qs-svc"><i className={"qs-c " + r.carrier.toLowerCase()}>{r.carrier}</i>{serviceName(r.carrier, r.service)}{r === cheapest && <span className="qs-tag cheap">Cheapest</span>}{r === fastest && r !== cheapest && <span className="qs-tag fast">Fastest</span>}</span>
              <span className="qs-days">{r.days != null ? `${r.days} day${r.days === 1 ? "" : "s"}` : "—"}<small>{a ? a.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : ""}</small></span>
              <span className="qs-p"><b>{money(r.price)}</b><small>cost {money(r.cost)}</small></span>
            </li>
          ); })}</ul>
        </>
      ) : <div className="db-empty">No UPS or FedEx rates for that ZIP.</div>)}
    </div>
  );
}
