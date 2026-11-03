"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import RequestsDesk from "@/components/RequestsDesk";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import { ST } from "@/lib/pricing";
import type { Dept, JobItem, Step, Track } from "@/lib/jobCenter";
import { loadJobChats, loadJobs, notAJob, undoDeclined } from "./actions";
import JobPanel from "./JobPanel";
import { ChatLine, ChatThread, whoOf } from "./JobChats";
import type { ChatSummary } from "@/lib/jobChats";
import { useUrlSearch } from "@/lib/useUrlSearch";

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
const ic = (d: ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
type G = { t: string; line: string; c: string; steps: [Step, string, ReactNode][] };
const GROUPS: G[] = [
  { t: "Incoming", line: "Leads and requests", c: "var(--fbs-violet)", steps: [
    ["leads", "Leads", ic(<><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="m3 7 9 6 9-6" /></>)],
    ["requests", "Requests", ic(<><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M4 13h3l3 3h4l3-3h3" /></>)]] },
  { t: "In the works", line: "Mockups and numbers", c: "var(--warn)", steps: [
    ["mockups", "Mockups", ic(<><path d="M15 4l6 2v5h-3v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8H3V6l6-2a3 3 0 0 0 6 0" /></>)],
    ["numbers", "Numbers", ic(<><path d="M5 9h14M5 15h14M11 4 7 20M17 4l-4 16" /></>)]] },
  { t: "Quotes", line: "Ready or sent", c: "var(--fbs-blue)", steps: [
    ["ready", "Ready", ic(<><path d="M10 14 21 3" /><path d="m21 3-6.5 18a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1z" /></>)],
    ["sent", "Sent", ic(<><path d="M6.5 7h11M6.5 17h11" /><path d="M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" /><path d="M6 4v2a6 6 0 1 0 12 0V4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" /></>)]] },
  { t: "Revisions", line: "On hold", c: "var(--danger)", steps: [
    ["changes", "Make changes", ic(<><path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>)]] },
  { t: "Digitizing", line: "Embroidery only", c: "var(--ink-2)", steps: [
    ["sewouts", "Sew-outs", ic(<><path d="M5 19 17.5 6.5" /><circle cx="19" cy="5" r="2" /><path d="M3.5 20.5c1.5-.5 2.5-2 1.5-3.5s.5-3 2-3" /></>)]] },
  { t: "Done", line: "Approved or declined", c: "var(--ok)", steps: [
    ["approved", "Approved", ic(<><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></>)],
    ["declined", "Declined", ic(<><circle cx="12" cy="12" r="9" /><path d="m10 10 4 4m0-4-4 4" /></>)]] },
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
  const cameBack = false; // the "Came back with changes" filter is gone (Nov 2, Nick)
  const [artOnly, setArtOnly] = useSticky<boolean>("jobs.artOnly", false);
  const [q, setQ] = useUrlSearch("q");
  const [pick, setPick] = useState<string | null>(null); // the job open in the right panel
  // View all (Oct 29, Nick: "when you first go onto the job center, you got to see everything… everything but leads,
  // just requests all the way through… all the symbols would be selected"): every step at once, in sections
  const [all, setAll] = useSticky<boolean>("jobs.all", false);
  const [more, setMore] = useState<Record<string, boolean>>({}); // sections opened past their first few
  const [n, setN] = useState(0);
  const [lead, setLead] = useState<JobItem | null>(null);
  // customer messages (Nov 2, Nick): the conversations, and the one open under them
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chat, setChat] = useState<string | null>(null);
  const [cn, setCn] = useState(0);
  // the Message Center (Nov 2, Nick: "just have the message center… search and then have it say messages… that should
  // exactly line up with the word job"): its Messages heading sits level with the job table's heading
  const [mq, setMq] = useState("");
  const padRef = useRef<HTMLDivElement | null>(null);
  const [lvl, setLvl] = useState<{ pad: number; h: number }>({ pad: 0, h: 0 });

  // a link straight to a step (the old Incoming Orders and Proof Center pages open here), or to a conversation (the
  // live message pop-up's Open chat)
  useEffect(() => { try { const u = new URL(window.location.href).searchParams; const s = u.get("step") as Step | null; if (s && ALL_STEPS.includes(s)) setStep(s); const c = u.get("chat"); if (c) setChat(c); } catch { /* */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    const get = () => void loadJobChats().then((r) => { if (live && r.ok) setChats(r.chats); });
    get(); const t = setInterval(get, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [cn]);
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
  // the Digitizing Center is the whole shop's: Sew-outs shows everyone's, whatever My accounts says (Oct 29, Nick: "I don't
  // see… any of the digitizing center files under sew-outs")
  const SHOP_WIDE: Step[] = ["sewouts"];
  const flagged = (items || []).filter(flags);
  const base = flagged.filter((it) => whose(it));
  const pool = (s: Step) => (SHOP_WIDE.includes(s) ? flagged : base);
  const count = (s: Step) => pool(s).filter((it) => it.steps.includes(s) && inDept(it)).length;
  const shown = useMemo(() => pool(step).filter((it) => it.steps.includes(step) && inDept(it) && match(it))
    .sort((a, b) => (step === "approved" || step === "declined" || step === "leads" || step === "requests" ? (b.at || "").localeCompare(a.at || "") : (a.due || "9999").localeCompare(b.due || "9999") || (a.at || "").localeCompare(b.at || ""))), // eslint-disable-line react-hooks/exhaustive-deps
  [items, step, dept, q, mine, me, cameBack, artOnly]);
  const deptCount = (d: Dept | "all") => pool(step).filter((it) => it.steps.includes(step) && (d === "all" || it.depts.includes(d))).length;
  const after = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); setN((x) => x + 1); };
  const picked = (items || []).find((it) => it.key === pick) || null;
  const go = (s: Step, key?: string) => { setStep(s); setAll(false); setPick(key || null); };
  // the All tab is gone (Nov 2, Nick: "get rid of all jobs"): a step is always picked
  useEffect(() => { if (all) setAll(false); }, [all, setAll]);
  // a message picks its job: the tab it's at comes forward and its row lights up (Nov 2, Nick: "when you click on it, it
  // sorts the job on the right"); picking a job opens its conversation
  const openChat = (key: string | null) => {
    setChat(key);
    const c = key ? chats.find((x) => x.key === key) : null;
    const it = c?.orderId ? byOrder.get(c.orderId) : null;
    if (it) { const st = it.steps.find((x) => x !== "leads") || it.steps[0]; if (st && st !== step) setStep(st); setTimeout(() => document.querySelector(".jc-hl")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 80); }
  };
  // View all: each job once, in the first step it's at (Requests through Declined; not Leads)
  const sortIn = (s: Step) => (a: JobItem, b: JobItem) => (s === "approved" || s === "declined" || s === "requests" ? (b.at || "").localeCompare(a.at || "") : (a.due || "9999").localeCompare(b.due || "9999") || (a.at || "").localeCompare(b.at || ""));
  const sections = useMemo(() => {
    const seen = new Set<string>();
    return GROUPS.map((g) => {
      const steps = g.steps.map((x) => x[0]).filter((k) => k !== "leads");
      const rows: { it: JobItem; s: Step }[] = [];
      for (const k of steps) for (const it of pool(k).filter((x) => x.steps.includes(k) && inDept(x) && match(x)).sort(sortIn(k))) { if (seen.has(it.key)) continue; seen.add(it.key); rows.push({ it, s: k }); }
      return { g, steps, rows, counts: steps.map((k) => [k, rows.filter((r) => r.s === k).length] as const) };
    }).filter((x) => x.steps.length);
  }, [items, dept, q, mine, me, cameBack]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCount = sections.reduce((a, x) => a + x.rows.length, 0);
  // the tabs (Nov 2, Nick: "like tabs in a browser… the two panels fuse together"): All, then each group; the open one
  // joins the panel under it, which holds that tab's messages (left) and its jobs (right)
  const curG = all ? null : GROUPS.find((g) => g.steps.some((x) => x[0] === step)) || null;
  const byOrder = useMemo(() => new Map((items || []).filter((it) => it.orderId).map((it) => [it.orderId!, it])), [items]);
  const myChats = chats.filter((c) => !mine || !c.owner || c.owner === me);
  // the pipeline's signal: once when the page opens, and again whenever more messages are waiting on us
  const [signal, setSignal] = useState(false);
  const waitingNow = myChats.filter((c) => c.waiting).length;
  const lastWaiting = useRef<number | null>(null);
  useEffect(() => {
    if (lastWaiting.current !== null && waitingNow <= lastWaiting.current) { lastWaiting.current = waitingNow; return; }
    lastWaiting.current = waitingNow;
    setSignal(true);
    const t = setTimeout(() => setSignal(false), 2800);
    return () => clearTimeout(t);
  }, [waitingNow]);
  const inGroup = (c: ChatSummary, g: G) => { const it = c.orderId ? byOrder.get(c.orderId) : null; return !!it && it.steps.some((s0) => g.steps.some((x) => x[0] === s0)); };
  const newIn = (g: G | null) => (g ? myChats.filter((c) => inGroup(c, g)) : myChats).reduce((a, c) => a + c.unread, 0);
  const tagOf = (c: ChatSummary) => {
    const g = GROUPS.find((x) => inGroup(c, x));
    if (g) return { t: g.t, c: g.c };
    return c.orderId ? { t: ST[c.status]?.label || "Order", c: "var(--ink-3)" } : { t: "General", c: "var(--ink-3)" };
  };
  const unreadOf = (orderId?: string) => (orderId ? chats.filter((c) => c.orderId === orderId).reduce((a, c) => a + c.unread, 0) : 0);
  const chatOrder = chat ? chats.find((c) => c.key === chat)?.orderId || null : null;
  const curChat = chat ? chats.find((c) => c.key === chat) || null : null;
  const mWant = mq.trim().toLowerCase();
  const boardChats = myChats.filter((c) => !mWant || `${whoOf(c)} ${c.customer} ${c.last.body} ${c.number || ""} ${c.nickname}`.toLowerCase().includes(mWant));
  const chatOfJob = (orderId: string) => myChats.find((c) => c.orderId === orderId) || null;
  const colorOfChat = (c: ChatSummary) => tagOf(c).c;
  // a conversation picked is a filter (Nov 2, Nick: "when you click on a message, it should just pull up the message. There
  // shouldn't be any other jobs in the center panel"): its job alone, then the conversation; a message with no job on the
  // board is a general inquiry, with no tab picked
  const focusJob = curChat?.orderId ? byOrder.get(curChat.orderId) || null : null;
  const solo = !!curChat && !focusJob;
  // the Messages heading level with the jobs' heading: the space above it is measured from the table's own heading,
  // again when anything above the table changes size (filters wrapping, a narrower window)
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const sp = padRef.current, th = document.querySelector(".jct-body table.jc thead tr") as HTMLElement | null;
      if (!sp) return;
      const nx = th ? { pad: Math.max(0, Math.round(th.getBoundingClientRect().top - sp.getBoundingClientRect().top)), h: Math.round(th.getBoundingClientRect().height) } : { pad: 0, h: 0 };
      setLvl((p) => (Math.abs(p.pad - nx.pad) > 1 || Math.abs(p.h - nx.h) > 1 ? nx : p));
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const ro = new ResizeObserver(later);
    const pb = document.querySelector(".jct-body .jc-list > .panel-b"); if (pb) ro.observe(pb);
    const tb = document.querySelector(".jct-body .jc-list .toolbar"); if (tb) ro.observe(tb);
    addEventListener("resize", later);
    return () => { ro.disconnect(); removeEventListener("resize", later); if (raf) cancelAnimationFrame(raf); };
  }, [items, step, dept, q, chat, mine, cameBack, artOnly, pick]);

  return (
    <>
      <div className="page-head">
        <div><h1>Job Center</h1><div className="eyebrow">Every job before production, and what customers are saying about it</div></div>
        <div className="jc-hd-r">
          {hasAcc && <div className="chips" role="group" aria-label="Whose jobs">
            {([[true, "My accounts"], [false, "Everyone"]] as const).map(([k, l]) => <button key={l} type="button" className={"chip" + (mineOn === k ? " on" : "")} aria-pressed={mineOn === k} onClick={() => setMine(k)}>{l}</button>)}
          </div>}
        </div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      {msg && <div className="pv-err sow-msg" role="status">{msg}</div>}
      <div className="jcx">
      {/* the FBS Message Center (Nov 2, Nick: "the messaging center round logo around an FBS… just FBS in the center and make
          it radiate"): our logo in a ring of our colors that sends out rings, quicker when a message is waiting on us */}
      <div className={"jrl-mc" + (solo ? " on" : "") + (signal ? " go" : "")}>
        <div className="jrl-mc-ban">
          <span className={"jrl-sig" + (waitingNow ? " live" : "")} aria-hidden>
            <b /><b /><b />
            <i><img src="/brand/fbs-logo-white.svg" alt="" width={30} height={30} /></i>
          </span>
          <span className="jrl-mc-t">Message Center</span>
        </div>
        <div className="jrl-mc-n"><span><b className="nw">{myChats.reduce((a0, c) => a0 + c.unread, 0)}</b> new</span><span><b className="wt">{waitingNow}</b> waiting on us</span></div>
        <i className="jrl-strip" aria-hidden />
      </div>
      {/* the stages as cards (Nov 2, Nick: "the title should be on the top… a small number in the top right of each card…
          small number underneath the bubble. I don't like the notification style bubble"): the picked one tinted, with an
          arrow down to its list */}
      <div className="jrl" role="tablist" aria-label="Steps">
        {GROUPS.map((g) => { const on = !solo && curG?.t === g.t; const nm = newIn(g); const tot = items ? g.steps.reduce((a0, [k]) => a0 + (k === "declined" ? 0 : count(k)), 0) : null; return (
          <div key={g.t} role="tab" aria-selected={on} className={"jrl-sec" + (on ? " on" : "")} style={{ ["--c" as string]: g.c, ["--f" as string]: g.steps.length > 1 ? 2 : 1 }}>
            <button type="button" className="jrl-h" onClick={() => go(g.steps[0][0])} title={g.line}>
              <span className="jrl-t">{g.t}</span>
              <span className="jrl-n">{tot ?? "…"}</span>
            </button>
            {nm > 0 && <span className="jrl-nm">{nm} new message{nm === 1 ? "" : "s"}</span>}
            <div className="jrl-ss">
              {g.steps.map(([k, l, icon]) => { const nn = count(k); return (
                <button key={k} type="button" className={"jrl-st" + (!all && !solo && step === k ? " pick" : "")} onClick={() => go(k)} aria-label={`${l}: ${items ? nn : "loading"}`}>
                  <span className="jrl-ic">{icon}</span>
                  <em className={items && !nn ? "z" : ""}>{items ? nn : "…"}</em>
                  <span className="jrl-sl">{l}</span>
                </button>); })}
            </div>
          </div>
        ); })}
      </div>
      {/* the messages: search, then the Messages heading level with Job on the right; picking one brings its job forward on
          its tab and opens the conversation under it (Nov 2, Nick) */}
      <div className="jmb">
        <input className="jmb-s" value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Search messages" aria-label="Search messages" />
        <div ref={padRef} style={{ height: lvl.pad }} aria-hidden />
        <div className="jmb-head" style={lvl.h ? { height: lvl.h } : undefined}>Messages</div>
        <div className="jmb-list">
          {!boardChats.length ? <div className="jmb-none faint">{mq ? `No messages match “${mq}”.` : "No customer messages."}</div>
            : /* in two parts (Nov 2, Nick: "sort the messages… a little heading that says job related… and then just general
                 messages"): about a job on the Job Center, then everything else */
            ([["Job related", boardChats.filter((c) => !!c.orderId && byOrder.has(c.orderId))], ["General messages", boardChats.filter((c) => !c.orderId || !byOrder.has(c.orderId))]] as const).map(([h, list]) => list.length > 0 && (
              <div key={h} className="jmb-grp"><div className="jmb-grp-h">{h}<span className="pill-n">{list.length}</span></div>
                {list.map((c) => <ChatLine key={c.key} c={c} full color={colorOfChat(c)} on={chat === c.key} onClick={() => openChat(chat === c.key ? null : c.key)} />)}</div>))}
        </div>
      </div>
      <div className={"jc-body jct-body" + (picked ? " has-pick" : "")} style={{ ["--c" as string]: curG?.c || "var(--fbs-blue)" }}>
        <section className="panel jc-list">
          <div className="panel-b stack" style={{ gap: 12 }}>
            {/* a message with no job in the Job Center (a general question, or an order past it) opens on its own, as a general
                inquiry, with no tab picked (Nov 2, Nick: "it should go back as a general inquiry and not go to a tab") */}
            {curChat ? <div className="jmb-gen">
              <div className="toolbar jmb-gen-h" data-toolbar>
                <button type="button" className="btn sm" onClick={() => setChat(null)}>← All jobs</button>
                <span className="faint">{focusJob ? `Just this job and its conversation with ${whoOf(curChat) === "You" ? curChat.customer : whoOf(curChat)}` : "A message that isn't about a job on the board"}</span>
              </div>
              <div className="tbl-wrap"><table className="tbl jc" data-nofit>
                {focusJob ? <>
                  <thead><tr><th>Job</th><th>Dept</th><th>{step === "approved" ? "Where it is" : step === "requests" ? "Pieces" : "Needs"}</th><th>Also</th><th>{step === "requests" ? "Sent in" : "Due"}</th></tr></thead>
                  <tbody><Row it={focusJob} step={focusJob.steps.includes(step) ? step : (focusJob.steps.find((x) => x !== "leads") || step)} msgs={unreadOf(focusJob.orderId)} on={pick === focusJob.key} onPick={() => setPick(pick === focusJob.key ? null : focusJob.key)} after={after} onLead={() => setLead(focusJob)} /></tbody>
                </> : <>
                  <thead><tr><th>General inquiry</th><th>Where it is</th></tr></thead>
                  <tbody><tr><td><b>{curChat.customer || "No customer"}</b><div className="sub">{curChat.number ? `#${curChat.number}${curChat.nickname ? ` ${curChat.nickname}` : ""}` : "Not about an order"}</div></td>
                    <td>{curChat.number ? <span className="pill" style={{ ["--sc" as string]: ST[curChat.status]?.c || "var(--ink-3)" }}><span className="pill-t">{ST[curChat.status]?.label || curChat.status}</span></span> : <span className="faint">General question</span>}</td></tr></tbody>
                </>}
              </table></div>
              <div className="jmb-focus" style={{ ["--mc" as string]: focusJob ? colorOfChat(curChat) : "var(--ink-3)" }}>
                <ChatThread c={curChat} color={colorOfChat(curChat)} onSent={() => setCn((x) => x + 1)} onClose={() => setChat(null)} />
              </div>
            </div> : <>
            {/* one solid bar in the picked stage's color (Nov 2, Nick: "make that whole top bar whatever that color is… screen print
                embroidery and heat press live in that… along with the search… solid blue bar"), and under it which stage and step
                is showing ("depending on which bubble you click… indicate that below") */}
            <div className="toolbar jc-sbar" data-toolbar>
              {/* the departments as small SP / EMB / HP buttons beside the search, like the Dept column's tags (Nov 2, Nick: "just
                  do a small, the SP, EMB, and HP buttons next to the search… get rid of came back with changes"); one picked
                  shows only its jobs, picked again shows all */}
              {/* the department switch first, on the left: All · SP · EMB · HP, one always picked (Nov 2, Nick: "move that all
                  the way to the left… add one button for all") */}
              {(all || step !== "leads") && <div className="jc-dpt jc-dseg" role="radiogroup" aria-label="Department">{DEPTS.map(([k, l]) => { const nn = items ? (k === "all" ? null : deptCount(k)) : null; const on = dept === k; return (
                <button key={k} type="button" role="radio" aria-checked={on} className={"prf-dept " + k + (on ? " on" : "") + (nn === 0 ? " z" : "")} title={k === "all" ? "Every department" : `${l}: ${nn ?? 0} job${nn === 1 ? "" : "s"}`} onClick={() => setDept(k)}>{k === "all" ? "All" : DEPT_TAG[k as Dept]}</button>); })}</div>}
              {step === "mockups" && !all && <div className="chips"><button type="button" className={"chip" + (artOnly ? " on" : "")} aria-pressed={artOnly} title="Mockups made for a customer with no order yet" onClick={() => setArtOnly(!artOnly)}>Art only, no order</button></div>}
              <span className="jc-search"><SearchInput placeholder="Search job, customer or order #" value={q} onChange={(e) => setQ(e.target.value)} /></span>
            </div>
            <div className="jc-swhere">{all ? <b>All jobs</b> : <><b>{curG?.t}</b><span>›</span><b>{(curG?.steps.find((x) => x[0] === step) || [])[1]}</b></>}{items && !all && step !== "requests" ? <small>{count(step)} job{count(step) === 1 ? "" : "s"}{dept !== "all" ? ` in ${DEPT_TAG[dept as Dept]}` : ""}</small> : null}</div>
            {/* Requests: laid out like ClickUp Jobs' New list, the picked one opened on top (components/RequestsDesk.tsx) */}
            {step === "requests" && !all ? <RequestsDesk q={q} onChanged={() => void loadJobs().then((r) => { if (r.ok) setItems(r.items); })} /> : !items ? <div className="faint">Loading…</div> : all ? (!allCount ? <div className="faint">{q ? `No matches for “${q}”.` : "Nothing in the Job Center right now."}</div> : (
              <div className="tbl-wrap"><table className="tbl jc" data-nofit>
                <thead><tr><th>Job</th><th>Dept</th><th>Where it is</th><th>Also</th><th>Due</th></tr></thead>
                <tbody>{sections.filter((x) => x.rows.length).map((x) => { const open = !!more[x.g.t] || x.rows.length <= 6; return [
                  <tr key={x.g.t} className="jc-sec" style={{ ["--c" as string]: x.g.c }}><td colSpan={5}><i aria-hidden /><b>{x.g.t}</b> · {x.counts.filter(([, n]) => n).map(([k, n]) => `${GROUPS.flatMap((g) => g.steps).find((y) => y[0] === k)![1]} ${n}`).join(" · ")}</td></tr>,
                  ...(open ? x.rows : x.rows.slice(0, 5)).map(({ it, s: st }) => <Row key={it.key} it={it} step={st} wide msgs={unreadOf(it.orderId)} hl={!!chatOrder && chatOrder === it.orderId} on={pick === it.key} onPick={() => { setPick(pick === it.key ? null : it.key); const c = it.orderId ? chats.find((x) => x.orderId === it.orderId) : null; if (c) setChat(c.key); }} after={after} onLead={() => setLead(it)} />),
                  ...(open ? [] : [<tr key={x.g.t + "+"} className="jc-more"><td colSpan={5}><button type="button" className="linkbtn" onClick={() => setMore((m) => ({ ...m, [x.g.t]: true }))}>+ {x.rows.length - 5} more in {x.g.t.toLowerCase()}</button></td></tr>]),
                ]; })}</tbody>
              </table></div>
            )) : !shown.length ? <div className="faint">{q ? `No matches for “${q}”.` : EMPTY[step]}</div> : (
              <div className="tbl-wrap"><table className="tbl jc" data-nofit>
                <thead><tr>{step === "leads" ? <><th>Lead</th><th>Came in</th><th /></>
                  : step === "declined" ? <><th>Job</th><th>Why</th><th>Declined</th></>
                  : <><th>Job</th><th>Dept</th><th>{step === "approved" ? "Where it is" : step === "requests" ? "Pieces" : "Needs"}</th><th>Also</th><th>{step === "requests" ? "Sent in" : "Due"}</th></>}</tr></thead>
                <tbody>{shown.flatMap((it) => { const c0 = it.orderId ? chatOfJob(it.orderId) : null; return [
                  <Row key={it.key} it={it} step={step} msgs={unreadOf(it.orderId)} mc={c0 ? colorOfChat(c0) : undefined} onChat={c0 ? () => openChat(chat === c0.key ? null : c0.key) : undefined} hl={!!chatOrder && chatOrder === it.orderId} on={pick === it.key} onPick={() => setPick(pick === it.key ? null : it.key)} after={after} onLead={() => setLead(it)} />,
                  // the conversation opens on the next line, in the big panel (Nov 2, Nick)
                ]; })}</tbody>
              </table></div>
            )}
            </>}
          </div>
        </section>
        {picked && <aside className="jc-side" aria-label="The job">
          <JobPanel key={picked.key + n} it={picked} step={step} after={after} onClose={() => setPick(null)} onLead={() => setLead(picked)} onUndo={() => void undoDeclined(picked.orderId!).then((r) => after(r.ok ? "Back on the Job Center." : r.error))} />
        </aside>}
      </div>
      </div>
      {/* Make a job: the one Create order tool (components/tools/CreateOrderTool.tsx), the same as on emails and ClickUp jobs */}
      {lead?.activityId && <CreateOrderTool activityId={lead.activityId} text={lead.leadText || lead.title} onClose={() => { setLead(null); setN((x) => x + 1); }} onCreated={(_, num) => after(`Order #${num} made.`)} />}
    </>
  );
}

function Row({ it, step, wide, on, onPick, after, onLead, msgs = 0, hl = false, mc, onChat, linked = false }: { /** open its conversation */ onChat?: () => void; /** joined to its open message (Line up) */ linked?: boolean; it: JobItem; step: Step; /** View all: every row in the same five columns */ wide?: boolean; on: boolean; onPick: () => void; after: (m: string) => void; onLead: () => void; /** new customer messages on it */ msgs?: number; /** its conversation is open */ hl?: boolean; /** it has a conversation: the color it has on the message board */ mc?: string }) {
  const [busy, setBusy] = useState(false);
  const here = it.tracks.filter((t) => forStep(step, t)), also = it.tracks.filter((t) => !forStep(step, t));
  const tag = (t: Track, i: number) => <span key={i} className="pill" style={{ ["--sc" as string]: TONE[t.state] }}><span className="pill-t">{t.label}</span></span>;
  const who = <>{it.number ? <span className="ordno">#{it.number}</span> : null}{" "}<b>{it.customer || "No customer yet"}</b>{mc && <button type="button" className={"jc-msgn" + (msgs ? " new" : "")} style={{ ["--mc" as string]: mc }} title={msgs ? `${msgs} new message${msgs === 1 ? "" : "s"}: open` : "Open the messages"} onClick={(e) => { e.stopPropagation(); onChat?.(); }}>💬{msgs ? ` ${msgs}` : ""}</button>}<div className="sub">{it.title}</div></>;
  const keys = { tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }, "aria-selected": on };
  if (it.type === "lead") return (
    <tr className={on ? "on" : ""} onClick={onPick} {...keys} data-job="">
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
    <tr className={(on ? "on" : "") + (hl && !linked ? " jc-hl" : "") + (linked ? " jc-linked" : "")} onClick={onPick} {...keys} data-job={it.orderId || ""} style={linked && mc ? { ["--mc" as string]: mc } : undefined}>
      <td>{who}</td>
      <td className="nowrap">{it.depts.map((d) => <span key={d} className={"prf-dept " + d}>{DEPT_TAG[d]}</span>)}</td>
      <td>{step === "requests" ? (wide ? <span className="pill" style={{ ["--sc" as string]: "var(--fbs-violet)" }}><span className="pill-t">New request · {it.qty || 0} pcs</span></span> : <span className="nowrap">{it.qty || 0} pcs</span>) : step === "approved" ? <span className="pill" style={{ ["--sc" as string]: ST[it.status || ""]?.c || "var(--ok)" }}><span className="pill-t">{ST[it.status || ""]?.label || it.status}</span></span>
        : <div className="jc-tags">{here.map(tag)}</div>}</td>
      {/* what else is going on, in quiet words (Nov 2, Nick: "statuses are weird"): one colored status per job, in Where it is */}
      <td><span className="jc-also">{[...(step === "approved" ? [] : also).map((t) => t.label), it.revised && step !== "changes" ? "came back once" : ""].filter(Boolean).join(" · ")}</span></td>
      <td className="nowrap">{step === "requests" ? day(it.at) : it.due ? day(it.due) : <span className="faint">No date</span>}</td>
    </tr>
  );
}
