"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import SendProofTool from "@/components/tools/SendProofTool";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import { mockupHref } from "@/lib/mockupFresh";
import { ST } from "@/lib/pricing";
import type { Dept, JobItem, Step, Track } from "@/lib/jobCenter";
import { jobHistory, loadJobs, markDeclined, notAJob, undoDeclined } from "./actions";
import { remindProof } from "@/app/shop/proof-actions";
import { remindSewoutAction } from "@/app/shop/sewout-actions";

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
  { t: "Revisions", line: "Make changes", c: "var(--danger)", steps: [
    ["changes", "Make changes", ic(<><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>)]] },
  { t: "Done", line: "Approved or declined", c: "var(--ok)", steps: [
    ["approved", "Approved", ic(<><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3" /></>)],
    ["declined", "Declined", ic(<><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>)]] },
];
const ALL_STEPS = GROUPS.flatMap((g) => g.steps.map((s) => s[0]));
const colorOf = (s: Step) => (s === "declined" ? "var(--ink-3)" : GROUPS.find((g) => g.steps.some((x) => x[0] === s))!.c);
const DEPTS: [Dept | "all", string][] = [["all", "All"], ["screen", "Screen printing"], ["embroidery", "Embroidery"], ["heat", "Heat press"]];
const EMPTY: Record<Step, string> = {
  leads: "No new orders found in email or ClickUp.", requests: "No requests from the portal.", mockups: "No mockups waiting on numbers.", numbers: "No numbers waiting on mockups.",
  ready: "Nothing made and waiting to be sent.", sent: "Nothing out with a customer.", changes: "No changes asked.", approved: "Nothing approved and still open.", declined: "Nothing declined in the last two weeks.",
};
/** the tracks a step is about */
// Mockups lists mockups still missing their numbers (the numbers are what it needs); Numbers the other way round
const forStep = (s: Step, t: Track) => (s === "mockups" ? (t.k === "numbers" && t.state === "needed") : s === "numbers" ? (t.k !== "numbers" && t.state === "needed")
  : s === "ready" ? t.state === "made" : s === "sent" ? t.state === "sent" : s === "changes" ? t.state === "changes" : s === "approved" ? t.state === "done" : false);
const TONE: Record<Track["state"], string> = { needed: "var(--warn)", made: "var(--fbs-blue)", sent: "var(--fbs-violet)", changes: "var(--danger)", done: "var(--ok)" };
const day = (s?: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "");
const stamp = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
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
  const [open, setOpen] = useState<string | null>(null);
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

  return (
    <>
      <div className="page-head">
        <div><h1>Job Center</h1><div className="eyebrow">Every job before production: where it is and what&apos;s next</div></div>
        {hasAcc && <div className="chips" role="group" aria-label="Whose jobs">
          {([[true, "My accounts"], [false, "Everyone"]] as const).map(([k, l]) => <button key={l} type="button" className={"chip" + (mineOn === k ? " on" : "")} aria-pressed={mineOn === k} onClick={() => setMine(k)}>{l}</button>)}
        </div>}
      </div>
      {err && <div className="pv-err">{err}</div>}
      {msg && <div className="pv-err sow-msg" role="status">{msg}</div>}
      <section className="panel">
        <div className="panel-b stack" style={{ gap: 12 }}>
          <div className="jc-groups" role="tablist" aria-label="Steps">
            {GROUPS.map((g) => (
              <div key={g.t} className="jc-g" style={{ ["--c" as string]: g.c, ["--n" as string]: g.steps.length }}>
                <div className="jc-gh"><b>{g.t}</b><span>{g.line}</span></div>
                <div className="jc-st">
                  {g.steps.length > 1 && <div className="dgz-rail" aria-hidden />}
                  {g.steps.map(([k, l, icon]) => { const nn = count(k); const c = colorOf(k); return (
                    <button key={k} type="button" role="tab" aria-selected={step === k} className={"dgz-stn" + (step === k ? " on" : "")} style={{ ["--c" as string]: c }} onClick={() => { setStep(k); setOpen(null); }}>
                      <span className="dgz-ring">{icon}<span className={"dgz-cnt" + (items && !nn ? " z" : "")}>{items ? nn : "…"}</span></span>
                      <span className="dgz-nm">{l}</span>
                    </button>); })}
                </div>
              </div>
            ))}
          </div>
          <div className="toolbar" data-toolbar>
            {step !== "leads" && <div className="chips">{DEPTS.map(([k, l]) => <button key={k} type="button" className={"chip" + (dept === k ? " on" : "")} aria-pressed={dept === k} onClick={() => setDept(k)}>{l} <span className="pill-n">{items ? deptCount(k) : "…"}</span></button>)}</div>}
            <div className="chips">
              <button type="button" className={"chip" + (cameBack ? " on" : "")} aria-pressed={cameBack} title="Jobs a customer sent back with changes at some point" onClick={() => setCameBack(!cameBack)}>Came back with changes</button>
              {step === "mockups" && <button type="button" className={"chip" + (artOnly ? " on" : "")} aria-pressed={artOnly} title="Mockups made for a customer with no order yet" onClick={() => setArtOnly(!artOnly)}>Art only, no order</button>}
            </div>
            <SearchInput placeholder="Search job, customer or order #" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!items ? <div className="faint">Loading…</div> : !shown.length ? <div className="faint">{q ? `No matches for “${q}”.` : EMPTY[step]}</div> : (
            <div className="tbl-wrap"><table className="tbl jc">
              <thead><tr>{step === "leads" ? <><th>Lead</th><th>Customer</th><th>Came in</th><th /></>
                : step === "declined" ? <><th>Job</th><th>Why</th><th>Declined</th><th /></>
                : <><th>Job</th><th>Dept</th><th>{step === "approved" ? "Where it is" : step === "requests" ? "Pieces" : "Needs"}</th><th>Also</th><th>{step === "requests" ? "Sent in" : "Due"}</th></>}</tr></thead>
              <tbody>{shown.map((it) => <Row key={it.key} it={it} step={step} open={open === it.key} onToggle={() => setOpen(open === it.key ? null : it.key)} after={after} onLead={() => setLead(it)} />)}</tbody>
            </table></div>
          )}
        </div>
      </section>
      {/* Make a job: the one Create order tool (components/tools/CreateOrderTool.tsx), the same as on emails and ClickUp jobs */}
      {lead?.activityId && <CreateOrderTool activityId={lead.activityId} text={lead.leadText || lead.title} onClose={() => { setLead(null); setN((x) => x + 1); }} onCreated={(_, num) => after(`Order #${num} made.`)} />}
    </>
  );
}

function Row({ it, step, open, onToggle, after, onLead }: { it: JobItem; step: Step; open: boolean; onToggle: () => void; after: (m: string) => void; onLead: () => void }) {
  const [busy, setBusy] = useState(false), [why, setWhy] = useState(""), [asking, setAsking] = useState(false);
  const [hist, setHist] = useState<{ at: string; what: string; detail: string; who: string; tone: string }[] | null>(null);
  useEffect(() => { if (open && it.orderId && !hist) void jobHistory(it.orderId).then((r) => setHist(r.ok ? r.rows : [])); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = it.tracks.filter((t) => forStep(step, t)), also = it.tracks.filter((t) => !forStep(step, t));
  const go = async (f: () => Promise<{ ok: boolean; error?: string }>, done: string) => { setBusy(true); const r = await f(); setBusy(false); after(r.ok ? done : r.error || "That didn't work."); };
  const tag = (t: Track, i: number) => <span key={i} className="pill" style={{ ["--sc" as string]: TONE[t.state] }}><span className="pill-t">{t.label}</span></span>;
  const who = <>{it.number ? <Link className="ordno" href={`/shop/orders/${it.orderId}`} onClick={(e) => e.stopPropagation()}>#{it.number}</Link> : null}{" "}<b>{it.customer || "No customer yet"}</b><div className="sub">{it.title}</div></>;
  const cols = 5;

  if (it.type === "lead") return (
    <tr>
      <td><b>{it.title}</b><div className="sub">{it.sub}{it.tracks.length ? " · has questions to answer" : ""}</div></td>
      <td>{it.customer || <span className="faint">Not matched</span>}</td>
      <td className="nowrap">{ago(it.at)}</td>
      <td className="r nowrap">
        {it.activityId && <button type="button" className="btn sm primary" onClick={onLead}>Make a job</button>}{" "}
        <button type="button" className="btn sm" disabled={busy} onClick={() => void go(() => notAJob(it.suggestionId!), "Taken off the leads.")}>Not a job</button>
      </td>
    </tr>);
  if (step === "declined") return (
    <tr>
      <td>{who}</td><td>{it.declined || <span className="faint">No reason given</span>}</td><td className="nowrap">{day(it.at)}</td>
      <td className="r nowrap"><button type="button" className="btn sm" disabled={busy} onClick={() => void go(() => undoDeclined(it.orderId!), "Back on the Job Center.")}>Put it back</button>{" "}<Link className="btn sm" href={`/shop/orders/${it.orderId}`}>Open order</Link></td>
    </tr>);

  const sentArt = it.tracks.some((t) => t.k === "art" && t.state === "sent"), sentSew = it.sentSewoutIds || [];
  const out = it.tracks.some((t) => t.state === "sent" || t.state === "done" || t.state === "changes");
  const fixes: ReactNode[] = [];
  const need = (k: Track["k"], s: Track["state"]) => it.tracks.some((t) => t.k === k && t.state === s);
  if (it.type === "request") fixes.push(<Link key="o" className="btn sm primary" href={`/shop/orders/${it.orderId}`}>Price and review</Link>);
  if (it.type === "artonly") fixes.push(<Link key="c" className="btn sm primary" href={`/shop/customers/${it.customerId}`}>Open the customer</Link>);
  if (it.type === "order") {
    if ((need("art", "needed") || need("art", "changes")) && it.mockGroup) fixes.push(<Link key="m" className="btn sm" href={mockupHref(it.orderId!, it.mockGroup)}>Mockup Creator</Link>);
    if (need("sewout", "needed") || need("sewout", "changes")) fixes.push(<Link key="d" className="btn sm" href="/shop/digitizing">Digitizing</Link>);
    if (need("numbers", "needed") || need("numbers", "changes")) fixes.push(<Link key="p" className="btn sm" href={`/shop/orders/${it.orderId}`}>{it.tracks.some((t) => t.label === "No sizes yet") ? "Add sizes" : need("numbers", "changes") ? "Fix the quote" : "Price it"}</Link>);
    if (it.tracks.some((t) => t.state === "made")) fixes.push(<SendProofTool key="s" target={{ kind: "order", orderId: it.orderId! }} label="Send" onDone={after} />);
    if (sentArt) fixes.push(<button key="ra" type="button" className="btn sm" disabled={busy} title="Emails them a reminder about the mockup" onClick={() => void go(() => remindProof(it.orderId!), "Reminder sent.")}>Remind</button>);
    if (sentSew.length && !sentArt) fixes.push(<button key="rs" type="button" className="btn sm" disabled={busy} title="Emails them a reminder about the sew-out" onClick={() => void go(async () => { for (const id of sentSew) { const r = await remindSewoutAction(id); if (!r.ok) return r; } return { ok: true }; }, "Reminder sent.")}>Remind</button>);
  }
  return (
    <>
      <tr className={open ? "on" : ""} onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>{who}</td>
        <td className="nowrap">{it.depts.map((d) => <span key={d} className={"prf-dept " + d}>{DEPT_TAG[d]}</span>)}</td>
        <td>{step === "requests" ? <span className="nowrap">{it.qty || 0} pcs</span> : step === "approved" ? <span className="pill" style={{ ["--sc" as string]: ST[it.status || ""]?.c || "var(--ok)" }}><span className="pill-t">{ST[it.status || ""]?.label || it.status}</span></span>
          : <div className="jc-tags">{here.map(tag)}</div>}{here.find((t) => t.note) && <div className="sub">“{here.find((t) => t.note)!.note}”</div>}</td>
        <td><div className="jc-tags sm">{(step === "approved" ? [] : also).map(tag)}{it.revised && step !== "changes" && <span className="faint jc-back">came back once</span>}</div></td>
        <td className="nowrap">{step === "requests" ? day(it.at) : it.due ? day(it.due) : <span className="faint">No date</span>}</td>
      </tr>
      {open && <tr className="prf-more"><td colSpan={cols}>
        <div className="prf-open">
          <div className="prf-steps">
            <div className="imp-l">What&apos;s happened</div>
            {!it.orderId ? <div className="faint" style={{ fontSize: 12.5 }}>{it.mockupIds?.length || 0} mockup{it.mockupIds?.length === 1 ? "" : "s"} made for {it.customer}, no order yet.</div>
              : !hist ? <div className="faint" style={{ fontSize: 12.5 }}>Loading…</div>
              : hist.length ? <ol>{hist.map((x, i) => <li key={i} className={x.tone}><b>{x.what}</b><span>{stamp(x.at)}{x.who ? ` · ${x.who.split("@")[0]}` : ""}</span>{x.detail && <small>{x.detail}</small>}</li>)}</ol>
              : <div className="faint" style={{ fontSize: 12.5 }}>Nothing sent yet.</div>}
          </div>
          <div className="prf-acts">
            {fixes}
            {it.type === "order" && out && <SendProofTool target={{ kind: "order", orderId: it.orderId! }} mode="copy" onDone={after} />}
            {it.orderId && <Link className="btn sm" href={`/shop/orders/${it.orderId}?tab=msg`}>Message</Link>}
            {it.orderId && <Link className="btn sm" href={`/shop/orders/${it.orderId}`}>Open order</Link>}
            {it.type === "order" && step !== "approved" && (asking
              ? <span className="jc-decl"><input type="text" autoFocus placeholder="Why? (optional)" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Why it was declined" />
                  <button type="button" className="btn sm" onClick={() => setAsking(false)}>Cancel</button>
                  <button type="button" className="btn sm danger" disabled={busy} onClick={() => void go(() => markDeclined(it.orderId!, why), "Moved to Declined.")}>Mark declined</button></span>
              : <button type="button" className="btn sm" onClick={() => setAsking(true)}>Mark declined</button>)}
          </div>
        </div>
      </td></tr>}
    </>
  );
}
