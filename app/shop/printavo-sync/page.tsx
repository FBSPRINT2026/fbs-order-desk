"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { calcOrder, mergeSettings, type Order, type Settings } from "@/lib/pricing";
import { cardFix, printavoChanges, snapOf, type Change } from "@/lib/printavoChanges";
import { custLabel } from "@/lib/format";
import { useRole } from "@/components/RoleContext";

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
      sb.from("orders").select("*, customers(company, name)").not("printavo_id", "is", null).gte("number", 40000).lt("number", 50000).order("number", { ascending: false }),
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
  const shown = showAll ? list : waiting;

  /** apply changes to one order and save it (with its new total), the same as editing it on the order page */
  async function accept(o: Row, picks: Change[]) {
    setBusy(o.id); setErr("");
    const d: Row = JSON.parse(JSON.stringify(o));
    for (const c of picks) c.apply?.(d);
    cardFix(d, snapOf(d))?.apply(d);
    const c = calcOrder(d, settings);
    const { error } = await sb.from("orders").update({ groups: d.groups, fees: d.fees, total: c.total, qty: c.qty }).eq("id", o.id);
    const n = picks.find((x) => x.note !== undefined);
    if (!error && n) { const r = await sb.from("order_internal").upsert({ order_id: o.id, production_notes: n.note }); if (r.error) setErr(`#${o.number}: ${r.error.message}`); }
    if (error) setErr(`#${o.number}: ${error.message}`);
    else await sb.from("order_events").insert({ order_id: o.id, kind: "printavo", detail: `Accepted from Printavo: ${picks.map((x) => `${x.what}: ${x.text}`).join("; ").slice(0, 900)}`, actor: "" });
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
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show orders that already match</label>
      </div>
      {err && <div className="err">{err}</div>}
      {!rows && <div className="faint">Loading…</div>}
      {rows && !shown.length && <div className="pvsync-empty">Nothing waiting: every order in Printavo matches ours.{list.length ? ` (${list.length} order${list.length === 1 ? "" : "s"} linked.)` : ""}</div>}
      <div className="pvsync-list">
        {shown.map(({ o, snap, changes, info, card }) => (
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
            {changes.length > 0 && <ul className="pvc-list">{changes.map((c) => <li key={c.key}><span><span className="pvc-what">{c.what}</span> {c.text}</span><button type="button" className="btn sm" disabled={busy === o.id} onClick={() => accept(o, [c])}>Accept</button></li>)}</ul>}
            {card && !changes.length && <div className="faint" style={{ fontSize: 12.5 }}>Card surcharge to update: ${card.amount.toFixed(2)} (saved when you open or accept the order).</div>}
            {info.length > 0 && <ul className="pvc-info">{info.map((t, i) => <li key={i} className="faint">{t}</li>)}</ul>}
            {showAll && !changes.length && !card && <div className="faint" style={{ fontSize: 12.5 }}>Matches Printavo.</div>}
          </section>
        ))}
      </div>
    </div>
  );
}
