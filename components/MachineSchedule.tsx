"use client";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mergeProduction, needsForOrder, needsForPrintavo, estimate, fits, suggest, fmtMin, machineForStatus, capacityMin, PV_READY, type Machine, type Need, type ProductionSettings, type Suggestion } from "@/lib/production";
import type { Group } from "@/lib/pricing";

/**
 * The production calendar, on a real clock. Day view: machines across, the shop day down (7 AM → 7 PM), each job a
 * block as tall as it takes. Week view: machines down, days across, each job a bar as wide as it takes.
 * Jobs ready to run land in "Ready To Schedule" with a suggested machine and day (worked out from colors, quantity,
 * garments and stitches); one click books it at the next open time. Drag a job to another machine, day or time (a job
 * only drops on a machine that can run it), or tap it to move it. Printavo jobs in a machine status
 * ("SP - Press 1 - 12C Gauntlet III") show on that machine at their Printavo start/end times until go-live
 * (read-only toward Printavo: moving one here books it in our schedule only).
 */
type Job = { key: string; kind: "o" | "a"; id: string; number: string; customer: string; name: string; due: string | null; qty: number; status: string; needs: Need[]; href: string };
type Slot = { id: string; order_id: string | null; archived_order_id: string | null; machine: string; day: string; position: number; minutes: number; start_min: number | null; kind: string; label: string; status: "scheduled" | "running" | "done"; source: string; note: string };
/** a job on the calendar; startMin = pinned start (minutes after midnight), null = next open time */
type Card = { key: string; job: Job; need: Need; machine: Machine; day: string; minutes: number; startMin: number | null; slot: Slot | null; fromPv: boolean; carried?: string };
type Placed = { c: Card; start: number; end: number; overlap: boolean };
type View = "day" | "week" | "2wk";
type Drag = { card?: Card; job?: Job; need?: Need; grabMin: number };

const TZ = "America/Chicago";
const PARTS = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** shop-time date + minutes after midnight for an instant */
function shopTime(d: Date | string | null): { day: string; min: number } | null {
  if (!d) return null;
  const x = typeof d === "string" ? new Date(d) : d;
  if (isNaN(+x)) return null;
  const p = Object.fromEntries(PARTS.formatToParts(x).map((q) => [q.type, q.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return ymd(x); };
const dow = (d: string) => new Date(d + "T12:00:00").getDay();
const dayLbl = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** 420 → "7a", 510 → "8:30a" */
const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); const hh = h % 12 || 12, ap = h >= 12 ? "p" : "a"; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const clockLong = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const snap = (min: number, step = 15) => Math.round(min / step) * step;
const TYPE_LBL = { screen: "Screen Print", embroidery: "Embroidery", heat: "Heat Press" };
/** "Embroidery · 12 Head" → "12 Head", "Press 3 · 8C Sportsman" → "Press 3" */
const shortName = (m: Machine) => { const p = m.name.split(" · "); return p.length < 2 ? m.name : m.type === "embroidery" ? p[1] : p[0]; };
const PV_DONE = /job\s*completed|quote|cancel|ship|fulfillment|issue/i;
const HOUR_PX = 60;

/** Lay a machine's day out on the clock: pinned jobs at their times, the rest in order at the next open time. */
function layout(cs: Card[], mach: Machine): Placed[] {
  const out: Placed[] = [];
  for (const c of cs.filter((x) => x.startMin != null).sort((a, b) => a.startMin! - b.startMin!)) {
    const st = c.startMin!, en = st + c.minutes;
    const hits = out.filter((p) => st < p.end && en > p.start);
    hits.forEach((p) => { p.overlap = true; });
    out.push({ c, start: st, end: en, overlap: hits.length > 0 });
  }
  for (const c of cs.filter((x) => x.startMin == null).sort((a, b) => (a.slot?.position ?? 99) - (b.slot?.position ?? 99))) {
    let t = mach.startMin ?? 420;
    for (let guard = 0; guard < 200; guard++) { const hit = out.find((p) => t < p.end && t + c.minutes > p.start); if (!hit) break; t = hit.end; }
    out.push({ c, start: t, end: t + c.minutes, overlap: false });
  }
  return out.sort((a, b) => a.start - b.start);
}

export default function MachineSchedule() {
  const [now, setNow] = useState(() => shopTime(new Date())!);
  useEffect(() => { const t = setInterval(() => setNow(shopTime(new Date())!), 60000); return () => clearInterval(t); }, []);
  const today = now.day;
  const [s, setS] = useState<ProductionSettings | null>(null);
  const [view, setView] = useState<View>("day");
  const [start, setStart] = useState(() => { let d = shopTime(new Date())!.day; while (dow(d) === 0 || dow(d) === 6) d = addDay(d, 1); return d; });
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [pvLane, setPvLane] = useState<{ job: Job; machine: Machine; day: string; startMin: number | null; minutes: number | null; carried?: string }[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState("");
  const [open, setOpen] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");
  const [typeF, setTypeF] = useState<"" | "screen" | "embroidery" | "heat">("");
  const [trayAll, setTrayAll] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);

  // working days only (any active machine runs that weekday): a Saturday shows up only if a machine works Saturdays
  const workDays = useMemo(() => { const w = new Set((s?.machines || []).filter((x) => x.active).flatMap((x) => x.days)); if (!w.size) [1, 2, 3, 4, 5].forEach((x) => w.add(x)); return w; }, [s]);
  const days = useMemo(() => { const n = view === "2wk" ? 12 : 6; const out: string[] = []; let d = start; for (let i = 0; out.length < n && i < 60; i++) { if (workDays.has(dow(d))) out.push(d); d = addDay(d, 1); } return out; }, [start, view, workDays]);
  const stepDay = (dir: 1 | -1) => { let d = addDay(start, dir); for (let i = 0; i < 7 && !workDays.has(dow(d)); i++) d = addDay(d, dir); setStart(d); };
  const step = (dir: 1 | -1) => { if (view !== "day") setStart(addDay(start, 7 * dir)); else stepDay(dir); };

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: st }, { data: o }, { data: a }, { data: sl }] = await Promise.all([
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      sb.from("orders").select("id, number, nickname, due_date, qty, status, customer_id, groups, lines").in("status", ["approved", "art", "blanks", "production"]).limit(300),
      sb.from("archived_orders").select("id, visual_id, nickname, due_date, qty, status_name, customer_id, start:data->>startAt, pend:data->>dueAt, pvgroups:data->groups").eq("kind", "invoice").gte("due_date", addDay(today, -45)).not("status_name", "ilike", "%complete%").limit(600),
      sb.from("production_slots").select("*").gte("day", addDay(today, -14)).lte("day", addDay(today, 60)),
    ]);
    const ps = mergeProduction((st?.data as { production?: unknown } | null)?.production);
    setS(ps); setSlots((sl || []) as Slot[]);
    const pv = ((a || []) as { id: string; visual_id: string; nickname: string; due_date: string | null; qty: number; status_name: string; customer_id: string | null; start: string | null; pend: string | null; pvgroups: unknown }[]).filter((x) => !PV_DONE.test(x.status_name || "") || PV_READY.test(x.status_name || ""));
    const ids = [...new Set([...((o || []) as { customer_id: string | null }[]).map((x) => x.customer_id), ...pv.map((x) => x.customer_id)].filter(Boolean))] as string[];
    const cn = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 300) { const { data } = await sb.from("customers").select("id, company, name").in("id", ids.slice(i, i + 300)); for (const c of (data || []) as { id: string; company: string; name: string }[]) cn.set(c.id, c.company || c.name); }
    const js: Job[] = [
      ...((o || []) as { id: string; number: number; nickname: string; due_date: string | null; qty: number; status: string; customer_id: string | null; groups: Group[]; lines: never[] }[]).map((x) => ({ key: "o:" + x.id, kind: "o" as const, id: x.id, number: String(x.number), customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status, needs: needsForOrder(ps, x as never), href: `/shop/orders/${x.id}` })),
      ...pv.map((x) => ({ key: "a:" + x.id, kind: "a" as const, id: x.id, number: x.visual_id, customer: cn.get(x.customer_id || "") || "", name: x.nickname || "", due: x.due_date, qty: x.qty || 0, status: x.status_name, needs: needsForPrintavo(ps, { qty: x.qty, status_name: x.status_name, nickname: x.nickname, data: { groups: x.pvgroups as never } }), href: `/shop/archive/${x.id}` })),
    ];
    setJobs(js);
    // Printavo jobs in a machine status sit on that machine at their Printavo production times (start → end);
    // ones whose day has passed but are still in the status carry over to the start of today
    setPvLane(pv.map((x) => {
      const mach = machineForStatus(ps, x.status_name); if (!mach) return null;
      const job = js.find((j) => j.key === "a:" + x.id)!;
      const st = shopTime(x.start), en = shopTime(x.pend);
      const d0 = st?.day || (x.due_date ? addDay(x.due_date, -1) : today);
      const block = st && en && en.day === st.day && en.min > st.min ? en.min - st.min : null;
      const sane = st && st.min >= 300 && st.min <= 1320; // ignore midnight placeholders
      if (d0 < today) return { job, machine: mach, day: today, startMin: null, minutes: block, carried: d0 };
      return { job, machine: mach, day: d0, startMin: sane ? st!.min : null, minutes: block };
    }).filter(Boolean) as typeof pvLane);
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
      out.push({ key: sl.id, job, need, machine: mach, day: sl.day, minutes: sl.minutes || estimate(s, need, mach).minutes, startMin: sl.start_min, slot: sl, fromPv: false });
    }
    for (const p of pvLane) {
      const need = p.job.needs.find((n) => n.type === p.machine.type) || p.job.needs[0];
      if (!need || booked.has(p.job.key + ":" + p.machine.type)) continue;
      out.push({ key: "pv:" + p.job.key, job: p.job, need, machine: p.machine, day: p.day, minutes: p.minutes || estimate(s, need, p.machine).minutes, startMin: p.startMin, slot: null, fromPv: true, carried: p.carried });
    }
    return out;
  }, [s, jobs, slots, pvLane, byKey]);
  const load2 = useMemo(() => { const m: Record<string, Record<string, number>> = {}; for (const c of cards) { if (c.slot?.status === "done") continue; (m[c.machine.id] ||= {})[c.day] = (m[c.machine.id]?.[c.day] || 0) + c.minutes; } return m; }, [cards]);
  // every machine-day laid out on the clock
  const placed = useMemo(() => {
    const m = new Map<string, Placed[]>();
    if (!s) return m;
    const groups = new Map<string, Card[]>();
    for (const c of cards) { const k = c.machine.id + "|" + c.day; groups.set(k, [...(groups.get(k) || []), c]); }
    for (const [k, cs] of groups) m.set(k, layout(cs, cs[0].machine));
    return m;
  }, [cards, s]);
  const at = (mach: Machine, day: string) => placed.get(mach.id + "|" + day) || [];

  // ready to schedule: in production (goods here, art done) or a Printavo "ready for production / scheduling" status, not booked yet
  const tray = useMemo(() => {
    if (!s || !jobs) return [];
    const onCal = new Set(cards.map((c) => c.job.key + ":" + c.need.type));
    const ready = jobs.filter((j) => (j.kind === "o" ? j.status === "production" : PV_READY.test(j.status)));
    const ld = JSON.parse(JSON.stringify(load2)) as Record<string, Record<string, number>>;
    const out: { job: Job; need: Need; sug: Suggestion | null }[] = [];
    for (const j of [...ready].sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))) for (const n of j.needs) {
      if (onCal.has(j.key + ":" + n.type)) continue;
      const sug = suggest(s, n, j.due, today, ld);
      if (sug) (ld[sug.machine.id] ||= {})[sug.day] = (ld[sug.machine.id]?.[sug.day] || 0) + sug.minutes; // later jobs see this one's room taken
      out.push({ job: j, need: n, sug });
    }
    return out;
  }, [s, jobs, cards, load2, today]);
  const coming = (jobs || []).filter((j) => j.kind === "o" && ["approved", "art", "blanks"].includes(j.status));

  async function book(job: Job, need: Need, machine: Machine, day: string, source = "manual", slot?: Slot | null, startMin: number | null = null) {
    if (!s) return;
    if (!fits(need, machine)) { setMsg(`#${job.number} needs ${need.type === "screen" ? `${need.needColors} screens` : TYPE_LBL[need.type]}: ${machine.name} can't run it.`); return; }
    const minutes = estimate(s, need, machine).minutes;
    const sb = createClient();
    const pos = cards.filter((c) => c.machine.id === machine.id && c.day === day).length;
    const r = slot
      ? await sb.from("production_slots").update({ machine: machine.id, day, minutes, start_min: startMin, position: pos, updated_at: new Date().toISOString() }).eq("id", slot.id)
      : await sb.from("production_slots").insert({ order_id: job.kind === "o" ? job.id : null, archived_order_id: job.kind === "a" ? job.id : null, machine: machine.id, day, minutes, start_min: startMin, position: pos, kind: need.type, label: need.label, source });
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(`#${job.number} → ${machine.name}, ${dayLbl(day)}${startMin != null ? ` at ${clockLong(startMin)}` : ""} (${fmtMin(minutes)})`);
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

  if (!s || !jobs) return <div className="empty">Loading the schedule…</div>;
  const machines = s.machines.filter((x) => x.active && (!typeF || x.type === typeF));

  // the clock window: from the earliest machine start, at least 12 hours, longer if a shift or a job runs later
  const shownDays = view === "day" ? [start] : days;
  const vStart = Math.max(0, Math.floor(Math.min(...machines.map((m) => m.startMin ?? 420), 420) / 60) * 60);
  let vEnd = Math.max(vStart + 720, ...machines.map((m) => (m.startMin ?? 420) + m.hoursPerDay * 60));
  for (const m of machines) for (const d of shownDays) for (const p of at(m, d)) vEnd = Math.max(vEnd, p.end);
  vEnd = Math.min(1440, Math.ceil(vEnd / 60) * 60);
  const range = vEnd - vStart;
  const hours = Array.from({ length: range / 60 }, (_, i) => vStart + i * 60);

  const dragNeed = drag?.card?.need || drag?.need;
  const canDrop = (mach: Machine) => !dragNeed || fits(dragNeed, mach);
  function startDrag(e: DragEvent, d: Drag) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", "job"); } catch { /* old browsers */ } setDrag(d); }
  function drop(mach: Machine, day: string, minuteAtPointer: number) {
    setOver("");
    if (!drag) return;
    const st = Math.max(0, Math.min(1440 - 15, snap(minuteAtPointer - drag.grabMin)));
    if (drag.card) book(drag.card.job, drag.card.need, mach, day, "manual", drag.card.slot, st);
    else if (drag.job && drag.need) book(drag.job, drag.need, mach, day, "manual", null, st);
    setDrag(null);
  }
  const cls = (p: Placed) => {
    const c = p.c, late = !!c.job.due && c.day > c.job.due;
    return "ms-blk " + c.need.type + (c.fromPv ? " pv" : "") + (c.slot?.status === "done" ? " done" : c.slot?.status === "running" ? " run" : "") + (late ? " late" : "") + (p.overlap ? " clash" : "");
  };
  const tip = (p: Placed) => `#${p.c.job.number} ${p.c.job.customer}\n${clockLong(p.start)} – ${clockLong(p.end)} (${fmtMin(p.c.minutes)})\n${p.c.need.label}${p.c.job.due ? `\nIn-hands ${dayLbl(p.c.job.due)}` : ""}${p.c.fromPv ? "\nFrom its Printavo status" : ""}${p.c.carried ? `\nCarried over from ${dayLbl(p.c.carried)}` : ""}${p.overlap ? "\nOverlaps another job" : ""}`;
  const offShade = (mach: Machine, day: string) => {
    const a = mach.startMin ?? 420, b = a + mach.hoursPerDay * 60, works = mach.days.includes(dow(day));
    return works ? [[vStart, a], [b, vEnd]].filter(([x, y]) => y > x) : [[vStart, vEnd]];
  };

  /* ---------- Day view: machines across, the clock down ---------- */
  const dayView = () => (
    <div className="ms-dv">
      <div className="ms-dv-grid" style={{ gridTemplateColumns: `52px repeat(${machines.length}, minmax(118px,1fr))`, minWidth: 52 + machines.length * 118 }}>
        <div className="ms-dv-corner" />
        {machines.map((m) => { const used = load2[m.id]?.[start] || 0, cap = capacityMin(s, m); return (
          <div key={m.id} className={"ms-dv-h " + m.type}><b>{shortName(m)}</b><small>{m.type === "screen" ? `${m.colors} colors` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat press"}</small>
            <div className={"ms-cap" + (used > cap ? " full" : used > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(used)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
            <small className="ms-used">{fmtMin(used)} / {fmtMin(cap)}</small></div>
        ); })}
        <div className="ms-dv-gut" style={{ height: (range / 60) * HOUR_PX }}>{hours.map((h) => <span key={h} style={{ top: ((h - vStart) / 60) * HOUR_PX }}>{clock(h)}</span>)}</div>
        {machines.map((m) => (
          <div key={m.id} className={"ms-dv-col" + (over === m.id + start ? (canDrop(m) ? " over" : " no") : "")} style={{ height: (range / 60) * HOUR_PX, backgroundSize: `100% ${HOUR_PX}px` }}
            onDragOver={(e) => { e.preventDefault(); setOver(m.id + start); }} onDragLeave={() => setOver("")}
            onDrop={(e) => { const r = e.currentTarget.getBoundingClientRect(); drop(m, start, vStart + ((e.clientY - r.top) / HOUR_PX) * 60); }}>
            {offShade(m, start).map(([a, b]) => <div key={a} className="ms-off" style={{ top: ((a - vStart) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} />)}
            {start === today && now.min >= vStart && now.min <= vEnd && <div className="ms-now" style={{ top: ((now.min - vStart) / 60) * HOUR_PX }} />}
            {at(m, start).map((p) => { const h = Math.max(20, (p.c.minutes / 60) * HOUR_PX - 2); return (
              <button key={p.c.key} type="button" draggable className={cls(p) + (h < 44 ? " tiny" : "")} style={{ top: ((p.start - vStart) / 60) * HOUR_PX + 1, height: h }} title={tip(p)}
                onDragStart={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); startDrag(e, { card: p.c, grabMin: ((e.clientY - r.top) / HOUR_PX) * 60 }); }} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(p.c)}>
                <span className="ms-b1"><b>#{p.c.job.number}</b> {p.c.job.customer || p.c.job.name}</span>
                <span className="ms-b2">{clock(p.start)}–{clock(p.end)} · {fmtMin(p.c.minutes)}</span>
                <span className="ms-b3">{p.c.need.label}</span>
              </button>
            ); })}
          </div>
        ))}
      </div>
    </div>
  );

  /* ---------- Week view: machines down, days across, jobs as bars on each day's clock ---------- */
  const strip = (m: Machine, d: string, tall?: boolean) => {
    const ps = at(m, d);
    return (
      <div className={"ms-gt" + (tall ? " tall" : "") + (over === m.id + d ? (canDrop(m) ? " over" : " no") : "")} style={{ backgroundSize: `${(60 / range) * 100 * 2}% 100%` }}
        onDragOver={(e) => { e.preventDefault(); setOver(m.id + d); }} onDragLeave={() => setOver("")}
        onDrop={(e) => { const r = e.currentTarget.getBoundingClientRect(); drop(m, d, vStart + ((e.clientX - r.left) / r.width) * range); }}>
        {offShade(m, d).map(([a, b]) => <div key={a} className="ms-off h" style={{ left: `${((a - vStart) / range) * 100}%`, width: `${((b - a) / range) * 100}%` }} />)}
        {d === today && now.min >= vStart && now.min <= vEnd && <div className="ms-now v" style={{ left: `${((now.min - vStart) / range) * 100}%` }} />}
        {ps.map((p) => (
          <button key={p.c.key} type="button" draggable className={cls(p) + " bar"} title={tip(p)}
            style={{ left: `${((p.start - vStart) / range) * 100}%`, width: `calc(${(Math.min(p.end, vEnd) - p.start) / range * 100}% - 2px)` }}
            onDragStart={(e) => { const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect(), pr = el.parentElement!.getBoundingClientRect(); startDrag(e, { card: p.c, grabMin: ((e.clientX - r.left) / pr.width) * range }); }} onDragEnd={() => { setDrag(null); setOver(""); }} onClick={() => setOpen(p.c)}>
            <b>#{p.c.job.number}</b><span>{p.c.job.customer}</span>
          </button>
        ))}
      </div>
    );
  };
  const axis = () => <div className="ms-ax">{hours.filter((_, i) => i % 3 === 0).map((h) => <span key={h} style={{ left: `${((h - vStart) / range) * 100}%` }}>{clock(h)}</span>)}</div>;
  const weekView = () => (
    <div className="ms-grid-wrap">
      <div className="ms-grid" style={{ gridTemplateColumns: `150px repeat(${days.length}, minmax(${view === "2wk" ? 96 : 130}px,1fr))`, minWidth: 150 + days.length * (view === "2wk" ? 96 : 130) }}>
        <div className="ms-h" />
        {days.map((d) => <button type="button" key={d} className={"ms-h" + (d === today ? " today" : "")} onClick={() => { setStart(d); setView("day"); }} title="Open this day">{dayLbl(d)}{axis()}</button>)}
        {machines.map((m) => [
          <div key={m.id} className={"ms-m " + m.type}><b>{m.name}</b><small>{m.type === "screen" ? `${m.colors} colors` : m.type === "embroidery" ? `${m.heads} head${m.heads === 1 ? "" : "s"}` : "heat press"} · {clock(m.startMin ?? 420)}, {m.hoursPerDay}h</small></div>,
          ...days.map((d) => { const used = load2[m.id]?.[d] || 0, cap = capacityMin(s, m); return (
            <div key={m.id + d} className={"ms-cell" + (d === today ? " today" : "")}>
              <div className={"ms-cap" + (used > cap ? " full" : used > cap * s.fillTarget ? " warn" : "")} title={`${fmtMin(used)} of ${fmtMin(cap)} booked`}><i style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
              {strip(m, d)}
            </div>
          ); }),
        ])}
      </div>
    </div>
  );

  /* ---------- Phones: one day, each machine a clock strip + its jobs in time order ---------- */
  const phoneView = () => (
    <div className="ms-phone">
      <div className="ms-pnav"><button type="button" className="btn sm" onClick={() => stepDay(-1)} aria-label="Previous day">←</button><b>{new Date(start + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</b><button type="button" className="btn sm" onClick={() => stepDay(1)} aria-label="Next day">→</button></div>
      {machines.map((m) => { const ps = at(m, start); const used = load2[m.id]?.[start] || 0, cap = capacityMin(s, m); return (
        <section key={m.id} className={"ms-pm " + m.type}>
          <div className="ms-pm-h"><b>{m.name}</b><span className="faint">{fmtMin(used)} / {fmtMin(cap)}</span></div>
          {strip(m, start, true)}{axis()}
          {ps.length ? <ul className="ms-agenda">{ps.map((p) => (
            <li key={p.c.key}><button type="button" className={cls(p) + " row-blk"} onClick={() => setOpen(p.c)}>
              <span className="ms-t1">{clock(p.start)}–{clock(p.end)}</span><span className="ms-b1"><b>#{p.c.job.number}</b> {p.c.job.customer || p.c.job.name}</span><span className="ms-b3">{p.c.need.label} · {fmtMin(p.c.minutes)}</span>
            </button></li>
          ))}</ul> : <div className="faint" style={{ fontSize: 12.5 }}>Open all day</div>}
        </section>
      ); })}
    </div>
  );

  return (
    <div className="ms">
      <div className="ms-bar">
        <h2 className="ms-title">Production Calendar</h2>
        <div className="rv-seg">{([["", "All"], ["screen", "Screen Print"], ["embroidery", "Embroidery"], ["heat", "Heat Press"]] as const).map(([k, l]) => <button key={k} type="button" className={typeF === k ? "on" : ""} onClick={() => setTypeF(k)}>{l}</button>)}</div>
        <span className="spacer" />
        <div className="rv-seg ms-span">{([["day", "Day"], ["week", "Week"], ["2wk", "2 Weeks"]] as const).map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
        <button type="button" className="btn sm" onClick={() => step(-1)} aria-label="Earlier">←</button>
        <button type="button" className="btn sm" onClick={() => { let d = today; while (!workDays.has(dow(d))) d = addDay(d, 1); setStart(d); }}>Today</button>
        <button type="button" className="btn sm" onClick={() => step(1)} aria-label="Later">→</button>
        <Link className="linkbtn" href="/shop/settings/production">Machines &amp; times</Link>
      </div>
      <div className="ms-date">{view === "day" ? new Date(start + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : `${dayLbl(days[0])} – ${dayLbl(days[days.length - 1])}`}{start === today && view === "day" ? <span className="ms-today-tag">Today</span> : null}</div>
      {msg && <div className="banner" style={{ marginBottom: 8 }} onClick={() => setMsg("")}>{msg}</div>}

      <div className={"ms-wrap" + (trayOpen ? "" : " closed")}>
        {!trayOpen ? <button type="button" className="ms-tray-tab" onClick={() => setTrayOpen(true)} title="Show Ready To Schedule">Ready To Schedule <span className="aa-n">{tray.length}</span></button> : (
        <aside className="ms-tray">
          <div className="ms-tray-h"><b>Ready To Schedule</b><span className="aa-n">{tray.length}</span>{tray.some((t) => t.sug && !t.sug.late) && <button type="button" className="btn sm primary" onClick={acceptAll}>Accept All</button>}<button type="button" className="btn sm ghost ms-tray-x" onClick={() => setTrayOpen(false)} title="Hide to make the calendar wider" aria-label="Hide Ready To Schedule">«</button></div>
          {!tray.length ? <div className="db-empty">Nothing waiting. Jobs land here when they go to In Production (goods here, art approved), or a Printavo &quot;Ready for Production / Scheduling&quot; status.</div> : (
            <ul>{(trayAll ? tray : tray.slice(0, 5)).map((t) => (
              <li key={t.job.key + t.need.type} draggable onDragStart={(e) => startDrag(e, { job: t.job, need: t.need, grabMin: 0 })} onDragEnd={() => setDrag(null)} className={"ms-t " + t.need.type + (t.sug?.late ? " late" : "")}>
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
          <div className="faint ms-hint">Drag a job onto a machine at the time you want it to start, or tap a job to move it.</div>
        </aside>
        )}

        <div className="ms-main">
          {view === "day" ? dayView() : weekView()}
          {phoneView()}
        </div>
      </div>

      {open && <CardPanel s={s} c={open} days={days} placedStart={(at(open.machine, open.day).find((p) => p.c.key === open.key) || { start: open.startMin ?? 420 }).start} win={[vStart, vEnd]} onClose={() => setOpen(null)} onMove={(mach, d, st) => { book(open.job, open.need, mach, d, "manual", open.slot, st); setOpen(null); }} onStatus={setStatus} onUnbook={unbook} />}
    </div>
  );
}

/** A job on the calendar: the time breakdown, move it (machine / day / start time), mark it running or done, or take it off. */
function CardPanel({ s, c, days, placedStart, win, onClose, onMove, onStatus, onUnbook }: { s: ProductionSettings; c: Card; days: string[]; placedStart: number; win: [number, number]; onClose: () => void; onMove: (m: Machine, d: string, startMin: number | null) => void; onStatus: (sl: Slot, st: Slot["status"]) => void; onUnbook: (sl: Slot) => void }) {
  const [mach, setMach] = useState(c.machine.id), [day, setDay] = useState(c.day);
  const [st, setSt] = useState<string>(c.startMin != null ? String(c.startMin) : "auto");
  const m = s.machines.find((x) => x.id === mach) || c.machine;
  const est = estimate(s, c.need, m);
  const options = s.machines.filter((x) => x.active && x.type === c.need.type);
  const times: number[] = []; for (let t = Math.min(win[0], m.startMin ?? 420); t < win[1]; t += 15) times.push(t);
  const newStart = st === "auto" ? null : +st;
  const same = mach === c.machine.id && day === c.day && newStart === c.startMin && !c.fromPv;
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scheduled job">
        <div className="pp-sheet-h"><b>#{c.job.number} {c.job.customer}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="faint">{c.job.name}{c.job.due ? ` · in-hands ${dayLbl(c.job.due)}` : ""} · {c.job.status}</div>
          <div className="ms-when"><b>{dayLbl(c.day)}, {clockLong(placedStart)} – {clockLong(placedStart + c.minutes)}</b> on {c.machine.name}{c.fromPv ? <span className="faint"> · from its Printavo schedule{c.carried ? ` (was ${dayLbl(c.carried)}, carried over)` : ""}</span> : c.startMin == null ? <span className="faint"> · next open time</span> : null}</div>
          <div><b>{TYPE_LBL[c.need.type]}:</b> {c.need.label} · {c.need.qty} pcs{c.need.steps.some((x) => x.note) ? <span className="faint"> ({c.need.steps.find((x) => x.note)?.note})</span> : null}</div>
          <ul className="ms-parts">{est.parts.map((p, i) => <li key={i}><span>{p.label}</span><b>{fmtMin(p.minutes)}</b></li>)}<li className="tot"><span>Setup {fmtMin(est.setup)} · run {fmtMin(est.run)}{est.teardown ? ` · teardown ${fmtMin(est.teardown)}` : ""}</span><b>{fmtMin(est.minutes)}</b></li></ul>
          {c.fromPv && c.minutes !== est.minutes && <div className="faint" style={{ fontSize: 12.5 }}>Printavo has it blocked for {fmtMin(c.minutes)}; our estimate is {fmtMin(est.minutes)}. Booking it here uses our estimate.</div>}
          <div className="tmx-2 ms-3">
            <label>Machine<select value={mach} onChange={(e) => setMach(e.target.value)}>{options.map((x) => <option key={x.id} value={x.id} disabled={!fits(c.need, x)}>{x.name}{!fits(c.need, x) ? " (not enough colors)" : ""}</option>)}</select></label>
            <label>Day<select value={day} onChange={(e) => setDay(e.target.value)}>{[...new Set([c.day, ...days])].sort().map((d) => <option key={d} value={d}>{dayLbl(d)}</option>)}</select></label>
            <label>Start<select value={st} onChange={(e) => setSt(e.target.value)}><option value="auto">Next open time</option>{times.map((t) => <option key={t} value={t}>{clockLong(t)}</option>)}</select></label>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link className="btn" href={c.job.href}>Open Job</Link>
            {c.slot && c.slot.status !== "running" && <button type="button" className="btn" onClick={() => onStatus(c.slot!, "running")}>Running</button>}
            {c.slot && c.slot.status !== "done" && <button type="button" className="btn" onClick={() => onStatus(c.slot!, "done")}>Done</button>}
            {c.slot && <button type="button" className="btn danger" onClick={() => onUnbook(c.slot!)}>Take Off Schedule</button>}
            <button type="button" className="btn primary" disabled={same} onClick={() => onMove(m, day, newStart)}>{c.fromPv ? "Book Here" : "Move"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
