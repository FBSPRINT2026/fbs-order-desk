"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addDays, dayLabel, localDay, localToIso, mergeTime, periodOf, type Employee, type Punch, type TimeSettings } from "@/lib/timeclock";
import { timeIssues, type TimeIssue } from "@/lib/timeIssues";
import { useRole } from "@/components/RoleContext";

/**
 * The time clock's little notification (Oct 20, Nick: "like on your iPhone when it has a little bubble… you have a
 * time clock issue. Click it: hey, one issue, Joanna clocked in yesterday and never clocked out"). For the people who
 * run the time clock (owners, admins, "Runs the time clock"): a round clock button with a red count at the top right
 * of every shop page (bottom right) when something needs fixing, a "Good morning, Jose" card the first time each day, and a list
 * where each issue is fixed in one tap. Counted in the browser (never a server action, so it can't slow the pages):
 * a few seconds after the page opens, then every 5 minutes.
 */
const CACHE = "fbs:timeIssues";

type Loaded = { s: TimeSettings; emps: Employee[]; punches: Punch[]; dismissed: string[]; at: number };
export async function loadIssueData(force = false): Promise<Loaded> {
  if (!force) try { const c = JSON.parse(sessionStorage.getItem(CACHE) || "null") as Loaded | null; if (c && Date.now() - c.at < 5 * 60000) return c; } catch { /* no cache */ }
  const sb = createClient();
  const from = addDays(localDay(new Date()), -30); // two pay periods
  const [{ data: s }, { data: es }, { data: ps }, { data: dm }] = await Promise.all([
    sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    sb.from("employees").select("id, first_name, last_name, active, department, code, takes_lunch"),
    sb.from("time_punches").select("id, employee_id, kind, at, source, voided").eq("voided", false).gte("at", localToIso(from, 0)).order("at").limit(5000),
    sb.from("time_issue_dismissals").select("key").gte("dismissed_at", new Date(Date.now() - 40 * 86400000).toISOString()),
  ]);
  const out: Loaded = { s: mergeTime((s?.data as { time?: unknown } | null)?.time), emps: (es || []) as Employee[], punches: (ps || []) as Punch[], dismissed: ((dm || []) as { key: string }[]).map((x) => x.key), at: Date.now() };
  try { sessionStorage.setItem(CACHE, JSON.stringify(out)); } catch { /* full */ }
  return out;
}
/** this pay period and the last one (so the Friday after a period ends, its leftovers still show) */
export const issuesFrom = (l: Loaded) => timeIssues(l.s, l.emps, l.punches, periodOf(l.s, addDays(periodOf(l.s, localDay(new Date())).start, -1)).start, new Set(l.dismissed));
export const clearIssueCache = () => { try { sessionStorage.removeItem(CACHE); } catch { /* none */ } window.dispatchEvent(new Event("fbs:time-changed")); };

const greet = () => { const h = +new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function TimeBubble() {
  const { perms, role, staffName, email } = useRole();
  const path = usePathname();
  const runs = role === "owner" || role === "admin" || perms.pay;
  const [issues, setIssues] = useState<TimeIssue[] | null>(null);
  const [open, setOpen] = useState(false), [hello, setHello] = useState(false);
  // where the Time Clock icon is in the menu: the list opens beside it
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const load = useCallback(async (force = false) => { try { setIssues(issuesFrom(await loadIssueData(force))); } catch { /* try again later */ } }, []);
  useEffect(() => {
    if (!runs) return;
    const t = setTimeout(() => load(), 2500), i = setInterval(() => load(), 5 * 60000);
    const re = () => load(true);
    window.addEventListener("fbs:time-changed", re);
    return () => { clearTimeout(t); clearInterval(i); window.removeEventListener("fbs:time-changed", re); };
  }, [runs, load]);
  // the hello card: once a day, when there's something to fix
  useEffect(() => {
    if (!issues?.length) return;
    const k = `fbs:timeHello:${email}:${localDay(new Date())}`;
    try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { return; }
    setHello(true); const t = setTimeout(() => setHello(false), 12000); return () => clearTimeout(t);
  }, [issues, email]);
  useEffect(() => { setOpen(false); }, [path]);
  // the button lives in Shop Tools now (Oct 20, Nick: "should just be in the shop tools… similar to" Printavo Sync's
  // badge): the count goes to the Time Clock icon there, and clicking it opens this list
  useEffect(() => { window.dispatchEvent(new CustomEvent("fbs:time-count", { detail: runs ? issues?.length || 0 : 0 })); (window as unknown as { __timeCount?: number }).__timeCount = runs ? issues?.length || 0 : 0; }, [issues, runs]);
  useEffect(() => {
    const op = (e: Event) => { const d = (e as CustomEvent).detail as { x: number; y: number } | undefined; if (d) setAt(d); setOpen((o) => !o); setHello(false); };
    window.addEventListener("fbs:time-open", op);
    return () => window.removeEventListener("fbs:time-open", op);
  }, []);
  if (!runs || !issues?.length) return null;
  const first = (staffName || "").split(/\s+/)[0] || "there";
  const n = issues.length;
  return (
    <div className="tcb-wrap tcb-side" style={at && typeof window !== "undefined" && window.innerWidth > 820 ? { left: at.x + 12, top: Math.max(12, Math.min(at.y - 20, window.innerHeight - 420)) } : undefined}>
      {hello && !open && (
        <button type="button" className="tb-hello" onClick={() => { setOpen(true); setHello(false); }}>
          <span className="tb-hello-ic" aria-hidden><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg></span>
          <span className="tb-hello-t"><small>Time Clock · now</small><b>{greet()}, {first}</b><span>{n === 1 ? `One issue: ${issues[0].text}.` : `${n} time clock issues. ${issues[0].text}.`}</span></span>
        </button>
      )}
      {open && (
        <div className="tb-pop" role="dialog" aria-label="Time clock issues">
          <div className="tb-pop-h"><b>{greet()}, {first}</b><span>{n === 1 ? "One time clock issue" : `${n} time clock issues`}</span><button type="button" className="btn icon ghost" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
          <IssueList issues={issues} onFixed={() => { clearIssueCache(); }} />
          <div className="tb-pop-f"><Link href="/shop/time" onClick={() => setOpen(false)}>Open Time Clock</Link></div>
        </div>
      )}
    </div>
  );
}

/** the issues, each with its fix: add the clock-out, add the lunch (or "they didn't take one"), or open the time card */
export function IssueList({ issues, onFixed, compact }: { issues: TimeIssue[]; onFixed: () => void; compact?: boolean }) {
  const { email } = useRole();
  const [times, setTimes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  async function addPunches(i: TimeIssue, ps: { kind: Punch["kind"]; hhmm: string }[], note: string) {
    setBusy(i.key); setErr("");
    const now = new Date().toISOString();
    const rows = ps.map((p) => { const [h, m] = p.hhmm.split(":").map(Number); return { employee_id: i.employee_id, kind: p.kind, at: localToIso(i.day, h * 60 + m), source: "manual", note, edited_by: email || "", edited_at: now }; });
    if (rows.some((r) => Date.parse(r.at) > Date.now() + 5 * 60000)) { setBusy(""); return setErr("That time hasn't happened yet."); }
    const { error } = await createClient().from("time_punches").insert(rows);
    setBusy("");
    if (error) return setErr(error.message);
    onFixed();
  }
  async function dismiss(i: TimeIssue) {
    setBusy(i.key);
    await createClient().from("time_issue_dismissals").upsert({ key: i.key, dismissed_by: email || "" });
    setBusy(""); onFixed();
  }
  const addMin = (hhmm: string, n: number) => { const [h, m] = hhmm.split(":").map(Number); const t = h * 60 + m + n; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  const t12 = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  return (
    <ul className={"tb-list" + (compact ? " compact" : "")}>
      {issues.map((i) => {
        const t = times[i.key] ?? (i.fix?.type === "out" ? i.fix.time : i.fix?.type === "lunch" ? i.fix.start : "");
        return (
          <li key={i.key} className={"tb-i " + i.kind}>
            <span className="tb-i-dot" aria-hidden />
            <div className="tb-i-b">
              <p>{i.text}</p>
              <div className="tb-i-a">
                {i.fix?.type === "out" && <>
                  <label className="tb-t">Clocked out at<input type="time" value={t} onChange={(e) => setTimes({ ...times, [i.key]: e.target.value })} /></label>
                  <button type="button" className="btn sm primary" disabled={busy === i.key || !t} onClick={() => addPunches(i, [{ kind: "out", hhmm: t }], `Missed clock-out added (${dayLabel(i.day)})`)}>Add clock-out</button>
                </>}
                {i.fix?.type === "lunch" && <>
                  <label className="tb-t">Lunch at<input type="time" value={t} onChange={(e) => setTimes({ ...times, [i.key]: e.target.value })} /></label>
                  <button type="button" className="btn sm primary" disabled={busy === i.key || !t} onClick={() => addPunches(i, [{ kind: "break_start", hhmm: t }, { kind: "break_end", hhmm: addMin(t, i.fix!.type === "lunch" ? i.fix!.minutes : 30) }], `30 minute lunch added (${dayLabel(i.day)})`)}>Add 30 min lunch{t ? ` (${t12(t)})` : ""}</button>
                  <button type="button" className="btn sm ghost" disabled={busy === i.key} onClick={() => dismiss(i)}>No lunch taken</button>
                </>}
                <Link className="tb-link" href={`/shop/time?tab=cards&who=${i.employee_id}`}>Time card</Link>
              </div>
            </div>
          </li>
        );
      })}
      {err && <li className="pv-err">{err}</li>}
    </ul>
  );
}
