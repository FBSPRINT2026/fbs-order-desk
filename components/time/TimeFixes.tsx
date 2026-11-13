"use client";
import { useCallback, useEffect, useState } from "react";
import { timeFixDecide, timeFixesOpen, type TimeFix } from "@/app/shop/time-actions";
import { fullName, type Employee } from "@/lib/timeclock";

/** Fixes from phones, waiting for a manager (the crew's Time card on /crew). Approve makes the punches; "Something else" is fixed on the card by hand first. */
const WHAT: Record<TimeFix["kind"], string> = { lunch: "Lunch not punched", missed_in: "Forgot to clock in", missed_out: "Forgot to clock out", other: "Something else" };
const t12 = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : "");
const day = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });

export default function TimeFixes({ employees, onChanged }: { employees: Employee[]; onChanged?: () => void }) {
  const [list, setList] = useState<TimeFix[] | null>(null), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const load = useCallback(async () => { const r = await timeFixesOpen(); if (r.ok) setList(r.fixes); else setList([]); }, []);
  useEffect(() => { load(); }, [load]);
  if (!list?.length) return null;
  const name = (id: string) => { const e = employees.find((x) => x.id === id); return e ? fullName(e) : "—"; };
  async function decide(f: TimeFix, ok: boolean) {
    setBusy(f.id); setErr("");
    const r = await timeFixDecide(f.id, ok);
    setBusy("");
    if (!r.ok) return setErr(r.error);
    await load(); onChanged?.();
  }
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-h"><h2>Fixes from phones</h2><span className="faint">{list.length} waiting · approved, each becomes the punch it asks for (the original kept)</span></div>
      <div className="panel-b">
        {err && <div role="alert" style={{ color: "var(--danger)", fontWeight: 700, marginBottom: 8 }}>{err}</div>}
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Who</th><th>Day</th><th>What</th><th>Note</th><th /></tr></thead>
          <tbody>{list.map((f) => (
            <tr key={f.id}>
              <td><b>{name(f.employee_id)}</b></td>
              <td style={{ whiteSpace: "nowrap" }}>{day(f.day)}</td>
              <td>{WHAT[f.kind]}{f.at && <div className="sub">{t12(f.at)}{f.minutes ? `, ${f.minutes} min` : ""}</div>}</td>
              <td>{f.note || "—"}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button type="button" className="btn primary" disabled={busy === f.id} onClick={() => decide(f, true)}>{f.kind === "other" ? "Fixed, approve" : "Approve"}</button>{" "}
                <button type="button" className="btn" disabled={busy === f.id} onClick={() => decide(f, false)}>No</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </section>
  );
}
