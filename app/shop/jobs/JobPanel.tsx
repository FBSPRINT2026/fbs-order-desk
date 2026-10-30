"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import SendProofTool from "@/components/tools/SendProofTool";
import { mockupHref } from "@/lib/mockupFresh";
import { ST } from "@/lib/pricing";
import type { Dept, JobDetail, JobItem, JobPiece, PieceState, ProofVersion, Step } from "@/lib/jobCenter";
import { jobPanel, markDeclined, notAJob } from "./actions";
import { remindProof } from "@/app/shop/proof-actions";
import { remindSewoutAction } from "@/app/shop/sewout-actions";

/**
 * The Job Center's right panel (Oct 29, Nick: "you click on it and say, here's the order… status… view the mockup… or
 * the sew-out… open the job… copy link… view the messages, what was sent… if it was opened or not… proof approved,
 * changes to art"). The job, its pieces (the mockup by version, each sew-out, the quote) with the picture big, three
 * facts about the one picked (sent, opened, answered), the button for what's next, what the customer said last, the
 * messages and the history. With nothing picked: where to start.
 */
const I = (d: ReactNode, s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const IC = {
  shirt: <path d="M20.4 7.6 16 3l-4 2-4-2-4.4 4.6L6 11v10h12V11z" />, needle: <><path d="M5 19 19 5" /><circle cx="18" cy="6" r="2" /><path d="M4 20c2-1 3-3 2-5" /></>,
  receipt: <><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></>, send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12" /><circle cx="12" cy="12" r="3" /></>, check: <path d="M20 6 9 17l-5-5" />,
  pencil: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />, x: <path d="M18 6 6 18M6 6l12 12" />, bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  ext: <><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>, dot: <circle cx="12" cy="12" r="4" />,
  mail: <><path d="M4 4h16v16H4z" /><path d="m4 6 8 7 8-7" /></>, hour: <path d="M6 2h12M6 22h12M7 2c0 5 10 7 10 10S7 17 7 22M17 2c0 5-10 7-10 10s10 5 10 10" />,
  left: <path d="m15 18-6-6 6-6" />, right: <path d="m9 18 6-6-6-6" />,
};
const day = (s?: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const first = (s: string) => (s || "").trim().split(/\s+/)[0];
const DEPT_TAG: Record<Dept, string> = { screen: "SP", embroidery: "EMB", heat: "HP" };
const WORD: Record<PieceState | "replaced", [string, string]> = {
  needed: ["Not made yet", "var(--ink-3)"], made: ["Ready to send", "var(--fbs-blue)"], sent: ["Waiting", "var(--warn)"], changes: ["Changes asked", "var(--danger)"], done: ["Approved", "var(--ok)"], replaced: ["Replaced", "var(--ink-3)"],
};
type Row = { at: string; what: string; detail: string; who: string; tone: string };

export default function JobPanel({ it, step, after, onClose, onLead, onUndo }: { it: JobItem; step: Step; after: (m: string) => void; onClose: () => void; onLead: () => void; onUndo: () => void }) {
  const [d, setD] = useState<JobDetail | null>(null), [rows, setRows] = useState<Row[]>([]), [err, setErr] = useState("");
  useEffect(() => { if (!it.orderId) return; let live = true; void jobPanel(it.orderId).then((r) => { if (!live) return; if (r.ok) { setD(r.detail); setRows(r.rows); } else setErr(r.error); }); return () => { live = false; }; }, [it.orderId]);
  const close = <button type="button" className="jp-x" aria-label="Close" onClick={onClose}>{I(IC.x)}</button>;

  // a lead or art with no order: what we know, and the buttons
  if (!it.orderId) return (
    <div className="jp">
      <div className="jp-h"><div><h3>{it.title}</h3><div className="sub">{[it.customer, it.type === "lead" ? it.sub : "Mockups made, no order yet"].filter(Boolean).join(" · ")}</div></div>{close}</div>
      <div className="jp-sec">
        {it.type === "lead" ? <>
          <p className="jp-txt">{it.leadText?.replace(it.title, "").trim() || "An order the AI found."}</p>
          {it.tracks.length > 0 && <p className="jp-note">The AI has questions to answer before it can make the order.</p>}
          <div className="jp-acts"><button type="button" className="btn primary" onClick={onLead}>Make a job</button>
            <button type="button" className="btn" onClick={() => void notAJob(it.suggestionId!).then((r) => { after(r.ok ? "Taken off the leads." : r.error); onClose(); })}>Not a job</button></div>
        </> : <>
          <p className="jp-txt">{it.mockupIds?.length || 0} mockup{it.mockupIds?.length === 1 ? "" : "s"} made for {it.customer}. Make the order from the customer&apos;s page when the details come in.</p>
          <div className="jp-acts">{it.customerId && <Link className="btn primary" href={`/shop/customers/${it.customerId}`}>Open the customer</Link>}</div>
        </>}
      </div>
    </div>
  );
  if (err) return <div className="jp"><div className="jp-h"><div><h3>#{it.number}</h3></div>{close}</div><div className="jp-sec pv-err">{err}</div></div>;
  if (!d) return <div className="jp"><div className="jp-h"><div><h3>#{it.number} · {it.title}</h3><div className="sub">{it.customer}</div></div>{close}</div><div className="jp-sec faint">Loading…</div></div>;
  return <Detail d={d} rows={rows} it={it} step={step} after={after} close={close} onUndo={onUndo} />;
}

function Detail({ d, rows, it, step, after, close, onUndo }: { d: JobDetail; rows: Row[]; it: JobItem; step: Step; after: (m: string) => void; close: ReactNode; onUndo: () => void }) {
  // the piece this step is about, to start with
  const want: PieceState[] = step === "changes" ? ["changes"] : step === "ready" ? ["made"] : step === "sent" ? ["sent"] : step === "numbers" ? ["needed"] : ["needed", "made", "sent", "changes"];
  const start = Math.max(0, step === "sewouts" ? d.pieces.findIndex((p) => p.k === "sewout" && p.state !== "done")
    : d.pieces.findIndex((p) => p.k !== "sewout" && want.includes(p.state) && (step !== "numbers" || p.k === "art") && (step !== "mockups" || p.k === "quote" || p.state !== "needed")));
  const [sel, setSel] = useState(start);
  const p = d.pieces[sel] || d.pieces[0];
  const who = first(d.contact) || d.customer;
  const anyOut = d.pieces.some((x) => x.state === "sent" || x.state === "changes" || x.state === "done") || !!d.link;
  const status: [string, string] = d.declinedAt ? ["Declined", "var(--ink-3)"] : it.steps.includes("changes") ? ["Changes asked", "var(--danger)"] : it.steps.includes("ready") ? ["Ready to send", "var(--fbs-blue)"]
    : it.steps.includes("sent") ? [`Waiting on ${who}`, "var(--warn)"] : it.steps.includes("requests") ? ["New request", "var(--fbs-violet)"] : it.steps.includes("mockups") || it.steps.includes("numbers") ? ["In the works", "var(--warn)"] : it.steps.includes("sewouts") ? ["Sew-out", "var(--ink-2)"]
    : [ST[d.status]?.label || d.status, "var(--ok)"];
  return (
    <div className="jp">
      <div className="jp-h">
        <div><h3>#{d.number} · {d.title}</h3><div className="sub">{[d.customer, d.contact, d.depts.map((x) => DEPT_TAG[x]).join(" "), d.qty ? `${d.qty} pcs` : "", d.due ? `Due ${day(d.due)}` : ""].filter(Boolean).join(" · ")}</div></div>
        <div className="jp-hr"><span className="pill" style={{ ["--sc" as string]: status[1] }}><span className="pill-t">{status[0]}</span></span>{close}</div>
      </div>
      {p && <Hero p={p} d={d} />}
      {d.pieces.length > 1 && <div className="jp-seg" role="tablist" aria-label="Pieces">
        {d.pieces.map((x, i) => { const w = WORD[x.state]; return (
          <button key={i} type="button" role="tab" aria-selected={i === sel} className={"jp-sg" + (i === sel ? " on" : "")} onClick={() => setSel(i)}>
            <span className="jp-sg-i">{I(x.k === "art" ? IC.shirt : x.k === "sewout" ? IC.needle : IC.receipt, 17)}</span>
            <span><b>{x.k === "art" ? "Mockup" : x.k === "sewout" ? `Sew-out · ${x.where.split(",")[0]}` : `Quote ${money(x.total)}`}</b><small><i style={{ background: w[1] }} />{x.k === "quote" && x.state === "sent" && d.pieces.some((y) => y.k !== "quote" && y.state === "sent") ? "After the proof" : w[0]}</small></span>
          </button>); })}
      </div>}
      {p && <Now p={p} d={d} who={who} after={after} anyOut={anyOut} />}
      {d.said && <div className="jp-sec">
        <div className="jp-lb">{first(d.said.who) || "The customer"} said · {day(d.said.at)} · {d.said.on}</div>
        <div className="jp-q">“{d.said.text}”</div>
        {d.said.after && <div className="jp-note">{d.said.after}</div>}
      </div>}
      <div className="jp-sec">
        <div className="jp-lb">Messages</div>
        {d.msgs.length ? d.msgs.map((m, i) => (
          <div key={i} className="jp-msg"><span className={"jp-av" + (m.us ? " us" : "")}>{m.us ? "FBS" : (first(m.who)[0] || "?").toUpperCase()}</span>
            <div><b>{m.us ? (m.who ? `${m.who[0].toUpperCase()}${m.who.slice(1)}` : "We") : m.who}</b> <span className="faint">· {day(m.at)}</span><div className="jp-mt">{m.text}</div></div></div>
        )) : <div className="faint" style={{ fontSize: 12.5 }}>Nothing sent or written yet.</div>}
        <div className="jp-acts"><Link className="btn sm" href={`/shop/orders/${d.id}?tab=msg`}>Write a message</Link></div>
      </div>
      <div className="jp-sec">
        <div className="jp-lb">History</div>
        {rows.length ? <ol className="jp-tl">{[...rows].map((r, i) => (
          <li key={i}><span className={"jp-tl-i " + (r.tone || (/sent|reminder/i.test(r.what) ? "send" : /opened/i.test(r.what) ? "see" : ""))}>{I(r.tone === "ok" ? IC.check : r.tone === "bad" ? IC.pencil : /sent|reminder/i.test(r.what) ? IC.send : /opened/i.test(r.what) ? IC.eye : IC.dot, 13)}</span>
            <span className="jp-tl-t">{r.what}{r.who && !/opened/i.test(r.what) ? ` · ${first(r.who.split("@")[0])}` : ""}{r.detail && /opened/i.test(r.what) ? ` · ${r.detail}` : ""}</span><span className="jp-tl-d">{day(r.at)}</span></li>
        ))}</ol> : <div className="faint" style={{ fontSize: 12.5 }}>Nothing yet.</div>}
      </div>
      <Foot d={d} after={after} onUndo={onUndo} />
    </div>
  );
}

/** the picture: the mockup by version (flip back to see what changed), the sew-out photo, or the quote */
function Hero({ p, d }: { p: JobPiece; d: JobDetail }) {
  const vs = p.k === "art" ? p.versions : [];
  const opts: { key: string; label: string; pics: string[]; v?: ProofVersion }[] = p.k === "art" ? [...(p.next ? [{ key: "next", label: `v${(vs[0]?.v || 0) + 1}`, pics: p.next }] : []), ...vs.map((v) => ({ key: `v${v.v}`, label: `v${v.v}`, pics: v.pics, v }))] : [];
  const [ver, setVer] = useState(opts[0]?.key || ""), [i, setI] = useState(0);
  useEffect(() => { setVer(opts[0]?.key || ""); setI(0); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = opts.find((o) => o.key === ver) || opts[0];
  const pics = p.k === "art" ? cur?.pics || [] : p.k === "sewout" && p.pic ? [p.pic] : [];
  const pdf = p.k === "art" ? (cur?.key === opts[0]?.key ? p.pdf : pics[i] || "") : p.pdf;
  return (
    <div className="jp-hero">
      {opts.length > 1 && <div className="jp-ver" role="group" aria-label="Versions">{[...opts].reverse().map((o) => <button key={o.key} type="button" className={o.key === cur?.key ? "on" : ""} aria-pressed={o.key === cur?.key} onClick={() => { setVer(o.key); setI(0); }}>{o.label}{o.key === "next" ? " · not sent" : ""}</button>)}</div>}
      {pdf && <a className="jp-pdf" href={pdf} target="_blank" rel="noreferrer">{I(IC.ext, 13)} {cur?.key === opts[0]?.key || p.k !== "art" ? "Open PDF" : "Open picture"}</a>}
      {pics.length ? <img src={pics[Math.min(i, pics.length - 1)]} alt={p.k === "art" ? `Mockup ${cur?.label || ""}` : "Sew-out photo"} />
        : p.k === "quote" ? <div className="jp-quote"><b>{money(p.total)}</b><span>{p.qty ? `${p.qty} pieces · ` : ""}{p.state === "needed" ? "not priced yet" : p.state === "done" ? `approved${p.decidedName ? ` by ${p.decidedName}` : ""}` : "quote"}</span></div>
        : <div className="jp-empty">{I(p.k === "sewout" ? IC.needle : IC.shirt, 40)}<span>{p.k === "sewout" ? `No sew-out photo yet · ${p.where}` : "No mockup yet"}</span></div>}
      {pics.length > 1 && <div className="jp-nav"><button type="button" aria-label="Previous picture" onClick={() => setI((x) => (x - 1 + pics.length) % pics.length)}>{I(IC.left)}</button><span>{i + 1} / {pics.length}</span><button type="button" aria-label="Next picture" onClick={() => setI((x) => (x + 1) % pics.length)}>{I(IC.right)}</button></div>}
      {d.declinedAt && <div className="jp-decl">Declined {day(d.declinedAt)}{d.declinedWhy ? `: ${d.declinedWhy}` : ""}</div>}
    </div>
  );
}

/** three facts about the picked piece, and the button for what's next */
function Now({ p, d, who, after, anyOut }: { p: JobPiece; d: JobDetail; who: string; after: (m: string) => void; anyOut: boolean }) {
  const [busy, setBusy] = useState(false);
  const v = p.k === "art" ? p.versions[0] : null;
  const s = p.k === "sewout" ? p : null;
  const sentAt = p.k === "quote" ? (p.state === "needed" || p.state === "made" ? null : p.sentAt) : p.state === "made" || p.state === "needed" ? null : (v?.sentAt ?? s?.sentAt ?? null);
  const sentTo = v?.sentTo ?? s?.sentTo ?? null;
  const views = v?.views ?? s?.views ?? 0;
  const ans = p.state === "done" ? ["Approved", `${(v?.decidedName ?? s?.decidedName ?? (p.k === "quote" ? p.decidedName : "")) || ""}`, "ok"] : p.state === "changes" ? ["Changes", day(v?.decidedAt ?? s?.decidedAt ?? (p.k === "quote" ? p.decidedAt : "")), "bad"] : p.state === "sent" ? ["Not yet", "", "warn"] : ["—", "", ""];
  const facts: [string, string, string, string][] = [
    ["Sent", sentAt ? day(sentAt) : "Not yet", sentTo === "link copied" ? "by link" : "", ""],
    p.k === "quote" ? ["Total", money(p.total), p.qty ? `${p.qty} pcs` : "", ""] : ["Opened", views ? `${views} time${views === 1 ? "" : "s"}` : sentAt ? "Not yet" : "—", "", !views && sentAt ? "warn" : ""],
    ["Answered", ans[0], ans[1], ans[2]],
  ];
  const go = async (f: () => Promise<{ ok: boolean; error?: string }>, ok: string) => { setBusy(true); const r = await f(); setBusy(false); after(r.ok ? ok : r.error || "That didn't work."); };
  let main: ReactNode = null;
  if (p.state === "made") main = <SendProofTool target={{ kind: "order", orderId: d.id }} label="Send" onDone={after} />;
  else if (p.state === "sent" && p.k === "art") main = <button type="button" className="btn primary" disabled={busy} title="Emails them a reminder" onClick={() => void go(() => remindProof(d.id), "Reminder sent.")}>{I(IC.bell, 14)} Remind {who}</button>;
  else if (p.state === "sent" && p.k === "sewout" && p.id) main = <button type="button" className="btn primary" disabled={busy} title="Emails them a reminder" onClick={() => void go(() => remindSewoutAction(p.id!), "Reminder sent.")}>{I(IC.bell, 14)} Remind {who}</button>;
  else if ((p.state === "needed" || p.state === "changes") && p.k === "art") main = d.mockGroup ? <Link className="btn primary" href={mockupHref(d.id, d.mockGroup)}>{p.state === "changes" ? "Make the changes" : "Make the mockup"}</Link> : null;
  else if ((p.state === "needed" || p.state === "changes") && p.k === "sewout") main = <Link className="btn primary" href="/shop/digitizing">{p.state === "changes" ? "Make the changes" : "Take the sew-out"}</Link>;
  else if ((p.state === "needed" || p.state === "changes") && p.k === "quote") main = <Link className="btn primary" href={`/shop/orders/${d.id}`}>{p.state === "changes" ? "Fix the quote" : p.qty ? "Price it" : "Add sizes"}</Link>;
  return (
    <div className="jp-sec">
      <div className="jp-facts">{facts.map(([k, val, sub, tone]) => <div key={k} className={"jp-f " + tone}><span>{k}</span><b>{val}</b>{sub && <small>{sub}</small>}</div>)}</div>
      <div className="jp-acts">
        {main}
        {anyOut && <SendProofTool target={{ kind: "order", orderId: d.id }} mode="copy" onDone={after} />}
        {d.link && <a className="btn sm" href={d.link} target="_blank" rel="noreferrer">{I(IC.eye, 14)} What they see</a>}
      </div>
    </div>
  );
}

function Foot({ d, after, onUndo }: { d: JobDetail; after: (m: string) => void; onUndo: () => void }) {
  const [asking, setAsking] = useState(false), [why, setWhy] = useState(""), [busy, setBusy] = useState(false);
  const art = d.pieces.some((p) => p.k === "art");
  return (
    <div className="jp-sec jp-foot">
      <Link className="btn sm" href={`/shop/orders/${d.id}`}>Open job</Link>
      {art && d.mockGroup && <Link className="btn sm" href={mockupHref(d.id, d.mockGroup)}>Mockup Creator</Link>}
      {d.declinedAt ? <button type="button" className="btn sm" onClick={onUndo}>Put it back</button>
        : !["quote", "quote_sent", "request", "approved", "art"].includes(d.status) ? null
        : asking ? <span className="jc-decl"><input type="text" autoFocus placeholder="Why? (optional)" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Why it was declined" />
            <button type="button" className="btn sm" onClick={() => setAsking(false)}>Cancel</button>
            <button type="button" className="btn sm danger" disabled={busy} onClick={() => { setBusy(true); void markDeclined(d.id, why).then((r) => { setBusy(false); after(r.ok ? "Moved to Declined." : r.error); }); }}>Mark declined</button></span>
        : <button type="button" className="btn sm" onClick={() => setAsking(true)}>Mark declined</button>}
    </div>
  );
}

/** nothing picked: where to start (Oct 29, Nick: "let's get these orders approved. Where should we get started?") */
export function StartHere({ items, loading, mine, go }: { items: JobItem[]; loading: boolean; mine: boolean; go: (s: Step, key?: string) => void }) {
  const at = (s: Step) => items.filter((x) => x.steps.includes(s));
  const byDue = (xs: JobItem[]) => [...xs].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const fix = byDue(at("changes")), ready = byDue(at("ready"));
  const stale = at("sent").filter((x) => x.sentAt && Date.now() - new Date(x.sentAt).getTime() > 3 * 864e5).sort((a, b) => (a.sentAt || "").localeCompare(b.sentAt || ""));
  const leads = at("leads"), today = leads.filter((x) => Date.now() - new Date(x.at).getTime() < 864e5);
  const works = items.filter((x) => x.steps.includes("mockups") || x.steps.includes("numbers"));
  const rowsAll: { n: number; icon: ReactNode; c: string; t: string; sub: string; cta: string; act: () => void }[] = [
    { n: fix.length, icon: IC.pencil, c: "var(--danger)", t: `${fix.length} to fix`, sub: fix[0] ? `Customers asked for changes · start with #${fix[0].number}` : "", cta: "Make changes", act: () => go("changes", fix[0]?.key) },
    { n: ready.length, icon: IC.send, c: "var(--fbs-blue)", t: `${ready.length} ready to send`, sub: ready[0] ? `Due soonest: #${ready[0].number}${ready[0].due ? `, ${day(ready[0].due)}` : ""}` : "", cta: ready[0] ? `Start with #${ready[0].number}` : "", act: () => go("ready", ready[0]?.key) },
    { n: stale.length, icon: IC.hour, c: "var(--warn)", t: `${stale.length} waiting 3+ days`, sub: stale[0] ? `Longest: #${stale[0].number}, sent ${day(stale[0].sentAt)}` : "", cta: "Remind", act: () => go("sent", stale[0]?.key) },
    { n: works.length, icon: IC.shirt, c: "var(--warn)", t: `${works.length} in the works`, sub: "Mockups or numbers to finish", cta: "", act: () => go(at("mockups").length ? "mockups" : "numbers") },
    { n: at("sewouts").length, icon: IC.needle, c: "var(--ink-2)", t: `${at("sewouts").length} sew-out${at("sewouts").length === 1 ? "" : "s"}`, sub: "Embroidery: take them, send them, get them approved", cta: "", act: () => go("sewouts", byDue(at("sewouts"))[0]?.key) },
    { n: leads.length, icon: IC.mail, c: "var(--fbs-violet)", t: `${leads.length} new lead${leads.length === 1 ? "" : "s"}`, sub: today.length ? `${today.length} from today` : "From email and ClickUp", cta: "", act: () => go("leads") },
  ];
  const rowsOn = rowsAll.filter((r) => r.n > 0);
  return (
    <div className="jp jp-start">
      <div className="jp-h"><div><h3>Let&apos;s get these approved</h3><div className="sub">{mine ? "Your accounts" : "Everyone's jobs"} · where to start</div></div></div>
      <div className="jp-sec">
        {loading ? <div className="faint">Loading…</div> : !rowsOn.length ? <div className="jp-txt">All caught up. Nothing is waiting on you.</div>
          : rowsOn.map((r) => (
            <button key={r.t} type="button" className="jp-go" style={{ ["--c" as string]: r.c }} onClick={r.act}>
              <span className="jp-go-i">{I(r.icon, 18)}</span>
              <span className="jp-go-t"><b>{r.t}</b>{r.sub && <small>{r.sub}</small>}</span>
              {r.cta && <span className="jp-go-c">{r.cta}</span>}
            </button>))}
      </div>
      <div className="jp-sec jp-note">Click a job on the left to see everything about it here.</div>
    </div>
  );
}
