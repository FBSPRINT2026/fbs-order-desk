"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import { ST } from "@/lib/pricing";
import type { Dept, JobItem, Step, Track } from "@/lib/jobCenter";
import { loadJobs, notAJob, undoDeclined } from "./actions";
import JobPanel, { StartHere } from "./JobPanel";

/**
 * The Job Center (Oct 29, Nick: "everything pre-production… new requests… quotes without mockups and mockups without
 * quotes… it goes 1, 4, 3, 5, 6… keep it all together in one place, in one screen… This is a really important page").
 *
 * Five groups, each a header with one line under it, and their steps: Incoming (Leads, Requests), In the works (Mockups,
 * Numbers), Quotes (Ready, Sent), Revisions (Make changes), Done (Approved, Declined). A job shows at every step it's at
 * (lib/jobCenter.ts works that out from the records), with what that step needs, what else is going on with it, and the
 * button that does the next thing. Approved stays until the job is completed; Declined for two weeks. Nothing here
 * moves a job on its own. My accounts / Everyone like the dashboard and the calendar (lib/accountOwners.ts).
 * The Proof Center and Incoming Orders open here.
 */
const ic = (d: ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
type G = { t: string; line: string; c: string; steps: [Step, string, ReactNode][] };
const GROUPS: G[] = [
  { t: "Incoming", line: "Leads and requests", c: "var(--fbs-violet)", steps: [
    ["leads", "Leads", ic(<><path d="M4 4h16v16H4z" /><path d="m4 6 8 7 8-7" /></>)],
    ["requests", "Requests", ic(<><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></>)]] },
  { t: "In the works", line: "Mockups and numbers", c: "var(--warn)", steps: [
    ["mockups", "Mockups", ic(<><path d="M20.4 7.6 16 3l-4 2-4-2-4.4 4.6L6 11v10h12V11z" /></>)],
    ["numbers", "Numbers", ic(<><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></>)]] },
  { t: "Quotes", line: "Ready or sent", c: "var(--fbs-blue)", steps: [
    ["ready", "Ready", ic(<><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></>)],
    ["sent", "Sent", ic(<><path d="M6 2h12M6 22h12M7 2c0 5 10 7 10 10S7 17 7 22M17 2c0 5-10 7-10 10s10 5 10 10" /></>)]] },
  { t: "Revisions", line: "On hold", c: "var(--danger)", steps: [
    ["changes", "Make changes", ic(<><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>)]] },
  { t: "Digitizing", line: "Embroidery only", c: "var(--ink-2)", steps: [
    ["sewouts", "Sew-outs", ic(<><path d="M5 19 19 5" /><circle cx="18" cy="6" r="2" /><path d="M4 20c2-1 3-3 2-5" /></>)]] },
  { t: "Done", line: "Approved or declined", c: "var(--ok)", steps: [
    ["approved", "Approved", ic(<><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" /></>)],
    ["declined", "Declined", ic(<><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>)]] },
];
const ALL_STEPS = GROUPS.flatMap((g) => g.steps.map((s) => s[0]));
const colorOf = (s: Step) => (s === "declined" ? "var(--ink-3)" : GROUPS.find((g) => g.steps.some((x) => x[0] === s))!.c);
const DEPTS: [Dept | "all", string][] = [["all", "All"], ["screen", "Screen printing"], ["embroidery", "Embroidery"], ["heat", "Heat press"]];
const EMPTY: Record<Step, string> = {
  leads: "No new orders found in email or ClickUp.", requests: "No requests from the portal.", mockups: "No mockups waiting on numbers.", numbers: "No numbers waiting on mockups.",
  ready: "Nothing made and waiting to be sent.", sent: "Nothing out with a customer.", changes: "No changes asked.", sewouts: "No sew-outs to take or get approved.", approved: "Nothing approved and still open.", declined: "Nothing declined in the last two weeks.",
};
/** the tracks a step is about */
// Mockups lists mockups still missing their numbers (the numbers are what it needs); Numbers the other way round
const forStep = (s: Step, t: Track) => (s === "mockups" ? (t.k === "numbers" && t.state === "needed") : s === "numbers" ? (t.k === "art" && t.state === "needed")
  : s === "sewouts" ? (t.k === "sewout" && t.state !== "done")
  : s === "ready" ? (t.k !== "sewout" && t.state === "made") : s === "sent" ? (t.k !== "sewout" && t.state === "sent") : s === "changes" ? (t.k !== "sewout" && t.state === "changes") : s === "approved" ? t.state === "done" : false);
const TONE: Record<Track["state"], string> = { needed: "var(--warn)", made: "var(--fbs-blue)", sent: "var(--fbs-violet)", changes: "var(--danger)", done: "var(--ok)" };
const day = (s?: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "");
const ago = (s: string) => { const d = Math.floor((Date.now() - new Date(s).getTime()) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
const DEPT_TAG: Record<Dept, string> = { screen: "SP", embroidery: "EMB", heat: "HP" };

export default function JobCenter() {
  const [items, setItems] = useState<JobItem[] | null>(null);
  const [me, setMe] = useState(""), [hasAcc, setHasAcc] = useState(false);
  const [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const [step, setStep] = useSticky<Step>("jobs.step", "mockups");
  const [dept, setDept] = useSticky<Dept | "all">("jobs.dept", "all");
  const [mineOn, setMine] = useSticky<boolean>("jobs.mine", true);
  const [cameBack, setCameBack] = useSticky<boolean>("jobs.cameBack", false);
  const [artOnly, setArtOnly] = useSticky<boolean>("jobs.artOnly", false);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string | null>(null); // the job open in the right panel
  // View all (Oct 29, Nick: "when you first go onto the job center, you got to see everything… everything but leads,
  // just requests all the way through… all the symbols would be selected"): every step at once, in sections
  const [all, setAll] = useSticky<boolean>("jobs.all", false);
  const [more, setMore] = useState<Record<string, boolean>>({}); // sections opened past their first few
  const [n, setN] = useState(0);
  const [lead, setLead] = useState<JobItem | null>(null);

  // a link straight to a step (the old Incoming Orders and Proof Center pages open here)
  useEffect(() => { try { const s = new URL(window.location.href).searchParams.get("step") as Step | null; if (s && ALL_STEPS.includes(s)) setStep(s); } catch { /* */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    void loadJobs().then((r) => { if (!live) return; if (!r.ok) { setErr(r.error); return; } setItems(r.items); setMe(r.me); setHasAcc(r.hasAccounts); });
    return () => { live = false; };
  }, [n]);

  const mine = mineOn && hasAcc; // someone with no accounts (production) sees everyone's
  const whose = (it: JobItem) => !mine || it.owner === me;
  const inDept = (it: JobItem) => dept === "all" || it.depts.includes(dept) || (it.type !== "order" && it.type !== "request");
  const match = (it: JobItem) => { const t = q.trim().toLowerCase(); return !t || `${it.number || ""} ${it.title} ${it.customer} ${it.sub || ""}`.toLowerCase().includes(t); };
  const flags = (it: JobItem) => (!cameBack || !!it.revised) && (!artOnly || step !== "mockups" || it.type === "artonly");
  const base = (items || []).filter((it) => whose(it) && flags(it));
  const count = (s: Step) => base.filter((it) => it.steps.includes(s) && inDept(it)).length;
  const shown = useMemo(() => base.filter((it) => it.steps.includes(step) && inDept(it) && match(it))
    .sort((a, b) => (step === "approved" || step === "declined" || step === "leads" || step === "requests" ? (b.at || "").localeCompare(a.at || "") : (a.due || "9999").localeCompare(b.due || "9999") || (a.at || "").localeCompare(b.at || ""))), // eslint-disable-line react-hooks/exhaustive-deps
  [items, step, dept, q, mine, me, cameBack, artOnly]);
  const deptCount = (d: Dept | "all") => base.filter((it) => it.steps.includes(step) && (d === "all" || it.depts.includes(d))).length;
  const after = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); setN((x) => x + 1); };
  const picked = (items || []).find((it) => it.key === pick) || null;
  const go = (s: Step, key?: string) => { setStep(s); setAll(false); setPick(key || null); };
  // View all: each job once, in the first step it's at (Requests through Declined; not Leads)
  const sortIn = (s: Step) => (a: JobItem, b: JobItem) => (s === "approved" || s === "declined" || s === "requests" ? (b.at || "").localeCompare(a.at || "") : (a.due || "9999").localeCompare(b.due || "9999") || (a.at || "").localeCompare(b.at || ""));
  const sections = useMemo(() => {
    const seen = new Set<string>();
    return GROUPS.map((g) => {
      const steps = g.steps.map((x) => x[0]).filter((k) => k !== "leads");
      const rows: { it: JobItem; s: Step }[] = [];
      for (const k of steps) for (const it of base.filter((x) => x.steps.includes(k) && inDept(x) && match(x)).sort(sortIn(k))) { if (seen.has(it.key)) continue; seen.add(it.key); rows.push({ it, s: k }); }
      return { g, steps, rows, counts: steps.map((k) => [k, rows.filter((r) => r.s === k).length] as const) };
    }).filter((x) => x.steps.length);
  }, [items, dept, q, mine, me, cameBack]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCount = sections.reduce((a, x) => a + x.rows.length, 0);

  return (
    <>
      <div className="page-head">
        <div><h1>Job Center</h1><div className="eyebrow">Every job before production: where it is and what&apos;s next</div></div>
        <div className="jc-hd-r">
          <button type="button" className={"chip" + (all ? " on" : "")} aria-pressed={all} title="Every job from Requests to Declined at once" onClick={() => { const on = !all; setAll(on); setPick(null); if (on) { setDept("all"); setCameBack(false); setQ(""); } }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg> View all</button>
          {hasAcc && <div className="chips" role="group" aria-label="Whose jobs">
            {([[true, "My accounts"], [false, "Everyone"]] as const).map(([k, l]) => <button key={l} type="button" className={"chip" + (mineOn === k ? " on" : "")} aria-pressed={mineOn === k} onClick={() => setMine(k)}>{l}</button>)}
          </div>}
        </div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {msg && <div className="pv-err sow-msg" role="status">{msg}</div>}
      <section className="panel">
        <div className="panel-b">
          <div className="jc-groups" role="tablist" aria-label="Steps">
            {GROUPS.map((g) => (
              <div key={g.t} className="jc-g" style={{ ["--c" as string]: g.c, ["--n" as string]: g.steps.length }}>
                <div className="jc-gh"><b>{g.t}</b><span>{g.line}</span></div>
                <div className="jc-st">
                  {g.steps.length > 1 && <div className="dgz-rail" aria-hidden />}
                  {g.steps.map(([k, l, icon]) => { const nn = count(k); const c = colorOf(k); return (
                    <button key={k} type="button" role="tab" aria-selected={all ? k !== "leads" : step === k} className={"dgz-stn" + ((all ? k !== "leads" : step === k) ? " on" : "")} style={{ ["--c" as string]: c }} onClick={() => go(k)}>
                      <span className="dgz-ring">{icon}<span className={"dgz-cnt" + (items && !nn ? " z" : "")}>{items ? nn : "…"}</span></span>
                      <span className="dgz-nm">{l}</span>
                    </button>); })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className={"jc-body" + (picked ? " has-pick" : "")}>
        <section className="panel jc-list">
          <div className="panel-b stack" style={{ gap: 12 }}>
            <div className="toolbar" data-toolbar>
              {(all || step !== "leads") && <div className="chips">{DEPTS.map(([k, l]) => <button key={k} type="button" className={"chip" + (dept === k ? " on" : "")} aria-pressed={dept === k} onClick={() => setDept(k)}>{l} <span className="pill-n">{items ? (all ? base.filter((it) => !it.steps.every((x) => x === "leads") && (k === "all" || it.depts.includes(k))).length : deptCount(k)) : "…"}</span></button>)}</div>}
              <div className="chips">
                <button type="button" className={"chip" + (cameBack ? " on" : "")} aria-pressed={cameBack} title="Jobs a customer sent back with changes at some point" onClick={() => setCameBack(!cameBack)}>Came back with changes</button>
                {step === "mockups" && !all && <button type="button" className={"chip" + (artOnly ? " on" : "")} aria-pressed={artOnly} title="Mockups made for a customer with no order yet" onClick={() => setArtOnly(!artOnly)}>Art only, no order</button>}
              </div>
              <span className="jc-search"><SearchInput placeholder="Search job, customer or order #" value={q} onChange={(e) => setQ(e.target.value)} /></span>
            </div>
            {!items ? <div className="faint">Loading…</div> : all ? (!allCount ? <div className="faint">{q ? `No matches for “${q}”.` : "Nothing in the Job Center right now."}</div> : (
              <div className="tbl-wrap"><table className="tbl jc">
                <thead><tr><th>Job</th><th>Dept</th><th>Where it is</th><th>Also</th><th>Due</th></tr></thead>
                <tbody>{sections.filter((x) => x.rows.length).map((x) => { const open = !!more[x.g.t] || x.rows.length <= 6; return [
                  <tr key={x.g.t} className="jc-sec" style={{ ["--c" as string]: x.g.c }}><td colSpan={5}><i aria-hidden /><b>{x.g.t}</b> · {x.counts.filter(([, n]) => n).map(([k, n]) => `${GROUPS.flatMap((g) => g.steps).find((y) => y[0] === k)![1]} ${n}`).join(" · ")}</td></tr>,
                  ...(open ? x.rows : x.rows.slice(0, 5)).map(({ it, s: st }) => <Row key={it.key} it={it} step={st} wide on={pick === it.key} onPick={() => setPick(pick === it.key ? null : it.key)} after={after} onLead={() => setLead(it)} />),
                  ...(open ? [] : [<tr key={x.g.t + "+"} className="jc-more"><td colSpan={5}><button type="button" className="linkbtn" onClick={() => setMore((m) => ({ ...m, [x.g.t]: true }))}>+ {x.rows.length - 5} more in {x.g.t.toLowerCase()}</button></td></tr>]),
                ]; })}</tbody>
              </table></div>
            )) : !shown.length ? <div className="faint">{q ? `No matches for “${q}”.` : EMPTY[step]}</div> : (
              <div className="tbl-wrap"><table className="tbl jc">
                <thead><tr>{step === "leads" ? <><th>Lead</th><th>Came in</th><th /></>
                  : step === "declined" ? <><th>Job</th><th>Why</th><th>Declined</th></>
                  : <><th>Job</th><th>Dept</th><th>{step === "approved" ? "Where it is" : step === "requests" ? "Pieces" : "Needs"}</th><th>Also</th><th>{step === "requests" ? "Sent in" : "Due"}</th></>}</tr></thead>
                <tbody>{shown.map((it) => <Row key={it.key} it={it} step={step} on={pick === it.key} onPick={() => setPick(pick === it.key ? null : it.key)} after={after} onLead={() => setLead(it)} />)}</tbody>
              </table></div>
            )}
          </div>
        </section>
        <aside className="jc-side" aria-label={picked ? "The job" : "Where to start"}>
          {picked ? <JobPanel key={picked.key + n} it={picked} step={step} after={after} onClose={() => setPick(null)} onLead={() => setLead(picked)} onUndo={() => void undoDeclined(picked.orderId!).then((r) => after(r.ok ? "Back on the Job Center." : r.error))} />
            : <StartHere items={base.filter(inDept)} loading={!items} mine={mine} go={go} />}
        </aside>
      </div>
      {/* Make a job: the one Create order tool (components/tools/CreateOrderTool.tsx), the same as on emails and ClickUp jobs */}
      {lead?.activityId && <CreateOrderTool activityId={lead.activityId} text={lead.leadText || lead.title} onClose={() => { setLead(null); setN((x) => x + 1); }} onCreated={(_, num) => after(`Order #${num} made.`)} />}
    </>
  );
}

function Row({ it, step, wide, on, onPick, after, onLead }: { it: JobItem; step: Step; /** View all: every row in the same five columns */ wide?: boolean; on: boolean; onPick: () => void; after: (m: string) => void; onLead: () => void }) {
  const [busy, setBusy] = useState(false);
  const here = it.tracks.filter((t) => forStep(step, t)), also = it.tracks.filter((t) => !forStep(step, t));
  const tag = (t: Track, i: number) => <span key={i} className="pill" style={{ ["--sc" as string]: TONE[t.state] }}><span className="pill-t">{t.label}</span></span>;
  const who = <>{it.number ? <span className="ordno">#{it.number}</span> : null}{" "}<b>{it.customer || "No customer yet"}</b><div className="sub">{it.title}</div></>;
  const keys = { tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }, "aria-selected": on };
  if (it.type === "lead") return (
    <tr className={on ? "on" : ""} onClick={onPick} {...keys}>
      <td><b>{it.title}</b><div className="sub">{it.customer ? `${it.customer} · ` : ""}{it.sub}{it.tracks.length ? " · has questions to answer" : ""}</div></td>
      <td className="nowrap">{ago(it.at)}</td>
      <td className="nowrap" onClick={(e) => e.stopPropagation()}>
        {it.activityId && <button type="button" className="btn sm primary" onClick={onLead}>Make a job</button>}{" "}
        <button type="button" className="btn sm" disabled={busy} onClick={() => { setBusy(true); void notAJob(it.suggestionId!).then((r) => { setBusy(false); after(r.ok ? "Taken off the leads." : r.error); }); }}>Not a job</button>
      </td>
    </tr>);
  if (step === "declined") return wide
    ? <tr className={on ? "on" : ""} onClick={onPick} {...keys}><td>{who}</td><td className="nowrap">{it.depts.map((d) => <span key={d} className={"prf-dept " + d}>{DEPT_TAG[d]}</span>)}</td><td><span className="pill" style={{ ["--sc" as string]: "var(--ink-3)" }}><span className="pill-t">Declined</span></span>{it.declined && <div className="sub">{it.declined}</div>}</td><td /><td className="nowrap">{day(it.at)}</td></tr>
    : <tr className={on ? "on" : ""} onClick={onPick} {...keys}><td>{who}</td><td>{it.declined || <span className="faint">No reason given</span>}</td><td className="nowrap">{day(it.at)}</td></tr>;
  return (
    <tr className={on ? "on" : ""} onClick={onPick} {...keys}>
      <td>{who}</td>
      <td className="nowrap">{it.depts.map((d) => <span key={d} className={"prf-dept " + d}>{DEPT_TAG[d]}</span>)}</td>
      <td>{step === "requests" ? (wide ? <span className="pill" style={{ ["--sc" as string]: "var(--fbs-violet)" }}><span className="pill-t">New request · {it.qty || 0} pcs</span></span> : <span className="nowrap">{it.qty || 0} pcs</span>) : step === "approved" ? <span className="pill" style={{ ["--sc" as string]: ST[it.status || ""]?.c || "var(--ok)" }}><span className="pill-t">{ST[it.status || ""]?.label || it.status}</span></span>
        : <div className="jc-tags">{here.map(tag)}</div>}</td>
      <td><div className="jc-tags sm">{(step === "approved" ? [] : also).map(tag)}{it.revised && step !== "changes" && <span className="faint jc-back">came back once</span>}</div></td>
      <td className="nowrap">{step === "requests" ? day(it.at) : it.due ? day(it.due) : <span className="faint">No date</span>}</td>
    </tr>
  );
}
