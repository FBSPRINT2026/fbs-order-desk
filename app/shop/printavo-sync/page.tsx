"use client";
import Link from "next/link";
import { allRows } from "@/lib/readAll";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calcOrder, mergeSettings, type Order, type Settings } from "@/lib/pricing";
import { cardFix, printavoChanges, sigOf, snapOf, type Change } from "@/lib/printavoChanges";
import { custLabel } from "@/lib/format";
import { useRole } from "@/components/RoleContext";
import { useSticky } from "@/lib/useSticky";

/**
 * Printavo Sync: the 40,000-series orders whose Printavo copy has changes not accepted here yet (quantities, prices,
 * fees), each with what changed, to accept one by one or all at once without opening every order.
 */
type Row = Order & { printavo_visual_id?: string | null; printavo_state?: Record<string, unknown> | null; customers?: { company?: string; name?: string } | null };
const when = (d?: string) => (d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default function PrintavoSyncPage() {
  const { realRole } = useRole();
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null), [settings, setSettings] = useState<Settings>(mergeSettings({}));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState(""), [busy, setBusy] = useState(""), [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => {
    const [{ data, error }, { data: st }] = await Promise.all([
      allRows((a, b) => sb.from("orders").select("*, customers(company, name)").not("printavo_id", "is", null).gte("number", 40000).lt("number", 50000).order("number", { ascending: false }).order("id").range(a, b)),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    if (error) return setErr(error.message);
    const ids = (data || []).map((x) => x.id as string);
    const { data: oi } = ids.length ? await sb.from("order_internal").select("order_id, production_notes").in("order_id", ids) : { data: [] };
    setNotes(Object.fromEntries((oi || []).map((x) => [x.order_id as string, String(x.production_notes || "")])));
    setSettings(mergeSettings(st?.data)); setRows((data || []) as Row[]);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  const list = (rows || []).map((o) => {
    const calc = calcOrder(o, settings), snap = snapOf(o);
    const { changes, info } = printavoChanges(o, calc, snap, notes[o.id] ?? "");
    return { o, calc, snap, changes, info, card: cardFix(o, snap) };
  });
  const waiting = list.filter((x) => x.changes.length || x.card);
  // every order's total against Printavo's (Nov 3, Nick: McKenna, Nine18, Cedar and Methodist balances didn't match
  // Printavo's): each gap with why, so it gets fixed on purpose instead of found by a customer
  const [view, setView] = useSticky<"waiting" | "totals">("printavoSync.view", "waiting");
  const gaps = list.filter((x) => x.snap && Math.abs(x.calc.total - x.snap.total) > 0.005).map((x) => {
    const o = x.o as Row & { updated_at?: string };
    const editedHere = !!o.updated_at && !!x.snap && new Date(o.updated_at).getTime() > new Date(x.snap.at).getTime() + 60_000;
    const why = x.changes.length || x.card ? "Changed in Printavo: accept or ignore the changes on the Waiting tab to match."
      : editedHere ? "Changed here since Printavo was last read. Check Printavo now; if it still differs, Reset in Printavo sends ours."
      : "Hasn't matched since it was sent (a fee or amount didn't arrive in Printavo). Reset in Printavo sends ours again.";
    return { ...x, gap: Math.round((x.calc.total - (x.snap?.total || 0)) * 100) / 100, why };
  });
  const shown = view === "totals" ? gaps : showAll ? list : waiting;
  const [checking, setChecking] = useState("");
  /** read every order that differs from Printavo again, one at a time (Printavo limits how fast it answers) */
  async function checkAll() {
    const ids = gaps.map((x) => x.o);
    for (let i = 0; i < ids.length; i++) {
      setChecking(`Checking ${i + 1} of ${ids.length}…`);
      await fetch("/api/printavo/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: ids[i].id, action: "refresh" }) }).catch(() => null);
    }
    setChecking(""); await load();
  }

  /** apply changes to one order and save it (with its new total), the same as editing it on the order page */
  async function accept(o: Row, picks: Change[]) {
    setBusy(o.id); setErr("");
    const d: Row = JSON.parse(JSON.stringify(o));
    for (const c of picks) c.apply?.(d);
    cardFix(d, snapOf(d))?.apply(d);
    const c = calcOrder(d, settings);
    // every field a change can touch, not just the lines and fees (Oct 20, Nick: accepting a production date left it on
    // the list: the new date was never saved). Only the ones that changed, so nothing else on the order is written over.
    const FIELDS = ["nickname", "due_date", "production_date", "po_number", "notes", "discount_type", "discount_pct", "discount_amt", "tax_exempt", "tax_rate"] as const;
    const before = o as unknown as Record<string, unknown>, after = d as unknown as Record<string, unknown>;
    const more = Object.fromEntries(FIELDS.filter((k) => JSON.stringify(after[k] ?? null) !== JSON.stringify(before[k] ?? null)).map((k) => [k, after[k] ?? null]));
    const { error } = await sb.from("orders").update({ groups: d.groups, fees: d.fees, total: c.total, qty: c.qty, ...more }).eq("id", o.id);
    const n = picks.find((x) => x.note !== undefined);
    if (!error && n) { const r = await sb.from("order_internal").upsert({ order_id: o.id, production_notes: n.note }); if (r.error) setErr(`#${o.number}: ${r.error.message}`); }
    if (error) setErr(`#${o.number}: ${error.message}`);
    else await sb.from("order_events").insert({ order_id: o.id, kind: "printavo", detail: `Accepted from Printavo: ${picks.map((x) => `${x.what}: ${x.text}`).join("; ").slice(0, 900)}`, actor: "" });
    await load(); setBusy("");
  }
  /** keep ours: hidden until Printavo changes that thing again */
  async function ignore(o: Row, c: Change) {
    setBusy(o.id); setErr("");
    const st0 = (o.printavo_state || {}) as { ignored?: string[] };
    const { error } = await sb.from("orders").update({ printavo_state: { ...st0, ignored: [...new Set([...(st0.ignored || []), sigOf(c)])].slice(-200) } }).eq("id", o.id);
    if (error) setErr(`#${o.number}: ${error.message}`);
    await load(); setBusy("");
  }
  async function check(o: Row) {
    setBusy(o.id); setErr("");
    const r = await fetch("/api/printavo/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id, action: "refresh" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok) setErr(`#${o.number}: ${j.error || "Couldn't read it from Printavo."}`);
    await load(); setBusy("");
  }

  if (realRole !== "owner") return <div className="pvsync-empty">Printavo Sync is in the owner&apos;s view only.</div>;
  return (
    <div className="pvsync">
      <div className="page-head">
        <div>
          <div className="eyebrow">Orders in the 40,000s</div>
          <h1>Printavo Sync</h1>
          <div className="faint">Orders #40000–#49999 run in Printavo until Nov 2. Changes made there wait here until you accept them. The card surcharge is taken automatically.</div>
        </div>
        {view === "totals" ? <button type="button" className="btn" disabled={!!checking || !gaps.length} onClick={checkAll}>{checking || "Check all in Printavo now"}</button>
          : <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show orders that already match</label>}
      </div>
      <div className="toolbar" data-toolbar><div className="chips">
        <button type="button" className={"chip" + (view === "waiting" ? " on" : "")} onClick={() => setView("waiting")}>Changes waiting{waiting.length ? <span className="chip-n">{waiting.length}</span> : null}</button>
        <button type="button" className={"chip" + (view === "totals" ? " on" : "")} onClick={() => setView("totals")}>Totals that differ{gaps.length ? <span className="chip-n">{gaps.length}</span> : null}</button>
      </div></div>
      {err && <div className="err">{err}</div>}
      {!rows && <div className="faint">Loading…</div>}
      {rows && !shown.length && <div className="pvsync-empty">{view === "totals" ? "Every order's total matches Printavo's." : "Nothing waiting: every order in Printavo matches ours."}{list.length ? ` (${list.length} order${list.length === 1 ? "" : "s"} linked.)` : ""}</div>}
      {view === "totals" && gaps.length > 0 && (
        <div className="tbl-wrap"><table className="tbl pvsg-t">
          <thead><tr><th>Order</th><th>Customer</th><th className="r">Ours</th><th className="r">Printavo</th><th className="r">Difference</th><th>Why</th><th>Checked</th></tr></thead>
          <tbody>{gaps.map((x) => (
            <tr key={x.o.id}>
              <td><Link href={`/shop/orders/${x.o.id}`} className="ordno">#{x.o.number}</Link><div className="sub">{x.o.nickname || "Untitled"}</div></td>
              <td>{custLabel(x.o.customers || undefined)}</td>
              <td className="r num">${x.calc.total.toFixed(2)}</td>
              <td className="r num">${(x.snap?.total || 0).toFixed(2)}</td>
              <td className="r num">{x.gap > 0 ? "+" : "−"}${Math.abs(x.gap).toFixed(2)}</td>
              <td className="pvsg-why">{x.why}</td>
              <td className="num"><button type="button" className="btn sm" disabled={busy === x.o.id || !!checking} onClick={() => check(x.o)}>{busy === x.o.id ? "Checking…" : when(x.snap?.at)}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="pvsync-list">
        {view === "waiting" && shown.map(({ o, snap, changes, info, card }) => (
          <section key={o.id} className="pvsync-card">
            <div className="pvsync-h">
              <div>
                <Link href={`/shop/orders/${o.id}`} className="pvsync-num">#{o.number}</Link> <b>{o.nickname || "Untitled"}</b>
                <div className="faint" style={{ fontSize: 12.5 }}>{custLabel(o.customers || undefined)}{snap ? ` · Printavo: ${snap.status} · $${snap.total.toFixed(2)} · checked ${when(snap.at)}` : " · not read back yet"}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn sm" disabled={busy === o.id} onClick={() => check(o)}>Check Printavo now</button>
                {(changes.length > 0 || card) && <button type="button" className="btn primary sm" disabled={busy === o.id} onClick={() => accept(o, changes)}>{busy === o.id ? "Saving…" : changes.length > 1 ? `Accept all ${changes.length}` : "Accept"}</button>}
              </div>
            </div>
            {changes.length > 0 && <ul className="pvc-list">{changes.map((c) => <li key={c.key}><span><span className="pvc-what">{c.what}</span> {c.text}</span><span className="row" style={{ gap: 6 }}><button type="button" className="btn ghost sm" disabled={busy === o.id} title="Keep ours; hidden until Printavo changes this again" onClick={() => ignore(o, c)}>Ignore</button><button type="button" className="btn sm" disabled={busy === o.id} onClick={() => accept(o, [c])}>Accept</button></span></li>)}</ul>}
            {card && !changes.length && <div className="faint" style={{ fontSize: 12.5 }}>Card surcharge to update: ${card.amount.toFixed(2)} (saved when you open or accept the order).</div>}
            {info.length > 0 && <ul className="pvc-info">{info.map((t, i) => <li key={i} className="faint">{t}</li>)}</ul>}
            {showAll && !changes.length && !card && <div className="faint" style={{ fontSize: 12.5 }}>Matches Printavo.</div>}
          </section>
        ))}
      </div>
    </div>
  );
}
