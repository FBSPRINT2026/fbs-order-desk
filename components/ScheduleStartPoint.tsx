"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/**
 * Where things stand (Nov 11 2026, Nick: "a simple pop-up… a list of jobs that I can just check completed, printed, ready
 * to ship. I need one moment to set everything right so that we can start using the system"). Every job on the schedule
 * or In Production, one row each, with one switch: Goods not in / Counted / Printed / Ready / Completed. Saving writes only
 * the rows changed:
 *   Counted   → the goods are counted (order_goods "received"), the job stays on the schedule to print;
 *   Printed   → its booked runs are done (no pace is learned from these: they weren't timed);
 *   Ready     → printed, and the order is Ready for Pickup;
 *   Completed → printed, and the order is Completed.
 * No customer emails are sent from here.
 */
type St = "waiting" | "counted" | "printed" | "ready" | "completed";
const OPTS: [St, string][] = [["waiting", "Goods not in"], ["counted", "Counted"], ["printed", "Printed"], ["ready", "Ready"], ["completed", "Completed"]];
type Row = { id: string; number: number; nickname: string; customer: string; due: string | null; status: string; goods: string; slots: { id: string; machine: string; status: string }[]; now: St };

const dueLbl = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date");

export default function ScheduleStartPoint({ by, onClose, onSaved }: { by: string; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pick, setPick] = useState<Record<string, St>>({});
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: sl } = await sb.from("production_slots").select("id, order_id, machine, status").not("order_id", "is", null).neq("status", "done").limit(1000);
      const slots = (sl || []) as { id: string; order_id: string; machine: string; status: string }[];
      const ids = new Set(slots.map((x) => x.order_id));
      const { data: prod } = await sb.from("orders").select("id").eq("status", "production").is("discarded_at", null).limit(1000);
      for (const o of (prod || []) as { id: string }[]) ids.add(o.id);
      const list = [...ids];
      const orders: { id: string; number: number; nickname: string | null; customer_id: string | null; due_date: string | null; status: string }[] = [];
      const goods = new Map<string, string>();
      for (let i = 0; i < list.length; i += 200) {
        const part = list.slice(i, i + 200);
        const [{ data: o }, { data: g }] = await Promise.all([
          sb.from("orders").select("id, number, nickname, customer_id, due_date, status").in("id", part).is("discarded_at", null),
          sb.from("order_goods").select("order_id, status").in("order_id", part),
        ]);
        orders.push(...((o || []) as typeof orders));
        for (const x of (g || []) as { order_id: string; status: string }[]) goods.set(x.order_id, x.status);
      }
      const cids = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[];
      const cn = new Map<string, string>();
      for (let i = 0; i < cids.length; i += 200) {
        const { data } = await sb.from("customers").select("id, company, name").in("id", cids.slice(i, i + 200));
        for (const c of (data || []) as { id: string; company: string; name: string }[]) cn.set(c.id, c.company || c.name);
      }
      const out: Row[] = orders.filter((o) => o.status !== "completed" && o.status !== "ready").map((o) => {
        const g = goods.get(o.id) || "";
        return { id: o.id, number: o.number, nickname: o.nickname || "", customer: cn.get(o.customer_id || "") || "", due: o.due_date, status: o.status, goods: g, slots: slots.filter((x) => x.order_id === o.id), now: g === "received" ? "counted" : "waiting" };
      }).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.number - b.number);
      setRows(out);
    })();
  }, []);

  const changed = useMemo(() => (rows || []).filter((r) => pick[r.id] && pick[r.id] !== r.now), [rows, pick]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (rows || []).filter((r) => !t || `${r.number} ${r.customer} ${r.nickname}`.toLowerCase().includes(t)); }, [rows, q]);

  async function save() {
    setBusy(true); setMsg("");
    const sb = createClient(), now = new Date().toISOString();
    let n = 0;
    for (const r of changed) {
      const p = pick[r.id];
      if (p === "counted" || ((p === "printed" || p === "ready" || p === "completed") && r.goods !== "received")) await sb.from("order_goods").upsert({ order_id: r.id, status: "received", updated_by: by, updated_at: now }, { onConflict: "order_id" });
      if (p === "waiting" && r.goods === "received") await sb.from("order_goods").update({ status: "arrived", updated_by: by, updated_at: now }).eq("order_id", r.id);
      if (p === "printed" || p === "ready" || p === "completed") {
        for (const s of r.slots) {
          await sb.from("production_slots").update({ status: "done", finished_at: now, progress: 1, progress_at: now, updated_at: now }).eq("id", s.id);
          await sb.from("production_slot_log").insert({ slot_id: s.id, order_id: r.id, machine: s.machine, action: "done", progress: 1, by: `${by} · Where things stand` });
        }
        if (r.status !== "production") await sb.from("orders").update({ status: "production" }).eq("id", r.id);
      }
      if (p === "ready") await sb.from("orders").update({ status: "ready" }).eq("id", r.id);
      if (p === "completed") await sb.from("orders").update({ status: "completed" }).eq("id", r.id);
      n++;
    }
    setBusy(false); setMsg(`Saved ${n} job${n === 1 ? "" : "s"}.`); setPick({});
    onSaved();
    onClose();
  }

  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet wts" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Where things stand">
        <div className="pp-sheet-h"><b>Where things stand</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="wts-b">
          <div className="wts-top">
            <span className="faint">Every job on the schedule or In Production, soonest in-hands first. Set each one, then save. No emails go out.</span>
            <input className="wts-q" placeholder="Find a job or customer" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!rows ? <div className="empty">Loading jobs…</div> : !rows.length ? <div className="empty">No jobs on the schedule.</div> : (
            <div className="wts-list">
              {shown.map((r) => {
                const v = pick[r.id] || r.now;
                return (
                  <div key={r.id} className={"wts-r" + (pick[r.id] && pick[r.id] !== r.now ? " ch" : "")}>
                    <div className="wts-j">
                      <Link className="ordno" href={`/shop/orders/${r.id}`} target="_blank">#{r.number}</Link> <b>{r.customer || "—"}</b>
                      <div className="sub">{r.nickname ? r.nickname + " · " : ""}due <span className="wts-d">{dueLbl(r.due)}</span>{r.slots.length ? "" : " · not on the calendar"}</div>
                    </div>
                    <div className="wts-seg">{OPTS.map(([k, l]) => <button key={k} type="button" className={v === k ? "on " + k : ""} onClick={() => setPick((p) => ({ ...p, [r.id]: k }))}>{l}</button>)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="wts-f">
          {msg && <span className="faint">{msg}</span>}
          <span className="faint">{changed.length ? `${changed.length} changed` : "Nothing changed yet"}</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !changed.length} onClick={() => void save()}>{busy ? "Saving…" : `Save ${changed.length || ""}`.trim()}</button>
        </div>
      </div>
    </div>
  );
}
