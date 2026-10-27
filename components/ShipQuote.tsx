"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import { estimateBoxes, type Rate } from "@/lib/shipping";
import type { ShipSettings } from "@/lib/pricing";
import { deliveredBy, niceService } from "@/components/ShipWindow";
import { matchShipMethod } from "@/lib/pricing";

/**
 * Shipping quote (Oct 16, Nick: "how do we save shipping to an invoice… figure the charge for FedEx or UPS using
 * EasyPost"; then "this takes up too much room… when you select ship / FedEx Ground, pop up a little screen on the
 * right under Totals that says Shipping quote, and you should be able to select from there").
 * A small card in the order's right column, shown when the order ships. It prices the order as soon as it shows: the
 * boxes (Shipping settings: pieces a box, the default box), the weight (S&S's weight for each size ordered, else an
 * estimate; editable) + 1 lb a box, from our ZIP to the ship-to ZIP, through EasyPost with our markup and per-box fee.
 * The order's ship method is highlighted; clicking a rate puts it on the invoice as the "Shipping" fee and sets the method.
 */
const lbEach = (desc: string) => {
  const d = desc.toLowerCase();
  if (/hood|sweat|fleece|crew ?neck sweat|quarter|1\/4|jacket|pullover/.test(d)) return 1.3;
  if (/long sleeve|l\/s|polo|raglan/.test(d)) return 0.6;
  if (/hat|cap|beanie|visor|koozie/.test(d)) return 0.25;
  if (/tote|bag/.test(d)) return 0.5;
  return 0.45; // a tee
};
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export default function ShipQuote({ pieces, garments, shipTo, settings, shipMethod, current, onAdd, onSet, due, shipOn, tbd, onTbd, onClear }: {
  /** shipping to be decided (on the order as TBD, $0 for now) */ tbd?: boolean; onTbd?: (on: boolean) => void;
  /** take the shipping charge off the order */ onClear?: () => void;
  pieces: number; garments: { desc: string; qty: number; /** the supplier's weight for this line (lb), when known */ lbs?: number }[]; shipTo: string; settings: ShipSettings;
  /** the order's ship method ("FedEx Ground"), highlighted */ shipMethod: string;
  /** the order's shipping fee now, if any */ current?: { label: string; amount: number } | null;
  onAdd: (label: string, amount: number, method: string) => void;
  /** a different shipping price typed in (override; 0 = free shipping) */ onSet: (amount: number) => void;
  /** the in-hands date (YYYY-MM-DD): a rate that gets there later is marked late */ due?: string | null;
  /** the day it ships (the production date; today when it's past or not set) */ shipOn?: string | null;
}) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [editW, setEditW] = useState(false);
  const [each, setEach] = useState<string>("");
  const [nonce, setNonce] = useState(0);
  const zip = (shipTo.match(/\b(\d{5})(?:-\d{4})?\b(?![\s\S]*\b\d{5}\b)/) || [])[1] || "";
  const nBoxes = estimateBoxes(pieces, settings.perBox);
  const box = settings.boxes.find((b) => b.name === settings.defaultBox) || settings.boxes[0] || { name: "Box", length: 16, width: 13, height: 21 };
  const known = garments.every((g) => !g.qty || g.lbs != null);
  const est = pieces ? garments.reduce((a, g) => a + (g.lbs ?? g.qty * lbEach(g.desc)), 0) / pieces : 0.45;
  const per = +each > 0 ? +each : Math.round(est * 1000) / 1000;
  const perBox = Math.max(1, Math.ceil((pieces * per) / nBoxes + 1)); // + 1 lb a box; carriers bill whole pounds
  const want = zip && pieces ? `${zip}|${nBoxes}|${perBox}|${box.length}x${box.width}x${box.height}|${nonce}` : "";

  // priced once for each ZIP / box count / weight (not on a timer)
  const asked = useRef("");
  useEffect(() => {
    if (!want || asked.current === want) return;
    asked.current = want;
    const t = setTimeout(async () => {
      setBusy(true); setErr("");
      try {
        const boxes = Array.from({ length: nBoxes }, (_, i) => ({ n: i + 1, length: box.length, width: box.width, height: box.height, weight: perBox }));
        const r = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quick: true, to: { zip }, boxes, bill: "fbs" }) });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        const list = ((j.rates || []) as Rate[]).filter((x) => /ups|fedex|usps/i.test(x.carrier)).sort((a, b) => a.price - b.price);
        setRates(list);
        if (!list.length) setErr("No rates came back for that ZIP.");
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setRates(null); }
      setBusy(false);
    }, 400);
    return () => clearTimeout(t);
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (r: Rate) => matchShipMethod(`${r.carrier} ${r.service}`) || `${r.carrier} ${niceService(r.service)}`;
  // shorter names in this narrow card only (Oct 16, Nick): Next Day Air → ND Air, 2nd Day Air / 2 Day → 2D Air.
  // The invoice line keeps the full name.
  const shortService = (r: Rate) => name(r).slice(r.carrier.length).trim().replace(/^Next Day Air/i, "ND Air").replace(/^(2nd Day Air|2 ?Day( Air)?|Two Day)/i, "2D Air").replace(/^Priority Mail Express$/, "Priority Express");
  const isPicked = (r: Rate) => !!shipMethod && key(name(r)) === key(shipMethod);
  const onInvoice = (r: Rate) => !!current && Math.abs(current.amount - r.price) < 0.005 && key(current.label).includes(key(name(r)));

  // the Shipping Center's rules (Oct 16, Nick): when each one gets there, counted from the day the job ships (the
  // production date, or today), late when that's after the in-hands date, options that cost more and don't get there
  // sooner left out, and the pick: the cheapest that arrives in time
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const ship0 = shipOn ? new Date(shipOn.slice(0, 10) + "T12:00") : null;
  const ships = ship0 && ship0 > today ? ship0 : today;
  const need = due ? new Date(due.slice(0, 10) + "T23:59") : null;
  const arrive = (r: Rate): Date | null => {
    if (r.days) { const d = new Date(ships); let n = r.days; while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; } return d; }
    if (r.deliveryDate) { const d = new Date(r.deliveryDate.slice(0, 10) + "T12:00"); if (!isNaN(+d)) { d.setDate(d.getDate() + Math.round((+ships - +today) / 864e5)); return d; } }
    return null;
  };
  type Opt = { r: Rate; at: Date | null; late: boolean; rank: number; beaten: boolean };
  const opts: Opt[] = (rates || []).map((r) => { const at = arrive(r); return { r, at, late: !!(need && at && at > need), rank: deliveredBy(r.service).rank, beaten: false }; });
  const when = (o: Opt) => (o.at ? +new Date(o.at.getFullYear(), o.at.getMonth(), o.at.getDate()) : 9e15) + o.rank;
  for (const o of opts) o.beaten = opts.some((x) => x !== o && x.r.price <= o.r.price && when(x) <= when(o) && (x.r.price < o.r.price || when(x) < when(o)));
  const good = opts.filter((o) => !o.beaten);
  const cheapestOnTime = good.filter((o) => !o.late).sort((x, y) => x.r.price - y.r.price)[0] || null;
  const cheapest = [...good].sort((x, y) => x.r.price - y.r.price)[0] || null;
  const fastest = [...good].sort((x, y) => when(x) - when(y) || x.r.price - y.r.price)[0] || null;
  const tagOf = (o: Opt) => (o === cheapestOnTime && need ? "Cheapest on time" : o === cheapest ? "Cheapest" : o === fastest ? "Fastest" : "");
  // the order's method first, then the picks, then the rest on time (cheapest first), then the late ones
  const pickedO = opts.find((o) => isPicked(o.r));
  const order = [pickedO, cheapestOnTime, cheapest, fastest, ...good.filter((o) => !o.late).sort((x, y) => x.r.price - y.r.price), ...good.filter((o) => o.late).sort((x, y) => x.r.price - y.r.price)];
  const best = order.filter((o, i): o is Opt => !!o && order.indexOf(o) === i);
  // "more options" also lists the ones that cost more and don't get there sooner: a customer may ask for a carrier
  const list = [...best, ...opts.filter((o) => !best.includes(o)).sort((x, y) => x.r.price - y.r.price)];
  const shown = more ? list : best.slice(0, 4);
  const add = (r: Rate) => onAdd(`Shipping · ${name(r)} (${nBoxes} box${nBoxes === 1 ? "" : "es"})`, r.price, name(r));
  const dd = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <section className="panel money-only sqp">
      <div className="panel-h"><h2>Shipping quote</h2>{busy ? <span className="faint">Getting rates…</span> : rates ? <button type="button" className="linkbtn" onClick={() => setNonce((n) => n + 1)}>Refresh</button> : null}</div>
      <div className="panel-b">
        {!zip ? <div className="faint sqp-note">Add a ship-to address with a ZIP and it prices here.</div> : (<>
          <div className="sqp-what">
            {nBoxes} {box.name.toLowerCase()} box{nBoxes === 1 ? "" : "es"} · <b>{perBox} lb</b>{nBoxes > 1 ? " each" : ""} · to {zip}
            {!editW ? <button type="button" className="linkbtn" onClick={() => setEditW(true)} title={`${pieces} pieces × ${per} lb${known && !each ? " (S&S weights)" : " (estimate)"} + 1 lb a box`}>{known && !each ? "S&S weight" : "est. weight"}</button>
              : <span className="sqp-w"><input type="number" step="0.01" min="0.05" aria-label="Pounds per piece" placeholder={String(per)} value={each} autoFocus onChange={(e) => setEach(e.target.value)} onBlur={() => setEditW(false)} /> lb a piece</span>}
          </div>
          {(need || ship0) && <div className="sqp-when">Ships {dd(ships)}{need ? <> · in hands <b>{dd(need)}</b></> : null}</div>}
          {err && <div className="pv-err">{err}</div>}
          {rates && need && good.length > 0 && !cheapestOnTime && <div className="sqp-warn">Nothing gets there by {dd(need)}. Move the production date up or call the customer.</div>}
          {rates && cheapestOnTime && !isPicked(cheapestOnTime.r) && shipMethod && pickedO?.late && <div className="sqp-warn">{shipMethod} won&apos;t arrive in time. {name(cheapestOnTime.r)} gets there {dd(cheapestOnTime.at!)} for {money(cheapestOnTime.r.price)}.</div>}
          {shown.length > 0 && (
            <div className="sqp-list" role="list">
              {shown.map((o, i) => {
                const r = o.r, on = onInvoice(r), tag = tagOf(o);
                return (
                  <button key={i} type="button" role="listitem" className={"sqp-r" + (isPicked(r) ? " picked" : "") + (on ? " on" : "") + (o.late ? " late" : "")} onClick={() => add(r)}
                    title={on ? "On the invoice" : `Put ${money(r.price)} on the invoice as ${name(r)} (we pay ${money(r.cost)})`}>
                    <span className={"sqp-c " + r.carrier.toLowerCase()}>{r.carrier}</span>
                    <span className="sqp-s">{shortService(r)}{tag && <em className="sqp-tag">{tag}</em>}
                      <small className={o.late ? "late" : ""}>{o.at ? `${o.late ? "Late · " : "Arrives "}${dd(o.at)}` : "No estimate"}</small></span>
                    <b>{money(r.price)}</b>
                    <span className="sqp-go">{on ? "✓" : "Add"}</span>
                  </button>
                );
              })}
            </div>
          )}
          {list.length > Math.min(4, best.length) && <button type="button" className="linkbtn sqp-more" onClick={() => setMore(!more)}>{more ? "Fewer options" : `All options (${list.length})`}</button>}
          {/* to be decided, or none (Oct 27, Nick: "you can't unselect it… check a box there that says TBD") */}
          {(onTbd || onClear) && <div className="sqp-tbd">
            {onTbd && <label className="check"><input type="checkbox" checked={!!tbd} onChange={(e) => onTbd(e.target.checked)} /> TBD <small className="faint">decided later: $0 for now, shows as TBD</small></label>}
            {onClear && current && <button type="button" className="linkbtn" onClick={onClear}>Remove shipping</button>}
          </div>}
          {current && !tbd && (
            <label className={"sqp-inv" + (opts.some((o) => onInvoice(o.r)) ? "" : " custom")}>
              <span>On the invoice{opts.some((o) => onInvoice(o.r)) ? "" : <small> (your price)</small>}</span>
              <span className="sqp-amt">$<input type="number" step="0.01" min="0" aria-label="Shipping charge on the invoice" key={current.amount} defaultValue={current.amount.toFixed(2)}
                onBlur={(e) => { const v = Math.max(0, Math.round((+e.target.value || 0) * 100) / 100); if (Math.abs(v - current.amount) >= 0.005) onSet(v); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></span>
            </label>
          )}
        </>)}
      </div>
    </section>
  );
}
