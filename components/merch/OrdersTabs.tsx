"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { editOrder, makeJob, setItemPack, setOrderStatus, setStoreStatus, type StoreBundle } from "@/app/merch-actions";
import { bySize, fmtDateTime, isYouthSize, orderCode, packingKey, r2, sizeName, type Field, type MerchOrder } from "@/lib/merch";
import { useSticky } from "@/lib/useSticky";

const money = (n: number) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const LIVE = (o: MerchOrder) => !["cancelled", "refunded", "pending"].includes(o.status);
const ST_LABEL: Record<string, string> = { paid: "To pack", packed: "Packed", delivered: "Delivered", picked_up: "Picked up", shipped: "Shipped", cancelled: "Cancelled", refunded: "Refunded", pending: "Not paid" };
const ST_TONE: Record<string, string> = { paid: "#C98A0C", packed: "#1E9D5B", delivered: "#6B7688", picked_up: "#6B7688", shipped: "#0A8FC0", cancelled: "#B42318", refunded: "#B42318", pending: "#7C8799" };
const fieldsOf = (b: StoreBundle) => (b.store.fields || []) as Field[];
const sortFields = (b: StoreBundle) => fieldsOf(b).filter((f) => f.sort >= 0).sort((a, c) => a.sort - c.sort);
const who = (o: MerchOrder) => o.answers?.student || o.shopper?.name || "";
const pcsOf = (o: MerchOrder) => (o.items || []).reduce((a, i) => a + i.qty, 0);
const print = (b: StoreBundle, what: string, extra = "") => window.open(`/print/store/${b.store.id}?what=${what}${extra}`, "_blank");

/* ------------------------------------------------------------------ orders */

export function OrdersTab({ b, reload }: { b: StoreBundle; reload: () => void }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useSticky<"all" | "open" | "packed" | "cancelled">("store.orders.show", "all");
  const [open, setOpen] = useState<MerchOrder | null>(null);
  const flds = fieldsOf(b).filter((f) => f.kind === "select").slice(0, 2);
  const t = q.trim().toLowerCase();
  const list = b.orders.filter((o) => (show === "all" ? o.status !== "cancelled" : show === "open" ? o.status === "paid" : show === "packed" ? ["packed", "delivered", "picked_up", "shipped"].includes(o.status) : o.status === "cancelled"))
    .filter((o) => !t || [orderCode(b.store, o.number), who(o), o.shopper?.name, o.shopper?.email, ...Object.values(o.answers || {})].join(" ").toLowerCase().includes(t))
    .sort((a, c) => c.number - a.number);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <input style={{ maxWidth: 320 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an order: student, parent, email, order #" />
        <div className="chips">{(["all", "open", "packed", "cancelled"] as const).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{k === "all" ? "All" : k === "open" ? "To pack" : k === "packed" ? "Packed / done" : "Cancelled"}</button>)}</div>
        <span className="spacer" />
        {b.staff && <button type="button" className="btn" onClick={() => print(b, "slips")}>Packing slips</button>}
      </div>
      {!list.length ? <div className="empty">{b.orders.length ? "No orders match." : "No orders yet. Share the store link once it's open."}</div> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Order</th><th>For</th>{flds.map((f) => <th key={f.key}>{f.label}</th>)}<th>Parent</th><th className="r">Pieces</th><th className="r">Total</th><th>Status</th><th>Placed</th></tr></thead>
          <tbody>{list.map((o) => (
            <tr key={o.id} onClick={() => setOpen(o)}>
              <td className="mono">{orderCode(b.store, o.number)}</td>
              <td><b>{who(o)}</b>{(o.changes || []).some((c) => /request/.test(c.by)) && <span className="pill" style={{ ["--sc" as string]: "#B42318", marginLeft: 6 }}>change request</span>}</td>
              {flds.map((f) => <td key={f.key}>{o.answers?.[f.key] || "—"}</td>)}
              <td>{o.shopper?.name}<div className="faint" style={{ fontSize: 12 }}>{o.shopper?.email}</div></td>
              <td className="r">{pcsOf(o)}</td><td className="r">{money(o.total)}</td>
              <td><span className="pill" style={{ ["--sc" as string]: ST_TONE[o.status] }}>{ST_LABEL[o.status] || o.status}</span></td>
              <td className="faint" style={{ fontSize: 12.5 }}>{fmtDateTime(o.created_at)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {open && <OrderSheet b={b} o={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function OrderSheet({ b, o, onClose, onChanged }: { b: StoreBundle; o: MerchOrder; onClose: () => void; onChanged: () => void }) {
  const [ans, setAns] = useState<Record<string, string>>({ ...o.answers });
  const [note, setNote] = useState(o.note || "");
  const [trk, setTrk] = useState(o.tracking || "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [cancelArm, setCancelArm] = useState(false);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => { setBusy(true); setErr(""); const r = await fn(); setBusy(false); if (!r.ok) setErr(r.error || "Couldn't save that."); else onChanged(); };
  const dirty = JSON.stringify(ans) !== JSON.stringify(o.answers) || note !== (o.note || "");
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Order" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pp-sheet" style={{ maxWidth: 720 }}>
        <div className="pp-sheet-h"><div><b className="mono">{orderCode(b.store, o.number)}</b> <span className="faint" style={{ fontSize: 14 }}>· {who(o)} · {money(o.total)} · {o.pay_method || "paid"}</span></div><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="stack" style={{ padding: 18, gap: 14 }}>
          <div className="grid g2">
            {fieldsOf(b).map((f) => (
              <div key={f.key} className="field"><label>{f.label}</label>{!b.staff ? <div>{ans[f.key] || "—"}</div> : f.kind === "select" && f.options.length
                ? <select value={ans[f.key] || ""} onChange={(e) => setAns({ ...ans, [f.key]: e.target.value })}><option value="">—</option>{f.options.map((x) => <option key={x}>{x}</option>)}{ans[f.key] && !f.options.includes(ans[f.key]) && <option>{ans[f.key]}</option>}</select>
                : <input value={ans[f.key] || ""} onChange={(e) => setAns({ ...ans, [f.key]: e.target.value })} />}</div>
            ))}
          </div>
          <div className="faint" style={{ fontSize: 13 }}>{o.shopper.name} · <a href={`mailto:${o.shopper.email}`}>{o.shopper.email}</a>{o.shopper.phone ? ` · ${o.shopper.phone}` : ""} · {o.delivery === "org" ? "deliver to school" : o.delivery === "pickup" ? "pick up at FBS" : `ship to ${[o.ship_to.street1, o.ship_to.city, o.ship_to.state, o.ship_to.zip].filter(Boolean).join(", ")}`}</div>
          <table className="ms-mini"><tbody>{(o.items || []).map((it) => (
            <tr key={it.id}><td><b>{it.name}</b><div className="faint" style={{ fontSize: 12.5 }}>{it.style} · {it.color} · {sizeName(it.size)}{Object.values(it.personalization || {}).length ? ` · ${Object.values(it.personalization).join(", ")}` : ""}</div></td><td className="r">×{it.qty}</td><td className="r">{money(it.qty * it.unit_price)}</td>
              {b.staff && <td><select value={it.pack || ""} onChange={async (e) => { await setItemPack(it.id!, e.target.value as "" | "packed" | "backorder"); onChanged(); }}><option value="">To pack</option><option value="packed">Packed</option><option value="backorder">Back-ordered</option></select></td>}</tr>
          ))}</tbody></table>
          <div className="faint" style={{ fontSize: 13 }}>Items {money(o.subtotal)}{o.shipping ? ` · shipping ${money(o.shipping)}` : ""} · tax {money(o.tax)} · <b>total {money(o.total)}</b> · give-back {money(o.giveback)}</div>
          {(o.changes || []).length > 0 && <div><b style={{ fontSize: 13 }}>Changes and requests</b><ul className="ms-time">{o.changes.map((c, i) => <li key={i}><span className="faint">{fmtDateTime(c.at)} · {c.by}:</span> {c.what}</li>)}</ul></div>}
          {b.staff && <div className="field"><label>Note (staff)</label><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>}
          {err && <div className="pv-err">{err}</div>}
          {b.staff && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {dirty && <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => editOrder(o.id, { answers: ans, note }))}>Save changes</button>}
              {o.status === "paid" && <button type="button" className="btn" disabled={busy} onClick={() => act(() => setOrderStatus(o.id, "packed"))}>Mark packed</button>}
              {["packed", "paid"].includes(o.status) && o.delivery === "pickup" && <button type="button" className="btn" disabled={busy} onClick={() => act(() => setOrderStatus(o.id, "picked_up"))}>Picked up</button>}
              {["packed", "paid"].includes(o.status) && o.delivery === "ship" && <><input style={{ width: 200 }} value={trk} onChange={(e) => setTrk(e.target.value)} placeholder="Tracking #" /><button type="button" className="btn" disabled={busy || !trk.trim()} onClick={() => act(() => setOrderStatus(o.id, "shipped", { tracking: trk }))}>Shipped</button></>}
              {o.status === "packed" && <button type="button" className="btn ghost" disabled={busy} onClick={() => act(() => setOrderStatus(o.id, "paid", { note: "unpacked" }))}>Not packed after all</button>}
              <span className="spacer" />
              <a className="btn ghost" href={`/s/${b.store.slug}/o/${o.token}`} target="_blank" rel="noreferrer">Shopper&apos;s page</a>
              <button type="button" className="btn ghost" onClick={() => window.open(`/print/store/${b.store.id}?what=slips&order=${o.id}`, "_blank")}>Packing slip</button>
              {o.status !== "cancelled" && <button type="button" className={"btn danger" + (cancelArm ? " armed" : "")} disabled={busy} onClick={() => (cancelArm ? act(() => setOrderStatus(o.id, "cancelled")) : setCancelArm(true))}>{cancelArm ? "Sure? Cancel it (refund in Stax)" : "Cancel order"}</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ goods (after close) */

export function GoodsTab({ b, reload }: { b: StoreBundle; reload: () => void }) {
  const [over, setOver] = useSticky<number>("store.goods.overage", 0);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = useMemo(() => {
    const m = new Map<string, { supplier: string; style: string; color: string; sizes: Record<string, number>; total: number }>();
    for (const o of b.orders.filter(LIVE)) for (const it of o.items || []) {
      const p = b.products.find((x) => x.id === it.product_id);
      const sup = p?.imprint?.youth && isYouthSize(it.size) ? p.imprint.youth.supplier : p?.supplier || "";
      const k = `${sup}|${it.style}|${it.color}`;
      const r = m.get(k) || { supplier: sup, style: it.style, color: it.color, sizes: {}, total: 0 };
      r.sizes[it.size] = (r.sizes[it.size] || 0) + it.qty; r.total += it.qty; m.set(k, r);
    }
    return [...m.values()].sort((a, c) => a.supplier.localeCompare(c.supplier) || a.style.localeCompare(c.style) || a.color.localeCompare(c.color));
  }, [b]);
  const sizes = [...new Set(rows.flatMap((r) => Object.keys(r.sizes)))].sort(bySize);
  const plus = (n: number) => (over ? n + Math.ceil((n * over) / 100) : n);
  const csv = () => {
    const lines = [["Supplier", "Style", "Color", ...sizes, "Total"].join(","), ...rows.map((r) => [r.supplier === "ss" ? "S&S" : r.supplier === "sanmar" ? "SanMar" : r.supplier, r.style, `"${r.color}"`, ...sizes.map((z) => (r.sizes[z] ? plus(r.sizes[z]) : "")), sizes.reduce((a, z) => a + (r.sizes[z] ? plus(r.sizes[z]) : 0), 0)].join(","))];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = `${b.store.slug}-blanks.csv`; a.click();
  };
  const st = b.store.status;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {["draft", "review", "open"].includes(st) && <div className="banner">The store is still {st === "open" ? "open" : "being set up"}: these are the totals so far.</div>}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 6 }}>Extra for misprints<select style={{ width: "auto" }} value={over} onChange={(e) => setOver(+e.target.value)}>{[0, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n ? `${n}%` : "none"}</option>)}</select></label>
        <span className="spacer" />
        <button type="button" className="btn" onClick={csv} disabled={!rows.length}>Download CSV</button>
        <button type="button" className="btn" onClick={() => print(b, "blanks", over ? `&over=${over}` : "")} disabled={!rows.length}>Print order sheet</button>
        {b.job ? <Link className="btn" href={`/shop/orders/${b.job.id}`}>Production job #{b.job.number}</Link>
          : <button type="button" className="btn primary" disabled={busy || ["draft", "review", "open"].includes(st) || !rows.length} title={st === "open" ? "Close the store first" : ""} onClick={async () => { setBusy(true); setMsg(null); const r = await makeJob(b.store.id); setBusy(false); if (!r.ok) setMsg({ ok: false, text: r.error }); else { setMsg({ ok: true, text: "Production job made: it's in Orders with every blank, color and size." }); reload(); } }}>Make the production job</button>}
        {st === "closed" && <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); const r = await setStoreStatus(b.store.id, "ordered", { notify: b.store.settings?.notify ?? true }); setBusy(false); if (!r.ok) setMsg({ ok: false, text: r.error }); else { setMsg({ ok: true, text: `Marked goods ordered.${r.data.emailed ? ` Emailed ${r.data.emailed} shoppers.` : ""} Shoppers can't change their orders now.` }); reload(); } }}>Goods ordered</button>}
      </div>
      {msg && <div className={msg.ok ? "okmsg" : "pv-err"}>{msg.text}</div>}
      {!rows.length ? <div className="empty">No orders yet.</div> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Supplier</th><th>Style</th><th>Color</th>{sizes.map((z) => <th key={z} className="r">{z}</th>)}<th className="r">Total</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.supplier + r.style + r.color} style={{ cursor: "default" }}>
              <td>{r.supplier === "ss" ? "S&S" : r.supplier === "sanmar" ? "SanMar" : r.supplier || "—"}</td><td><b>{r.style}</b></td><td>{r.color}</td>
              {sizes.map((z) => <td key={z} className="r">{r.sizes[z] ? plus(r.sizes[z]) : ""}</td>)}
              <td className="r"><b>{sizes.reduce((a, z) => a + (r.sizes[z] ? plus(r.sizes[z]) : 0), 0)}</b></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={3}><b>Total</b></td>{sizes.map((z) => <td key={z} className="r">{rows.reduce((a, r) => a + (r.sizes[z] ? plus(r.sizes[z]) : 0), 0) || ""}</td>)}<td className="r"><b>{rows.reduce((a, r) => a + sizes.reduce((x, z) => x + (r.sizes[z] ? plus(r.sizes[z]) : 0), 0), 0)}</b></td></tr></tfoot>
        </table></div>
      )}
      <div className="faint" style={{ fontSize: 13 }}>Ordering straight from S&amp;S / SanMar when the store closes, and a daily low-stock check while it&apos;s open, are next.</div>
    </div>
  );
}

/* ------------------------------------------------------------------ packing */

export function PackingTab({ b, reload }: { b: StoreBundle; reload: () => void }) {
  const sf = sortFields(b);
  const [q, setQ] = useState("");
  const [hideDone, setHideDone] = useSticky<boolean>("store.pack.hideDone", false);
  const [busy, setBusy] = useState("");
  const live = b.orders.filter(LIVE).sort((a, c) => packingKey(fieldsOf(b), a.answers || {}, a.shopper?.name).localeCompare(packingKey(fieldsOf(b), c.answers || {}, c.shopper?.name)));
  const done = (o: MerchOrder) => o.status !== "paid";
  const groupOf = (o: MerchOrder) => sf.slice(0, 2).map((f) => o.answers?.[f.key] || `No ${f.label.toLowerCase()}`).join(" · ") || (o.delivery === "ship" ? "Ship to home" : o.delivery === "pickup" ? "Pick up at FBS" : "Orders");
  const t = q.trim().toLowerCase();
  const shown = live.filter((o) => (!hideDone || !done(o)) && (!t || [orderCode(b.store, o.number), who(o), o.shopper?.name, ...Object.values(o.answers || {})].join(" ").toLowerCase().includes(t)));
  const groups = [...new Set(shown.map(groupOf))];
  const packedN = live.filter(done).length;
  const pack = async (fn: () => Promise<{ ok: boolean }>, key: string) => { setBusy(key); await fn(); setBusy(""); reload(); };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="panel"><div className="panel-b row" style={{ gap: 12, flexWrap: "wrap" }}>
        <div><b style={{ fontSize: 22 }}>{packedN} of {live.length}</b> <span className="faint">bags packed</span><i className="ms-bar" style={{ width: 220 }}><i style={{ width: `${live.length ? (packedN / live.length) * 100 : 0}%` }} /></i></div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => print(b, "slips")}>Packing slips</button>
        <button type="button" className="btn" onClick={() => print(b, "labels")}>3×1 bag labels</button>
        <button type="button" className="btn" onClick={() => print(b, "boxes")}>Box labels by {sf[0]?.label.toLowerCase() || "group"}</button>
        <button type="button" className="btn" onClick={() => print(b, "handout")}>Hand-out sheets</button>
      </div></div>
      <div className="row" style={{ gap: 10 }}>
        <input style={{ maxWidth: 340 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a bag: student, order #, teacher" autoFocus />
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" style={{ width: "auto" }} checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />Hide packed</label>
        <span className="faint" style={{ fontSize: 13 }}>Sorted by {sf.map((f) => f.label.toLowerCase()).join(" → ") || "order"}, then name: the order the bags go in the boxes.</span>
      </div>
      {!live.length && <div className="empty">No orders to pack.</div>}
      {groups.map((g) => {
        const os = shown.filter((o) => groupOf(o) === g);
        return (
          <div key={g} className="panel">
            <div className="panel-h"><b>{g}</b><span className="faint">{os.filter(done).length} of {os.length} packed · {os.reduce((a, o) => a + pcsOf(o), 0)} piece{os.reduce((a, o) => a + pcsOf(o), 0) === 1 ? "" : "s"}</span>
              <button type="button" className="btn sm ghost" onClick={() => print(b, "slips", `&group=${encodeURIComponent(g)}`)}>Slips for this group</button></div>
            <div className="ms-pack">
              {os.map((o) => (
                <div key={o.id} className={"ms-bag" + (done(o) ? " done" : "")}>
                  <div className="ms-bag-h"><span className="mono">{orderCode(b.store, o.number)}</span><b>{who(o)}</b><span className="faint">{sf.map((f) => o.answers?.[f.key]).filter((v) => v && v !== who(o)).join(" · ")}</span></div>
                  <ul>{(o.items || []).map((it) => (
                    <li key={it.id} className={it.pack || ""}>
                      <button type="button" className="ms-check" aria-label={`${it.name} packed`} aria-pressed={it.pack === "packed"} disabled={!!busy} onClick={() => pack(() => setItemPack(it.id!, it.pack === "packed" ? "" : "packed"), it.id!)}>{it.pack === "packed" ? "✓" : ""}</button>
                      <span><b>{it.qty > 1 ? `${it.qty} × ` : ""}{it.name}</b> <span className="faint">{it.color} · {it.size}{Object.values(it.personalization || {}).length ? ` · ${Object.values(it.personalization).join(", ")}` : ""}</span></span>
                      <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => pack(() => setItemPack(it.id!, it.pack === "backorder" ? "" : "backorder"), it.id!)}>{it.pack === "backorder" ? "back-ordered ✕" : "back-order"}</button>
                    </li>
                  ))}</ul>
                  <div className="row" style={{ gap: 6 }}>
                    {done(o) ? <><span className="pill" style={{ ["--sc" as string]: ST_TONE[o.status] }}>{ST_LABEL[o.status]}</span><button type="button" className="linkbtn" onClick={() => pack(() => setOrderStatus(o.id, "paid", { note: "unpacked" }), o.id)}>undo</button></>
                      : <button type="button" className="btn sm primary" disabled={!!busy || (o.items || []).some((i) => i.pack === "")} title={(o.items || []).some((i) => i.pack === "") ? "Check off every item (or mark it back-ordered) first" : ""} onClick={() => pack(() => setOrderStatus(o.id, "packed"), o.id)}>{busy === o.id ? "…" : "Bag packed"}</button>}
                    <span className="spacer" />
                    <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => window.open(`/print/store/${b.store.id}?what=labels&order=${o.id}`, "_blank")}>label</button>
                    <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => window.open(`/print/store/${b.store.id}?what=slips&order=${o.id}`, "_blank")}>slip</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ give-back report */

export function ReportTab({ b }: { b: StoreBundle }) {
  const live = b.orders.filter(LIVE);
  const rows = useMemo(() => {
    const m = new Map<string, { name: string; size: string; units: number; price: number; base: number; give: number; sales: number; fbs: number; giveback: number }>();
    for (const o of live) for (const it of o.items || []) {
      const k = `${it.name}|${it.size}|${it.unit_price}|${it.giveback}`;
      const r = m.get(k) || { name: it.name, size: it.size, units: 0, price: it.unit_price, base: it.base_price, give: it.giveback, sales: 0, fbs: 0, giveback: 0 };
      r.units += it.qty; r.sales = r2(r.sales + it.qty * it.unit_price); r.fbs = r2(r.fbs + it.qty * it.base_price); r.giveback = r2(r.giveback + it.qty * it.giveback);
      m.set(k, r);
    }
    return [...m.values()].sort((a, c) => a.name.localeCompare(c.name) || bySize(a.size, c.size));
  }, [live]);
  const tot = rows.reduce((a, r) => ({ units: a.units + r.units, sales: r2(a.sales + r.sales), fbs: r2(a.fbs + r.fbs), giveback: r2(a.giveback + r.giveback) }), { units: 0, sales: 0, fbs: 0, giveback: 0 });
  const tax = r2(live.reduce((a, o) => a + +o.tax, 0)), ship = r2(live.reduce((a, o) => a + +o.shipping, 0));
  const goal = +(b.store.giveback?.goal || 0);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="ms-stats">
        <div><span>Give-back to {b.store.brand?.school || b.customer?.name || "the organization"}</span><b>{money(tot.giveback)}</b>{goal > 0 && <small>{Math.round((tot.giveback / goal) * 100)}% of the {money(goal)} goal</small>}</div>
        <div><span>Pieces sold</span><b>{tot.units}</b></div>
        <div><span>Item sales</span><b>{money(tot.sales)}</b></div>
        <div><span>FBS&apos;s share</span><b>{money(tot.fbs)}</b></div>
      </div>
      <div className="row"><span className="faint" style={{ fontSize: 13 }}>{live.length} orders · sales tax collected {money(tax)}{ship ? ` · shipping ${money(ship)}` : ""}. Give-back = the amount added on top of FBS&apos;s price × pieces sold.</span><span className="spacer" />{b.staff && <button type="button" className="btn" onClick={() => print(b, "report")}>Print the report</button>}</div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Product</th><th>Size</th><th className="r">Pieces</th><th className="r">Shopper price</th><th className="r">FBS price</th><th className="r">Give-back each</th><th className="r">Sales</th><th className="r">Give-back</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name + r.size + r.price + r.give} style={{ cursor: "default" }}><td>{r.name}</td><td>{r.size}</td><td className="r">{r.units}</td><td className="r">{money(r.price)}</td><td className="r">{money(r.base)}</td><td className="r">{money(r.give)}</td><td className="r">{money(r.sales)}</td><td className="r"><b>{money(r.giveback)}</b></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}><b>Total</b></td><td className="r"><b>{tot.units}</b></td><td colSpan={3} /><td className="r"><b>{money(tot.sales)}</b></td><td className="r"><b>{money(tot.giveback)}</b></td></tr></tfoot>
      </table></div>
    </div>
  );
}
