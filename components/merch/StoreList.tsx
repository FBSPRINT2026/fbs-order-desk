"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createStore, listStores, type StoreRow } from "@/app/merch-actions";
import { fmtDate, SHOPPER_STEPS, stepIndex, stepOf, storeImg } from "@/lib/merch";
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
        // a few stores at a time (Nov 1, Nick: "merch stores will never have more than a few at a time… just larger cards"):
        // each store is a card with where it is, its dates and its numbers
        <div className="msc-grid">{list.map((s) => <StoreCard key={s.id} s={s} href={`${base}/${s.id}`} staff={staff} />)}</div>
      )}
      {making && <NewStore customers={customers} staff={staff} stores={rows} onClose={() => setMaking(false)} onMade={(id) => router.push(`${base}/${id}`)} />}
    </>
  );
}

/** one store, big: its look, where it is on the way to delivery, its dates and its numbers */
function StoreCard({ s, href, staff }: { s: StoreRow; href: string; staff: boolean }) {
  const tone = TONE[s.status] || "#7C8799", at = stepIndex(s.status), before = ["draft", "review"].includes(s.status);
  const goal = +(s.giveback_goal || 0);
  const date = (d: string | null) => (d ? fmtDate(d, false) : "—");
  return (
    <Link href={href} className="msc" style={{ ["--msc" as string]: s.brand?.primary || tone }}>
      <div className="msc-top">
        {s.brand?.logo ? <img className="msc-logo" src={storeImg(s.brand.logo)} alt="" /> : <span className="msc-logo msc-mono" aria-hidden>{(s.brand?.school || s.name).slice(0, 1)}</span>}
        <div className="msc-name">
          <b>{s.name}</b>
          <span>{[staff ? s.customer : "", `/s/${s.slug}`].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="pill" style={{ ["--sc" as string]: tone }}>{stepOf(s.status).label}</span>
      </div>
      {before ? <div className="msc-next">{stepOf(s.status).hint}</div> : (
        <ol className="msc-steps" aria-label="Where it is">
          {SHOPPER_STEPS.map((k, i) => <li key={k} className={i < at ? "done" : i === at ? "now" : ""}><i aria-hidden /><span>{stepOf(k).label}</span></li>)}
        </ol>
      )}
      <div className="msc-dates">
        <div><span>Opens</span><b>{date(s.opens_at)}</b></div>
        <div><span>Closes</span><b>{date(s.closes_at)}</b></div>
        <div><span>Deliver by</span><b>{date(s.deliver_by)}</b></div>
      </div>
      <div className="msc-nums">
        <div><b>{s.orders}</b><span>Orders</span></div>
        <div><b>{s.pcs}</b><span>Pieces</span></div>
        <div><b>{money(s.sales)}</b><span>Sales</span></div>
        <div><b>{money(s.giveback)}</b><span>Give-back{goal > 0 ? ` of ${money(goal)}` : ""}</span>{goal > 0 && <em className="msc-bar" aria-hidden><em style={{ width: `${Math.min(100, (s.giveback / goal) * 100)}%` }} /></em>}</div>
      </div>
      {!before && <div className="msc-next">{stepOf(s.status).hint}</div>}
    </Link>
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
