"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createStore, listStores, type StoreRow } from "@/app/merch-actions";
import { fmtDate, stepOf } from "@/lib/merch";
import { useSticky } from "@/lib/useSticky";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const TONE: Record<string, string> = { draft: "#7C8799", review: "#6477D6", open: "#1E9D5B", closed: "#C98A0C", ordered: "#C98A0C", production: "#E0582E", packing: "#A152C9", ready: "#0A8FC0", delivered: "#6B7688" };

/** Every merch store, by where it is (open now, to produce, done). `base` is /shop/stores or /portal/stores. */
export default function StoreList({ base }: { base: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<StoreRow[] | null>(null), [staff, setStaff] = useState(false), [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState("");
  const [show, setShow] = useSticky<"active" | "done" | "all">("stores.show", "active");
  const [making, setMaking] = useState(false);
  useEffect(() => { listStores().then((r) => { if (!r.ok) return setErr(r.error); setRows(r.data.stores); setStaff(r.data.staff); setCustomers(r.data.customers); }); }, []);
  if (err) return <div className="pv-err">{err}</div>;
  if (!rows) return <div className="empty">Loading…</div>;
  const done = (s: StoreRow) => s.status === "delivered";
  const list = rows.filter((s) => (show === "all" ? true : show === "done" ? done(s) : !done(s)));
  const open = rows.filter((s) => s.status === "open");
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Sales</div><h1>Merch Stores</h1></div>
        <button type="button" className="btn primary" onClick={() => setMaking(true)}>+ New store</button>
      </div>
      {open.length > 0 && <p className="muted" style={{ marginTop: 0 }}>{open.length} open now: {open.reduce((a, s) => a + s.orders, 0)} orders, {open.reduce((a, s) => a + s.pcs, 0)} pieces, {money(open.reduce((a, s) => a + s.sales, 0))} so far.</p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="chips">{(["active", "done", "all"] as const).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{k === "active" ? "In progress" : k === "done" ? "Delivered" : "All"}</button>)}</div>
      </div>
      {!list.length ? <div className="empty">{rows.length ? "Nothing here." : "No stores yet. Make the first one: pick the school, add their designs on a few shirts, set the close date."}</div> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Store</th>{staff && <th>Customer</th>}<th>Status</th><th>Closes</th><th className="r">Orders</th><th className="r">Pieces</th><th className="r">Sales</th><th className="r">Give-back</th></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id} onClick={() => router.push(`${base}/${s.id}`)}>
              <td><Link href={`${base}/${s.id}`} onClick={(e) => e.stopPropagation()}><b>{s.name}</b></Link><div className="faint" style={{ fontSize: 12 }}>/s/{s.slug}</div></td>
              {staff && <td>{s.customer || "—"}</td>}
              <td><span className="pill" style={{ ["--sc" as string]: TONE[s.status] || "#7C8799" }}>{stepOf(s.status).label}</span></td>
              <td>{s.closes_at ? fmtDate(s.closes_at, false) : "—"}</td>
              <td className="r">{s.orders}</td><td className="r">{s.pcs}</td><td className="r">{money(s.sales)}</td><td className="r">{money(s.giveback)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {making && <NewStore customers={customers} staff={staff} stores={rows} onClose={() => setMaking(false)} onMade={(id) => router.push(`${base}/${id}`)} />}
    </>
  );
}

function NewStore({ customers, staff, stores, onClose, onMade }: { customers: { id: string; name: string }[]; staff: boolean; stores: StoreRow[]; onClose: () => void; onMade: (id: string) => void }) {
  const [cust, setCust] = useState<{ id: string; name: string } | null>(customers.length === 1 && !staff ? customers[0] : null);
  const [who, setWho] = useState(""), [name, setName] = useState(""), [copy, setCopy] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const typed = who.trim().toLowerCase();
  const hits = typed.length >= 2 ? customers.filter((c) => c.name.toLowerCase().includes(typed)).slice(0, 8) : [];
  const theirs = stores.filter((s) => s.customer_id === cust?.id);
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="New store" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pp-sheet" style={{ maxWidth: 520 }}>
        <div className="pp-sheet-h"><b>New merch store</b><button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="stack" style={{ padding: 16, gap: 12 }}>
          <div className="field">
            <label>School or group</label>
            {cust ? <div className="row" style={{ gap: 8 }}><b>{cust.name}</b>{(staff || customers.length > 1) && <button type="button" className="linkbtn" onClick={() => { setCust(null); setWho(""); }}>Change</button>}</div> : <>
              <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Start typing the customer…" autoFocus />
              {hits.length > 0 && <div className="stack" style={{ gap: 2 }}>{hits.map((c) => <button key={c.id} type="button" className="linkbtn" style={{ textAlign: "left" }} onClick={() => { setCust(c); setWho(""); if (!name) setName(`${c.name.replace(/\s*PTA$/i, "")} Spirit Store`); }}>{c.name}</button>)}</div>}
            </>}
          </div>
          <div className="field"><label>Store name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Whitt Elementary Spirit Wear, Fall 2026" /></div>
          {theirs.length > 0 && <div className="field"><label>Start from an earlier store (copies the look, questions and products)</label><select value={copy} onChange={(e) => setCopy(e.target.value)}><option value="">Start fresh</option>{theirs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row"><span className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy || !name.trim() || (!cust && !staff)} onClick={async () => {
              setBusy(true); setErr("");
              const r = await createStore({ customer_id: cust?.id || null, name, copyFrom: copy || undefined });
              if (!r.ok) { setBusy(false); return setErr(r.error); }
              onMade(r.data.id);
            }}>{busy ? "Making it…" : "Make the store"}</button></div>
        </div>
      </div>
    </div>
  );
}
