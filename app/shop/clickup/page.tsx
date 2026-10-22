"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSticky } from "@/lib/useSticky";
import SearchInput from "@/components/SearchInput";
import { Due } from "@/components/bits";
import OrderStartPick, { type OrderStart } from "@/components/OrderStartPick";
import QuickOrder from "@/components/QuickOrder";
import EmailOrderPanel from "@/components/EmailOrderPanel";
import { FileTray, type MailFile } from "@/components/MailFolders";
import type { ClickUpTeamRow, CuFile } from "@/lib/clickup";
import { clickUpFiles, clickUpWorkspace, markClickUpDone, tickClickUpBox, dismissClickUpTask, hideClickUpTeam, listClickUp, processClickUpTask, setClickUpCustomer, type ClickUpKnown, type ClickUpState, type ClickUpTask } from "./actions";

/**
 * ClickUp Jobs (Oct 22, Nick: "When you click the clickup tool, it would basically show you, hey, McKenna uploaded…
 * would you like to process this order? …let's create a new order or let's create a reorder. And then you go through
 * the same process like you did before. The only thing at the end is you would go back and click the In Printavo
 * button in ClickUp"). Under Shop Tools, with a count of new jobs like the Time Clock's. Every staff member sees every
 * workspace for now. The jobs are read by lib/clickup.ts every 3 minutes; a job waits here until it's made into an
 * order, ticked "In Printavo" in ClickUp, or marked "Not an order". Making the order ticks "In Printavo" in ClickUp.
 */

type Tab = "new" | "made" | "printavo" | "not" | "boards";
type Data = { connected: boolean; tokens: number; state: ClickUpState | null; teams: ClickUpTeamRow[]; tasks: ClickUpTask[]; known: Record<string, ClickUpKnown>; customers: { id: string; label: string }[] };
/** a task's files as an email's attachments (stored copies open in the portal; until then, in ClickUp) */
const asMail = (files: CuFile[]): MailFile[] => files.map((f) => ({ key: f.id, name: f.name, size: f.size, type: f.type,
  href: f.path ? `/api/files/open?${new URLSearchParams({ p: f.path, n: f.name })}` : f.url }));

const chiDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
/** the fields worth showing: ticked boxes and filled-in words (not "In Printavo", it has its own tab) */
/** ClickUp's priority flag (Oct 22, Nick: "how are we handling like the urgent flags or priority flags"): Urgent and High
 * are shown like ClickUp's flags and listed first */
const prRank = (t: { priority?: string }) => (t.priority === "urgent" ? 0 : t.priority === "high" ? 1 : 2);
function Flag({ p }: { p?: string }) {
  if (p !== "urgent" && p !== "high") return null;
  return <span className={"cu-flag " + p} title={`Flagged ${p === "urgent" ? "Urgent" : "High"} in ClickUp`}><svg viewBox="0 0 24 24" aria-hidden><path d="M5 21V4h11l-1.5 4L16 12H5" /></svg>{p === "urgent" ? "Urgent" : "High"}</span>;
}
/** what staff see instead of "In Printavo" on this page (Oct 22, Nick: "it shouldn't say In Printavo, it should say FBS
 * invoice number") */
const boxName = (b: string) => (/in printavo/i.test(b) ? "FBS Invoice #" : b);
/**
 * The FBS invoice number(s) for a job, each tagged with where it lives (Oct 22, Nick: "an indicator whether it's in our
 * new system or our old system for my staff"): an order made in the portal = New system, a Printavo job = Old system.
 */
function Inv({ ours, pv }: { ours?: { id: string; number: number } | null; pv?: { id?: string | null; number: string; status?: string } | null }) {
  if (!ours && !pv) return <span className="faint">—</span>;
  return <span className="cu-inv">
    {ours && <span className="cu-inv-r"><Link href={`/shop/orders/${ours.id}`} onClick={(e) => e.stopPropagation()}><span className="ordno">{ours.number}</span></Link><span className="cu-sys new" title="Made in our new system (this portal)">New system</span></span>}
    {pv && <span className="cu-inv-r">{pv.id ? <Link href={`/shop/archive/${pv.id}`} onClick={(e) => e.stopPropagation()}><span className="ordno">{pv.number}</span></Link> : <span className="ordno">{pv.number}</span>}<span className="cu-sys old" title="Printavo (our old system)">PTV</span>{pv.status && <span className="sub cu-inv-s">{pv.status}</span>}</span>}
  </span>;
}
const isDoneT = (t: { status_type: string }) => /^(closed|done)$/i.test(t.status_type || "");
const shownFields = (f: Record<string, string>) => Object.entries(f).filter(([k, v]) => v !== "—" && !/printavo/i.test(k));

export default function ClickUpJobs() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useSticky<Tab>("clickup.tab", "new");
  const [team, setTeam] = useSticky<string>("clickup.team", "");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [act, setAct] = useState<string | null>(null); // the job brought in (activity), for the order maker
  const [pick, setPick] = useState(false);
  const [quick, setQuick] = useState<(OrderStart & { n: number }) | null>(null);
  const [review, setReview] = useState<OrderStart | null>(null);
  const [made, setMade] = useState<{ id: string; number: number } | null>(null);
  const [files, setFiles] = useState<{ id: string; list: CuFile[]; busy: boolean; err?: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // a customer's whole workspace (Workspaces tab → click one): every job, open and completed, by board
  const [ws, setWs] = useState<string | null>(null);
  const [wsData, setWsData] = useState<{ team: string; tasks: ClickUpTask[]; known: Record<string, ClickUpKnown>; reading: boolean } | null>(null);
  const [wsShow, setWsShow] = useSticky<"open" | "done" | "all">("clickup.ws.show", "open");
  const [wsQ, setWsQ] = useState("");
  // column widths, dragged on the header's right edge (Oct 22, Nick: "make the columns movable… larger or shorter"),
  // remembered in this browser; double-click the edge to put a column back
  const [cw, setCw] = useSticky<Record<string, number>>("clickup.cols2", {});
  // the toolbar and the column headings always pinned to the top while the list scrolls (Oct 22, Nick: "make this
  // pinnable…", then "don't need that little pinned button… It'll always be pinned")
  const pin = true;
  const tbRef = useRef<HTMLDivElement | null>(null);
  const [tbH, setTbH] = useState(0);
  useEffect(() => {
    const el = tbRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTbH(el.offsetHeight)); ro.observe(el); setTbH(el.offsetHeight);
    return () => ro.disconnect();
  }, [ws, tab, pin]);
  const pinStyle = { ["--cu-th-top" as string]: `${pin ? tbH : 0}px` };
  // Dragging a column's right edge moves just that edge, exactly with the mouse, like a divider: this column grows and
  // the one after it shrinks (the table always fills the window, so something has to give; Oct 22, Nick: "you click
  // on it and then you move it and the cursor jumps"). The Job column has no saved width: it takes what's left.
  // Double-click an edge: the column fits what's in it, like Excel (Nick: "when you double click a column and it
  // shrinks it to a reasonable size"). While dragging only the headings change; widths are saved on letting go.
  const MIN_W = 44, JOB_MIN = 220;
  const isJob = (k?: string | null) => !!k && /\.job$/.test(k);
  const saveW = (ws: Record<string, number>) => setCw((m) => { const n = { ...m }; for (const [k, v] of Object.entries(ws)) if (!isJob(k)) n[k] = v; return n; });
  const rth = (key: string, label: ReactNode, cls = "", sizable = true) => (
    <th key={key} className={cls} data-col={key} style={cw[key] && !isJob(key) ? { width: cw[key] } : undefined}>{label}
      {sizable && <span className="cu-rsz" title="Drag to move this edge · double-click to fit the column to what's in it" aria-hidden
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const th = e.currentTarget.parentElement as HTMLElement, table = th.closest("table");
          if (!table || isJob(key)) return;
          const job = th.parentElement?.querySelector<HTMLElement>("th[data-col$='.job']");
          const w0 = th.getBoundingClientRect().width, jobW = job ? job.getBoundingClientRect().width : 9999;
          table.classList.add("cu-measure");
          const natural = th.getBoundingClientRect().width;
          table.classList.remove("cu-measure");
          const w = Math.round(Math.max(56, Math.min(520, natural + 4, w0 + Math.max(0, jobW - JOB_MIN))));
          th.style.width = `${w}px`; saveW({ [key]: w });
        }}
        onPointerDown={(e) => {
          e.preventDefault(); e.stopPropagation();
          const th = e.currentTarget.parentElement as HTMLElement, next = th.nextElementSibling as HTMLElement | null;
          if (!next) return;
          const k1 = th.dataset.col, k2 = next.dataset.col || "";
          const x0 = e.clientX, w1 = th.getBoundingClientRect().width, w2 = next.getBoundingClientRect().width;
          // how far the edge can go: neither side under its minimum (the Job column keeps 220px)
          const lo = -(w1 - (isJob(k1) ? JOB_MIN : MIN_W)), hi = w2 - (isJob(k2) ? JOB_MIN : MIN_W);
          let d = 0;
          const move = (ev: PointerEvent) => {
            d = Math.round(Math.min(hi, Math.max(lo, ev.clientX - x0)));
            if (!isJob(k1)) th.style.width = `${w1 + d}px`;
            if (!isJob(k2)) next.style.width = `${w2 - d}px`;
          };
          const up = () => {
            window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("cu-resizing");
            if (d) saveW({ ...(k1 ? { [k1]: w1 + d } : {}), ...(k2 && k2 !== "act" ? { [k2]: w2 - d } : {}) });
          };
          document.body.classList.add("cu-resizing");
          window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
        }} />}
    </th>
  );
  /** tick / untick a ClickUp box from the workspace view (Oct 22, Nick: "can we check like in Printavo here? And it'll check in ClickUp") */
  const toggleBox = async (t: ClickUpTask, name: string) => {
    const on = t.fields[name] !== "✓";
    const put = (v: string) => setWsData((d) => (d ? { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, fields: { ...x.fields, [name]: v } } : x)) } : d));
    put(on ? "✓" : "—");
    const r = await tickClickUpBox(t.id, name, on);
    if (!r.ok) { put(on ? "—" : "✓"); setErr(r.error); return; }
    flash(`${on ? "Ticked" : "Unticked"} "${boxName(name)}" on "${t.name}" in ClickUp.`);
    if (/printavo/i.test(name)) void load();
  };
  const loadWs = useCallback(async (id: string) => {
    const r = await clickUpWorkspace(id);
    if (!r.ok) { setErr(r.error); return; }
    setWsData({ team: id, tasks: r.tasks, known: r.known, reading: r.reading });
  }, []);
  useEffect(() => { if (!ws) return; void loadWs(ws); const t = setInterval(() => void loadWs(ws), 60_000); return () => clearInterval(t); }, [ws, loadWs]);

  const load = useCallback(async () => {
    const r = await listClickUp();
    if (!r.ok) { setErr(r.error); return; }
    setErr("");
    setData(r);
    window.dispatchEvent(new CustomEvent("fbs:clickup-count", { detail: r.tasks.filter((t) => t.waiting).length }));
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg((m) => (m === t ? "" : m)), 6000); };

  const teams = useMemo(() => new Map((data?.teams || []).map((t) => [t.id, t])), [data]);
  const custName = useMemo(() => new Map((data?.customers || []).map((c) => [c.id, c.label])), [data]);
  const all = useMemo(() => (data?.tasks || []).filter((t) => !teams.get(t.team_id)?.hidden), [data, teams]);
  const groups = useMemo(() => ({
    new: all.filter((t) => t.waiting),
    made: all.filter((t) => t.order_id).sort((a, b) => (b.synced_at || "").localeCompare(a.synced_at || "")),
    printavo: all.filter((t) => (t.in_printavo || t.pv_number) && !t.order_id && !t.dismissed_at),
    not: all.filter((t) => t.dismissed_at && !t.order_id),
  }), [all]);
  const list = tab === "boards" ? [] : groups[tab]
    .filter((t) => !team || t.team_id === team)
    .filter((t) => { const s = q.trim().toLowerCase(); return !s || [t.name, t.where_text, teams.get(t.team_id)?.name, t.creator_name, ...Object.values(t.fields)].some((x) => String(x || "").toLowerCase().includes(s)); });
  // grouped by customer (Oct 22, Nick: "automatically sort by customer and like separate them… something on the left that
  // shows the grouping"): customers A–Z, then the soonest due first (no date last), then the newest
  const label = (teamId: string) => { const tm = teams.get(teamId); return custName.get(tm?.customer_id || "") || tm?.name || ""; };
  const rows = [...list].sort((a, b) => label(a.team_id).localeCompare(label(b.team_id), undefined, { sensitivity: "base" }) || a.team_id.localeCompare(b.team_id)
    || prRank(a) - prRank(b) || (a.due_at ? (b.due_at ? a.due_at.localeCompare(b.due_at) : -1) : b.due_at ? 1 : 0) || (b.created_at_cu || "").localeCompare(a.created_at_cu || ""));
  const groupSize = rows.reduce<Record<string, number>>((m, t) => { m[t.team_id] = (m[t.team_id] || 0) + 1; return m; }, {});
  const weekOut = new Date(Date.now() + 7 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const dueSoon = groups.new.filter((t) => { const d = chiDay(t.due_at); return d && d <= weekOut; }).length;
  const noCustomer = (data?.teams || []).filter((t) => !t.hidden && !t.customer_id).length;
  const job = openId ? (data?.tasks || []).find((t) => t.id === openId) || wsData?.tasks.find((t) => t.id === openId) || null : null;
  const jobTeam = job ? teams.get(job.team_id) : undefined;

  /** Mark complete / Reopen: the job's status in ClickUp (Oct 22, Nick: "if we mark something complete, it auto-completes") */
  const toggleDone = async (t: ClickUpTask) => {
    const done = !isDoneT(t);
    setBusy(done ? "Marking it complete in ClickUp…" : "Reopening it in ClickUp…"); setErr("");
    const r = await markClickUpDone(t.id, done);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    flash(`"${t.name}" is ${done ? "complete" : "open again"} in ClickUp (${r.status}).`);
    await load(); if (ws) await loadWs(ws);
  };
  const checkNow = async () => {
    setBusy("Checking ClickUp…");
    const r = await fetch("/api/clickup/sync", { method: "POST" }).then((x) => x.json()).catch(() => null) as { ok?: boolean; error?: string; waiting?: string; newJobs?: string[]; read?: number } | null;
    setBusy("");
    if (!r) flash("Couldn't reach ClickUp. Try again in a minute.");
    else if (r.waiting) flash(r.waiting);
    else if (!r.ok) setErr(r.error || "ClickUp didn't answer.");
    else flash(r.newJobs?.length ? `${r.newJobs.length} new job${r.newJobs.length === 1 ? "" : "s"}: ${r.newJobs.slice(0, 3).join("; ")}` : "Checked ClickUp: nothing new.");
    await load();
  };
  const openJob = (id: string) => {
    setOpenId(id); setMade(null); setAct(null); setPick(false); setQuick(null); setReview(null);
    // the files, like an email's attachments: copied into the portal if the reader hasn't yet
    const t = data?.tasks.find((x) => x.id === id) || wsData?.tasks.find((x) => x.id === id);
    setFiles({ id, list: t?.attachments || [], busy: !!t?.attachments.some((f) => !f.path) });
    if (t?.attachments.some((f) => !f.path)) void clickUpFiles(id).then((r) => setFiles((cur) => (cur?.id !== id ? cur : r.ok ? { id, list: r.files, busy: false } : { ...cur, busy: false, err: r.error })));
    setTimeout(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const start = async (kind: "new" | "reorder") => {
    if (!job) return;
    setBusy("Bringing in the job and its files from ClickUp…"); setErr("");
    const r = await processClickUpTask(job.id);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setAct(r.activityId);
    if (kind === "new") setQuick({ told: "This is a new order, not a reorder of a past job.", n: Date.now() });
    else setPick(true);
  };
  const madeIt = (id: string, number: number) => { setMade({ id, number }); void load(); setTimeout(() => void load(), 4000); };
  const pickCustomer = async (teamId: string, customerId: string) => {
    const r = await setClickUpCustomer(teamId, customerId || null);
    if (!r.ok) setErr(r.error); else await load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jobs your customers put on their ClickUp boards</div>
          <h1>ClickUp Jobs</h1>
        </div>
        <div className="cu-head-acts">
          <a className="btn" href="https://app.clickup.com" target="_blank" rel="noreferrer">Open ClickUp</a>
          <button type="button" className="btn primary" disabled={!!busy || !data?.connected} title={data?.connected ? `Checked ${ago(data.state?.last_ok_at || null)}: ${data.teams.length} workspaces. New jobs are looked for every 3 minutes.` : undefined} onClick={() => void checkNow()}>{busy === "Checking ClickUp…" ? busy : "Check ClickUp now"}</button>
        </div>
      </div>
      {data && !data.connected && <div className="banner">ClickUp isn&apos;t connected yet: add <code>CLICKUP_API_TOKEN</code> in Vercel (ClickUp → Settings → Apps → API Token).</div>}
      {data?.state?.last_error && <div className="banner">ClickUp: {data.state.last_error}</div>}
      {err && <div className="banner">{err}</div>}
      {msg && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--ink)" }}>{msg}</div>}
      {/* the "Checked … ago" line is on the Check button's hover now (Oct 22, Nick: "don't need to see this at the top") */}

      <div className="stats">
        <button type="button" className="stat" onClick={() => setTab("new")}><span className={"v" + (groups.new.length ? " alert" : "")}>{groups.new.length}</span><span className="k">New jobs to process</span></button>
        <button type="button" className="stat" onClick={() => setTab("new")}><span className="v">{dueSoon}</span><span className="k">New, due within 7 days</span></button>
        <button type="button" className="stat" onClick={() => setTab("made")}><span className="v">{groups.made.length}</span><span className="k">Made into orders</span></button>
        <button type="button" className="stat" onClick={() => setTab("boards")}><span className={"v" + (noCustomer ? " alert" : "")}>{(data?.teams || []).filter((t) => !t.hidden).length}</span><span className="k">{noCustomer ? `Workspaces · ${noCustomer} need a customer` : "Customer workspaces"}</span></button>
      </div>

      {job && <div ref={panel} className="panel cu-job">
        <div className="panel-h">
          <h2>{custName.get(jobTeam?.customer_id || "") || jobTeam?.name || "A customer"} uploaded a job</h2>
          <span className="faint">{[jobTeam?.name, job.where_text].filter(Boolean).join(" › ")}{job.created_at_cu ? ` · ${job.creator_name || "made"} ${when(job.created_at_cu)}` : ""}</span>
        </div>
        <div className="panel-b">
          <div className="cu-title">{job.name}<Flag p={job.priority} /></div>
          <div className="cu-line">
            {job.due_at ? <>Due <Due date={chiDay(job.due_at)} status="" /></> : <span className="faint">No due date</span>}
            <span className="faint">·</span><span>{job.status || "open"}</span>
            {job.in_printavo && <><span className="faint">·</span><span className="cu-tag">FBS Invoice # ✓</span></>}
            <span className="faint">·</span><a href={job.url} target="_blank" rel="noreferrer">Open in ClickUp</a>
          </div>
          {shownFields(job.fields).length > 0 && <div className="cu-tags">{shownFields(job.fields).map(([k, v]) => <span key={k} className="cu-tag">{v === "✓" ? `${k} ✓` : `${k}: ${v}`}</span>)}</div>}
          {job.description && <p className="cu-notes">{job.description}</p>}
          {(() => {
            const k = data?.known[job.id] || wsData?.known[job.id], ours = job.order_id ? { id: job.order_id, number: job.order_number || 0 } : k?.ours;
            return k?.pv || ours ? <div className="cu-known"><span className="faint">FBS Invoice #</span><Inv ours={ours} pv={k?.pv ? { id: k.pv.id, number: k.pv.number, status: [k.pv.name, k.pv.status].filter(Boolean).join(" · ") } : null} />
            </div> : null;
          })()}
          {files?.id === job.id && files.list.length > 0 ? <div className="cu-sec"><FileTray files={asMail(files.list)} note={files.busy ? "Bringing the files in from ClickUp…" : files.err ? `Some files open in ClickUp: ${files.err}` : undefined} /></div>
            : !job.attachments.length && <div className="cu-sec faint">No files on this job in ClickUp.</div>}
          {job.comments.length > 0 && <div className="cu-sec"><div className="cu-k">Comments</div>
            <ul className="cu-comments">{job.comments.map((c, i) => <li key={i}><b>{c.who}</b> <span className="faint">{when(c.at)}</span><div>{c.text}</div></li>)}</ul></div>}

          {jobTeam && !jobTeam.customer_id && <div className="cu-sec cu-cust">
            <label>Which customer is the &ldquo;{jobTeam.name}&rdquo; workspace? <select value="" onChange={(e) => void pickCustomer(jobTeam.id, e.target.value)}>
              <option value="">Pick the customer…</option>{data?.customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <span className="faint">Its jobs become this customer&apos;s orders. You only pick it once.</span>
          </div>}
          {jobTeam?.customer_id && jobTeam.guessed && <div className="cu-sec faint">We matched the &ldquo;{jobTeam.name}&rdquo; workspace to {custName.get(jobTeam.customer_id)}. <button type="button" className="linkbtn" onClick={() => void pickCustomer(jobTeam.id, jobTeam.customer_id!)}>That&apos;s right</button> · <button type="button" className="linkbtn" onClick={() => setTab("boards")}>Change it</button></div>}

          {made || job.order_id ? <div className="cu-done">
            Order <Link href={`/shop/orders/${made?.id || job.order_id}`}><b>#{made?.number || job.order_number}</b></Link> was made from this job.{" "}
            {job.ticked_at ? <span>The &ldquo;FBS Invoice #&rdquo; box is ticked in ClickUp.</span> : job.tick_error ? <span className="cu-bad">Couldn&apos;t tick the &ldquo;FBS Invoice #&rdquo; box in ClickUp: {job.tick_error}</span> : <span className="faint">Ticking the &ldquo;FBS Invoice #&rdquo; box in ClickUp…</span>}
            <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => void toggleDone(job)}>{isDoneT(job) ? "Reopen in ClickUp" : "Mark complete in ClickUp"}</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpenId(null)}>Close</button>
          </div> : <div className="cu-ask">
            <b>Would you like to process this job?</b>
            <div className="cu-acts">
              <button type="button" className="btn primary" disabled={!!busy || !jobTeam?.customer_id || !data?.connected} onClick={() => void start("new")}>Create a new order</button>
              <button type="button" className="btn" disabled={!!busy || !jobTeam?.customer_id || !data?.connected} onClick={() => void start("reorder")}>Create a reorder</button>
              {job.dismissed_at
                ? <button type="button" className="btn ghost" disabled={!!busy} onClick={async () => { const r = await dismissClickUpTask(job.id, false); if (!r.ok) setErr(r.error); else { flash("Back on the list."); await load(); } }}>Put it back on the list</button>
                : <button type="button" className="btn ghost" disabled={!!busy} onClick={async () => { const r = await dismissClickUpTask(job.id, true); if (!r.ok) setErr(r.error); else { flash(`"${job.name}" marked not an order.`); setOpenId(null); await load(); } }}>Not an order</button>}
              <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void toggleDone(job)}>{isDoneT(job) ? "Reopen in ClickUp" : "Mark complete in ClickUp"}</button>
              <button type="button" className="btn ghost" onClick={() => setOpenId(null)}>Close</button>
            </div>
            {busy && busy !== "Checking ClickUp…" && <div className="faint">{busy}</div>}
          </div>}
          {review && act && <div className="cu-sec"><EmailOrderPanel key={act + (review.job || "")} activityId={act} start={{ told: review.told, job: review.job }} onClose={() => setReview(null)} onCreated={(id, n) => { setReview(null); madeIt(id, n); }} /></div>}
        </div>
      </div>}
      {pick && act && job && <OrderStartPick activityId={act} text={job.name} guess="reorder" onClose={() => setPick(false)}
        onPick={(s) => { setPick(false); if (s.review) setReview(s); else setQuick({ ...s, n: Date.now() }); }} />}
      {quick && act && <QuickOrder key={quick.n} activityId={act} start={quick} onClose={() => setQuick(null)}
        onReview={() => { const s = quick; setQuick(null); setReview(s); }}
        onCreated={(id, n) => madeIt(id, n)} />}

      {ws ? (() => {
        const tm = teams.get(ws);
        const tasks = wsData?.team === ws ? wsData.tasks : null;
        const open = (tasks || []).filter((t) => !isDoneT(t)), shut = (tasks || []).filter(isDoneT);
        const s0 = wsQ.trim().toLowerCase();
        const shown = (wsShow === "open" ? open : wsShow === "done" ? shut : tasks || [])
          .filter((t) => !s0 || [t.name, t.where_text, t.status, t.creator_name, t.pv_number, ...Object.values(t.fields)].some((x) => String(x || "").toLowerCase().includes(s0)));
        // the check boxes the boards use most (In Printavo, PO Ready, Embroidery Order…) as columns, like ClickUp
        const boxN: Record<string, number> = {};
        for (const t of tasks || []) for (const [k, v] of Object.entries(t.fields)) if (v === "✓" || v === "—") boxN[k] = (boxN[k] || 0) + 1;
        const boxes = Object.entries(boxN).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
        const board = (t: ClickUpTask) => t.where_text || "Completed jobs";
        const list2 = [...shown].sort((a, b) => board(a).localeCompare(board(b)) || Number(isDoneT(a)) - Number(isDoneT(b))
          || (isDoneT(a) ? 0 : prRank(a) - prRank(b)) || (isDoneT(a) ? (b.updated_at_cu || "").localeCompare(a.updated_at_cu || "") : (a.due_at ? (b.due_at ? a.due_at.localeCompare(b.due_at) : -1) : b.due_at ? 1 : 0)));
        const size = list2.reduce<Record<string, number>>((m, t) => { m[board(t)] = (m[board(t)] || 0) + 1; return m; }, {});
        const cols = 6 + boxes.length;
        return <>
          <div className={"toolbar" + (pin ? " cu-pinned" : "")} ref={tbRef}>
            <button type="button" className="btn sm" onClick={() => { setWs(null); setWsQ(""); }}>Back to workspaces</button>
            <span className="cu-ws-t"><b>{label(ws) || tm?.name}</b> <span className="faint">{tm?.name} · {open.length} open · {shut.length} completed{wsData?.team === ws && wsData.reading ? " · still reading older completed jobs from ClickUp" : ""}</span></span>
            <div className="chips">
              {([["open", "Open", open.length], ["done", "Completed", shut.length], ["all", "All", (tasks || []).length]] as ["open" | "done" | "all", string, number][])
                .map(([k, l, n]) => <button key={k} type="button" className={"chip" + (wsShow === k ? " on" : "")} onClick={() => setWsShow(k)}>{l}{n > 0 && <span className="chip-n">{n}</span>}</button>)}
            </div>
            <SearchInput placeholder="Search this workspace" value={wsQ} onChange={(e) => setWsQ(e.target.value)} />
          </div>
          <div className={"tbl-wrap cu-fit" + (pin ? " cu-pinhead" : "")} style={pinStyle}>
            <table className="tbl cu-tbl">
              <thead><tr>{rth("w.board", "Board", "cu-w-rail")}{rth("w.job", "Job")}{rth("w.status", "Status", "cu-w-status")}{rth("w.due", "Due", "cu-w-due")}{boxes.map((b) => rth(`w.box.${b}`, boxName(b), "cu-box-h"))}{rth("w.pv", "FBS INV#", "cu-w-inv")}<th className="cu-w-act" /></tr></thead>
              <tbody>
                {!tasks ? <tr><td colSpan={cols}><div className="empty">Loading the workspace…</div></td></tr> : list2.length ? list2.map((t, i) => {
                  const first = i === 0 || board(list2[i - 1]) !== board(t);
                  const k = wsData?.known[t.id], pvNo = t.pv_number || k?.pv?.number, pvId = t.pv_id || k?.pv?.id;
                  return <tr key={t.id} tabIndex={0} className={[first ? "cu-gstart" : "", openId === t.id ? "picked" : "", isDoneT(t) ? "cu-done-row" : ""].filter(Boolean).join(" ") || undefined}
                    onClick={() => openJob(t.id)} onKeyDown={(e) => e.key === "Enter" && openJob(t.id)}>
                    {first && <td className="cu-rail" rowSpan={size[board(t)]} onClick={(e) => e.stopPropagation()}><div className="cu-rail-c">{board(t)}</div><span className="cu-rail-n">{size[board(t)]}</span></td>}
                    <td><div>{t.name}{!isDoneT(t) && <Flag p={t.priority} />}</div></td>
                    <td className="cu-nw"><span className="pill" style={{ ["--sc" as string]: t.status_color || "#8a94a6" }}><span className="pill-t">{t.status || "open"}</span></span></td>
                    <td className="cu-nw">{t.due_at ? <Due date={chiDay(t.due_at)} status={isDoneT(t) ? "completed" : ""} /> : <span className="faint">—</span>}</td>
                    {boxes.map((b) => <td key={b} className="cu-box" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className={"cu-boxbtn" + (t.fields[b] === "✓" ? " on" : "")} aria-pressed={t.fields[b] === "✓"} disabled={!!busy}
                        title={`${t.fields[b] === "✓" ? "Untick" : "Tick"} "${boxName(b)}" in ClickUp`} aria-label={`${boxName(b)}: ${t.fields[b] === "✓" ? "ticked" : "not ticked"}`} onClick={() => void toggleBox(t, b)}>
                        {t.fields[b] === "✓" && <svg viewBox="0 0 24 24" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                      </button></td>)}
                    <td><Inv ours={t.order_id ? { id: t.order_id, number: t.order_number || 0 } : k?.ours} pv={pvNo ? { id: pvId, number: pvNo } : null} /></td>
                    <td className="r cu-nw"><button type="button" className="btn sm" disabled={!!busy} onClick={(e) => { e.stopPropagation(); void toggleDone(t); }}>{isDoneT(t) ? "Reopen" : "Mark complete"}</button></td>
                  </tr>;
                }) : <tr><td colSpan={cols}><div className="empty">{s0 ? `No jobs match “${wsQ}”.` : wsShow === "done" ? (wsData?.reading ? "Completed jobs are still being read in from ClickUp." : "No completed jobs.") : "No open jobs in this workspace."}</div></td></tr>}
              </tbody>
            </table>
          </div>
        </>;
      })() : <>
      <div className={"toolbar" + (pin ? " cu-pinned" : "")} ref={tbRef}>
        <div className="chips">
          {([["new", "New", groups.new.length], ["made", "Made into orders", groups.made.length], ["printavo", "FBS Invoice #", groups.printavo.length], ["not", "Not orders", groups.not.length], ["boards", "Workspaces", (data?.teams || []).length]] as [Tab, string, number][])
            .map(([k, l, n]) => <button key={k} type="button" className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}{n > 0 && <span className="chip-n">{n}</span>}</button>)}
        </div>
        {tab !== "boards" && <select aria-label="Customer" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Every customer</option>
          {(data?.teams || []).filter((t) => !t.hidden).map((t) => <option key={t.id} value={t.id}>{custName.get(t.customer_id || "") || t.name}</option>)}
        </select>}
        {tab !== "boards" && <SearchInput placeholder="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>

      {tab === "boards" ? <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>ClickUp workspace</th><th>Customer</th><th className="r">New jobs</th><th /></tr></thead>
          <tbody>
            {(data?.teams || []).map((t) => {
              const n = (data?.tasks || []).filter((x) => x.team_id === t.id && x.waiting).length;
              return <tr key={t.id} tabIndex={0} className={t.hidden ? "cu-off" : undefined} title="Open this workspace" onClick={() => { setWs(t.id); setOpenId(null); }} onKeyDown={(e) => e.key === "Enter" && setWs(t.id)}>
                <td><div>{t.name}</div><div className="sub">{t.members.slice(0, 3).join(", ")}{t.members.length > 3 ? ` +${t.members.length - 3}` : ""}</div></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select aria-label={`Customer for ${t.name}`} value={t.customer_id || ""} onChange={(e) => void pickCustomer(t.id, e.target.value)}>
                    <option value="">Pick the customer…</option>{data?.customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  {t.guessed && t.customer_id && <div className="sub">Matched by the portal. <button type="button" className="linkbtn" onClick={() => void pickCustomer(t.id, t.customer_id!)}>That&apos;s right</button></div>}
                </td>
                <td className="r">{t.hidden ? <span className="faint">—</span> : n}</td>
                <td className="r cu-nw" onClick={(e) => e.stopPropagation()}><button type="button" className="btn sm" onClick={() => { setWs(t.id); setOpenId(null); }}>Open</button> <button type="button" className="btn ghost sm" title={t.hidden ? "Show this workspace's jobs again" : "Not a customer's jobs: hide it"}
                  onClick={async () => { const r = await hideClickUpTeam(t.id, !t.hidden); if (!r.ok) setErr(r.error); else await load(); }}>{t.hidden ? "Show" : "Hide"}</button></td>
              </tr>;
            })}
            {data && !data.teams.length && <tr><td colSpan={4}><div className="empty">{data.connected ? "No workspaces yet: the first check of ClickUp is on its way (every 3 minutes), or press Check ClickUp now." : "Connect ClickUp first."}</div></td></tr>}
          </tbody>
        </table>
      </div> : <div className={"tbl-wrap cu-fit" + (pin ? " cu-pinhead" : "")} style={pinStyle}>
        <table className="tbl cu-tbl">
          <thead><tr>{rth("l.cust", "Customer", "cu-w-rail")}{rth("l.job", "Job")}{rth("l.due", "Due", "cu-w-due")}{rth("l.files", "Files", "cu-w-files")}{rth("l.pv", "FBS INV#", "cu-w-inv")}{rth("l.added", "Added", "cu-w-added")}<th className="cu-w-act" /></tr></thead>
          <tbody>
            {!data ? <tr><td colSpan={8}><div className="empty">Loading…</div></td></tr> : rows.length ? rows.map((t, i) => {
              const tm = teams.get(t.team_id);
              const first = i === 0 || rows[i - 1].team_id !== t.team_id, n = groupSize[t.team_id] || 1;
              const k = data.known[t.id], ours = t.order_id ? { id: t.order_id, number: t.order_number || 0 } : k?.ours;
              const f = shownFields(t.fields).slice(0, 3);
              return <tr key={t.id} tabIndex={0} className={[first ? "cu-gstart" : "", openId === t.id ? "picked" : ""].filter(Boolean).join(" ") || undefined} onClick={() => openJob(t.id)} onKeyDown={(e) => e.key === "Enter" && openJob(t.id)}>
                {first && <td className="cu-rail" rowSpan={n} onClick={(e) => e.stopPropagation()}>
                  <div className="cu-rail-c">{label(t.team_id) || "—"}</div>
                  <div className="sub">{tm?.customer_id ? tm.name : "Pick the customer"}</div>
                  <span className="cu-rail-n">{n} {tab === "new" ? "new" : n === 1 ? "job" : "jobs"}</span>
                </td>}
                <td><div>{t.name}<Flag p={t.priority} /></div><div className="sub">{[t.where_text, ...f.map(([k, v]) => (v === "✓" ? `${k} ✓` : `${k}: ${v}`))].filter(Boolean).join(" · ")}</div></td>
                <td>{t.due_at ? <Due date={chiDay(t.due_at)} status={t.order_id ? "completed" : ""} /> : <span className="faint">No date</span>}</td>
                <td>{t.attachments.length ? `${t.attachments.length} file${t.attachments.length === 1 ? "" : "s"}` : <span className="faint">None</span>}{t.comments.length ? <div className="sub">{t.comments.length} comment{t.comments.length === 1 ? "" : "s"}</div> : null}</td>
                <td><Inv ours={ours} pv={k?.pv ? { id: k.pv.id, number: k.pv.number, status: k.pv.status } : null} /></td>
                <td className="cu-nw cu-added">{when(t.created_at_cu)}</td>
                <td className="r cu-nw">{t.order_id
                  ? <span className="faint">Made</span>
                  : <button type="button" className={"btn sm" + (t.waiting ? " primary" : "")} onClick={(e) => { e.stopPropagation(); openJob(t.id); }}>Process</button>}</td>
              </tr>;
            }) : <tr><td colSpan={8}><div className="empty">{q ? `No jobs match “${q}”.` : tab === "new" ? "No new ClickUp jobs right now. New ones show up here (and as a count in the menu) within a few minutes of a customer adding them." : "Nothing here."}</div></td></tr>}
          </tbody>
        </table>
      </div>}
      </>}
    </>
  );
}
