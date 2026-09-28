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

const LAST = "fbs-ship-last-box";
const lastSize = (): { length: number; width: number; height: number } | undefined => {
  try { const v = JSON.parse(localStorage.getItem(LAST) || "null"); return v && v.length && v.width && v.height ? v : undefined; } catch { return undefined; }
};
const rememberSize = (b: Box) => { try { if (boxReady(b)) localStorage.setItem(LAST, JSON.stringify({ length: b.length, width: b.width, height: b.height })); } catch { /* not important */ } };
/** When a rate arrives: the carrier's date, else business days from today. */
export function arrival(r: Rate): Date | null {
  if (r.deliveryDate) { const d = new Date(r.deliveryDate); if (!isNaN(+d)) return d; }
  if (!r.days) return null;
  const d = new Date(); let n = r.days;
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d;
}
const dayName = (d: Date) => d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const niceService = (s: string) => {
  let x = s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/^(fedex|ups|usps)\s+/i, "").trim();
  if (x === x.toUpperCase()) x = x.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); // FEDEX_2_DAY → 2 Day
  return x;
};
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
  // new boxes start at the size used last on this computer, so the usual box is just Tab, Tab, Tab
  const [boxes, setBoxes] = useState<Box[]>(() => (existing?.boxes?.length ? existing.boxes : newBoxes(estimate, lastSize())));
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

  /** Every option with its arrival day, sorted soonest first, tagged Cheapest / Fastest / Recommended. */
  const { options, best } = useMemo(() => {
    const need = t.due ? new Date(t.due.slice(0, 10) + "T23:59") : null;
    const cost = (r: Rate) => (bill === "fbs" ? r.price : r.cost);
    const list = (rates || []).map((r) => { const at = arrival(r); return { r, at, late: !!(need && at && at > need), tags: [] as string[] }; })
      .sort((a, b) => (a.at ? +a.at : 9e15) - (b.at ? +b.at : 9e15) || cost(a.r) - cost(b.r));
    if (!list.length) return { options: list, best: null };
    const cheapest = list.reduce((m, o) => (cost(o.r) < cost(m.r) ? o : m));
    const fastest = list.find((o) => o.at) || list[0];
    const onTime = list.filter((o) => !o.late);
    // best value: the cheapest that makes the in-hands date; with no date, the cheapest unless paying a little more is much faster
    let pickO = onTime.length ? onTime.reduce((m, o) => (cost(o.r) < cost(m.r) ? o : m)) : fastest;
    let why = need ? (onTime.length ? `Cheapest option that arrives by the in-hands date (${dayName(need)}).` : `In-hands date is ${dayName(need)}. Consider calling the customer.`) : "Cheapest option.";
    if (!need && fastest !== cheapest && fastest.at && cheapest.at) {
      const daysSaved = Math.round((+cheapest.at - +fastest.at) / 86400000), extra = cost(fastest.r) - cost(cheapest.r);
      if (daysSaved >= 2 && extra <= Math.max(5, cost(cheapest.r) * 0.15)) { pickO = fastest; why = `Arrives ${daysSaved} days sooner for only ${money(extra)} more.`; }
    }
    cheapest.tags.push("Cheapest"); fastest.tags.push("Fastest"); if (!pickO.tags.includes("Recommended")) pickO.tags.unshift("Recommended");
    list.forEach((o) => { if (o.late) o.tags.push("Late"); });
    return { options: list, best: { ...pickO, why } };
  }, [rates, bill, t.due]);

  // rates pop up by themselves once every box and the address are filled in (and again after a change)
  const rateKey = JSON.stringify([boxes.map((b) => [b.length, b.width, b.height, b.weight]), to.street1, to.city, to.state, to.zip, bill, account, zip]);
  const tried = useRef("");
  useEffect(() => {
    if (!canRate || rates || busy || tried.current === rateKey) return;
    const h = setTimeout(() => { tried.current = rateKey; getRates(); }, 900);
    return () => clearTimeout(h);
  }, [rateKey, canRate, rates, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (best && !rates?.some((r) => `${r.carrier}|${r.service}` === pick)) setPick(`${best.r.carrier}|${best.r.service}`); }, [best]); // eslint-disable-line react-hooks/exhaustive-deps

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
              <div className="sw-presets"><span className="faint">All boxes:</span>{settings.boxes.map((s) => <button key={s.name} type="button" className="chip" onClick={() => sizeAll(s)}>{s.name} {s.length}×{s.width}×{s.height}</button>)}</div>
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
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget.closest("td")?.nextElementSibling?.querySelector("input") as HTMLInputElement | null)?.focus(); } }} aria-label={`Box ${b.n} ${k}`} /><span>in</span></div></td>
                    ))}
                    <td><div className="sw-in w"><input ref={(el) => { refs.current[`w${b.n}`] = el; }} type="number" inputMode="decimal" min={0} step="0.1" value={b.weight}
                      onFocus={(e) => e.target.select()} onChange={(e) => setBox(i, { weight: num(e.target.value) })}
                      onBlur={() => rememberSize(b)}
                      onKeyDown={(e) => {
                        // Tab or Enter after a weight goes to the next box: its weight when its size is filled in (22 Tab 23 Tab 24…), else its length
                        if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
                          rememberSize(b);
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
            <div className="sw-foot">
              <button type="button" className="btn" onClick={addBox}>+ Add a box</button>
              <span className="faint">{boxes.length} box{boxes.length === 1 ? "" : "es"} · {Math.round(totalWeight * 10) / 10} lb total{ready ? "" : " · fill in every size and weight"}</span>
            </div>

            <div className="sw-rates">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>How would you like to ship it?</b>
                <button type="button" className="btn sm" tabIndex={-1} disabled={!canRate || busy !== ""} onClick={getRates}>{busy === "rates" ? "Checking UPS, FedEx, USPS…" : rates ? "Check again" : "Compare rates"}</button>
              </div>
              {busy === "rates" && !rates && <div className="faint" style={{ fontSize: 13 }}>Comparing UPS, FedEx and USPS from {settings.from.zip || "our ZIP"}…</div>}
              {rates ? (options.length ? (
                <>
                  {best && (
                    <div className={"sw-rec" + (best.late ? " late" : "")}>
                      <div className="sw-rec-t">{best.late ? "Nothing arrives by the in-hands date. Fastest:" : "Recommended"}</div>
                      <div className="sw-rec-b"><b>{best.r.carrier} {niceService(best.r.service)}</b> arrives <b>{best.at ? dayName(best.at) : "(no estimate)"}</b>{bill === "fbs" ? <> for <b>{money(best.r.price)}</b></> : " on their account"}</div>
                      <div className="sw-rec-w">{best.why}</div>
                    </div>
                  )}
                  <div className="sw-rate-list">{options.map((o) => {
                    const k = `${o.r.carrier}|${o.r.service}`;
                    return (
                      <label key={k} className={"sw-rate" + (pick === k ? " on" : "") + (o.late ? " late" : "")}>
                        <input type="radio" name="rate" checked={pick === k} onChange={() => setPick(k)} />
                        <span className="sw-rate-n">
                          <b>{o.at ? o.at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "No estimate"}</b>
                          <small>{o.r.carrier} {niceService(o.r.service)}{o.r.days ? ` · ${o.r.days} business day${o.r.days === 1 ? "" : "s"}` : ""}</small>
                        </span>
                        <span className="sw-tags">
                          {o.tags.map((tg) => <span key={tg} className={"sw-tag " + tg.toLowerCase().replace(/\W+/g, "")}>{tg}</span>)}
                        </span>
                        {bill === "fbs"
                          ? <span className="sw-rate-p"><b>{money(o.r.price)}</b><small>we pay {money(o.r.cost)}</small></span>
                          : <span className="sw-rate-p"><b>Their account</b><small>{o.r.price ? `+ ${money(o.r.price)} handling` : `about ${money(o.r.cost)} list`}</small></span>}
                      </label>
                    );
                  })}</div>
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
