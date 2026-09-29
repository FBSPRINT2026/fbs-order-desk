"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dayLabel, fullName, localDay, type TimeOff } from "@/lib/timeclock";
import { isBoss, type TimeData } from "./types";

const KINDS: Record<TimeOff["kind"], string> = { pto: "PTO / Vacation", sick: "Sick", holiday: "Holiday", unpaid: "Unpaid" };

/** Time off: add it (approved right away by managers, or as a request), approve or deny requests. Paid time off shows on timecards. */
export default function TimeOffPanel({ d }: { d: TimeData }) {
  const [rows, setRows] = useState<TimeOff[] | null>(null);
  const [v, setV] = useState({ employee_id: "", starts_on: localDay(new Date()), ends_on: localDay(new Date()), hours: "8", kind: "pto" as TimeOff["kind"], note: "" });
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const boss = isBoss(d);
  const load = useCallback(async () => {
    const { data } = await createClient().from("time_off").select("*").gte("ends_on", new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)).order("starts_on", { ascending: false });
    setRows((data || []) as TimeOff[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  const name = (id: string) => fullName(d.employees.find((e) => e.id === id) || { first_name: "?", last_name: "" });
  async function add() {
    if (!v.employee_id) return setErr("Pick who it's for.");
    if (v.ends_on < v.starts_on) return setErr("The end date is before the start.");
    setBusy(true); setErr("");
    const { error } = await createClient().from("time_off").insert({ ...v, hours: +v.hours || 0, status: boss ? "approved" : "requested", decided_by: boss ? d.me : null, decided_at: boss ? new Date().toISOString() : null });
    setBusy(false);
    if (error) return setErr(error.message);
    setV({ ...v, note: "" }); load();
  }
  async function decide(id: string, status: TimeOff["status"]) { await createClient().from("time_off").update({ status, decided_by: d.me, decided_at: new Date().toISOString() }).eq("id", id); load(); }
  return (
    <div className="tmx">
      <section className="db-card db-teal">
        <div className="db-card-h"><h2>Add Time Off</h2><span className="faint db-h-note">{boss ? "approved when you add it" : "goes to a manager to approve"}</span></div>
        <div className="tmx-off-f">
          <label>Employee<select value={v.employee_id} onChange={(e) => setV({ ...v, employee_id: e.target.value })}><option value="">Choose…</option>{d.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></label>
          <label>Type<select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as TimeOff["kind"] })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>From<input type="date" value={v.starts_on} onChange={(e) => setV({ ...v, starts_on: e.target.value, ends_on: e.target.value > v.ends_on ? e.target.value : v.ends_on })} /></label>
          <label>To<input type="date" value={v.ends_on} onChange={(e) => setV({ ...v, ends_on: e.target.value })} /></label>
          <label>Total hours<input type="number" min={0} step="0.5" value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} /></label>
          <label className="wide">Note<input type="text" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></label>
          <button type="button" className="btn primary" disabled={busy} onClick={add}>{busy ? "Saving…" : "Add"}</button>
        </div>
        {err && <div className="pv-err">{err}</div>}
      </section>
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Time Off</h2><span className="faint db-h-note">last 4 months and upcoming</span></div>
        {rows === null ? <div className="db-empty">Loading…</div> : !rows.length ? <div className="db-empty">No time off yet.</div> : (
          <ul className="db-list">{rows.map((r) => (
            <li key={r.id} className="db-row">
              <span className="db-main"><b>{name(r.employee_id)}</b><span className="faint">{KINDS[r.kind]} · {dayLabel(r.starts_on)}{r.ends_on !== r.starts_on ? ` – ${dayLabel(r.ends_on)}` : ""} · {r.hours} h{r.note ? ` · ${r.note}` : ""}</span></span>
              <span className="db-side">
                <span className={"tmx-tag " + (r.status === "approved" ? "ok" : r.status === "denied" ? "bad" : "warn")}>{r.status === "requested" ? "Requested" : r.status === "approved" ? "Approved" : "Denied"}</span>
                {boss && r.status !== "approved" && <button type="button" className="btn sm primary" onClick={() => decide(r.id, "approved")}>Approve</button>}
                {boss && r.status !== "denied" && <button type="button" className="btn sm" onClick={() => decide(r.id, "denied")}>Deny</button>}
              </span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
