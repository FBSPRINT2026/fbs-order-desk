"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { digitizeState, liveSewout, type DgzSewout } from "@/lib/digitizeStatus";
import type { Design, Group, Imprint } from "@/lib/pricing";

/**
 * Where things stand (Nov 11 2026, Nick: "a simple pop-up… a list of jobs that I can just check… one moment to set
 * everything right so that we can start using the system"). Every job on the schedule or In Production, in two tabs
 * (screen printing, embroidery: an order with both shows in each, for its own press time), one switch per job:
 *   Not counted / Counted in full / Counted missing → the goods (order_goods), the job stays on the schedule to print;
 *   Printing today → it's running now on the press picked, until the time given (production_slots.ends_at);
 *   Printed        → its press time is done (no pace is learned: these weren't timed);
 *   Fulfillment    → printed, finishing and QC checked on the order;
 *   Shipping       → packed, the order Ready;  Delivery → the same, out for delivery;  Completed → the order Completed.
 * Embroidery jobs carry a Digitized mark: on when every embroidered print's file is in (lib/digitizeStatus.ts), or ticked
 * here (the order's "Digitized" stage check; it never touches the price). Saves only what changed; no emails go out.
 */
type St = "not" | "full" | "missing" | "printing" | "printed" | "fulfill" | "shipping" | "delivery" | "completed";
const OPTS: [St, string][] = [["not", "Not counted"], ["full", "Counted in full"], ["missing", "Counted missing"], ["printing", "Printing today"], ["printed", "Printed"], ["fulfill", "Fulfillment"], ["shipping", "Shipping"], ["delivery", "Delivery"], ["completed", "Completed"]];
const RANK: Record<St, number> = Object.fromEntries(OPTS.map(([k], i) => [k, i])) as Record<St, number>;
type Tab = "screen" | "embroidery";
type Slot = { id: string; order_id: string; machine: string; kind: string; status: string; day: string; ends_at: string | null };
type Check = { by: string; at: string; note?: string };
type Row = {
  key: string; tab: Tab; id: string; number: number; nickname: string; customer: string; due: string | null; qty: number; status: string; goods: string;
  checks: Record<string, Check>; slots: Slot[]; now: St; digit: boolean | null; digitAuto: boolean;
};
export type StandPress = { id: string; label: string; type: string };

const dueLbl = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date");
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tabOf = (kind: string): Tab => (kind === "embroidery" ? "embroidery" : "screen");

export default function ScheduleStartPoint({ by, presses, onClose, onSaved }: { by: string; presses: StandPress[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pick, setPick] = useState<Record<string, St>>({});
  const [dig, setDig] = useState<Record<string, boolean>>({});
  const [run, setRun] = useState<Record<string, { press: string; ends: string; left: string }>>({});
  const [tab, setTab] = useState<Tab>("screen");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: open } = await sb.from("production_slots").select("order_id").not("order_id", "is", null).neq("status", "done").limit(1000);
      const ids = new Set(((open || []) as { order_id: string }[]).map((x) => x.order_id));
      const { data: prod } = await sb.from("orders").select("id").eq("status", "production").is("discarded_at", null).limit(1000);
      for (const o of (prod || []) as { id: string }[]) ids.add(o.id);
      const list = [...ids];
      type O = { id: string; number: number; nickname: string | null; customer_id: string | null; due_date: string | null; qty: number | null; status: string; groups: Group[] | null; stage_checks: Record<string, Check> | null };
      const orders: O[] = [], slots: Slot[] = [], sews: DgzSewout[] = [];
      const goods = new Map<string, string>();
      for (let i = 0; i < list.length; i += 150) {
        const part = list.slice(i, i + 150);
        const [{ data: o }, { data: g }, { data: sl }, { data: sw }] = await Promise.all([
          sb.from("orders").select("id, number, nickname, customer_id, due_date, qty, status, groups, stage_checks").in("id", part).is("discarded_at", null),
          sb.from("order_goods").select("order_id, status").in("order_id", part),
          sb.from("production_slots").select("id, order_id, machine, kind, status, day, ends_at").in("order_id", part),
          sb.from("sewouts").select("order_id, imprint_id, status, archived_at").in("order_id", part),
        ]);
        orders.push(...((o || []) as O[]));
        slots.push(...((sl || []) as Slot[]));
        sews.push(...((sw || []) as DgzSewout[]));
        for (const x of (g || []) as { order_id: string; status: string }[]) goods.set(x.order_id, x.status);
      }
      const cids = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[];
      const cn = new Map<string, string>();
      for (let i = 0; i < cids.length; i += 200) {
        const { data } = await sb.from("customers").select("id, company, name").in("id", cids.slice(i, i + 200));
        for (const c of (data || []) as { id: string; company: string; name: string }[]) cn.set(c.id, c.company || c.name);
      }
      const embIms = (o: O) => (o.groups || []).flatMap((g) => (g.imprints || []) as Imprint[]).filter((im) => im.method === "embroidery");
      const dids = [...new Set(orders.flatMap((o) => embIms(o).map((im) => im.design_id).filter(Boolean)))] as string[];
      const designs = new Map<string, Design>();
      for (let i = 0; i < dids.length; i += 150) {
        const { data } = await sb.from("designs").select("id, specs").in("id", dids.slice(i, i + 150));
        for (const d of (data || []) as Design[]) designs.set(d.id, d);
      }
      const out: Row[] = [];
      for (const o of orders) {
        if (o.status === "completed") continue;
        const g = goods.get(o.id) || "", checks = o.stage_checks || {};
        const ims = (o.groups || []).flatMap((x) => (x.imprints || []) as Imprint[]);
        const tabs = new Set<Tab>(slots.filter((x) => x.order_id === o.id).map((x) => tabOf(x.kind)));
        if (!tabs.size) for (const im of ims) tabs.add(tabOf(im.method || "screen"));
        if (!tabs.size) tabs.add("screen");
        for (const t of tabs) {
          const mine = slots.filter((x) => x.order_id === o.id && tabOf(x.kind) === t);
          const now: St = o.status === "ready" ? (checks.out?.note === "delivery" ? "delivery" : "shipping")
            : mine.length && mine.every((x) => x.status === "done") ? (checks.qc ? "fulfill" : "printed")
            : mine.some((x) => x.status === "running" || x.status === "paused" || x.status === "done") ? "printing"
            : g === "received" ? "full" : g === "issue" || g === "partial" ? "missing" : "not";
          let digit: boolean | null = null, digitAuto = false;
          if (t === "embroidery") {
            const es = embIms({ ...o, groups: o.groups });
            digitAuto = es.length > 0 && es.every((im) => digitizeState(im, im.design_id ? designs.get(im.design_id) : null, liveSewout(sews, o.id, im.id)).state !== "need" && digitizeState(im, im.design_id ? designs.get(im.design_id) : null, liveSewout(sews, o.id, im.id)).state !== "asked");
            digit = digitAuto || !!checks.digitized;
          }
          out.push({ key: `${o.id}:${t}`, tab: t, id: o.id, number: o.number, nickname: o.nickname || "", customer: cn.get(o.customer_id || "") || "", due: o.due_date, qty: o.qty || 0, status: o.status, goods: g, checks, slots: mine, now, digit, digitAuto });
        }
      }
      out.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.number - b.number);
      setRows(out);
      const t0 = out.some((r) => r.tab === "screen") ? "screen" : "embroidery";
      setTab(t0);
    })();
  }, []);

  const changed = useMemo(() => (rows || []).filter((r) => (pick[r.key] && pick[r.key] !== r.now) || (dig[r.key] !== undefined && dig[r.key] !== r.digit) || (pick[r.key] === "printing" && run[r.key])), [rows, pick, dig, run]);
  const count = (t: Tab) => (rows || []).filter((r) => r.tab === t).length;
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (rows || []).filter((r) => r.tab === tab && (!t || `${r.number} ${r.customer} ${r.nickname}`.toLowerCase().includes(t))); }, [rows, q, tab]);
  const pressesFor = (t: Tab) => presses.filter((p) => tabOf(p.type) === t);
  const runOf = (r: Row) => {
    const cur = r.slots.find((x) => x.status === "running" || x.status === "paused") || r.slots.find((x) => x.status !== "done") || r.slots[0];
    const ends = cur?.ends_at ? new Date(cur.ends_at) : null;
    return run[r.key] || { press: cur?.machine && pressesFor(r.tab).some((p) => p.id === cur.machine) ? cur.machine : pressesFor(r.tab)[0]?.id || "", ends: ends ? `${String(ends.getHours()).padStart(2, "0")}:${String(ends.getMinutes()).padStart(2, "0")}` : "", left: "" };
  };

  async function save() {
    const bad = changed.find((r) => pick[r.key] === "printing" && !runOf(r).ends);
    if (bad) { setErr(`#${bad.number}: when will it finish?`); return; }
    setBusy(true); setErr("");
    const sb = createClient(), nowIso = new Date().toISOString(), today = localDay();
    const tag = `${by} · Where things stand`;
    const check = (note?: string): Check => ({ by, at: nowIso, ...(note ? { note } : {}) });
    const done = new Set<string>(); // order-wide writes once per order
    try {
      for (const r of changed) {
        const p = pick[r.key] || r.now, rk = RANK[p];
        const live = r.slots.filter((x) => x.status !== "done");
        // goods (order-wide): counted in full for anything from Printing on
        if (!done.has(r.id + ":g")) {
          if (p === "not" && (r.goods === "received" || r.goods === "issue")) await sb.from("order_goods").update({ status: "arrived", issue_type: "", issue_note: "", updated_by: tag, updated_at: nowIso }).eq("order_id", r.id);
          if (p === "full" || (rk >= RANK.printing && r.goods !== "received" && r.goods !== "issue")) await sb.from("order_goods").upsert({ order_id: r.id, status: "received", issue_type: "", issue_note: "", updated_by: tag, updated_at: nowIso }, { onConflict: "order_id" });
          if (p === "missing") await sb.from("order_goods").upsert({ order_id: r.id, status: "issue", issue_type: "short", issue_note: "Counted missing", updated_by: tag, updated_at: nowIso }, { onConflict: "order_id" });
          done.add(r.id + ":g");
        }
        // press time for this tab's work
        if (rk <= RANK.missing && pick[r.key] && r.now !== p) {
          for (const x of r.slots.filter((y) => y.status !== "scheduled")) await sb.from("production_slots").update({ status: "scheduled", started_at: null, finished_at: null, progress: 0, progress_at: null, ends_at: null, updated_at: nowIso }).eq("id", x.id);
        }
        if (p === "printing") {
          const rr = runOf(r), [hh, mm] = rr.ends.split(":").map(Number);
          const ends = new Date(); ends.setHours(hh, mm, 0, 0);
          const left = Number(rr.left), prog = r.qty && rr.left !== "" && left >= 0 ? Math.max(0, Math.min(0.99, 1 - left / r.qty)) : 0;
          const cur = live.find((x) => x.status === "running" || x.status === "paused") || live[0];
          const patch = { machine: rr.press, day: today, position: 0, status: "running", started_at: nowIso, progress: prog, progress_at: nowIso, ends_at: ends.toISOString(), updated_at: nowIso };
          if (cur) await sb.from("production_slots").update(patch).eq("id", cur.id);
          else await sb.from("production_slots").insert({ ...patch, order_id: r.id, kind: r.tab, minutes: Math.max(15, Math.round((ends.getTime() - Date.now()) / 60000)), source: "stand", created_by: by });
          const sid = cur?.id;
          if (sid) await sb.from("production_slot_log").insert({ slot_id: sid, order_id: r.id, machine: rr.press, action: "start", progress: prog, by: tag });
        }
        if (rk >= RANK.printed) {
          for (const x of live) {
            await sb.from("production_slots").update({ status: "done", finished_at: nowIso, progress: 1, progress_at: nowIso, ends_at: null, updated_at: nowIso }).eq("id", x.id);
            await sb.from("production_slot_log").insert({ slot_id: x.id, order_id: r.id, machine: x.machine, action: "done", progress: 1, by: tag });
          }
        }
        // the order (order-wide): stage checks and status
        const checks = { ...r.checks };
        if (rk >= RANK.fulfill) { checks.finishing ||= check(); checks.qc ||= check(); }
        if (rk >= RANK.shipping) checks.packing ||= check();
        if (p === "delivery") checks.out = check("delivery");
        else if (p === "shipping" && checks.out?.note === "delivery") delete checks.out;
        if (dig[r.key] !== undefined && dig[r.key] !== r.digit && !r.digitAuto) { if (dig[r.key]) checks.digitized = check(); else delete checks.digitized; }
        const status = p === "completed" ? "completed" : p === "shipping" || p === "delivery" ? "ready" : rk >= RANK.printing && r.status !== "production" ? "production" : r.status === "ready" && rk < RANK.shipping ? "production" : r.status;
        const patchO: Record<string, unknown> = {};
        if (JSON.stringify(checks) !== JSON.stringify(r.checks)) patchO.stage_checks = checks;
        if (status !== r.status) patchO.status = status;
        if (Object.keys(patchO).length) await sb.from("orders").update(patchO).eq("id", r.id);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); return; }
    setBusy(false);
    onSaved();
    onClose();
  }

  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet wts" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Where things stand">
        <div className="pp-sheet-h"><b>Where Things Stand</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="wts-tabs" data-toolbar>
          {(["screen", "embroidery"] as Tab[]).map((t) => <button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "screen" ? "Screen printing" : "Embroidery"}<span className="wts-n">{count(t)}</span></button>)}
        </div>
        <div className="wts-b">
          <div className="wts-top">
            <span className="faint">Soonest in-hands first. Set each job, then save. No emails go out.</span>
            <input className="wts-q" placeholder="Find a job or customer" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!rows ? <div className="empty">Loading jobs…</div> : !shown.length ? <div className="empty">No jobs here.</div> : (
            <div className="wts-list">
              {shown.map((r) => {
                const v = pick[r.key] || r.now, d = dig[r.key] ?? r.digit, rr = runOf(r);
                const ch = changed.some((x) => x.key === r.key);
                return (
                  <div key={r.key} className={"wts-r" + (ch ? " ch" : "")}>
                    <div className="wts-j">
                      <Link className="ordno" href={`/shop/orders/${r.id}`} target="_blank">#{r.number}</Link>
                      <b>{r.customer || "—"}</b>
                      <span className="wts-s">{r.nickname ? r.nickname + " · " : ""}due <span className="wts-d">{dueLbl(r.due)}</span>{r.slots.length ? "" : " · not on the calendar"}</span>
                      {r.tab === "embroidery" && <button type="button" className={"wts-dg" + (d ? " y" : "")} disabled={r.digitAuto} title={r.digitAuto ? "The digitizer's file is in" : "Mark it digitized"} onClick={() => setDig((x) => ({ ...x, [r.key]: !d }))}><span className="wts-box" />{d ? "Digitized" : "Not digitized"}</button>}
                    </div>
                    <div className="wts-seg">{OPTS.map(([k, l]) => <button key={k} type="button" className={v === k ? "on " + k : ""} onClick={() => setPick((p) => ({ ...p, [r.key]: k }))}>{l}</button>)}</div>
                    {v === "printing" && (
                      <div className="wts-run">
                        <label className="wts-f"><span>Press</span>
                          <select value={rr.press} onChange={(e) => setRun((x) => ({ ...x, [r.key]: { ...rr, press: e.target.value } }))}>{pressesFor(r.tab).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                        </label>
                        <label className="wts-f"><span>Finishes at</span><input type="time" value={rr.ends} onChange={(e) => setRun((x) => ({ ...x, [r.key]: { ...rr, ends: e.target.value } }))} /></label>
                        <label className="wts-f wts-f-s"><span>Pieces left</span><input inputMode="numeric" value={rr.left} placeholder={r.qty ? `of ${r.qty}` : ""} onChange={(e) => setRun((x) => ({ ...x, [r.key]: { ...rr, left: e.target.value.replace(/\D/g, "") } }))} /></label>
                        <span className="wts-hint">{rr.ends ? <>Booked on <b>{presses.find((p) => p.id === rr.press)?.label || "the press"} today until {new Date(`2000-01-01T${rr.ends}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</b>. Everything after it starts from there.</> : "When will it finish?"}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="wts-ft">
          {err && <span className="wts-err">{err}</span>}
          <span className="faint">{changed.length ? `${changed.length} changed` : "Nothing changed yet"}</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !changed.length} onClick={() => void save()}>{busy ? "Saving…" : `Save ${changed.length || ""}`.trim()}</button>
        </div>
      </div>
    </div>
  );
}
