"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { custLabel } from "@/lib/format";
import { mergeSettings, type Customer, type Settings, type ShipAddress } from "@/lib/pricing";
import { addressFromText, addressReady, emptyAddress, estimateBoxes, oneLine, trackingLink, BILL_LABEL, type BillTo, type Shipment } from "@/lib/shipping";
import type { PvAddress } from "@/lib/archive";
import ShipWindow, { type ShipTarget } from "@/components/ShipWindow";

type NewRow = { id: string; number: number; nickname: string; qty: number; due_date: string | null; customer_id: string | null; ship_to: string; ship_method: string; po_number: string };
type PvRow = { id: string; visual_id: string; nickname: string; qty: number; due_date: string | null; customer_id: string; po_number: string; status_name: string; ship: PvAddress; delivery: string | null; contact: { fullName?: string; email?: string; phone?: string } | null };
type Item = ShipTarget & { printavo: boolean; shipment: Shipment | null };

const fromPv = (a: PvAddress, c: PvRow["contact"], company: string): ShipAddress => ({
  ...emptyAddress(), company: a?.companyName || company, name: a?.customerName || c?.fullName || "",
  street1: a?.address1 || "", street2: a?.address2 || "", city: a?.city || "", state: a?.state || "", zip: a?.zipCode || "",
  country: !a?.country || /^(us|usa|united states)$/i.test(a.country) ? "US" : a.country, phone: c?.phone || "", email: c?.email || "",
});
const billOf = (c?: Customer): { bill: BillTo; account: string; zip: string } => {
  const b = (c?.ship_bill || "fbs") as BillTo;
  return { bill: b, account: b === "ups" ? c?.ship_ups_account || "" : b === "fedex" ? c?.ship_fedex_account || "" : "", zip: c?.ship_bill_zip || "" };
};
const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—");

/**
 * Shipping center: every order that's ready to ship (new orders marked Ready with delivery "Ship", and Printavo
 * orders in "Shipping - Ready to Ship"), a scan box for box labels, and the ship window.
 */
export default function ShippingCenter() {
  const sb = createClient();
  const [items, setItems] = useState<Item[] | null>(null);
  const [shipped, setShipped] = useState<(Shipment & { label: string; customer: string })[]>([]);
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  const [tab, setTab] = useState<"ready" | "shipped">("ready");
  const [open, setOpen] = useState<{ item: Item; box: number | null } | null>(null);
  const [q, setQ] = useState(""), [scan, setScan] = useState(""), [note, setNote] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [n, p, st] = await Promise.all([
      sb.from("orders").select("id, number, nickname, qty, due_date, customer_id, ship_to, ship_method, po_number").eq("status", "ready").eq("delivery_method", "ship").order("due_date", { ascending: true, nullsFirst: false }),
      sb.from("archived_orders").select("id, visual_id, nickname, qty, due_date, customer_id, po_number, status_name, ship:data->shippingAddress, delivery:data->deliveryMethod, contact:data->contact").ilike("status_name", "%ready to ship%").order("due_date", { ascending: true, nullsFirst: false }).limit(300),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const s = mergeSettings(st.data?.data); setSettings(s);
    const news = (n.data || []) as NewRow[], pvs = (p.data || []) as unknown as PvRow[];
    const custIds = [...new Set([...news.map((o) => o.customer_id), ...pvs.map((o) => o.customer_id)].filter(Boolean))] as string[];
    const [{ data: cs }, { data: ships }] = await Promise.all([
      custIds.length ? sb.from("customers").select("*").in("id", custIds) : Promise.resolve({ data: [] }),
      sb.from("shipments").select("*").neq("status", "void").or([news.length ? `order_id.in.(${news.map((o) => o.id).join(",")})` : "", pvs.length ? `archived_order_id.in.(${pvs.map((o) => o.id).join(",")})` : ""].filter(Boolean).join(",") || "id.is.null"),
    ]);
    const cust = Object.fromEntries(((cs || []) as Customer[]).map((c) => [c.id, c]));
    const shipOf = (key: "order_id" | "archived_order_id", id: string) => ((ships || []) as Shipment[]).filter((x) => x[key] === id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
    const list: Item[] = [
      ...news.map((o): Item => {
        const c = cust[o.customer_id || ""];
        return { kind: "order", printavo: false, id: o.id, number: String(o.number), job: o.nickname, customerId: o.customer_id, customer: custLabel(c) || "—", pieces: o.qty || 0, due: o.due_date,
          to: addressFromText(o.ship_to || c?.ship_address || c?.address || "", c?.name || "", c?.company || ""), service: o.ship_method || "", ...billOf(c), shipment: shipOf("order_id", o.id) };
      }),
      ...pvs.map((o): Item => {
        const c = cust[o.customer_id];
        return { kind: "archived", printavo: true, id: o.id, number: o.visual_id, job: o.nickname, customerId: o.customer_id, customer: custLabel(c) || "—", pieces: o.qty || 0, due: o.due_date,
          to: fromPv(o.ship, o.contact, c?.company || ""), service: /ups|fedex|usps/i.test(o.delivery || "") ? o.delivery || "" : "", ...billOf(c), shipment: shipOf("archived_order_id", o.id) };
      }),
    ].filter((x) => x.shipment?.status !== "shipped");
    setItems(list);

    const { data: done } = await sb.from("shipments").select("*").eq("status", "shipped").order("shipped_at", { ascending: false }).limit(50);
    const d = (done || []) as Shipment[];
    const oIds = d.map((x) => x.order_id).filter(Boolean) as string[], aIds = d.map((x) => x.archived_order_id).filter(Boolean) as string[];
    const [{ data: on }, { data: an }, { data: dc }] = await Promise.all([
      oIds.length ? sb.from("orders").select("id, number").in("id", oIds) : Promise.resolve({ data: [] }),
      aIds.length ? sb.from("archived_orders").select("id, visual_id").in("id", aIds) : Promise.resolve({ data: [] }),
      d.length ? sb.from("customers").select("id, company, name").in("id", d.map((x) => x.customer_id).filter(Boolean) as string[]) : Promise.resolve({ data: [] }),
    ]);
    const lab = new Map<string, string>([...((on || []) as { id: string; number: number }[]).map((x) => [x.id, String(x.number)] as [string, string]), ...((an || []) as { id: string; visual_id: string }[]).map((x) => [x.id, x.visual_id] as [string, string])]);
    const cn = new Map(((dc || []) as { id: string; company: string; name: string }[]).map((x) => [x.id, x.company || x.name]));
    setShipped(d.map((x) => ({ ...x, label: lab.get(x.order_id || x.archived_order_id || "") || "?", customer: cn.get(x.customer_id || "") || "—" })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  /** A scanned box label: "34317-2" (order and box) or just the order number. */
  function onScan(v: string) {
    const m = v.trim().match(/^#?(\d+)(?:-(\d+))?$/);
    setScan("");
    if (!m) return setNote(`“${v}” isn't an order number.`);
    const it = (items || []).find((x) => x.number === m[1]);
    if (!it) return setNote(`#${m[1]} isn't in Ready to ship. Check its status (it has to be ready, with delivery by shipping).`);
    setNote(""); setOpen({ item: it, box: m[2] ? +m[2] : null });
  }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items || []).filter((x) => !t || [x.number, x.customer, x.job, x.to.city].some((s) => String(s || "").toLowerCase().includes(t)));
  }, [items, q]);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Shipping</div><h1>Shipping center</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <input ref={scanRef} className="sc-scan" type="text" autoFocus placeholder="Scan a box label or type an order #" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(scan); } }} aria-label="Scan a box label" />
          <button type="button" className="btn" onClick={() => setShowSettings((x) => !x)}>Settings</button>
        </div>
      </div>
      {note && <div className="banner" style={{ marginBottom: 10 }}>{note}</div>}
      {showSettings && <ShipSettingsPanel s={settings} onSaved={(s) => { setSettings(s); setShowSettings(false); }} />}
      {!addressReady(settings.ship.from) && !showSettings && <div className="banner" style={{ marginBottom: 10 }}>Add our ship-from address in <button type="button" className="linkbtn" style={{ fontSize: "inherit" }} onClick={() => setShowSettings(true)}>Settings</button> so rates can be pulled.</div>}

      <div className="aa-sub" role="tablist" style={{ marginBottom: 10 }}>
        <button type="button" className={tab === "ready" ? "on" : ""} onClick={() => setTab("ready")}>Ready to ship<span className="aa-n">{items?.length ?? "…"}</span></button>
        <button type="button" className={tab === "shipped" ? "on" : ""} onClick={() => setTab("shipped")}>Recently shipped<span className="aa-n">{shipped.length}</span></button>
        <span className="spacer" />
        {tab === "ready" && <label className="aa-search"><input type="search" placeholder="Search order, customer, city" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      </div>

      {tab === "ready" ? (
        items === null ? <div className="empty">Loading…</div> : (
          <div className="aa-card aa-tblcard">
            <table className="aa-tbl">
              <thead><tr><th>#</th><th>Customer</th><th>Job</th><th className="r">Pieces</th><th className="r">Boxes</th><th>Ship to</th><th>Paid by</th><th>In hands</th><th /></tr></thead>
              <tbody>
                {list.map((x) => {
                  const late = x.due && x.due.slice(0, 10) < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={x.kind + x.id} onClick={() => setOpen({ item: x, box: null })} className={late ? "late" : ""}>
                      <td className="num"><Link href={x.kind === "order" ? `/shop/orders/${x.id}` : `/shop/archive/${x.id}`} onClick={(e) => e.stopPropagation()}>{x.number}</Link>{x.printavo && <div className="aa-s">Printavo</div>}</td>
                      <td><div className="aa-t">{x.customer}</div></td>
                      <td>{x.job || <span className="faint">—</span>}</td>
                      <td className="r num">{x.pieces || "—"}</td>
                      <td className="r num">{x.shipment?.boxes?.length || estimateBoxes(x.pieces, settings.ship.perBox)}{!x.shipment && <span className="faint"> est.</span>}</td>
                      <td className="aa-s" style={{ maxWidth: 260 }}>{addressReady(x.to) ? `${x.to.city}, ${x.to.state}` : <span className="bad">Address needed</span>}</td>
                      <td className="aa-s">{x.bill === "fbs" ? "FBS" : `${x.bill === "ups" ? "UPS" : "FedEx"} ${x.account ? "…" + x.account.slice(-4) : "(no #)"}`}</td>
                      <td>{day(x.due)}</td>
                      <td className="r"><button type="button" className="btn primary sm" onClick={(e) => { e.stopPropagation(); setOpen({ item: x, box: null }); }}>{x.shipment ? "Continue" : "Ship"}</button></td>
                    </tr>
                  );
                })}
                {!list.length && <tr><td colSpan={9}><div className="aa-empty">{q ? `No matches for “${q}”.` : "Nothing is waiting to ship. Orders show up here when they're Ready and set to ship (and Printavo orders in “Shipping - Ready to Ship”)."}</div></td></tr>}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="aa-card aa-tblcard">
          <table className="aa-tbl">
            <thead><tr><th>#</th><th>Customer</th><th>Shipped</th><th>Service</th><th className="r">Boxes</th><th>Paid by</th><th>Tracking</th></tr></thead>
            <tbody>
              {shipped.map((s) => (
                <tr key={s.id} style={{ cursor: "default" }}>
                  <td className="num">{s.label}</td>
                  <td>{s.customer}<div className="aa-s">{oneLine(s.ship_to)}</div></td>
                  <td>{s.shipped_at ? new Date(s.shipped_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}</td>
                  <td>{[s.carrier, s.service].filter(Boolean).join(" ") || "—"}</td>
                  <td className="r num">{s.boxes.length}</td>
                  <td className="aa-s">{BILL_LABEL[s.bill_to]}</td>
                  <td className="aa-s">{s.boxes.filter((b) => b.tracking).map((b) => <div key={b.n}><a href={trackingLink(b.tracking!)} target="_blank" rel="noreferrer">{b.tracking}</a></div>)}</td>
                </tr>
              ))}
              {!shipped.length && <tr><td colSpan={7}><div className="aa-empty">Nothing shipped from here yet.</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && <ShipWindow t={open.item} existing={open.item.shipment} settings={settings.ship} focusBox={open.box}
        onClose={() => { setOpen(null); setTimeout(() => scanRef.current?.focus(), 50); }}
        onDone={(m) => { setOpen(null); setNote(m); load(); setTimeout(() => scanRef.current?.focus(), 50); }} />}
    </>
  );
}

/** Pieces per box, our ship-from address, box sizes on hand, and the markup on our own account. */
function ShipSettingsPanel({ s, onSaved }: { s: Settings; onSaved: (s: Settings) => void }) {
  const [v, setV] = useState(s.ship);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const f = (k: keyof ShipAddress, label: string, cls = "") => <label className={cls}>{label}<input type="text" value={v.from[k]} onChange={(e) => setV({ ...v, from: { ...v.from, [k]: e.target.value } })} /></label>;
  const n = (k: "perBox" | "markupPct" | "perBoxFee" | "minCharge" | "thirdPartyFee", label: string, unit: string) => (
    <label>{label}<div className="sw-in"><input type="number" min={0} step="0.01" value={v[k]} onChange={(e) => setV({ ...v, [k]: +e.target.value || 0 })} /><span>{unit}</span></div></label>
  );
  async function save() {
    setBusy(true); setErr("");
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const next = { ...(data?.data || {}), ship: v };
    const { error } = await sb.from("settings").upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) setErr(error.message); else onSaved(mergeSettings(next));
  }
  return (
    <section className="panel sc-set">
      <div className="panel-h"><h2>Shipping settings</h2></div>
      <div className="panel-b stack" style={{ gap: 14 }}>
        <div className="sc-grid">
          <div>
            <div className="sw-h">Ship from (our address)</div>
            <div className="sw-addr">{f("company", "Company", "wide")}{f("name", "Attention", "wide")}{f("street1", "Street", "wide")}{f("street2", "Suite / unit", "wide")}{f("city", "City")}<div className="sw-st">{f("state", "State")}{f("zip", "ZIP")}</div>{f("phone", "Phone")}{f("email", "Email")}</div>
          </div>
          <div>
            <div className="sw-h">Boxes</div>
            <div className="sc-nums">{n("perBox", "Pieces per box (for the estimate)", "pcs")}</div>
            <div className="sw-h" style={{ marginTop: 10 }}>Box sizes we keep</div>
            {v.boxes.map((b, i) => (
              <div key={i} className="sc-box">
                <input type="text" value={b.name} onChange={(e) => setV({ ...v, boxes: v.boxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Box name" />
                {(["length", "width", "height"] as const).map((k) => <input key={k} type="number" min={0} value={b[k]} onChange={(e) => setV({ ...v, boxes: v.boxes.map((x, j) => (j === i ? { ...x, [k]: +e.target.value || 0 } : x)) })} aria-label={k} />)}
                <button type="button" className="btn icon ghost sm" aria-label="Remove size" onClick={() => setV({ ...v, boxes: v.boxes.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => setV({ ...v, boxes: [...v.boxes, { name: "New", length: 0, width: 0, height: 0 }] })}>+ Box size</button>
            <div className="sw-h" style={{ marginTop: 14 }}>What customers pay</div>
            <div className="sc-nums">
              {n("markupPct", "Markup on our account", "%")}
              {n("perBoxFee", "Plus per box", "$")}
              {n("minCharge", "Minimum charge", "$")}
              {n("thirdPartyFee", "Per box on their own account", "$")}
            </div>
          </div>
        </div>
        {err && <div className="pv-err">{err}</div>}
        <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save settings"}</button></div>
      </div>
    </section>
  );
}
