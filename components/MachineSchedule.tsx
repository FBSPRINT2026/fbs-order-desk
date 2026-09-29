"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mergeProduction, needsForOrder, needsForPrintavo, estimate, fits, suggest, fmtMin, machineForStatus, capacityMin, PV_READY, type Machine, type Need, type ProductionSettings, type Suggestion } from "@/lib/production";
import type { Group } from "@/lib/pricing";

/**
 * The production calendar: one lane per machine, days across, how full each day is. Jobs ready to run land in
 * "Ready To Schedule" with a suggested machine and day (worked out from colors, quantity, garments and stitches);
 * one click books it. Drag a job to another machine or day (a job only drops on a machine that can run it), or tap
 * it to move it. Printavo jobs sitting in a machine status ("SP - Press 1 - 12C Gauntlet III") show on that
 * machine until go-live (read-only toward Printavo: moving one here books it in our schedule only).
 */
type Job = { key: string; kind: "o" | "a"; id: string; number: string; customer: string; name: string; due: string | null; qty: number; status: string; needs: Need[]; href: string };
type Slot = { id: string; order_id: string | null; archived_order_id: string | null; machine: string; day: string; position: number; minutes: number; kind: string; label: string; status: "scheduled" | "running" | "done"; source: string; note: string };
type Card = { key: string; job: Job; need: Need; machine: Machine; day: string; minutes: number; slot: Slot | null; fromPv: boolean };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return ymd(x); };
const dow = (d: string) => new Date(d + "T12:00:00").getDay();
const dayLbl = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const TYPE_LBL = { screen: "Screen Print", embroidery: "Embroidery", heat: "Heat Press" };
/** "Embroidery · 12 Head" → "12 Head", "Press 3 · 8C Sportsman" → "Press 3" */
const shortName = (m: Machine) => { const p = m.name.split(" · "); return p.length < 2 ? m.name : m.type === "embroidery" ? p[1] : p[0]; };
const PV_DONE = /job\s*completed|quote|cancel|ship|fulfillment|issue/i;

export default function MachineSchedule() {
  const today = ymd(new Date());
  const [s, setS] = useState<ProductionSettings | null>(null);
  const [start, setStart] = useState(() => { let d = today; while (dow(d) === 0 || dow(d) === 6) d = addDay(d, 1); return d; });
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [pvLane, setPvLane] = useState<{ job: Job; machine: Machine; day: string }[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [drag, setDrag] = useState<{ card?: Card; job?: Job; need?: Need } | null>(null);
  const [over, setOver] = useState("");
  const [open, setOpen] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");
  const [typeF, setTypeF] = useState<"" | "screen" | "embroidery" | "heat">("");
  const [phoneDay, setPhoneDay] = useState(today);

  const [span, setSpan] = useState<6 | 12>(6);
  const [trayAll, setTrayAll] = useState(false);
  // working days only (any active machine runs that weekday): a Saturday column shows up only if a machine works Saturdays
  const days = useMemo(() => { const work = new Set((s?.machines || []).filter((x) => x.active).flatMap((x) => x.days)); if (!work.size) [1, 2, 3, 4, 5].forEach((x) => work.add(x)); const out: string[] = []; let d = start; for (let i = 0; out.length < span && i < 60; i++) { if (work.has(dow(d))) out.push(d); d = addDay(d, 1); } return out; }, [start, span, s]);

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: st }, { data: o }, { data: a }, { data: sl }] = await Promise.all([
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      sb.from("orders").select("id, number, nickname, due_date, qty, status, customer_id, groups, lines").in("status", ["approved", "art", "blanks", "production"]).limit(300),
      sb.from("archived_orders").select("id, visual_id, nickname, due_date, qty, status_name, customer_id, start:data->>startAt, pvgroups:data->groups").eq("kind", "invoice").gte("due_date", addDay(today, -45)).not("status_name", "ilike", "%complete%").limit(600),
      sb.from("production_slots").select("*").gte("day", addDay(today, -14)).lte("day", addDay(today, 60)),
    ]);
    const ps = mergeProduction((st?.data as { production?: unknown } | null)?.production);
    setS(ps); setSlots((sl || []) as Slot[]);
    const pv = ((a || []) as { id: string; visual_id: string; nickname: string; due_date: string | null; qty: number; status_name: string; customer_id: string | null; start: string | null; pvgroups: unknown }[]).filter((x) => !PV_DONE.test(x.status_name || "") || PV_READY.test(x.status_name || ""));
    const ids = [...new Set([...((o || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...pv.map((x) => x.customer_id)].filter(Boolean))] as string[];
    const cn = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 300) { const { data } = await sb.from("customers").select("id, company, name").in("id", ids.slice(i, i + 300)); for (const c of (data || []) as { id: string; company: string; name: string }[]) cn.set(c.id, c.company || c.name); }
    const js: Job[] = [
      ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null; groups: Group[]; lines: never[] }[]).map((x) => ({ key: "o:" + x.id, kind: "o" as const, id: x.id, number: String(x.number), customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status, needs: needsForOrder(ps, x as never), href: `/shop/orders/${x.id}` })),
      ...pv.map((x) => ({ key: "a:" + x.id, kind: "a" as const, id: x.id, number: x.visual_id, customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status_name, needs: needsForPrintavo(ps, { qty: x.qty, status_name: x.status_name, nickname: x.nickname, data: { groups: x.pvgroups as never } }), href: `/shop/archive/${x.id}` })),
    ];
    setJobs(js);
    // Printavo jobs already in a machine status sit on that machine (on their production date, else a day before in-hands)
    setPvLane(pv.map((x) => { const mach = machineForStatus(ps, x.status_name); const job = js.find((j) => j.key === "a:" + x.id)!; if (!mach) return null; const d0 = (x.start || "").slice(0, 10) || (x.due_date ? addDay(x.due_date, -1) : today); return { job, machine: mach, day: d0 < today ? today : d0 }; /* still in a press status = still to run */ }).filter(Boolean) as { job: Job; machine: Machine; day: string }[]);
  }, [today]);
  useEffect(() => { load(); }, [load]);

  const byKey = useMemo(() => new Map((jobs || []).map((j) => [j.key, j])), [jobs]);
  const slotKey = (x: { order_id: string | null; archived_order_id: string | null }) => (x.order_id ? "o:" + x.order_id : "a:" + x.archived_order_id);
  // everything on the calendar: our bookings, then Printavo machine statuses that aren't booked here
  const cards = useMemo<Card[]>(() => {
    if (!s || !jobs) return [];
    const out: Card[] = [];
    const booked = new Set<string>();
    for (const sl of slots) {
      const job = byKey.get(slotKey(sl)); const mach = s.machines.find((x) => x.id === sl.machine);
      booked.add(slotKey(sl) + ":" + sl.kind);
      if (!job || !mach) continue;
      const need = job.needs.find((n) => n.type === sl.kind) || job.needs[0];
      if (!need) continue;
      out.push({ key: sl.id, job, need, machine: mach, day: sl.day, minutes: sl.minutes || estimate(s, need, mach).minutes, slot: sl, fromPv: false });
    }
    for (const p of pvLane) {
      const need = p.job.needs.find((n) => n.type === p.machine.type) || p.job.needs[0];
      if (!need || booked.has(p.job.key + ":" + p.machine.type)) continue;
      out.push({ key: "pv:" + p.job.key, job: p.job, need, machine: p.machine, day: p.day, minutes: estimate(s, need, p.machine).minutes, slot: null, fromPv: true });
    }
    return out;
  }, [s, jobs, slots, pvLane, byKey]);
  const load2 = useMemo(() => { const m: Record<string, Record<string, number>> = {}; for (const c of cards) { if (c.slot?.status === "done") continue; (m[c.machine.id] ||= {})[c.day] = (m[c.machine.id]?.[c.day] || 0) + c.minutes; } return m; }, [cards]);

  // ready to schedule: in production (goods here, art done) or a Printavo "ready for production / scheduling" status, not booked yet
  const tray = useMemo(() => {
    if (!s || !jobs) return [];
    const onCal = new Set(cards.map((c) => c.job.key + ":" + c.need.type));
    const ready = jobs.filter((j) => (j.kind === "o" ? j.status === "production" : PV_READY.test(j.status)));
    const load = JSON.parse(JSON.stringify(load2)) as Record<string, Record<string, number>>;
    const out: { job: Job; need: Need; sug: Suggestion | null }[] = [];
    for (const j of [...ready].sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))) for (const n of j.needs) {
      if (onCal.has(j.key + ":" + n.type)) continue;
      const sug = suggest(s, n, j.due, today, load);
      if (sug) (load[sug.machine.id] ||= {})[sug.day] = (load[sug.machine.id]?.[sug.day] || 0) + sug.minutes; // later jobs see this one's room taken
      out.push({ job: j, need: n, sug });
    }
    return out;
  }, [s, jobs, cards, load2, today]);
  const coming = (jobs || []).filter((j) => j.kind === "o" && ["approved", "art", "blanks"].includes(j.status));

  async function book(job: Job, need: Need, machine: Machine, day: string, source = "manual", slot?: Slot | null) {
    if (!s) return;
    if (!fits(need, machine)) { setMsg(`#${job.number} needs ${need.type === "screen" ? `${need.needColors} screens` : TYPE_LBL[need.type]}: ${machine.name} can't run it.`); return; }
    const minutes = estimate(s, need, machine).minutes;
    const sb = createClient();
    const pos = cards.filter((c) => c.machine.id === machine.id && c.day === day).length;
    const r = slot
      ? await sb.from("production_slots").update({ machine: machine.id, day, minutes, position: pos, updated_at: new Date().toISOString() }).eq("id", slot.id)
      : await sb.from("production_slots").insert({ order_id: job.kind === "o" ? job.id : null, archived_order_id: job.kind === "a" ? job.id : null, machine: machine.id, day, minutes, position: pos, kind: need.type, label: need.label, source });
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(`#${job.number} → ${machine.name}, ${dayLbl(day)} (${fmtMin(minutes)})`);
    load();
  }
  async function acceptAll() {
    const pos: Record<string, number> = {};
    const rows = tray.filter((t) => t.sug && !t.sug.late).map((t) => {
      const k = t.sug!.machine.id + t.sug!.day; pos[k] = pos[k] ?? cards.filter((c) => c.machine.id === t.sug!.machine.id && c.day === t.sug!.day).length;
      return { order_id: t.job.kind === "o" ? t.job.id : null, archived_order_id: t.job.kind === "a" ? t.job.id : null, machine: t.sug!.machine.id, day: t.sug!.day, minutes: t.sug!.minutes, position: pos[k]++, kind: t.need.type, label: t.need.label, source: "suggested" };
    });
    if (!rows.length) return;
    const r = await createClient().from("production_slots").insert(rows);
    setMsg(r.error ? r.error.message : `Booked ${rows.length} job${rows.length === 1 ? "" : "s"}. Late ones stay in the tray for you to place.`);
    load();
  }
  async function setStatus(sl: Slot, status: Slot["status"]) { await createClient().from("production_slots").update({ status, updated_at: new Date().toISOString() }).eq("id", sl.id); setOpen(null); load(); }
  async function unbook(sl: Slot) { await createClient().from("production_slots").delete().eq("id", sl.id); setOpen(null); load(); }

  function onDrop(machine: Machine, day: string) {
    setOver("");
    if (!drag) return;
    if (drag.card) book(drag.card.job, drag.card.need, machine, day, "manual", drag.card.slot);
    else if (drag.job && drag.need) book(drag.job, drag.need, machine, day);
    setDrag(null);
  }

  if (!s || !jobs) return <div className="empty">Loading the schedule…</div>;
  const machines = s.machines.filter((x) => x.active && (!typeF || x.type === typeF));
  const cellCards = (mach: Machine, day: string) => cards.filter((c) => c.machine.id === mach.id && c.day === day).sort((a, b) => (a.slot?.position ?? 99) - (b.slot?.position ?? 99));
  const CardEl = ({ c }: { c: Card }) => {
    const late = c.job.due && c.day > c.job.due;
    return (
      <button type="button" draggable className={"ms-card " + c.need.type + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (late ? " late" : "")}
        onDragStart={() => setDrag({ card: c })} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(c)}
        title={`#${c.job.number} ${c.job.customer} · ${c.need.label} · ${fmtMin(c.minutes)}${c.job.due ? ` · in-hands ${dayLbl(c.job.due)}` : ""}`}>
        <span className="ms-c"><b>#{c.job.number}</b> {c.job.customer || c.job.name}</span><small><b>{fmtMin(c.minutes)}</b> · {c.need.label}</small>
      </button>
    );
  };

  return (
    <div className="ms">
      <div className="ms-bar">
        <h2 className="ms-title">Production Calendar</h2>
        <div className="rv-seg">{([["", "All"], ["screen", "Screen Print"], ["embroidery", "Embroidery"], ["heat", "Heat Press"]] as const).map(([k, l]) => <button key={k} type="button" className={typeF === k ? "on" : ""} onClick={() => setTypeF(k)}>{l}</button>)}</div>
        <span className="spacer" />
        <div className="rv-seg ms-span">{([6, 12] as const).map((k) => <button key={k} type="button" className={span === k ? "on" : ""} onClick={() => setSpan(k)}>{k === 6 ? "1 Week" : "2 Weeks"}</button>)}</div>
        <button type="button" className="btn sm" onClick={() => setStart(addDay(start, -7))} aria-label="Earlier">←</button>
        <button type="button" className="btn sm" onClick={() => setStart(today)}>Today</button>
        <button type="button" className="btn sm" onClick={() => setStart(addDay(start, 7))} aria-label="Later">→</button>
        <Link className="linkbtn" href="/shop/settings/production">Machines &amp; times</Link>
      </div>
      {msg && <div className="banner" style={{ marginBottom: 8 }} onClick={() => setMsg("")}>{msg}</div>}

      <div className="ms-wrap">
        <aside className="ms-tray">
          <div className="ms-tray-h"><b>Ready To Schedule</b><span className="aa-n">{tray.length}</span>{tray.some((t) => t.sug && !t.sug.late) && <button type="button" className="btn sm primary" onClick={acceptAll}>Accept All</button>}</div>
          {!tray.length ? <div className="db-empty">Nothing waiting. Jobs land here when they go to In Production (goods here, art approved), or a Printavo &quot;Ready for Production / Scheduling&quot; status.</div> : (
            <ul>{(trayAll ? tray : tray.slice(0, 5)).map((t) => (
              <li key={t.job.key + t.need.type} draggable onDragStart={() => setDrag({ job: t.job, need: t.need })} onDragEnd={() => setDrag(null)} className={"ms-t " + t.need.type + (t.sug?.late ? " late" : "")}>
                <div className="ms-t-h"><b>#{t.job.number}</b><span>{t.job.customer}</span>{t.job.due && <small>in-hands {dayLbl(t.job.due)}</small>}</div>
                <div className="ms-t-n">{TYPE_LBL[t.need.type]} · {t.need.label} · {t.need.qty} pcs</div>
                {t.sug ? (<>
                  <div className="ms-t-s">→ <b>{t.sug.machine.name}</b>, {t.sug.day === today ? "today" : dayLbl(t.sug.day)} · {fmtMin(t.sug.minutes)}{t.sug.late ? <span className="ms-late"> · {t.job.due && t.sug.day > t.job.due ? "after in-hands date" : "no buffer before in-hands"}</span> : null}</div>
                  <div className="row" style={{ gap: 6 }}><button type="button" className="btn sm primary" onClick={() => book(t.job, t.need, t.sug!.machine, t.sug!.day, "suggested")}>Accept</button>
                    {t.sug.alternatives.slice(0, 2).map((x) => <button key={x.machine.id} type="button" className="btn sm" onClick={() => book(t.job, t.need, x.machine, x.day)} title={`${x.machine.name}, ${dayLbl(x.day)}, ${fmtMin(x.minutes)}`}>{shortName(x.machine)} {x.day === today ? "today" : dayLbl(x.day).split(",")[0]}</button>)}</div>
                </>) : <div className="ms-late">No machine can run this (check colors / machines in settings).</div>}
                <Link className="linkbtn" href={t.job.href} style={{ fontSize: 12 }}>Open job</Link>
              </li>
            ))}</ul>
          )}
          {tray.length > 5 && <button type="button" className="btn sm" onClick={() => setTrayAll(!trayAll)}>{trayAll ? "Show fewer" : `Show all ${tray.length}`}</button>}
          {coming.length > 0 && <div className="faint ms-coming">{coming.length} more coming (approved, art or blanks): they show here once they go to In Production.</div>}
        </aside>

        <div className="ms-grid-wrap">
          <div className="ms-grid" style={{ gridTemplateColumns: `150px repeat(${days.length}, minmax(112px,1fr))`, minWidth: 150 + days.length * 112 }}>
            <div className="ms-h" />
            {days.map((d) => <div key={d} className={"ms-h" + (d === today ? " today" : "") + (dow(d) === 6 ? " sat" : "")}>{dayLbl(d)}</div>)}
            {machines.map((mach) => [
              <div key={mach.id} className={"ms-m " + mach.type}><b>{mach.name}</b><small>{mach.type === "screen" ? `${mach.colors} colors` : mach.type === "embroidery" ? `${mach.heads} head${mach.heads === 1 ? "" : "s"}` : "heat press"} · {mach.hoursPerDay}h/day</small></div>,
              ...days.map((d) => {
                const cs = cellCards(mach, d); const used = load2[mach.id]?.[d] || 0, cap = capacityMin(s, mach);
                const off = !mach.days.includes(dow(d));
                const bad = drag && (drag.card?.need || drag.need) && !fits((drag.card?.need || drag.need)!, mach);
                return (
                  <div key={mach.id + d} className={"ms-cell" + (off ? " off" : "") + (over === mach.id + d ? (bad ? " no" : " over") : "") + (d === today ? " today" : "")}
                    onDragOver={(e) => { e.preventDefault(); setOver(mach.id + d); }} onDragLeave={() => setOver("")} onDrop={() => onDrop(mach, d)}>
                    {(used > 0 || !off) && <div className={"ms-cap" + (used > cap ? " full" : used > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(used)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>}
                    {cs.map((c) => <CardEl key={c.key} c={c} />)}
                  </div>
                );
              }),
            ])}
          </div>
        </div>

        {/* phones: one day at a time, machines stacked */}
        <div className="ms-phone">
          <div className="ms-days">{days.map((d) => <button key={d} type="button" className={phoneDay === d ? "on" : ""} onClick={() => setPhoneDay(d)}>{dayLbl(d).split(",")[0]}<small>{dayLbl(d).split(", ")[1]}</small></button>)}</div>
          {machines.map((mach) => { const cs = cellCards(mach, phoneDay); const used = load2[mach.id]?.[phoneDay] || 0, cap = capacityMin(s, mach); return (
            <section key={mach.id} className={"ms-pm " + mach.type}>
              <div className="ms-pm-h"><b>{mach.name}</b><span className="faint">{fmtMin(used)} / {fmtMin(cap)}</span></div>
              <div className={"ms-cap" + (used > cap ? " full" : used > cap * s.fillTarget ? " warn" : "")}><i style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
              {cs.length ? cs.map((c) => <CardEl key={c.key} c={c} />) : <div className="faint" style={{ fontSize: 12.5 }}>Open</div>}
            </section>
          ); })}
        </div>
      </div>

      {open && s && <CardPanel s={s} c={open} days={days} onClose={() => setOpen(null)} onMove={(mach, d) => { book(open.job, open.need, mach, d, "manual", open.slot); setOpen(null); }} onStatus={setStatus} onUnbook={unbook} />}
    </div>
  );
}

/** A job on the calendar: the time breakdown, move it (machine / day), mark it running or done, or take it off. */
function CardPanel({ s, c, days, onClose, onMove, onStatus, onUnbook }: { s: ProductionSettings; c: Card; days: string[]; onClose: () => void; onMove: (m: Machine, d: string) => void; onStatus: (sl: Slot, st: Slot["status"]) => void; onUnbook: (sl: Slot) => void }) {
  const [mach, setMach] = useState(c.machine.id), [day, setDay] = useState(c.day);
  const est = estimate(s, c.need, s.machines.find((x) => x.id === mach) || c.machine);
  const options = s.machines.filter((x) => x.active && x.type === c.need.type);
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scheduled job">
        <div className="pp-sheet-h"><b>#{c.job.number} {c.job.customer}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint">{c.job.name}{c.job.due ? ` · in-hands ${dayLbl(c.job.due)}` : ""} · {c.job.status}{c.fromPv ? " · placed by its Printavo status" : ""}</div>
          <div><b>{TYPE_LBL[c.need.type]}:</b> {c.need.label} · {c.need.qty} pcs{c.need.steps.some((x) => x.note) ? <span className="faint"> ({c.need.steps.find((x) => x.note)?.note})</span> : null}</div>
          <ul className="ms-parts">{est.parts.map((p, i) => <li key={i}><span>{p.label}</span><b>{fmtMin(p.minutes)}</b></li>)}<li className="tot"><span>Setup {fmtMin(est.setup)} · run {fmtMin(est.run)}{est.teardown ? ` · teardown ${fmtMin(est.teardown)}` : ""}</span><b>{fmtMin(est.minutes)}</b></li></ul>
          <div className="tmx-2">
            <label>Machine<select value={mach} onChange={(e) => setMach(e.target.value)}>{options.map((x) => <option key={x.id} value={x.id} disabled={!fits(c.need, x)}>{x.name}{!fits(c.need, x) ? " (not enough colors)" : ""}</option>)}</select></label>
            <label>Day<select value={day} onChange={(e) => setDay(e.target.value)}>{[...new Set([c.day, ...days])].map((d) => <option key={d} value={d}>{dayLbl(d)}</option>)}</select></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link className="btn" href={c.job.href}>Open Job</Link>
            {c.slot && c.slot.status !== "running" && <button type="button" className="btn" onClick={() => onStatus(c.slot!, "running")}>Running</button>}
            {c.slot && c.slot.status !== "done" && <button type="button" className="btn" onClick={() => onStatus(c.slot!, "done")}>Done</button>}
            {c.slot && <button type="button" className="btn danger" onClick={() => onUnbook(c.slot!)}>Take Off Schedule</button>}
            <button type="button" className="btn primary" disabled={mach === c.machine.id && day === c.day && !c.fromPv} onClick={() => onMove(s.machines.find((x) => x.id === mach)!, day)}>{c.fromPv ? "Book Here" : "Move"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
