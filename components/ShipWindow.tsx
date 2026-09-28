"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { SHIP_METHODS, type ShipAddress, type ShipSettings } from "@/lib/pricing";
import { BILL_LABEL, addressReady, boxReady, carrierOf, estimateBoxes, newBoxes, type BillTo, type Box, type Rate, type Shipment } from "@/lib/shipping";

export type ShipTarget = {
  kind: "order" | "archived"; id: string; number: string; job: string; customerId: string | null; customer: string;
  pieces: number; due: string | null; to: ShipAddress; service: string;
  bill: BillTo; account: string; zip: string;
};

/** When a rate arrives: the carrier's date, else business days from today. */
export function arrival(r: Rate): Date | null {
  if (r.deliveryDate) { const d = new Date(r.deliveryDate.slice(0, 10) + "T12:00"); if (!isNaN(+d)) return d; } // a calendar day, not a time
  if (!r.days) return null;
  const d = new Date(); let n = r.days;
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d;
}
/**
 * Roughly when in the day a service delivers (the carriers' usual commitments for business addresses), so a
 * pricier option that arrives the same day is only worth it when it arrives earlier in that day.
 */
export function deliveredBy(service: string): { rank: number; label: string } {
  const s = service.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/early|firstovernight/.test(s)) return { rank: 1, label: "by 8:30 AM" };
  if (/priorityovernight|^nextdayair$|2nddayairam|2dayam|fedex2dayam/.test(s)) return { rank: 2, label: "by 10:30 AM" };
  if (/standardovernight|nextdayairsaver/.test(s)) return { rank: 3, label: "by 3 PM" };
  return { rank: 4, label: "by end of day" };
}
const dayKey = (d: Date | null) => (d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : "none");
const dayName = (d: Date) => d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const niceService = (s: string) => {
  let x = s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/^(fedex|ups|usps)\s+/i, "").trim();
  if (x === x.toUpperCase()) x = x.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); // FEDEX_2_DAY → 2 Day
  return x;
};
/** "the same day" / "sooner", comparing two options' arrival. */
const when2 = (a: { at: Date | null; by: { rank: number } }, b: { at: Date | null; by: { rank: number } }) =>
  dayKey(a.at) === dayKey(b.at) ? (a.by.rank < b.by.rank ? "earlier that day" : "the same day") : "sooner";
const num = (v: string): number | "" => (v.trim() === "" ? "" : Math.max(0, +v || 0));

/**
 * The ship window: boxes (estimated from the piece count), their size and weight, who pays, and rates.
 * Labels are bought in the next step; for now a shipment can be saved as a draft or marked shipped with tracking.
 */
export default function ShipWindow({ t, existing, settings, focusBox, onClose, onDone }: {
  t: ShipTarget; existing: Shipment | null; settings: ShipSettings; focusBox?: number | null;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const sb = createClient();
  const estimate = estimateBoxes(t.pieces, settings.perBox);
  // new boxes start at the default box (Large 21×16×13 unless changed in Settings), so it's straight to the weights
  const defaultSize = settings.boxes.find((b) => b.name === settings.defaultBox) || settings.boxes[0];
  const [boxes, setBoxes] = useState<Box[]>(() => (existing?.boxes?.length ? existing.boxes : newBoxes(estimate, defaultSize)));
  const [askAll, setAskAll] = useState<{ length: number; width: number; height: number } | null>(null);
  const [multi, setMulti] = useState<{ step: "count" | "size"; count: number } | null>(null);
  const [to, setTo] = useState<ShipAddress>(existing?.ship_to?.street1 ? existing.ship_to : t.to);
  const [bill, setBill] = useState<BillTo>(existing?.bill_to || t.bill);
  const [account, setAccount] = useState(existing?.bill_account || t.account);
  const [zip, setZip] = useState(existing?.bill_zip || t.zip);
  const [remember, setRemember] = useState(false);
  const [service, setService] = useState(existing?.service || t.service || "");
  const [note, setNote] = useState(existing?.note || "");
  const [rates, setRates] = useState<Rate[] | null>(existing?.rates || null);
  const [pick, setPick] = useState<string>(existing?.service ? `${existing.carrier}|${existing.service}` : "");
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [scan, setScan] = useState("");
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  // start in Box 1's length (or the scanned box): type, Tab, type, Tab… Enter after a weight goes to the next box
  // start where the typing is: a box whose size is already filled in starts at its weight, otherwise at its length
  const sized = (b?: Box) => !!b && [b.length, b.width, b.height].every((x) => typeof x === "number" && x > 0);
  const focusBoxAt = (n: number, list = boxes) => { const b = list[n - 1]; setTimeout(() => refs.current[`${sized(b) ? "w" : "l"}${n}`]?.focus(), 40); };
  useEffect(() => { focusBoxAt(focusBox && boxes[focusBox - 1] ? focusBox : 1); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [busy, onClose]);

  const setBox = (i: number, patch: Partial<Box>) => { setBoxes((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b))); setRates(null); };
  const renumber = (bs: Box[]) => bs.map((b, i) => ({ ...b, n: i + 1 }));
  const addBox = () => { setBoxes((bs) => { const last = bs[bs.length - 1]; return renumber([...bs, { n: bs.length + 1, length: last?.length ?? "", width: last?.width ?? "", height: last?.height ?? "", weight: "" }]); }); setRates(null); const last = boxes[boxes.length - 1]; setTimeout(() => refs.current[`${sized(last) ? "w" : "l"}${boxes.length + 1}`]?.focus(), 30); };
  const removeBox = (i: number) => { setBoxes((bs) => renumber(bs.filter((_, j) => j !== i))); setRates(null); };
  /** Box 1's size changed to something the other boxes don't have: ask whether to use it for every box. */
  const offerAll = () => {
    const b1 = boxes[0];
    if (!sized(b1) || boxes.length < 2) return;
    const d = { length: +b1.length, width: +b1.width, height: +b1.height };
    if (boxes.slice(1).some((b) => +b.length !== d.length || +b.width !== d.width || +b.height !== d.height)) setAskAll(d);
  };
  /** Add several boxes at once (e.g. 40), all at one size or with the sizes left blank. */
  const addMany = (count: number, size: { length: number; width: number; height: number } | null) => {
    const start = boxes.length;
    setBoxes((bs) => renumber([...bs, ...Array.from({ length: count }, (_, j) => ({ n: start + j + 1, length: size?.length ?? "", width: size?.width ?? "", height: size?.height ?? "", weight: "" } as Box))]));
    setRates(null); setMulti(null);
    setTimeout(() => refs.current[`${size ? "w" : "l"}${start + 1}`]?.focus(), 40);
  };
  const sizeAll = (s: { length: number; width: number; height: number }) => {
    const next = boxes.map((b) => ({ ...b, length: s.length, width: s.width, height: s.height }));
    setBoxes(next); setRates(null);
    const firstEmpty = next.findIndex((b) => !b.weight);
    setTimeout(() => refs.current[`w${firstEmpty >= 0 ? firstEmpty + 1 : 1}`]?.focus(), 40); // straight to the weights
  };

  const totalWeight = boxes.reduce((a, b) => a + (+b.weight || 0), 0);
  const ready = boxes.length > 0 && boxes.every(boxReady);
  const perBox = t.pieces ? Math.ceil(t.pieces / Math.max(1, boxes.length)) : 0;
  const chosen = useMemo(() => rates?.find((r) => `${r.carrier}|${r.service}` === pick) || null, [rates, pick]);
  const canRate = ready && !!(to.zip && to.city && to.state && to.street1) && (bill === "fbs" || !!(account.trim() && zip.trim()));

  /**
   * The options, arranged: Cheapest and Fastest up top, then every useful option by arrival day. An option is grayed out
   * ("no gain") when another one costs the same or less and arrives the same day at the same time of day or sooner, e.g.
   * overnight vs ground that both arrive Thursday afternoon. Same day but earlier in the day (overnight by 10:30 AM) stays.
   */
  const plan = useMemo(() => {
    const need = t.due ? new Date(t.due.slice(0, 10) + "T23:59") : null;
    const cost = (r: Rate) => (bill === "fbs" ? r.price : r.cost);
    type Opt = { k: string; r: Rate; at: Date | null; by: { rank: number; label: string }; late: boolean; beatenBy: Opt | null };
    const all: Opt[] = (rates || []).map((r) => { const at = arrival(r); return { k: `${r.carrier}|${r.service}`, r, at, by: deliveredBy(r.service), late: !!(need && at && at > need), beatenBy: null }; });
    const when = (o: Opt) => (o.at ? +new Date(o.at.getFullYear(), o.at.getMonth(), o.at.getDate()) : 9e15) + o.by.rank; // day, then time of day
    for (const o of all) {
      o.beatenBy = all.filter((x) => x !== o && cost(x.r) <= cost(o.r) && when(x) <= when(o) && (cost(x.r) < cost(o.r) || when(x) < when(o)))
        .sort((x, y) => cost(x.r) - cost(y.r))[0] || null;
    }
    const good = all.filter((o) => !o.beatenBy).sort((x, y) => when(x) - when(y) || cost(x.r) - cost(y.r));
    const beaten = all.filter((o) => o.beatenBy).sort((x, y) => cost(x.r) - cost(y.r));
    if (!good.length) return null;
    const cheapest = good.reduce((m, o) => (cost(o.r) < cost(m.r) ? o : m));
    // fastest: the soonest day, and the cheapest way to get there that day (earlier-in-the-day options are listed under it)
    const fastest = good.filter((o) => dayKey(o.at) === dayKey(good[0].at)).reduce((m, o) => (cost(o.r) < cost(m.r) ? o : m));
    const onTime = need ? good.filter((o) => !o.late) : good;
    const cheapestOnTime = onTime.length ? onTime.reduce((m, o) => (cost(o.r) < cost(m.r) ? o : m)) : null;
    const days: { key: string; at: Date | null; late: boolean; opts: Opt[] }[] = [];
    for (const o of good) { const k = dayKey(o.at); let d = days.find((x) => x.key === k); if (!d) days.push(d = { key: k, at: o.at, late: o.late, opts: [] }); d.opts.push(o); }
    return { cost, need, cheapest, fastest, cheapestOnTime, days, beaten, pickDefault: (need ? cheapestOnTime : null) || cheapest };
  }, [rates, bill, t.due]);

  // rates pop up by themselves once every box and the address are filled in (and again after a change)
  const rateKey = JSON.stringify([boxes.map((b) => [b.length, b.width, b.height, b.weight]), to.street1, to.city, to.state, to.zip, bill, account, zip]);
  const tried = useRef("");
  useEffect(() => {
    if (!canRate || rates || busy || tried.current === rateKey) return;
    const h = setTimeout(() => { tried.current = rateKey; getRates(); }, 900);
    return () => clearTimeout(h);
  }, [rateKey, canRate, rates, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // start on the best choice (a saved pick stays unless it's one of the "no gain" options)
  useEffect(() => { if (plan && (!pick || !plan.days.some((d) => d.opts.some((o) => o.k === pick)))) setPick(plan.pickDefault.k); }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A scanned box label ("34317-2") jumps to that box; the order number alone jumps to the next box without a weight. */
  function onScan(v: string) {
    const m = v.trim().match(/^#?(\d+)(?:-(\d+))?$/);
    if (!m) return;
    let n = m[2] ? +m[2] : (boxes.findIndex((b) => !b.weight) + 1 || boxes.length);
    if (n > boxes.length) { addBox(); n = boxes.length + 1; }
    setTimeout(() => refs.current[`l${n}`]?.focus(), 40);
    setScan("");
  }

  const row = (): Partial<Shipment> & Record<string, unknown> => ({
    order_id: t.kind === "order" ? t.id : null, archived_order_id: t.kind === "archived" ? t.id : null, customer_id: t.customerId,
    ship_to: to, bill_to: bill, bill_account: bill === "fbs" ? "" : account.trim(), bill_zip: bill === "fbs" ? "" : zip.trim(),
    carrier: chosen?.carrier || existing?.carrier || (service.split(" ")[0] || ""), service: chosen?.service || service,
    boxes, rates, cost: chosen && bill === "fbs" ? chosen.cost : existing?.cost ?? null, price: chosen ? chosen.price : existing?.price ?? null, note,
    updated_at: new Date().toISOString(),
  });

  async function saveCustomer() {
    if (!remember || !t.customerId) return;
    await sb.from("customers").update(bill === "fbs" ? { ship_bill: "fbs" } : { ship_bill: bill, ship_bill_zip: zip.trim(), ...(bill === "ups" ? { ship_ups_account: account.trim() } : { ship_fedex_account: account.trim() }) }).eq("id", t.customerId);
  }

  async function save(status: Shipment["status"] = "draft") {
    setBusy("save"); setErr("");
    const r = { ...row(), status, ...(status === "shipped" ? { shipped_at: new Date().toISOString() } : {}) };
    const q = existing ? sb.from("shipments").update(r).eq("id", existing.id) : sb.from("shipments").insert(r);
    const { error } = await q;
    if (error) { setBusy(""); setErr(error.message); return false; }
    await saveCustomer();
    if (status === "shipped" && t.kind === "order") {
      const nums = boxes.map((b) => (b.tracking || "").trim()).filter(Boolean);
      await sb.from("orders").update({ tracking: nums.join(", "), ship_method: chosen?.service ? `${chosen.carrier} ${chosen.service}` : service }).eq("id", t.id);
    }
    setBusy("");
    return true;
  }

  async function getRates() {
    tried.current = rateKey;
    setBusy("rates"); setErr(""); setRates(null);
    try {
      const r = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, boxes, bill, account, zip, reference: `#${t.number}` }) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setPick(""); // the recommendation is picked when the rates arrive
      setRates(j.rates);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }

  const addrField = (k: keyof ShipAddress, label: string, cls = "") => (
    <label className={cls}>{label}<input type="text" value={to[k]} onChange={(e) => { setTo({ ...to, [k]: e.target.value }); setRates(null); }} /></label>
  );

  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label={`Ship #${t.number}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet sw">
        <div className="pp-sheet-h">
          <div><b>Ship #{t.number}</b> <span className="faint" style={{ fontSize: 14 }}>· {t.customer}{t.job ? ` · ${t.job}` : ""}</span></div>
          <div className="row" style={{ gap: 8 }}>
            <input className="sw-scan" type="text" placeholder="Scan a box label" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(scan); } }} aria-label="Scan a box label" />
            <button type="button" className="btn icon ghost" aria-label="Close" disabled={!!busy} onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="sw-cols">
          {/* boxes */}
          <section className="sw-main">
            <div className="sw-est">
              <div><b>{t.pieces.toLocaleString()}</b> pieces · estimated <b>{estimate} box{estimate === 1 ? "" : "es"}</b> at {settings.perBox} per box{boxes.length !== estimate ? <span className="faint"> · using {boxes.length}</span> : null}</div>
              <div className="sw-presets"><span className="faint">All boxes:</span>{settings.boxes.map((s) => {
                const on = boxes.length > 0 && boxes.every((b) => +b.length === s.length && +b.width === s.width && +b.height === s.height);
                return <button key={s.name} type="button" tabIndex={-1} className={"chip" + (on ? " on" : "")} onClick={() => sizeAll(s)}>{s.name} {s.length}×{s.width}×{s.height}{s.name === settings.defaultBox ? " · default" : ""}</button>;
              })}</div>
            </div>
            <div style={{ overflowX: "auto" }}><table className="sw-boxes">
              <thead><tr><th>Box</th><th>Length</th><th>Width</th><th>Height</th><th>Weight</th>{tracking && <th>Tracking #</th>}<th /></tr></thead>
              <tbody>
                {boxes.map((b, i) => (
                  <tr key={i} className={boxReady(b) ? "ok" : ""}>
                    <td className="sw-n">Box {b.n}<small>{perBox ? `~${Math.min(perBox, Math.max(0, t.pieces - perBox * i))} pcs` : ""}</small></td>
                    {(["length", "width", "height"] as const).map((k) => (
                      <td key={k}><div className="sw-in"><input ref={k === "length" ? (el) => { refs.current[`l${b.n}`] = el; } : undefined} type="number" inputMode="decimal" min={0} step="0.5" value={b[k]}
                        onFocus={(e) => e.target.select()} onChange={(e) => setBox(i, { [k]: num(e.target.value) })}
                        data-dims={b.n}
                        onBlur={(e) => { if (i === 0 && (e.relatedTarget as HTMLElement | null)?.dataset?.dims !== "1") offerAll(); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget.closest("td")?.nextElementSibling?.querySelector("input") as HTMLInputElement | null)?.focus(); } }} aria-label={`Box ${b.n} ${k}`} /><span>in</span></div></td>
                    ))}
                    <td><div className="sw-in w"><input ref={(el) => { refs.current[`w${b.n}`] = el; }} type="number" inputMode="decimal" min={0} step="0.1" value={b.weight}
                      onFocus={(e) => e.target.select()} onChange={(e) => setBox(i, { weight: num(e.target.value) })}
                                            onKeyDown={(e) => {
                        // Tab or Enter after a weight goes to the next box: its weight when its size is filled in (22 Tab 23 Tab 24…), else its length
                        if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
                          const nb = boxes[b.n];
                          if (nb) { e.preventDefault(); refs.current[`${sized(nb) ? "w" : "l"}${b.n + 1}`]?.focus(); }
                          else if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
                        }
                      }} aria-label={`Box ${b.n} weight`} /><span>lb</span></div></td>
                    {tracking && <td><input type="text" className="sw-trk" value={b.tracking || ""} placeholder="1Z… / 7…" onChange={(e) => setBox(i, { tracking: e.target.value.trim() })} aria-label={`Box ${b.n} tracking`} />{b.tracking && carrierOf(b.tracking) && <small className="faint"> {carrierOf(b.tracking)}</small>}</td>}
                    <td className="sw-act">
                      {i > 0 && <button type="button" tabIndex={-1} className="btn sm ghost" title="Same size as the box above" onClick={() => setBox(i, { length: boxes[i - 1].length, width: boxes[i - 1].width, height: boxes[i - 1].height })}>Same ↑</button>}
                      {boxes.length > 1 && <button type="button" tabIndex={-1} className="btn icon ghost sm" aria-label={`Remove box ${b.n}`} onClick={() => removeBox(i)}>✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {askAll && (
              <div className="sw-ask">
                <span>Box 1 is now <b>{askAll.length}×{askAll.width}×{askAll.height}</b>. Use that size for all {boxes.length} boxes?</span>
                <button type="button" className="btn primary sm" onClick={() => { sizeAll(askAll); setAskAll(null); }}>Yes, all boxes</button>
                <button type="button" className="btn sm" onClick={() => { setAskAll(null); setTimeout(() => refs.current.w1?.focus(), 30); }}>No, just box 1</button>
              </div>
            )}
            {multi && (
              <div className="sw-ask">
                {multi.step === "count" ? (
                  <>
                    <span>How many boxes to add?</span>
                    <input type="number" min={1} max={200} autoFocus className="sw-many" value={multi.count || ""} onChange={(e) => setMulti({ ...multi, count: Math.max(0, Math.min(200, Math.round(+e.target.value || 0))) })}
                      onKeyDown={(e) => { if (e.key === "Enter" && multi.count > 0) { e.preventDefault(); setMulti({ ...multi, step: "size" }); } }} aria-label="How many boxes" />
                    <button type="button" className="btn primary sm" disabled={!multi.count} onClick={() => setMulti({ ...multi, step: "size" })}>Next</button>
                    <button type="button" className="btn sm ghost" onClick={() => setMulti(null)}>Cancel</button>
                  </>
                ) : (() => {
                  const sz = sized(boxes[0]) ? { length: +boxes[0].length, width: +boxes[0].width, height: +boxes[0].height } : defaultSize;
                  return (
                    <>
                      <span>Add <b>{multi.count}</b> box{multi.count === 1 ? "" : "es"}. Make them all <b>{sz.length}×{sz.width}×{sz.height}</b>?</span>
                      <button type="button" className="btn primary sm" autoFocus onClick={() => addMany(multi.count, sz)}>Yes, same size</button>
                      <button type="button" className="btn sm" onClick={() => addMany(multi.count, null)}>No, I&apos;ll enter sizes</button>
                    </>
                  );
                })()}
              </div>
            )}
            <div className="sw-foot">
              <button type="button" className="btn" onClick={addBox}>+ Add a box</button>
              <button type="button" className="btn" onClick={() => { setAskAll(null); setMulti({ step: "count", count: 10 }); }}>+ Add several boxes</button>
              <span className="faint">{boxes.length} box{boxes.length === 1 ? "" : "es"} · {Math.round(totalWeight * 10) / 10} lb total{ready ? "" : " · fill in every size and weight"}</span>
            </div>

            <div className="sw-rates">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>How would you like to ship it?</b>
                <button type="button" className="btn sm" tabIndex={-1} disabled={!canRate || busy !== ""} onClick={getRates}>{busy === "rates" ? "Checking UPS, FedEx, USPS…" : rates ? "Check again" : "Compare rates"}</button>
              </div>
              {busy === "rates" && !rates && <div className="faint" style={{ fontSize: 13 }}>Comparing UPS, FedEx and USPS from {settings.from.zip || "our ZIP"}…</div>}
              {rates ? (plan ? (
                <>
                  {/* the two quick picks */}
                  <div className="sw-picks">
                    {[
                      { o: plan.cheapest, t: "Cheapest" },
                      { o: plan.fastest, t: "Fastest" },
                      ...(plan.need && plan.cheapestOnTime && plan.cheapestOnTime !== plan.cheapest && plan.cheapestOnTime !== plan.fastest ? [{ o: plan.cheapestOnTime, t: "Cheapest on time" }] : []),
                    ].map(({ o, t: title }) => (
                      <button key={title} type="button" tabIndex={-1} className={"sw-pick" + (pick === o.k ? " on" : "") + (o.late ? " late" : "")} onClick={() => setPick(o.k)}>
                        <span className="sw-pick-t">{title}{o.late ? " · late" : ""}</span>
                        <b>{o.at ? o.at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "No estimate"}</b>
                        <span className="sw-pick-s">{o.r.carrier} {niceService(o.r.service)}{o.by.rank < 4 ? ` · ${o.by.label}` : ""}</span>
                        <span className="sw-pick-p">{bill === "fbs" ? money(o.r.price) : "Their account"}</span>
                      </button>
                    ))}
                  </div>
                  {plan.need && !plan.cheapestOnTime && <div className="sw-warn">Nothing arrives by the in-hands date ({dayName(plan.need)}). Consider calling the customer.</div>}

                  {/* every useful option, by arrival day */}
                  <div className="sw-rate-list">
                    {plan.days.map((d) => (
                      <div key={d.key} className="sw-day">
                        <div className={"sw-day-h" + (d.late ? " late" : "")}>Arrives {d.at ? dayName(d.at) : "(no estimate)"}{d.late ? " · after the in-hands date" : ""}</div>
                        {d.opts.map((o, i) => (
                          <label key={o.k} className={"sw-rate" + (pick === o.k ? " on" : "") + (o.late ? " late" : "")}>
                            <input type="radio" name="rate" checked={pick === o.k} onChange={() => setPick(o.k)} />
                            <span className="sw-rate-n">
                              <b>{o.r.carrier} {niceService(o.r.service)}</b>
                              <small>{o.by.label}{o.r.deliveryDate ? "" : " (estimate)"}{i === d.opts.length - 1 && d.opts.length > 1 ? " · cheapest that day" : i < d.opts.length - 1 ? ` · earlier in the day for ${money(plan.cost(o.r) - plan.cost(d.opts[d.opts.length - 1].r))} more` : ""}</small>
                            </span>
                            <span className="sw-tags">
                              {o === plan.cheapest && <span className="sw-tag cheapest">Cheapest</span>}
                              {o === plan.fastest && <span className="sw-tag fastest">Fastest</span>}
                            </span>
                            {bill === "fbs"
                              ? <span className="sw-rate-p"><b>{money(o.r.price)}</b><small>we pay {money(o.r.cost)}</small></span>
                              : <span className="sw-rate-p"><b>Their account</b><small>about {money(o.r.cost)} list</small></span>}
                          </label>
                        ))}
                      </div>
                    ))}
                    {plan.beaten.length > 0 && (
                      <details className="sw-beaten">
                        <summary>{plan.beaten.length} more option{plan.beaten.length === 1 ? "" : "s"} that cost more and don&apos;t get there any sooner</summary>
                        {plan.beaten.map((o) => (
                          <label key={o.k} className={"sw-rate dim" + (pick === o.k ? " on" : "")}>
                            <input type="radio" name="rate" checked={pick === o.k} onChange={() => setPick(o.k)} />
                            <span className="sw-rate-n">
                              <b>{o.r.carrier} {niceService(o.r.service)}</b>
                              <small>{o.at ? o.at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "?"} {o.by.label} · {o.beatenBy ? `${o.beatenBy.r.carrier} ${niceService(o.beatenBy.r.service)} gets there ${when2(o.beatenBy, o)} for ${money(plan.cost(o.r) - plan.cost(o.beatenBy.r))} less` : ""}</small>
                            </span>
                            <span />
                            <span className="sw-rate-p"><b>{bill === "fbs" ? money(o.r.price) : "Their account"}</b></span>
                          </label>
                        ))}
                      </details>
                    )}
                  </div>
                </>
              ) : <div className="faint">No rates came back for this shipment. Check the address and box sizes.</div>)
                : busy !== "rates" && <div className="faint" style={{ fontSize: 13 }}>{canRate ? "Getting rates…" : `Fill in every box and the ship-to address; rates from UPS, FedEx and USPS pop up here with arrival days${bill === "fbs" ? ` and what the customer pays (${settings.markupPct}% + ${money(settings.perBoxFee)}/box)` : ""}.`}</div>}
            </div>
          </section>

          {/* where and who pays */}
          <aside className="sw-side">
            <div className="sw-h">Ship to</div>
            <div className="sw-addr">
              {addrField("company", "Company", "wide")}
              {addrField("name", "Attention", "wide")}
              {addrField("street1", "Street", "wide")}
              {addrField("street2", "Suite / unit", "wide")}
              {addrField("city", "City")}
              <div className="sw-st">{addrField("state", "State")}{addrField("zip", "ZIP")}</div>
              {addrField("phone", "Phone")}
              {addrField("email", "Email")}
            </div>
            {!addressReady(to) && <div className="sw-warn">The address needs a street, city, state and ZIP.</div>}

            <div className="sw-h">Shipping paid by</div>
            <div className="sw-bill">
              {(["fbs", "ups", "fedex"] as BillTo[]).map((k) => (
                <label key={k} className={"sw-billopt" + (bill === k ? " on" : "")}><input type="radio" name="bill" checked={bill === k} onChange={() => { setBill(k); setRates(null); if (k !== "fbs") setAccount(k === t.bill ? t.account : ""); }} /> {BILL_LABEL[k]}</label>
              ))}
            </div>
            {bill !== "fbs" && (
              <div className="sw-acct">
                <label>{bill === "ups" ? "UPS" : "FedEx"} account #<input type="text" value={account} onChange={(e) => { setAccount(e.target.value); setRates(null); }} /></label>
                <label>Billing ZIP<input type="text" value={zip} onChange={(e) => { setZip(e.target.value); setRates(null); }} /></label>
              </div>
            )}
            {t.customerId && <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Use this for {t.customer} from now on</label>}

            <div className="sw-h">Service</div>
            <select value={service} onChange={(e) => setService(e.target.value)}><option value="">Choose…</option>{SHIP_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <label className="sw-note">Note<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything for the shipper" /></label>
            {t.due && <div className="faint" style={{ fontSize: 12.5 }}>In-hands date: <b>{new Date(t.due + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</b></div>}
          </aside>
        </div>

        {err && <div className="pv-err" style={{ margin: "0 22px 12px" }}>{err}</div>}
        <div className="sw-bar">
          <button type="button" className="btn ghost" onClick={() => setTracking((x) => !x)}>{tracking ? "Hide tracking" : "Shipped another way? Enter tracking"}</button>
          <span className="spacer" />
          <button type="button" className="btn" disabled={!!busy} onClick={async () => { if (await save("draft")) onDone(`Saved #${t.number}.`); }}>{busy === "save" ? "Saving…" : "Save for later"}</button>
          {tracking
            ? <button type="button" className="btn primary" disabled={!!busy || !boxes.some((b) => b.tracking)} onClick={async () => { if (await save("shipped")) onDone(`#${t.number} marked shipped.`); }}>Mark shipped</button>
            : <button type="button" className="btn primary" disabled title="Buying labels is the next step: rates work now">{chosen ? `Create labels · ${chosen.carrier} ${chosen.service}` : "Create labels"}</button>}
        </div>
      </div>
    </div>
  );
}
