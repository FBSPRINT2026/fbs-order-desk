"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TRACK, trackingUrl } from "@/lib/goods";
import type { PendingShipment } from "@/lib/manifest";

const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "");
const supName = (s: string) => (s === "sanmar" ? "SanMar" : s === "ss" ? "S&S Activewear" : s);
const orderLabel = (o: PendingShipment["orders"][number]) => `${o.printavo ? "Printavo " : ""}#${o.number}${o.nickname ? ` ${o.nickname}` : ""}${o.po ? ` · PO ${o.po}` : ""}`;
/** every line id behind a row (a row can cover several boxes) */
const idsOf = (rowId: string) => rowId.split(",").filter(Boolean);

function Head({ g, staff }: { g: PendingShipment; staff: boolean }) {
  const arrived = g.tracking.length > 0 && g.tracking.every((t) => t.delivered);
  return (
    <div className="in-h">
      <div className="in-t">
        <span className={"in-badge" + (arrived ? " here" : "")}>{arrived ? "Arrived · not linked to an order" : "Incoming · not linked to an order"}</span>
        {staff && <b>{g.us ? "FBS (our blanks)" : g.customer?.name || g.customer_name}</b>}
        {staff && !g.us && g.customer && g.customer.name.toLowerCase() !== g.customer_name.toLowerCase() && <span className="faint">on the manifest as {g.customer_name}{g.customer_account ? ` (account ${g.customer_account})` : ""}</span>}
      </div>
      <div className="in-m">
        {supName(g.supplier)} order <b>{g.supplier_order || "—"}</b> · PO <b>{g.customer_po || "none"}</b>{g.ship_date ? ` · shipped ${day(g.ship_date)}` : ""} · {g.boxes} box{g.boxes === 1 ? "" : "es"} · {g.pcs} pcs · {g.styles}
      </div>
      {g.tracking.length > 0 && (
        <ul className="in-trk">{g.tracking.map((t) => (
          <li key={t.tracking || "local"}>
            {t.tracking ? <a href={trackingUrl(t.carrier, t.tracking)} target="_blank" rel="noreferrer">{t.carrier} {t.tracking}</a> : <span>{t.carrier} · {t.detail}</span>}
            {t.status && <span className="rv-st"> {TRACK[t.status] || t.status}</span>}
            {t.eta && !t.delivered && <span className="faint"> · arrives {day(t.eta)}</span>}
            {t.tracking && t.detail && <span className="faint"> · {t.detail}</span>}
          </li>
        ))}</ul>
      )}
    </div>
  );
}

/** The customer's view: "these goods are for order #…" (whole shipment, or as we suggested). */
export function PortalIncoming({ list, canAct, link }: { list: PendingShipment[]; canAct: boolean; link: (pick: { lineId: string; orderId: string }[]) => Promise<{ ok: boolean; error?: string }> }) {
  if (!list.length) return null;
  return (
    <div className="in-list">
      <p className="muted" style={{ margin: "0 0 6px", fontSize: 13.5 }}>Your supplier shipped these to us, but we can&apos;t tell which order they&apos;re for. Tell us and we&apos;ll track them on that order.</p>
      {list.map((g) => <PortalRow key={g.key} g={g} canAct={canAct} link={link} />)}
    </div>
  );
}
function PortalRow({ g, canAct, link }: { g: PendingShipment; canAct: boolean; link: (pick: { lineId: string; orderId: string }[]) => Promise<{ ok: boolean; error?: string }> }) {
  const sugg = [...new Set(g.lines.map((l) => l.suggest).filter(Boolean))] as string[];
  const [pick, setPick] = useState(sugg.length === 1 ? sugg[0] : "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [done, setDone] = useState(false);
  const allSuggested = g.lines.every((l) => l.suggest);
  async function go(rows: { lineId: string; orderId: string }[]) { setBusy(true); setErr(""); const r = await link(rows); setBusy(false); if (!r.ok) return setErr(r.error || "Couldn't link."); setDone(true); }
  if (done) return <article className="in-card"><div className="okmsg">Linked. You&apos;ll see the tracking on the order.</div></article>;
  return (
    <article className="in-card">
      <Head g={g} staff={false} />
      {canAct && (
        <div className="in-a">
          {sugg.length > 1 && allSuggested && (
            <button type="button" className="btn primary sm" disabled={busy} onClick={() => go(g.lines.flatMap((l) => idsOf(l.id).map((id) => ({ lineId: id, orderId: l.suggest! }))))}>
              Yes: split across {sugg.map((id) => "#" + (g.orders.find((o) => o.id === id)?.number || "?")).join(", ")}
            </button>
          )}
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Which order are these goods for">
            <option value="">{g.orders.length ? "Which order are these for?" : "No open orders yet"}</option>
            {g.orders.map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}{sugg.includes(o.id) ? " (our guess)" : ""}</option>)}
          </select>
          <button type="button" className={"btn sm" + (sugg.length > 1 ? "" : " primary")} disabled={busy || !pick} onClick={() => go(g.lines.flatMap((l) => idsOf(l.id).map((id) => ({ lineId: id, orderId: pick }))))}>{busy ? "Linking…" : "Link all to this order"}</button>
          {!g.orders.length && <small className="faint">When you send us the order for these, they&apos;ll link up automatically if the PO matches ({g.customer_po || "no PO on the shipment"}).</small>}
        </div>
      )}
      {err && <div className="bad" style={{ fontSize: 12.5 }}>{err}</div>}
    </article>
  );
}

/**
 * Staff resolution center: every manifest shipment not on an order yet.
 *   - unknown supplier account → "Who is X in our system?" (remembered)
 *   - our guess, line by line (one PO can be several orders: matched by style / color / size) → OK or change, then Link
 *   - our blanks ("FBS") → type the order #
 */
export function ResolveList({ list, onDone, empty }: { list: PendingShipment[]; onDone: () => void; empty?: string }) {
  if (!list.length) return <div className="gb-empty">{empty || "Nothing to resolve. Every shipment on the manifests is on its order."}</div>;
  return <div className="in-list">{list.map((g) => <ResolveRow key={g.key} g={g} onDone={onDone} />)}</div>;
}

async function post(body: unknown) {
  const r = await fetch("/api/goods/manifest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "Couldn't save.");
  return j;
}

function ResolveRow({ g, onDone }: { g: PendingShipment; onDone: () => void }) {
  const [sel, setSel] = useState<Record<string, string>>(() => Object.fromEntries(g.lines.map((l) => [l.id, l.suggest || ""])));
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [who, setWho] = useState(""), [custs, setCusts] = useState<{ id: string; label: string }[]>([]);
  const [num, setNum] = useState("");
  const [open, setOpen] = useState(g.lines.some((l) => l.suggest) || g.orders.length > 0);
  const unknown = !g.us && !g.customer;
  useEffect(() => {
    if (!unknown) return;
    createClient().from("customers").select("id, company, name").order("company").limit(3000)
      .then(({ data }) => setCusts(((data || []) as { id: string; company: string; name: string }[]).map((c) => ({ id: c.id, label: c.company || c.name })).filter((c) => c.label)));
  }, [unknown]);
  const suggested = g.lines.some((l) => l.suggest);
  const unchanged = g.lines.every((l) => (sel[l.id] || "") === (l.suggest || ""));
  const ready = g.lines.every((l) => sel[l.id]);
  const byOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of g.lines) if (sel[l.id]) m.set(sel[l.id], (m.get(sel[l.id]) || 0) + l.qty);
    return [...m.entries()].map(([id, pcs]) => ({ o: g.orders.find((x) => x.id === id), pcs }));
  }, [sel, g]);
  async function run(body: unknown) { setBusy(true); setErr(""); try { await post(body); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } setBusy(false); }
  const linkAll = () => run({ link: g.lines.filter((l) => sel[l.id]).flatMap((l) => idsOf(l.id).map((id) => ({ lineId: id, orderId: sel[l.id] }))) });
  async function blanks() {
    const { data } = await createClient().from("orders").select("id").eq("number", +num.replace(/\D/g, "")).maybeSingle();
    if (!data) return setErr(`No order #${num}.`);
    run({ assign: { lineIds: g.lineIds, orderId: data.id, kind: "blanks" } });
  }
  const picked = custs.find((c) => c.label.toLowerCase() === who.trim().toLowerCase());

  return (
    <article className={"in-card" + (suggested ? " sugg" : "")}>
      <Head g={g} staff />
      {unknown ? (
        <div className="in-a">
          <span>Who is <b>{g.customer_name}</b> in our system?</span>
          <input type="text" list={`in-c-${g.key}`} placeholder="Type the customer…" value={who} onChange={(e) => setWho(e.target.value)} aria-label={`Which customer is ${g.customer_name}`} />
          <datalist id={`in-c-${g.key}`}>{custs.map((c) => <option key={c.id} value={c.label} />)}</datalist>
          <button type="button" className="btn primary sm" disabled={busy || !picked} onClick={() => run({ alias: { supplier: g.supplier, name: g.customer_name, account: g.customer_account, customerId: picked!.id } })}>{busy ? "Saving…" : "Remember"}</button>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run({ ignore: g.lineIds })}>Ignore</button>
          <small className="faint">From now on every {supName(g.supplier)} shipment from {g.customer_account ? `account ${g.customer_account}` : `“${g.customer_name}”`} goes to that customer.</small>
        </div>
      ) : g.us ? (
        <div className="in-a">
          <span>Our blanks for order</span>
          <input type="text" inputMode="numeric" placeholder="Order #" value={num} onChange={(e) => setNum(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && num) blanks(); }} aria-label="Order number" style={{ width: 110 }} />
          <button type="button" className="btn primary sm" disabled={busy || !num} onClick={blanks}>{busy ? "Saving…" : "Link"}</button>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run({ ignore: g.lineIds })}>Ignore</button>
        </div>
      ) : (
        <>
          {suggested && <div className="in-sugg"><b>Our guess:</b> {byOrder.map((x) => `#${x.o?.number || "?"} (${x.pcs} pcs)`).join(" + ")}{g.how ? <span className="faint"> · {g.how}</span> : null}</div>}
          {!g.orders.length && <div className="faint" style={{ fontSize: 13 }}>{g.customer?.name} has no open wholesale orders. These stay here (and on their portal as incoming) until an order with PO {g.customer_po || "—"} shows up, then they link on their own.</div>}
          {g.orders.length > 0 && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="linkbtn" onClick={() => setOpen((x) => !x)}>{open ? "Hide items" : `Show ${g.lines.length} item${g.lines.length === 1 ? "" : "s"}`}</button>
                <label className="row" style={{ gap: 6, fontSize: 13 }}>All to
                  <select value="" onChange={(e) => { const v = e.target.value; if (v) setSel(Object.fromEntries(g.lines.map((l) => [l.id, v]))); }} style={{ width: "auto" }} aria-label="Put every item on one order">
                    <option value="">pick an order…</option>
                    {g.orders.map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}</option>)}
                  </select>
                </label>
              </div>
              {open && (
                <div style={{ overflowX: "auto" }}><table className="rv-tbl in-tbl">
                  <thead><tr><th>Garment</th><th>Color</th><th>Size</th><th className="r">Shipped</th><th>Order</th></tr></thead>
                  <tbody>{g.lines.map((l) => (
                    <tr key={l.id} className={!sel[l.id] ? "miss" : ""}>
                      <td>{[l.mill, l.style].filter(Boolean).join(" ")}</td><td>{l.color}</td><td>{l.size}</td>
                      <td className="r">{l.qty}{l.ordered > l.qty ? <span className="bad" title="Ordered more than shipped"> / {l.ordered}</span> : null}</td>
                      <td><select value={sel[l.id] || ""} onChange={(e) => setSel({ ...sel, [l.id]: e.target.value })} aria-label={`Order for ${l.style} ${l.color} ${l.size}`}>
                        <option value="">Not sure</option>
                        {g.orders.map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}{l.suggest === o.id ? " ✓ guess" : ""}</option>)}
                      </select></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              <div className="in-a">
                <button type="button" className="btn primary sm" disabled={busy || !byOrder.length} onClick={linkAll}>
                  {busy ? "Linking…" : suggested && unchanged ? "OK, link as suggested" : ready ? "Link" : `Link the ${g.lines.filter((l) => sel[l.id]).length} picked`}
                </button>
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run({ ignore: g.lineIds })}>Ignore</button>
                <small className="faint">The customer gets the tracking on each order and a note in its goods conversation.</small>
              </div>
            </>
          )}
        </>
      )}
      {err && <div className="bad" style={{ fontSize: 12.5 }}>{err}</div>}
    </article>
  );
}
