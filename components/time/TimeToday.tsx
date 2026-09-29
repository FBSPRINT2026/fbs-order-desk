"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KIND_LABEL, addDays, fullName, hm, localDay, localMinutes, nextKinds, timeLabel, timecard, type Punch, type Shift } from "@/lib/timeclock";
import type { TimeData } from "./types";

/** Right now: who's in, on break, late or missing a punch, plus the signed-in person's own punch buttons (phone punching). */
export default function TimeToday({ d }: { d: TimeData }) {
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const today = localDay(new Date());
  const load = useCallback(async () => {
    const sb = createClient();
    const from = addDays(today, -2);
    const [{ data: p }, { data: s }] = await Promise.all([
      sb.from("time_punches").select("*").eq("voided", false).gte("at", new Date(Date.parse(from + "T00:00:00Z")).toISOString()).order("at"),
      sb.from("shifts").select("*").gte("starts_at", new Date(Date.parse(today + "T00:00:00Z") - 12 * 3600000).toISOString()).lte("starts_at", new Date(Date.parse(today + "T00:00:00Z") + 36 * 3600000).toISOString()),
    ]);
    const ps = (p || []) as Punch[];
    setPunches(ps); setShifts(((s || []) as Shift[]).filter((x) => localDay(x.starts_at) === today));
    const withPhoto = ps.filter((x) => x.photo_path && localDay(x.at) === today);
    if (withPhoto.length) {
      const { data: sg } = await sb.storage.from("timeclock").createSignedUrls(withPhoto.map((x) => x.photo_path!), 3600);
      const m: Record<string, string> = {}; withPhoto.forEach((x, i) => { if (sg?.[i]?.signedUrl) m[x.id] = sg[i].signedUrl!; }); setPhotos(m);
    }
  }, [today]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const rows = useMemo(() => {
    if (!punches) return [];
    const nowMin = localMinutes(new Date());
    return d.employees.filter((e) => e.active).map((e) => {
      const mine = punches.filter((p) => p.employee_id === e.id);
      const card = timecard(d.settings, e.id, mine, [], today, today);
      const todays = mine.filter((p) => localDay(p.at) === today);
      const shift = shifts.find((s) => s.employee_id === e.id) || null;
      const late = !!shift && !todays.some((p) => p.kind === "in") && card.state === "out" && nowMin > localMinutes(shift.starts_at) + d.settings.graceMin;
      const lateIn = shift && todays.find((p) => p.kind === "in") ? Math.round((Date.parse(todays.find((p) => p.kind === "in")!.at) - Date.parse(shift.starts_at)) / 60000) : 0;
      const openOld = timecard(d.settings, e.id, mine, [], addDays(today, -2), today).issues.some((i) => i.kind === "missing_out" || i.kind === "long");
      const lastPhoto = [...todays].reverse().find((p) => photos[p.id]);
      return { e, card, todays, shift, late, lateIn, openOld, photo: lastPhoto ? photos[lastPhoto.id] : null };
    });
  }, [punches, shifts, photos, d.employees, d.settings, today]);
  const inNow = rows.filter((r) => r.card.state === "in"), onBreak = rows.filter((r) => r.card.state === "break");
  const late = rows.filter((r) => r.late), missed = rows.filter((r) => r.openOld);
  const order = (r: (typeof rows)[number]) => (r.card.state === "in" ? 0 : r.card.state === "break" ? 1 : r.late ? 2 : r.todays.length ? 3 : 4);

  return (
    <div className="tmx">
      <MyPunch />
      <div className="sc-kpis tmx-kpis">
        <div className="sc-kpi teal"><span>Clocked In</span><b>{inNow.length}</b><small>{inNow.map((r) => r.e.first_name).slice(0, 4).join(", ") || "no one yet"}</small></div>
        <div className="sc-kpi orange"><span>On Break</span><b>{onBreak.length}</b><small>{onBreak.map((r) => r.e.first_name).join(", ") || "—"}</small></div>
        <div className={"sc-kpi " + (late.length ? "bad" : "")}><span>Late / Not In</span><b>{late.length}</b><small>{late.map((r) => r.e.first_name).join(", ") || `scheduled today: ${shifts.length}`}</small></div>
        <div className={"sc-kpi " + (missed.length ? "warn" : "")}><span>Missed Punches</span><b>{missed.length}</b><small>{missed.length ? "still clocked in from earlier" : "none"}</small></div>
        <div className="sc-kpi blue"><span>Hours Today</span><b>{hm(rows.reduce((a, r) => a + r.card.worked, 0))}</b><small>everyone, so far</small></div>
      </div>
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Today</h2><span className="faint db-h-note">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span></div>
        {punches === null ? <div className="db-empty">Loading…</div> : !rows.length ? <div className="db-empty">No employees yet. Add them on the Employees tab, give each a PIN, then set up the wall clock.</div> : (
          <ul className="db-list">{[...rows].sort((a, b) => order(a) - order(b) || fullName(a.e).localeCompare(fullName(b.e))).map((r) => (
            <li key={r.e.id} className="db-row tmx-row">
              {r.photo ? <img src={r.photo} alt="" className="tmx-ph" /> : <span className={"tmx-dot " + r.card.state} />}
              <span className="db-main"><b>{fullName(r.e)}</b><span className="faint">{[r.e.department, r.shift ? `scheduled ${timeLabel(r.shift.starts_at)}–${timeLabel(r.shift.ends_at)}` : ""].filter(Boolean).join(" · ") || "—"}</span>
                <span className="tmx-punches">{r.todays.map((p) => <span key={p.id} className={"tmx-p " + p.kind} title={p.source}>{KIND_LABEL[p.kind].replace("Clock ", "")} {timeLabel(p.at)}</span>)}</span>
              </span>
              <span className="db-side">
                <span className={"tmx-st " + (r.late ? "late" : r.card.state)}>{r.late ? "Late" : r.card.state === "in" ? `In since ${timeLabel(r.card.since!)}` : r.card.state === "break" ? `Break since ${timeLabel(r.card.since!)}` : r.todays.length ? "Clocked out" : "Not in"}{r.lateIn > d.settings.graceMin ? ` · ${r.lateIn} min late` : ""}</span>
                <b className="num">{hm(r.card.worked)}</b>
              </span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}

/** The signed-in person's own clock (phone punching), when their login is linked to an employee. */
function MyPunch() {
  const [s, setS] = useState<{ linked: boolean; name?: string; phone?: boolean; geo?: boolean; next?: Punch["kind"][]; state?: string; since?: string | null; todayMinutes?: number } | null>(null);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  const load = useCallback(async () => { const r = await fetch("/api/time/me", { cache: "no-store" }).catch(() => null); if (r?.ok) setS(await r.json()); }, []);
  useEffect(() => { load(); }, [load]);
  if (!s?.linked || !s.phone) return null;
  async function punch(kind: Punch["kind"]) {
    setBusy(kind); setMsg("");
    const pos = await new Promise<GeolocationPosition | null>((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(res, () => res(null), { enableHighAccuracy: true, timeout: 10000 }); });
    const r = await fetch("/api/time/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, lat: pos?.coords.latitude, lng: pos?.coords.longitude, accuracy: pos?.coords.accuracy }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "No connection." };
    setBusy("");
    if (!r?.ok) return setMsg(j.error || "Couldn't punch.");
    setMsg(`${KIND_LABEL[kind]} at ${timeLabel(new Date())}.`); load();
  }
  return (
    <section className="db-card db-orange tmx-me">
      <div className="db-card-h"><h2>My Time</h2><span className="faint db-h-note">{s.state === "in" ? `In since ${timeLabel(s.since!)}` : s.state === "break" ? `On break since ${timeLabel(s.since!)}` : "Clocked out"} · {hm(s.todayMinutes || 0)} today</span></div>
      <div className="tmx-me-b">{(s.next || nextKinds(null)).map((k) => <button key={k} type="button" className={"btn " + (k === "in" ? "primary" : "")} disabled={!!busy} onClick={() => punch(k)}>{busy === k ? "…" : KIND_LABEL[k]}</button>)}
        {msg && <span className="faint">{msg}</span>}</div>
    </section>
  );
}
