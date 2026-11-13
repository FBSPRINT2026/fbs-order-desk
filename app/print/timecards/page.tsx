"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { allRows } from "@/lib/readAll";
import { addDays, cardPunches, daysBetween, fullName, localToIso, mergeTime, periodOf, punchFixed, timecard, timeLabel, weekOf, type Employee, type Punch, type TimeOff, type TimeSettings } from "@/lib/timeclock";

/**
 * Time cards to sign (Nick, Nov 13 2026: "print a time card for every employee to physically sign, that's the way we've
 * been doing it… we haven't got everybody in the system yet"). One letter page per person for a pay period: every day
 * with In / Lunch out / Lunch in / Out and its hours, the office's fixes marked, weekly totals, regular / overtime / time
 * off, and signature lines. /print/timecards?start=<period start>&who=all|open ("open": only who hasn't approved their
 * hours on the phone). Opened from Time Clock → Payroll Report → Print time cards.
 */
const DEPT_ORDER = ["Screen Printing", "Embroidery", "Screen Cleaning & Prep", "Receiving", "Fulfillment", "Shipping", "Office"];
const h2 = (m: number) => (m / 60).toFixed(2);
const clock = (t: string) => timeLabel(t).replace(/\s?([AP])M/i, (_, x) => x.toLowerCase());
const dayRow = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });
const longDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

type Data = { s: TimeSettings; start: string; emps: Employee[]; punches: Punch[]; offs: TimeOff[]; checked: Set<string> };

function Cards() {
  const sp = useSearchParams();
  const who = sp.get("who") === "open" ? "open" : "all";
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: st } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
      const s = mergeTime((st?.data as { time?: unknown } | null)?.time);
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const per = periodOf(s, /^\d{4}-\d{2}-\d{2}$/.test(sp.get("start") || "") ? sp.get("start")! : addDays(periodOf(s, today).start, -1));
      const [{ data: emps, error }, { data: punches }, { data: offs }, ck] = await Promise.all([
        sb.from("employees").select("*").order("first_name"),
        allRows((r0, r1) => sb.from("time_punches").select("*").gte("at", localToIso(addDays(per.start, -1), 0)).lt("at", localToIso(addDays(per.end, 2), 0)).order("at").order("id").range(r0, r1)),
        sb.from("time_off").select("*").lte("starts_on", per.end).gte("ends_on", per.start),
        sb.from("time_card_checks").select("employee_id, status").eq("period_start", per.start),
      ]);
      if (error) return setErr(error.message);
      setData({ s, start: per.start, emps: (emps || []) as Employee[], punches: (punches || []) as Punch[], offs: (offs || []) as TimeOff[],
        checked: new Set(((ck.data || []) as { employee_id: string; status: string }[]).filter((x) => x.status === "approved").map((x) => x.employee_id)) });
    })();
  }, [sp]);

  const pages = useMemo(() => {
    if (!data) return [];
    const { s, emps, punches, offs, checked } = data;
    const per = periodOf(s, data.start);
    const days = Array.from({ length: daysBetween(per.start, per.end) + 1 }, (_, i) => addDays(per.start, i));
    const worked = new Set([...punches.filter((p) => !p.voided).map((p) => p.employee_id), ...offs.filter((o) => o.status === "approved").map((o) => o.employee_id)]);
    const rank = (e: Employee) => { const i = DEPT_ORDER.indexOf(e.department); return i < 0 ? DEPT_ORDER.length : i; };
    return emps.filter((e) => worked.has(e.id) && (who === "all" || !checked.has(e.id)))
      .sort((a, b) => rank(a) - rank(b) || (a.department || "").localeCompare(b.department || "") || fullName(a).localeCompare(fullName(b)))
      .map((e) => {
        const c = timecard(s, e.id, punches, offs, per.start, per.end);
        const byDay = cardPunches(s, e.id, punches);
        const fixed = new Set(punches.filter((p) => p.employee_id === e.id && !p.voided && punchFixed(p as Punch & { source?: string })).map((p) => new Date(p.at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" })));
        // the rows: every day, a week's total after its last day
        const rows: ({ k: "d"; day: string; inn: string; lo: string; li: string; out: string; more: number; mins: number; miss: boolean; fix: boolean } | { k: "w"; label: string; mins: number })[] = [];
        let wk = "", wkMins = 0, wkN = 0;
        for (const d of days) {
          const w = weekOf(s, d).start;
          if (wk && w !== wk) { rows.push({ k: "w", label: `Week ${wkN}`, mins: wkMins }); wkMins = 0; }
          if (w !== wk) { wk = w; wkN++; }
          const ps = byDay[d] || [], dh = c.days[d];
          const first = (k: Punch["kind"]) => ps.find((p) => p.kind === k)?.at || "";
          const ins = ps.filter((p) => p.kind === "in"), outs = ps.filter((p) => p.kind === "out");
          const mins = dh?.worked || 0; wkMins += mins;
          rows.push({ k: "d", day: d, inn: ins[0]?.at || "", lo: first("break_start"), li: first("break_end"), out: outs[outs.length - 1]?.at || "", more: Math.max(0, ins.length - 1), mins, miss: !!dh?.issues.length, fix: fixed.has(d) });
        }
        rows.push({ k: "w", label: `Week ${wkN}`, mins: wkMins });
        return { e, c, rows, per, phone: checked.has(e.id) };
      });
  }, [data, who]);

  const printed = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  if (err) return <div className="tcp-msg">{err}</div>;
  if (!data) return <div className="tcp-msg">Loading time cards…</div>;
  return (
    <div className="tcp" data-nosquish>
      <title>{`Time cards ${pages[0] ? longDay(pages[0].per.start) + " – " + longDay(pages[0].per.end) : ""}`}</title>
      <div className="tcp-bar">
        <b>{pages.length} time card{pages.length === 1 ? "" : "s"}</b>
        <span>{who === "open" ? "Only who hasn't approved their hours on their phone" : "Everyone who worked this pay period"}</span>
        <span className="tcp-sp" />
        <button type="button" className="btn primary" onClick={() => window.print()}>Print</button>
        <button type="button" className="btn" onClick={() => window.close()}>Close</button>
      </div>
      {!pages.length && <div className="tcp-msg">Nobody to print: {who === "open" ? "everyone has approved their hours on their phone." : "no hours in this pay period."}</div>}
      {pages.map(({ e, c, rows, per, phone }, i) => (
        <section className="tcp-sheet" key={e.id}>
          <header className="tcp-h">
            <div><div className="tcp-k">FBS PRINT · TIME CARD</div><div className="tcp-name">{fullName(e)}</div></div>
            <div className="tcp-per"><div className="tcp-k">PAY PERIOD</div><b>{longDay(per.start)} – {longDay(per.end)}, {per.end.slice(0, 4)}</b></div>
          </header>
          <div className="tcp-who">
            <div><span>EMPLOYEE #</span><b>{e.code ?? "—"}</b></div>
            <div><span>DEPARTMENT</span><b>{e.department || "—"}</b></div>
            <div><span>PAID</span><b>{e.pay_type === "salary" ? "Salary" : "Hourly"} · {e.paid_by === "contract" ? "Contract" : "Payroll"}</b></div>
          </div>
          <table className="tcp-t" data-nofit>
            <thead><tr><th>Day</th><th>In</th><th>Lunch out</th><th>Lunch in</th><th>Out</th><th className="r">Hours</th></tr></thead>
            <tbody>{rows.map((r) => r.k === "w"
              ? <tr key={"w" + r.label} className="tcp-wk"><td colSpan={5}>{r.label}</td><td className="r">{h2(r.mins)}</td></tr>
              : <tr key={r.day} className={r.inn || r.out || r.mins ? "" : "tcp-off"}>
                  <td>{dayRow(r.day)}</td>
                  <td>{r.inn ? clock(r.inn) : r.miss ? <i className="tcp-miss">missed</i> : "—"}</td>
                  <td>{r.lo ? clock(r.lo) : "—"}</td>
                  <td>{r.li ? clock(r.li) : r.lo ? <i className="tcp-miss">missed</i> : "—"}</td>
                  <td>{r.out ? clock(r.out) : r.inn ? <i className="tcp-miss">missed</i> : "—"}{r.fix && <span className="tcp-fx">fixed</span>}{r.more > 0 && <span className="tcp-fx gray">+{r.more} in/out</span>}</td>
                  <td className="r">{r.mins ? h2(r.mins) : "—"}</td>
                </tr>)}</tbody>
          </table>
          <div className="tcp-tot">
            <div><span>REGULAR</span><b>{h2(c.regular)}</b></div>
            <div><span>OVERTIME</span><b>{h2(c.overtime)}</b></div>
            <div><span>TIME OFF</span><b>{h2(c.pto + c.sick + c.holiday)}</b></div>
            <div><span>TOTAL</span><b>{h2(c.regular + c.overtime + c.pto + c.sick + c.holiday)}</b></div>
          </div>
          <div className="tcp-sign">
            <p>I have checked these hours and they are correct. <i>Revisé estas horas y están correctas.</i>{phone && <span className="tcp-ph"> · Approved on their phone</span>}</p>
            <div className="tcp-sl"><div><span>Employee signature / Firma</span></div><div><span>Date / Fecha</span></div></div>
            <div className="tcp-sl"><div><span>Approved by</span></div><div><span>Date</span></div></div>
          </div>
          <footer className="tcp-f"><span><b>fixed</b> = changed by the office · <b>missed</b> = no punch, write the time in</span><span>Page {i + 1} of {pages.length} · printed {printed}</span></footer>
        </section>
      ))}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </div>
  );
}

const CSS = `
body{background:#e6e9ee}
.tcp{font-family:var(--body,"Public Sans",system-ui,sans-serif);color:#141d2b;display:flex;flex-direction:column;align-items:center;gap:18px;padding:0 12px 40px}
.tcp-bar{position:sticky;top:0;z-index:5;width:100%;max-width:8.5in;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff;border:1px solid #d5dbe3;border-radius:0 0 10px 10px;padding:10px 14px;font-size:14px}
.tcp-bar span{color:#4b5568}.tcp-sp{flex:1}
.tcp-msg{padding:40px;text-align:center;color:#4b5568;font-size:15px}
.tcp-sheet{background:#fff;width:8.5in;max-width:100%;min-height:11in;padding:.55in .6in;box-shadow:0 2px 12px rgba(0,0,0,.15);display:flex;flex-direction:column;gap:14px;font-size:12px}
.tcp-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:2px solid #141d2b;padding-bottom:9px}
.tcp-k{font-size:10px;font-weight:800;letter-spacing:.06em;color:#5f6b80}
.tcp-name{font-family:var(--display,"Archivo",system-ui,sans-serif);font-weight:900;font-size:24px;line-height:1.15}
.tcp-per{text-align:right}.tcp-per b{font-size:14px;white-space:nowrap}
.tcp-who{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tcp-who div{border:1px solid #c9d0da;border-radius:5px;padding:6px 8px}
.tcp-who span{display:block;font-size:9.5px;font-weight:800;letter-spacing:.05em;color:#5f6b80}
.tcp-who b{font-size:13.5px}
.tcp-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.tcp-t th{font-size:9.5px;font-weight:800;letter-spacing:.05em;color:#5f6b80;text-align:left;border-bottom:1.5px solid #141d2b;padding:4px 5px;text-transform:uppercase}
.tcp-t td{border-bottom:1px solid #e3e7ec;padding:5px;white-space:nowrap;font-size:12.5px}
.tcp-t .r{text-align:right}
.tcp-t tr.tcp-wk td{background:#f2f4f7;font-weight:800}
.tcp-t tr.tcp-off td{color:#9aa3b1}
.tcp-t .tcp-miss{color:#c9372c;font-style:normal;font-weight:700;font-size:11px;border-bottom:1px solid #c9372c;padding:0 12px 0 0}
.tcp-t .tcp-fx{font-size:9.5px;font-weight:800;color:#1d6fd8;margin-left:6px}
.tcp-t .tcp-fx.gray{color:#5f6b80}
.tcp-tot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;text-align:center}
.tcp-tot div{border:1.5px solid #141d2b;border-radius:5px;padding:6px}
.tcp-tot span{display:block;font-size:9.5px;font-weight:800;letter-spacing:.05em;color:#5f6b80}
.tcp-tot b{font-size:17px;font-variant-numeric:tabular-nums}
.tcp-sign{margin-top:auto;display:flex;flex-direction:column;gap:22px}
.tcp-sign p{margin:0;font-size:12px}.tcp-sign i{color:#5f6b80}.tcp-ph{color:#0f8c78;font-weight:700}
.tcp-sl{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:22px}
.tcp-sl div{border-bottom:1px solid #141d2b;height:30px;position:relative}
.tcp-sl div span{position:absolute;bottom:-15px;left:0;font-size:9.5px;color:#5f6b80;font-weight:700}
.tcp-f{display:flex;justify-content:space-between;gap:10px;font-size:9.5px;color:#7a8597;margin-top:10px}
.tcp-f b{color:#141d2b}
@media print{
  @page{size:letter;margin:0}
  body{background:#fff}
  .tcp{padding:0;gap:0}
  .tcp-bar{display:none}
  .tcp-sheet{box-shadow:none;width:8.5in;height:11in;min-height:0;break-after:page;page-break-after:always}
  .tcp-sheet:last-child{break-after:auto;page-break-after:auto}
}
`;

export default function TimeCardsPrint() {
  return <Suspense fallback={<div className="tcp-msg">Loading time cards…</div>}><Cards /></Suspense>;
}
