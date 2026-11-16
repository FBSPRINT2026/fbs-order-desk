"use client";
import { useCallback, useEffect, useState } from "react";
import { phonePunchDecide, phonePunchesOpen, timeFixDecide, timeFixesOpen, type PhonePunch, type TimeFix } from "@/app/shop/time-actions";
import { fullName, type Employee } from "@/lib/timeclock";

/** Fixes from phones, waiting for a manager (the crew's Time card on /crew). Approve makes the punches; "Something else" is fixed on the card by hand first. */
const WHAT: Record<TimeFix["kind"], string> = { lunch: "Lunch not punched", missed_in: "Forgot to clock in", missed_out: "Forgot to clock out", other: "Something else", day: "Their real hours" };
const PKS: Record<string, string> = { in: "In", out: "Out", break_start: "Lunch out", break_end: "Lunch in" };
const runs = (ps?: { kind: string; at: string }[] | null) => (ps || []).map((p) => `${PKS[p.kind] || p.kind} ${t12(p.at)}`).join(" · ") || "no punches";
const t12 = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : "");
const day = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });

export default function TimeFixes({ employees, onChanged }: { employees: Employee[]; onChanged?: () => void }) {
  const [list, setList] = useState<TimeFix[] | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const [pp, setPp] = useState<PhonePunch[]>([]);
  const load = useCallback(async () => {
    const [r, q] = await Promise.all([timeFixesOpen(), phonePunchesOpen()]);
    setList(r.ok ? r.fixes : []); setPp(q.ok ? q.punches : []);
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!list?.length && !pp.length) return null;
  const name = (id: string) => { const e = employees.find((x) => x.id === id); return e ? fullName(e) : "—"; };
  async function decide(f: TimeFix, ok: boolean) {
    setBusy(f.id); setErr("");
    const r = await timeFixDecide(f.id, ok);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    await load(); onChanged?.();
  }
  async function ok(ids: string[], yes: boolean) {
    setBusy(ids.length > 1 ? "all" : ids[0]); setErr("");
    const r = await phonePunchDecide(ids, yes);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    await load(); onChanged?.();
  }
  const PK: Record<string, string> = { in: "Clocked in", out: "Clocked out", break_start: "Started lunch", break_end: "Back from lunch" };
  return (<>
    {pp.length > 0 && <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-h"><h2>Punches from phones</h2><span className="faint">{pp.length} to OK · they already count; No takes the punch off</span>
        <button type="button" className="btn primary" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={() => ok(pp.map((x) => x.id), true)}>OK all</button></div>
      <div className="panel-b">
        {err && <div role="alert" style={{ color: "var(--danger)", fontWeight: 700, marginBottom: 8 }}>{err}</div>}
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Who</th><th>Day</th><th>Punch</th><th /></tr></thead>
          <tbody>{pp.map((x) => (
            <tr key={x.id}>
              <td><b>{name(x.employee_id)}</b></td>
              <td style={{ whiteSpace: "nowrap" }}>{new Date(x.at).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "numeric", day: "numeric" })}</td>
              <td style={{ whiteSpace: "nowrap" }}>{PK[x.kind] || x.kind} · {t12(x.at)}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button type="button" className="btn primary" disabled={!!busy} onClick={() => ok([x.id], true)}>OK</button>{" "}
                <button type="button" className="btn" disabled={!!busy} onClick={() => ok([x.id], false)}>No</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </section>}
    {!!list?.length && <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-h"><h2>Fixes from phones</h2><span className="faint">{list.length} waiting · approved, each becomes the punch it asks for (the original kept)</span></div>
      <div className="panel-b">
        {err && <div role="alert" style={{ color: "var(--danger)", fontWeight: 700, marginBottom: 8 }}>{err}</div>}
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Who</th><th>Day</th><th>What</th><th>Note</th><th /></tr></thead>
          <tbody>{list.map((f) => (
            <tr key={f.id}>
              <td><b>{name(f.employee_id)}</b></td>
              <td style={{ whiteSpace: "nowrap" }}>{day(f.day)}</td>
              <td>{f.kind === "day"
                ? <>{WHAT.day}{f.reason ? ` · ${f.reason}` : ""}<div className="sub">Was: {runs(f.was)}</div><div className="sub" style={{ color: "var(--ink)" }}><b>They say:</b> {runs(f.punches)}</div></>
                : <>{WHAT[f.kind]}{f.at && <div className="sub">{t12(f.at)}{f.minutes ? `, ${f.minutes} min` : ""}</div>}</>}</td>
              <td>{f.note || "—"}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button type="button" className="btn primary" disabled={busy === f.id} onClick={() => decide(f, true)}>{f.kind === "other" ? "Fixed, approve" : f.kind === "day" ? "Approve their day" : "Approve"}</button>{" "}
                <button type="button" className="btn" disabled={busy === f.id} onClick={() => decide(f, false)}>No</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </section>}
  </>);
}
