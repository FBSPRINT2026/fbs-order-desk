"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ShipAddress, ShipSettings } from "@/lib/pricing";
import { addressReady, boxReady, BILL_LABEL, carrierOf, estimateBoxes, newBoxes, type BillTo, type Box, type Rate, type Shipment } from "@/lib/shipping";
import { money } from "@/lib/format";
import type { ShipTarget } from "@/components/ShipWindow";
import { useT } from "./lang";

/**
 * Shipping from a phone (the Shipping Center's ship window, made for one hand): the boxes (tap a box size, type the
 * weight), who pays, rates, then save it for the Shipping Center or mark it shipped with tracking numbers. Labels are
 * bought from the Shipping Center (that step isn't on the phone).
 */
const niceService = (s: string) => s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^(fedex|ups|usps)\s+/i, "").replace(/\b\w/g, (c) => c.toUpperCase());
const day = (d?: string | null, loc = "en-US") => (d ? new Date(d).toLocaleDateString(loc, { weekday: "short", month: "short", day: "numeric" }) : "");

export default function MobileShip({ t: tg, existing, settings, box }: { t: ShipTarget; existing: Shipment | null; settings: ShipSettings; box: number | null }) {
  const sb = useMemo(() => createClient(), []);
  const { t, locale } = useT();
  const def = settings.boxes.find((b) => b.name === settings.defaultBox) || settings.boxes[0];
  const [boxes, setBoxes] = useState<Box[]>(() => (existing?.boxes?.length ? existing.boxes : newBoxes(Math.max(box || 0, estimateBoxes(tg.pieces, settings.perBox)), def)));
  const [to, setTo] = useState<ShipAddress>(existing?.ship_to?.street1 ? existing.ship_to : tg.to);
  const [editTo, setEditTo] = useState(!addressReady(existing?.ship_to?.street1 ? existing.ship_to : tg.to));
  const [bill, setBill] = useState<BillTo>(existing?.bill_to || tg.bill);
  const [account, setAccount] = useState(existing?.bill_account || tg.account), [zip, setZip] = useState(existing?.bill_zip || tg.zip);
  const [rates, setRates] = useState<Rate[] | null>(existing?.rates || null);
  const [pick, setPick] = useState(existing?.service ? `${existing.carrier}|${existing.service}` : "");
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [track, setTrack] = useState(false);
  const setBox = (i: number, p: Partial<Box>) => { setBoxes((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b))); setRates(null); };
  const ready = boxes.length > 0 && boxes.every(boxReady) && addressReady(to) && (bill === "fbs" || (!!account.trim() && !!zip.trim()));
  const chosen = rates?.find((r) => `${r.carrier}|${r.service}` === pick) || null;
  const cost = (r: Rate) => (bill === "fbs" ? r.price : r.cost);
  const sorted = (rates || []).slice().sort((a, b) => cost(a) - cost(b));

  async function getRates() {
    setBusy("rates"); setMsg(null);
    const r = await fetch("/api/shipping/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, boxes, bill, account, zip, reference: `#${tg.number}` }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline" };
    setBusy("");
    if (!r?.ok || j.error) return setMsg({ ok: false, text: t(j.error || "Couldn't get rates.") });
    const list = j.rates as Rate[];
    setRates(list);
    if (list.length && !list.some((x) => `${x.carrier}|${x.service}` === pick)) { const c = list.slice().sort((a, b) => cost(a) - cost(b))[0]; setPick(`${c.carrier}|${c.service}`); }
  }
  async function save(status: Shipment["status"]) {
    setBusy("save"); setMsg(null);
    const row = {
      order_id: tg.kind === "order" ? tg.id : null, archived_order_id: tg.kind === "archived" ? tg.id : null, customer_id: tg.customerId,
      ship_to: to, bill_to: bill, bill_account: bill === "fbs" ? "" : account.trim(), bill_zip: bill === "fbs" ? "" : zip.trim(),
      carrier: chosen?.carrier || existing?.carrier || "", service: chosen?.service || existing?.service || "", boxes, rates,
      cost: chosen && bill === "fbs" ? chosen.cost : existing?.cost ?? null, price: chosen ? chosen.price : existing?.price ?? null, note: existing?.note || "",
      status, updated_at: new Date().toISOString(), ...(status === "shipped" ? { shipped_at: new Date().toISOString() } : {}),
    };
    const { error } = existing ? await sb.from("shipments").update(row).eq("id", existing.id) : await sb.from("shipments").insert(row);
    if (!error && status === "shipped" && tg.kind === "order") await sb.from("orders").update({ tracking: boxes.map((b) => (b.tracking || "").trim()).filter(Boolean).join(", "), ship_method: chosen ? `${chosen.carrier} ${chosen.service}` : tg.service }).eq("id", tg.id);
    setBusy("");
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: t(status === "shipped" ? "Marked shipped." : "Saved. It's ready in the Shipping Center.") });
  }
  const f = (k: keyof ShipAddress, label: string) => <label className={k === "street1" || k === "company" || k === "name" ? "wide" : ""}>{t(label)}<input value={to[k]} onChange={(e) => { setTo({ ...to, [k]: e.target.value }); setRates(null); }} /></label>;

  return (
    <>
      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Ship to")}</b><button type="button" className="jm-link" onClick={() => setEditTo(!editTo)}>{editTo ? t("Done") : t("Edit")}</button></div>
        {editTo ? <div className="jm-addr">{f("company", "Company")}{f("name", "Attention")}{f("street1", "Street")}{f("street2", "Suite")}{f("city", "City")}{f("state", "State")}{f("zip", "ZIP")}{f("phone", "Phone")}</div>
          : <p className="jm-pre" style={{ margin: 0 }}>{[to.company, to.name, to.street1, to.street2, `${to.city}, ${to.state} ${to.zip}`].filter((x) => x && x.trim() && x !== ",  ").join("\n")}</p>}
      </div>

      <div className="jm-card">
        <div className="jm-cardh"><b>{t("Boxes")}</b><span className="jm-faint">{t("{0} pcs", tg.pieces)}</span></div>
        {boxes.map((b, i) => (
          <div key={i} className={"jm-sbox" + (box === b.n ? " on" : "")}>
            <div className="jm-sbox-h"><b>{t("Box {0}", b.n)}</b>{boxes.length > 1 && <button type="button" className="jm-link" onClick={() => { setBoxes(boxes.filter((_, j) => j !== i).map((x, j) => ({ ...x, n: j + 1 }))); setRates(null); }}>{t("Remove")}</button>}</div>
            <div className="jm-chips">{settings.boxes.map((s) => { const on = +b.length === s.length && +b.width === s.width && +b.height === s.height; return <button key={s.name} type="button" className={"jm-chip" + (on ? " on" : "")} onClick={() => setBox(i, { length: s.length, width: s.width, height: s.height })}>{s.name} <small>{s.length}×{s.width}×{s.height}</small></button>; })}</div>
            <div className="jm-dims">
              {(["length", "width", "height"] as const).map((k) => <label key={k}>{t(k[0].toUpperCase() + "|dim")}<input inputMode="decimal" value={b[k]} onChange={(e) => setBox(i, { [k]: e.target.value === "" ? "" : +e.target.value || 0 })} /></label>)}
              <label className="w">{t("Weight (lb)")}<input inputMode="decimal" value={b.weight} autoFocus={i === 0 && box === null} onChange={(e) => setBox(i, { weight: e.target.value === "" ? "" : +e.target.value || 0 })} /></label>
            </div>
            {track && <label className="jm-trk">{t("Tracking #")}<input value={b.tracking || ""} onChange={(e) => setBox(i, { tracking: e.target.value.trim() })} placeholder="1Z… / 7…" />{b.tracking && carrierOf(b.tracking) ? <small>{carrierOf(b.tracking)}</small> : null}</label>}
          </div>
        ))}
        <button type="button" className="jm-ghost" onClick={() => { const l = boxes[boxes.length - 1]; setBoxes([...boxes, { n: boxes.length + 1, length: l?.length ?? "", width: l?.width ?? "", height: l?.height ?? "", weight: "" }]); setRates(null); }}>{t("+ Add a box")}</button>
      </div>

      <div className="jm-card">
        <div className="jm-label">{t("Who pays")}</div>
        <div className="jm-chips">{(["fbs", "ups", "fedex"] as BillTo[]).map((k) => <button key={k} type="button" className={"jm-chip" + (bill === k ? " on" : "")} onClick={() => { setBill(k); setRates(null); }}>{t(BILL_LABEL[k])}</button>)}</div>
        {bill !== "fbs" && <div className="jm-addr"><label className="wide">{t(bill === "ups" ? "UPS account #" : "FedEx account #")}<input value={account} onChange={(e) => { setAccount(e.target.value); setRates(null); }} /></label><label>{t("Billing ZIP")}<input inputMode="numeric" value={zip} onChange={(e) => { setZip(e.target.value); setRates(null); }} /></label></div>}
      </div>

      <div className="jm-card">
        <button type="button" className="jm-go" disabled={!ready || !!busy} onClick={getRates}>{busy === "rates" ? t("Getting rates…") : rates ? t("Get rates again") : t("Get rates")}</button>
        {!ready && <p className="jm-faint">{t(addressReady(to) ? "Every box needs its size and weight." : "Every box needs its size and weight, and the address has to be complete.")}</p>}
        {sorted.length > 0 && <div className="jm-rates">{sorted.map((r) => { const k = `${r.carrier}|${r.service}`; return (
          <label key={k} className={"jm-rate" + (pick === k ? " on" : "")}><input type="radio" name="rate" checked={pick === k} onChange={() => setPick(k)} />
            <span><b>{r.carrier} {niceService(r.service)}</b><small>{r.deliveryDate ? t("Arrives {0}", day(r.deliveryDate, locale)) : r.days ? (r.days === 1 ? t("1 business day") : t("{0} business days", r.days)) : ""}</small></span><b>{money(cost(r))}</b></label>
        ); })}</div>}
      </div>

      <div className="jm-card">
        {msg && <div className={msg.ok ? "jm-ok" : "jm-err"} role="status">{msg.text}</div>}
        <button type="button" className="jm-go" disabled={!!busy || !boxes.every(boxReady)} onClick={() => save(existing?.status === "shipped" ? "shipped" : "draft")}>{busy === "save" ? t("Saving…") : t("Save for the Shipping Center")}</button>
        {!track ? <button type="button" className="jm-ghost" onClick={() => setTrack(true)}>{t("Shipped already? Add tracking numbers")}</button>
          : <button type="button" className="jm-ghost" disabled={!!busy || !boxes.some((b) => b.tracking)} onClick={() => save("shipped")}>{t("Mark shipped")}</button>}
        <p className="jm-faint">{t("Buying the carrier labels happens in the Shipping Center.")}</p>
      </div>
    </>
  );
}
