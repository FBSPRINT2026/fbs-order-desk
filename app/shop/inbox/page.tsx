"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { mailRows } from "@/lib/inbox";
import { checkMailNow, connectMailbox, customerFromEmail, disconnectMailbox, getMailStatus, getSignature, markNotCustomer, refreshSignature, sendEmailReply, setEmailCustomer, setEmailOrder, setSignatureOn } from "../mail-actions";
import { aiReplyOptions, aiWriteReply, markNoReply, noteEmailChat, putBackInInbox } from "../ai-actions";
import EmailOrderPanel from "@/components/EmailOrderPanel";
import EmailChat from "@/components/EmailChat";
import type { EmailAction } from "@/lib/ai/emailChat";

/**
 * Inbox, laid out like Outlook: the customer email on the left (what needs an answer first), the picked email on the
 * right with the answer on top: suggested answers to pick from, the reply box, then the email and the conversation
 * before it. Vendors, newsletters and personal mail never get here (they're skipped, not stored).
 */
type Act = { id: string; customer_id: string | null; order_id: string | null; direction: string; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; meta: { account_id?: string; account?: string; from_name?: string; lead?: boolean; ignored?: boolean; no_reply?: boolean; match?: string; references?: string[]; attachments?: { name: string; path: string; type: string; size: number }[]; html?: string; inline?: Record<string, string>; triage?: { intent?: string; summary?: string; urgency?: string; urgent_reason?: string; needs_reply?: boolean }; reply_options?: { at: string; options: { label: string; subject: string; body: string }[] } } };
type Sug = { id: string; kind: string; status: string; activity_id: string | null; title: string; body: string; draft: { subject?: string; body?: string } | null; payload: { groups?: unknown[] } | null; order_id: string | null };
type Cust = { id: string; company: string | null; name: string | null };
type Ord = { id: string; number: number; nickname: string | null; customer_id: string | null; status: string };
type Box = { id: string; email: string; name: string; imap_host: string; enabled: boolean; last_ok_at: string | null; last_error: string | null; last_run_at: string | null; stats: Record<string, Record<string, number>> };
type Status = { mine: Box | null; all: Box[]; defaultHost: string; myEmail: string };

const ago = (t: string) => { const m = (Date.now() - new Date(t).getTime()) / 60000; return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const INTENT: Record<string, string> = { new_order: "New order", reorder: "Reorder", change_to_order: "Order change", artwork: "Artwork", payment: "Payment", question: "Question", other: "Other" };

export default function Inbox() {
  const [st, setSt] = useState<Status | null>(null);
  const [acts, setActs] = useState<Act[] | null>(null), [sugs, setSugs] = useState<Sug[]>([]), [custs, setCusts] = useState<Map<string, Cust>>(new Map()), [orders, setOrders] = useState<Ord[]>([]);
  const [tab, setTab] = useSticky<"reply" | "leads" | "all">("inbox.tab", "reply");
  const [whose, setWhose] = useSticky<"mine" | "everyone">("inbox.whose", "mine");
  const [connecting, setConnecting] = useState(false);
  // the email list beside the three panes: hide it to make room (remembered)
  const [listOpen, setListOpen] = useSticky<boolean>("inbox.list", true);
  const [open, setOpen] = useState<string | null>(null), [focus, setFocus] = useState<string | null>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const sb = createClient();
    const s = await getMailStatus(); if (s.ok) setSt(s as unknown as Status);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: a } = await sb.from("activities").select("id, customer_id, order_id, direction, subject, body, from_email, to_email, external_id, thread_id, occurred_at, meta").eq("kind", "email").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(800);
    const list = ((a || []) as Act[]).filter((x) => !x.meta?.ignored);
    setActs(list);
    const ids = list.filter((x) => x.direction === "in").map((x) => x.id);
    const { data: sg } = ids.length ? await sb.from("ai_suggestions").select("id, kind, status, activity_id, title, body, draft, payload, order_id").in("activity_id", ids) : { data: [] };
    setSugs((sg || []) as Sug[]);
    const cIds = [...new Set(list.map((x) => x.customer_id).filter(Boolean))] as string[];
    const [{ data: cs }, { data: os }] = await Promise.all([
      cIds.length ? sb.from("customers").select("id, company, name").in("id", cIds) : Promise.resolve({ data: [] }),
      cIds.length ? sb.from("orders").select("id, number, nickname, customer_id, status").in("customer_id", cIds).order("number", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    ]);
    setCusts(new Map(((cs || []) as Cust[]).map((c) => [c.id, c])));
    setOrders((os || []) as Ord[]);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const rows = useMemo(() => mailRows(acts || [], sugs), [acts, sugs]);
  const mineId = st?.mine?.enabled ? st.mine.id : null;
  // opened from a link (the dashboard's Reply): /shop/inbox?open=<email id> opens it ready to answer
  useEffect(() => {
    if (!acts || !st) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    const r = rows.find((y) => y.x.id === id);
    if (r) {
      if (!(r.needs && tab === "reply")) setTab(r.needs ? "reply" : "all");
      if (whose === "mine" && r.x.meta?.account_id !== mineId) setWhose("everyone");
      setOpen(id); setFocus(id); setPicked(true);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [acts, st]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoped = whose === "mine" && mineId ? rows.filter((r) => r.x.meta?.account_id === mineId) : rows;
  const shown = scoped.filter((r) => (tab === "reply" ? r.needs : tab === "leads" ? r.x.meta?.lead && !r.x.customer_id : true))
    .sort((a, b) => (tab === "reply" ? Number(b.urgent) - Number(a.urgent) : 0) || b.x.occurred_at.localeCompare(a.x.occurred_at)); // urgent ones first on Needs reply
  const counts = { urgent: scoped.filter((r) => r.urgent).length, reply: scoped.filter((r) => r.needs).length, leads: scoped.filter((r) => r.x.meta?.lead && !r.x.customer_id).length, all: scoped.length };
  const today = st?.mine?.stats ? st.mine.stats[new Date().toISOString().slice(0, 10)] || {} : {};

  const who = (x: Act) => { const c = x.customer_id ? custs.get(x.customer_id) : null; return c ? c.company || c.name || x.from_email : `${x.meta?.from_name || x.from_email}`; };
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  // the email showing on the right: the one picked, else the first in the list (after sending, the next one)
  const [q, setQ] = useState("");
  const listed = q.trim() ? shown.filter((r) => `${who(r.x)} ${r.x.from_email} ${r.x.subject} ${r.x.meta?.triage?.summary || ""}`.toLowerCase().includes(q.trim().toLowerCase())) : shown;
  const sel = listed.find((r) => r.x.id === open) || (open ? rows.find((r) => r.x.id === open) : undefined) || listed[0];
  const [picked, setPicked] = useState(false); // phones: the list until an email is picked, then the email
  const pickRow = (id: string, answer = false) => { setOpen(id); setPicked(true); if (answer) setFocus(id); };
  const listRef = useRef<HTMLDivElement | null>(null);
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = listed.findIndex((r) => r.x.id === sel?.x.id), n = listed[Math.max(0, Math.min(listed.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) { setOpen(n.x.id); listRef.current?.querySelector<HTMLElement>(`[data-id="${n.x.id}"]`)?.focus(); }
  };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Sales</div><h1>Inbox</h1></div>
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {st?.mine?.enabled && <span className="faint" style={{ fontSize: 13 }}>{st.mine.email} · checked {st.mine.last_ok_at ? ago(st.mine.last_ok_at) : "not yet"} · today {(today.inbox_customer || 0)} customer, {(today.inbox_lead || 0)} leads, {(today.inbox_skipped || 0)} skipped</span>}
          {st?.mine?.enabled && <button type="button" className="btn" disabled={!!busy} onClick={async () => { setBusy("check"); const r = await checkMailNow(); setBusy(""); if (!r.ok) flash(r.error); else { flash("Checked."); load(); } }}>{busy === "check" ? "Checking…" : "Check now"}</button>}
          {st && <button type="button" className="btn" onClick={() => setConnecting(!connecting)}>{st.mine?.enabled ? "My email settings" : "Connect my email"}</button>}
        </div>
      </div>
      {st && (connecting || !st.mine?.enabled) && <Connect st={st} onDone={(t) => { setConnecting(false); flash(t); load(); }} />}
      {st?.mine?.enabled && st.mine.last_error && <div className="pv-err" style={{ marginBottom: 12 }}>{st.mine.last_error}</div>}
      {st && st.all.length > 0 && <div className="faint ibx-boxes">Connected: {st.all.map((b) => <span key={b.id} className={b.enabled ? (b.last_error ? "bad" : "ok") : "off"} title={b.last_error || (b.last_ok_at ? `checked ${ago(b.last_ok_at)}` : "")}>{b.email}{!b.enabled ? " (off)" : b.last_error ? " (problem)" : ""}</span>)}</div>}
      {msg && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 10 }}>{msg}</div>}
      <div className={"ibx-split" + (picked && sel ? " picked" : "") + (sel ? " reading" : "") + (sel && !listOpen ? " nolist" : "")}>
        <section className="ibx-pane ibx-left" aria-label="Emails">
          <div className="ibx-left-h">
            <div className="ibx-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "reply"} className={tab === "reply" ? "on" : ""} onClick={() => setTab("reply")}>Needs reply<span className={counts.urgent ? "hot" : ""} title={counts.urgent ? `${counts.urgent} urgent` : undefined}>{counts.reply}</span></button>
              <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "on" : ""} onClick={() => setTab("leads")}>Leads<span>{counts.leads}</span></button>
              <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All<span>{counts.all}</span></button>
            </div>
            <div className="ibx-left-tools">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email" aria-label="Search email" />
              {mineId && <span className="ibx-seg"><button type="button" className={whose === "mine" ? "on" : ""} onClick={() => setWhose("mine")}>Mine</button><button type="button" className={whose === "everyone" ? "on" : ""} onClick={() => setWhose("everyone")}>Everyone</button></span>}
            </div>
          </div>
          <div className="ibx-items" ref={listRef} onKeyDown={onKeys}>
            {!acts ? <div className="faint ibx-none">Loading…</div> : !listed.length ? <div className="faint ibx-none">{q ? "Nothing matches." : tab === "reply" ? "Nothing waiting on you." : tab === "leads" ? "No new leads." : "No customer email in the last 30 days yet."}</div>
              : listed.map(({ x, answered, needs, urgent }) => {
                const waitH = (Date.now() - new Date(x.occurred_at).getTime()) / 36e5;
                const ord = orders.find((o) => o.id === x.order_id);
                return (
                  <button key={x.id} data-id={x.id} type="button" className={"ibx-item" + (sel?.x.id === x.id ? " on" : "") + (needs ? " needs" : "") + (urgent ? " urgent" : "")} onClick={() => pickRow(x.id)} onDoubleClick={() => pickRow(x.id, true)} title="Double-click to answer it">
                    <span className="ibx-item-top">
                      <span className={"ibx-dot" + (needs ? (waitH > 24 ? " late" : " due") : answered ? " ok" : "")} aria-hidden />
                      <b className="ibx-item-who">{who(x)}</b>
                      <span className={"ibx-item-when" + (needs && waitH > 24 ? " late" : "")}>{ago(x.occurred_at)}</span>
                    </span>
                    <span className="ibx-item-subj">{x.subject || "(no subject)"}</span>
                    {x.meta?.triage?.summary && <span className="ibx-item-sum">{x.meta.triage.summary}</span>}
                    <span className="ibx-item-tags">
                      {urgent && <span className="tag ibx-urgent" title={x.meta?.triage?.urgent_reason || "The customer needs a fast answer"}>Urgent{x.meta?.triage?.urgent_reason ? `: ${x.meta.triage.urgent_reason}` : ""}</span>}
                      {x.meta?.lead && !x.customer_id && <span className="tag">Lead</span>}
                      {x.meta?.triage?.intent && INTENT[x.meta.triage.intent] && <span className="tag soft">{INTENT[x.meta.triage.intent]}</span>}
                      {ord && <span className="tag soft">#{ord.number}</span>}
                      {(x.meta?.attachments || []).length > 0 && <span className="faint" title="Attachments">📎{x.meta!.attachments!.length}</span>}
                      {answered && <span className="faint">answered</span>}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
        <section className="ibx-pane ibx-right" aria-label="Email and reply">
          {!sel ? <div className="ibx-empty"><b>{acts ? "Nothing to answer" : "Loading…"}</b>{acts && <span className="faint">Pick an email on the left. New customer email shows up within a couple of minutes.</span>}</div>
            : <Detail key={sel.x.id + (focus === sel.x.id ? ":f" : "") + ((sel.x.meta as { reply_options?: { at?: string } } | null)?.reply_options?.at || "")} focus={focus === sel.x.id} x={sel.x} who={who(sel.x)} reply={sel.reply} quote={sel.quote} needs={sel.needs} urgent={sel.urgent} answered={sel.answered}
                orders={orders.filter((o) => o.customer_id && o.customer_id === sel.x.customer_id)}
                thread={(acts || []).filter((o) => o.id !== sel.x.id && ((o.thread_id && (o.thread_id === sel.x.thread_id || o.thread_id === sel.x.external_id)) || (sel.x.external_id && (o.meta?.references || []).includes(sel.x.external_id)) || (o.external_id && (sel.x.meta?.references || []).includes(o.external_id))))}
                back={() => setPicked(false)} listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} busy={busy} setBusy={setBusy} done={(t) => { flash(t); load(); }} />}
        </section>
      </div>
    </>
  );
}

type Opt = { label: string; subject: string; body: string };

/**
 * The right-hand pane: who and what at the top, then the answer (suggested answers first, so they're the first thing
 * you see), then the email itself and the conversation before it.
 */
function Detail({ x, who, reply, quote, needs, urgent, answered, focus, orders, thread, back, busy, setBusy, done, listOpen, toggleList }: { x: Act; who: string; reply?: Sug; quote?: Sug; needs: boolean; urgent: boolean; answered: boolean; focus: boolean; orders: Ord[]; thread: Act[]; back: () => void; busy: string; setBusy: (s: string) => void; done: (msg: string) => void; listOpen: boolean; toggleList: () => void }) {
  const draftSubject = reply?.draft?.subject || (x.subject?.toLowerCase().startsWith("re:") ? x.subject : `Re: ${x.subject || ""}`);
  // an order was made from this email: its confirmation ("Thanks for your order…") is the answer, ready to send
  const confirm0 = (x.meta?.reply_options?.options || [])[0] as Opt | undefined;
  const confirm = confirm0?.label === "Order confirmation" ? confirm0 : undefined;
  const [subject, setSubject] = useState(confirm?.subject || draftSubject);
  const [body, setBody] = useState(confirm?.body || reply?.draft?.body || "");
  const [err, setErr] = useState(""), [company, setCompany] = useState(""), [custQ, setCustQ] = useState(""), [hits, setHits] = useState<Cust[]>([]);
  const [opts, setOpts] = useState<Opt[] | null>(x.meta?.reply_options?.options || null), [picked, setPicked] = useState(confirm ? 0 : reply?.draft?.body ? -2 : -1), [ask, setAsk] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  // Create order: the AI's suggested order from this email and its attachments, to check and create
  const [ordering, setOrdering] = useState(false), [orderStart, setOrderStart] = useState<{ told?: string; job?: string; n: number } | null>(null);
  // three panes: the email, the AI chat, the response (answer or order); on a narrow screen one at a time
  const [pane, setPane] = useState<"mail" | "ai" | "resp">(focus ? "resp" : "ai"), [resp, setResp] = useState<"reply" | "order">("reply");
  const [made, setMade] = useState<{ id: string; number: number } | null>(null), [bump, setBump] = useState(0);
  useEffect(() => { setOrdering(false); setOrderStart(null); setMade(null); }, [x.id]);
  // a step the Inbox chat suggested: open Create order with what to know, put a reply in the box, file it, no reply
  function act(a: EmailAction) {
    if (a.kind === "create_order") { setOrderStart((p) => ({ told: a.told, job: a.job, n: (p?.n || 0) + 1 })); setOrdering(true); setResp("order"); setPane("resp"); }
    else if (a.kind === "reply") { if (a.subject) setSubject(a.subject); setBody(a.body); setPicked(-1); setResp("reply"); setPane("resp"); setTimeout(() => boxRef.current?.focus(), 30); }
    else if (a.kind === "file_under") { const o = orders.find((z) => z.number === a.order_number); if (o) void run("ord", () => setEmailOrder(x.id, o.id), `Filed under #${o.number}.`); else setErr(`#${a.order_number} isn't one of their open orders.`); }
    else if (a.kind === "no_reply") void run("nr", () => markNoReply(x.id), "Off your Needs a reply list.");
    else if (a.kind === "order_goods") window.open(`/shop/order-goods?email=${x.id}`, "_blank");
  }
  const orderish = ["new_order", "reorder"].includes(x.meta?.triage?.intent || "") || !!quote;
  async function loadOpts(fresh = false) {
    setBusy("opts"); setErr("");
    const r = await aiReplyOptions(x.id, fresh);
    setBusy("");
    if (!r.ok) return setErr(r.error || "The AI couldn't come up with answers.");
    setOpts(r.options);
  }
  function pick(i: number) {
    if (i === -2) { setPicked(-2); setSubject(draftSubject); setBody(reply?.draft?.body || ""); }
    else { const o = opts?.[i]; if (!o) return; setPicked(i); setSubject(o.subject); setBody(o.body); }
    boxRef.current?.focus();
  }
  // emails waiting on an answer get their suggested answers straight away (written once, then kept with the email)
  useEffect(() => { if ((needs || focus) && !opts && !busy) loadOpts(); }, [x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) setTimeout(() => boxRef.current?.focus(), 60); }, [focus]);
  async function urlFor(path: string) { const { data } = await createClient().storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }
  async function find(q: string) { setCustQ(q); if (q.trim().length < 2) return setHits([]); const { data } = await createClient().from("customers").select("id, company, name").or(`company.ilike.%${q.replace(/[,()]/g, "")}%,name.ilike.%${q.replace(/[,()]/g, "")}%,email.ilike.%${q.replace(/[,()]/g, "")}%`).limit(8); setHits((data || []) as Cust[]); }
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => { setBusy(key); setErr(""); const r = await fn(); setBusy(""); if (!r.ok) setErr(r.error || "Something went wrong."); else done(ok); };
  const when = new Date(x.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="ibx-work" data-pane={pane}>
      <div className="ibx-work-tabs" role="tablist" aria-label="Panes">
        <button type="button" role="tab" aria-selected={pane === "mail"} className={pane === "mail" ? "on" : ""} onClick={() => setPane("mail")}>Email</button>
        <button type="button" role="tab" aria-selected={pane === "ai"} className={pane === "ai" ? "on" : ""} onClick={() => setPane("ai")}>✦ AI</button>
        <button type="button" role="tab" aria-selected={pane === "resp"} className={pane === "resp" ? "on" : ""} onClick={() => setPane("resp")}>{resp === "order" && ordering ? "Order" : "Answer"}</button>
      </div>

      {/* 1. the email */}
      <section className="ibx-col ibx-col-mail" aria-label="The email">
      <header className="ibx-read-h">
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn sm ghost ibx-back" onClick={back}>← Emails</button>
          <button type="button" className="btn sm ghost ibx-listbtn" onClick={toggleList} title={listOpen ? "Hide the email list to make room" : "Show the email list"}>{listOpen ? "⟨ Hide list" : "☰ Emails"}</button>
        </div>
        <h2>{x.subject || "(no subject)"}</h2>
        <div className="ibx-read-from"><b>{who}</b>{who !== (x.meta?.from_name || x.from_email) && <span> · {x.meta?.from_name || ""} &lt;{x.from_email}&gt;</span>}{who === (x.meta?.from_name || x.from_email) && who !== x.from_email && <span> &lt;{x.from_email}&gt;</span>}<span className="faint"> · {when}{answered ? " · answered" : ""}</span></div>
        {urgent && <div className="ibx-read-urgent"><b>Urgent</b>{x.meta?.triage?.urgent_reason ? ` · ${x.meta.triage.urgent_reason}` : " · the customer needs a fast answer"}</div>}
        {x.meta?.triage?.summary && <div className="ibx-read-sum">✦ {x.meta.triage.summary}</div>}
        <div className="ibx-read-tools">
          {x.direction === "in" && <button type="button" className={"btn sm" + (orderish && !x.order_id ? " primary" : "")} disabled={!!busy} onClick={() => { setOrdering(true); setResp("order"); setPane("resp"); }} title="The AI reads the email and its attachments and suggests the order (new, or a reorder of a past job) for you to check">{x.meta?.triage?.intent === "reorder" ? "Create reorder" : "Create order"}</button>}
          {x.customer_id && <select aria-label="File under an order" value={x.order_id || ""} disabled={!!busy} onChange={(e) => run("ord", () => setEmailOrder(x.id, e.target.value || null), "Filed under the order.")}>
            <option value="">Not about an order</option>{orders.slice(0, 40).map((o) => <option key={o.id} value={o.id}>#{o.number} {o.nickname || ""} ({o.status})</option>)}
          </select>}
          {x.direction === "in" && <a className="btn sm" href={`/shop/order-goods?email=${x.id}`} target="_blank" rel="noreferrer" title="Buy the blanks from S&S now, before the order is made (the garments the AI read from the email are filled in)">Order goods</a>}
          {x.customer_id && <Link className="btn sm" href={`/shop/customers/${x.customer_id}`}>Customer</Link>}
          {x.order_id && <Link className="btn sm" href={`/shop/orders/${x.order_id}`}>Order</Link>}
          <span className="spacer" />
          {needs ? <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => run("nr", () => markNoReply(x.id), "Off your Needs a reply list.")}>No reply needed</button>
            : x.meta?.no_reply ? <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => run("nr", () => markNoReply(x.id, false), "Back on Needs a reply.")}>Needs a reply after all</button>
            : x.direction === "in" && answered ? <button type="button" className="btn sm ghost" disabled={!!busy} title="Answered, but there's still something to do (an order to make): back on Needs a reply" onClick={() => run("back", () => putBackInInbox(x.id), "Back in the Inbox.")}>Back to inbox</button> : null}
          <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => run("ign", () => markNotCustomer(x.id), `${x.from_email} won't be read again.`)}>Not a customer</button>
        </div>
        {!x.customer_id && <div className="ibx-lead">
          <span><b>New sender.</b> Is this a new customer, or someone at one you have?</span>
          <input className="ibx-in" placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="New customer company" />
          <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => run("new", () => customerFromEmail(x.id, company), "New customer made from the email.")}>Make them a customer</button>
          <span className="faint">or add {x.meta?.from_name?.split(" ")[0] || "them"} as a contact at</span>
          <span className="ibx-find"><input className="ibx-in" placeholder="Find a customer…" value={custQ} onChange={(e) => find(e.target.value)} aria-label="Find the customer they work for" />
            {hits.length > 0 && <span className="ibx-hits">{hits.map((c) => <button key={c.id} type="button" onClick={() => run("cust", () => setEmailCustomer(x.id, c.id), `${x.meta?.from_name || x.from_email} is now a contact at ${c.company || c.name}. Their email will file there from now on.`)}>{c.company || c.name}</button>)}</span>}</span>
        </div>}
      </header>
      <div className="ibx-msg">
        <div className="ibx-msg-h"><b>{x.meta?.from_name || x.from_email}</b><span className="faint"> wrote · {when}</span></div>
        <EmailBody x={x} />
        {(x.meta?.attachments || []).length > 0 && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{x.meta!.attachments!.map((f) => <button key={f.path} type="button" className="btn sm" onClick={() => urlFor(f.path)}>📎 {f.name}</button>)}</div>}
      </div>
      {thread.length > 0 && <div className="ibx-thread"><div className="ibx-msg-h"><b>Earlier in this conversation</b></div>{[...thread].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((t) => <div key={t.id} className={"ibx-t " + t.direction}><b>{t.direction === "out" ? "You" : t.meta?.from_name || t.from_email}</b> · {new Date(t.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<div>{t.body.slice(0, 700)}</div></div>)}</div>}
      </section>

      {/* 2. the AI: stays open while answers are written and orders made */}
      <section className="ibx-col ibx-col-ai" aria-label="Talk it over with the AI">
        {x.direction === "in" ? <EmailChat activityId={x.id} onAction={act} busyOutside={!!busy} bump={bump} /> : <div className="faint" style={{ padding: 16 }}>Your sent email.</div>}
      </section>

      {/* 3. the response: the answer, or the order being made */}
      <section className="ibx-col ibx-col-resp" aria-label="Your response">
        <div className="ibx-resp-tabs">
          <button type="button" className={resp === "reply" ? "on" : ""} onClick={() => setResp("reply")}>Answer</button>
          {x.direction === "in" && <button type="button" className={resp === "order" ? "on" : ""} onClick={() => { setOrdering(true); setResp("order"); }}>{x.meta?.triage?.intent === "reorder" ? "Reorder" : "Order"}</button>}
        </div>
        {made && <div className="ibx-made">Order <b>#{made.number}</b> created. <a href={`/shop/orders/${made.id}`} target="_blank" rel="noreferrer">Open #{made.number}</a></div>}
        {ordering && <div hidden={resp !== "order"}><EmailOrderPanel key={`${x.id}:${orderStart?.n || 0}`} activityId={x.id} start={orderStart || undefined} onClose={() => { setOrdering(false); setResp("reply"); }} onCreated={(id, n, opened) => { setOrdering(false); setResp("reply"); setMade({ id, number: n }); if (!opened) window.open(`/shop/orders/${id}`, "_blank"); void noteEmailChat(x.id, `Order #${n} created from this email.`, `/shop/orders/${id}`).then(() => setBump((b) => b + 1)); done(`Order #${n} created from the email. Our mockup is being built in a new tab; the order opens there when it's saved.`); }} /></div>}
        {(resp === "reply" || !ordering) && (
      <div className="ibx-answer">
        <div className="ibx-answer-h"><b>Your answer</b>
          {busy === "opts" ? <span className="faint">✦ Thinking of answers…</span> : <button type="button" className="linkbtn" disabled={!!busy} onClick={() => loadOpts(!!opts)}>{opts ? "✦ Other answers" : "✦ Suggest answers"}</button>}
        </div>
        {(opts || reply?.draft?.body) && <div className="ibx-opts" role="list">
          {reply?.draft?.body && <button type="button" role="listitem" className={"ibx-opt" + (picked === -2 ? " on" : "")} onClick={() => pick(-2)}><b>AI&apos;s draft</b><span>{reply.draft.body.replace(/\s+/g, " ").slice(0, 110)}</span></button>}
          {opts?.map((o, i) => <button key={i} type="button" role="listitem" className={"ibx-opt" + (picked === i ? " on" : "")} onClick={() => pick(i)}><b>{o.label}</b><span>{o.body.replace(/^hi [^,\n]*,?\s*/i, "").replace(/\s+/g, " ").slice(0, 110)}</span></button>)}
        </div>}
        <input type="text" className="ibx-subj" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
        <textarea ref={boxRef} rows={9} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Pick an answer above, write your own, or tell the AI what to say below" aria-label="Reply" />
        <form className="ibx-tell" onSubmit={async (e) => { e.preventDefault(); if (!ask.trim()) return; setBusy("ai"); setErr(""); const r = await aiWriteReply({ activityId: x.id, instruction: ask, subject }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't write that."); else { setSubject(r.subject || subject); setBody(r.body); setPicked(-1); setAsk(""); boxRef.current?.focus(); } }}>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Tell the AI what to say, e.g. “yes, if we get the order by Saturday”" aria-label="Tell the AI what to say" />
          <button type="submit" className="btn sm" disabled={!!busy || !ask.trim()}>{busy === "ai" ? "Writing…" : "✦ Write it"}</button>
        </form>
        <div className="ibx-send">
          <button type="button" className="btn primary" disabled={!!busy || !body.trim()} onClick={() => run("send", () => sendEmailReply({ activityId: x.id, subject, body, suggestionId: reply?.id }), `Sent to ${x.from_email}.`)}>{busy === "send" ? "Sending…" : "Send reply"}</button>
          {body.trim() && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={async () => { setBusy("polish"); setErr(""); const r = await aiWriteReply({ activityId: x.id, subject, body }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't rewrite that."); else setBody(r.body); }}>{busy === "polish" ? "Polishing…" : "✦ Polish"}</button>}
          <span className="faint">To {x.from_email} · your signature and their email go underneath, like Outlook</span>
        </div>
        {err && <div className="pv-err">{err}</div>}
      </div>
        )}
      </section>
    </div>
  );
}

/**
 * The email as Outlook shows it: its own formatting, signature and pictures, in a locked-down frame (no scripts run;
 * links open in a new tab). Pictures sent inside the email come from our private copy; email stored before we kept
 * the formatting shows as plain text until the next mailbox check fills it in.
 */
function EmailBody({ x }: { x: Act }) {
  const [doc, setDoc] = useState<string | null>(null), [plain, setPlain] = useState(false), [h, setH] = useState(240);
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    let live = true;
    setDoc(null); setH(240);
    const path = x.meta?.html;
    if (!path) return;
    (async () => {
      const sb = createClient().storage.from("proofs");
      const { data: blob } = await sb.download(path);
      if (!blob || !live) return;
      let html = await blob.text();
      const inline = Object.entries(x.meta?.inline || {});
      if (inline.length) {
        const { data: urls } = await sb.createSignedUrls(inline.map(([, p]) => p), 3600);
        inline.forEach(([cid, p]) => { const u = urls?.find((r) => r.path === p)?.signedUrl; if (u) html = html.split(`cid:${cid}`).join(u); });
      }
      html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
      const head = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:10px 12px;font:14px/1.45 Calibri,Segoe UI,Arial,sans-serif;color:#222;background:#fff;overflow-x:auto}img{max-width:100%;height:auto}table img{max-width:none}table{max-width:100%}</style>`;
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
      if (live) setDoc(html);
    })().catch(() => null);
    return () => { live = false; };
  }, [x.id, x.meta?.html, x.meta?.inline]);
  const fit = () => { const d = ref.current?.contentDocument; if (d?.body) setH(Math.min(1600, Math.max(120, d.documentElement.scrollHeight + 4))); };
  if (!x.meta?.html || plain || doc == null) return (
    <div>
      <pre className="ibx-body">{x.body}</pre>
      {x.meta?.html && plain && <button type="button" className="btn sm ghost" onClick={() => setPlain(false)}>Show as in Outlook</button>}
    </div>
  );
  return (
    <div className="ibx-html">
      <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); }} />
      <button type="button" className="btn sm ghost" onClick={() => setPlain(true)}>Plain text</button>
    </div>
  );
}

function Connect({ st, onDone }: { st: Status; onDone: (msg: string) => void }) {
  const [email, setEmail] = useState(st.mine?.email || st.myEmail), [name, setName] = useState(st.mine?.name || ""), [pw, setPw] = useState("");
  const host = st.mine?.imap_host || st.defaultHost;
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  return (
    <section className="panel ibx-connect"><form className="panel-b stack" style={{ gap: 10 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); const r = await connectMailbox({ email, password: pw, name, host }); setBusy(false); setPw(""); if (!r.ok) setErr(r.error); else if (r.sendProblem) setErr(`Connected for reading, but sending isn't on yet. ${r.sendProblem}`); else onDone("Your email is connected. Customer email will show up within a couple of minutes."); }}>
      <div><b>{st.mine?.enabled ? "Your email" : "Connect your email"}</b><div className="faint" style={{ fontSize: 13 }}>The portal reads your Inbox and Sent Items every 2 minutes and keeps only customer email. Replies you send from here go out from your address and land in your Sent Items. Your password is checked with the mail server, then stored encrypted; nobody can see it.</div></div>
      <div className="ibx-form">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Your name (signs replies)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nicholas" /></label>
        <label>Email password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>IMAP and SMTP have to be ticked for your mailbox in HostPilot first (Services → Exchange → your name → Advanced Settings): IMAP to read, SMTP to send. The owner can do that for everyone.</div>
      {err && <div className="pv-err">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Checking the sign-in…" : st.mine?.enabled ? "Save" : "Connect"}</button>
        {st.mine?.enabled && <button type="button" className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); await disconnectMailbox(); setBusy(false); onDone("Your email is disconnected. Email already on file stays."); }}>Disconnect</button>}
      </div>
    </form>{st.mine?.enabled && <Signature />}</section>
  );
}

/** your Outlook signature, read from the emails you've sent, as it'll appear on replies sent from here */
function Signature() {
  const [sig, setSig] = useState<{ html: string; css: string; on: boolean; at: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [h, setH] = useState(120);
  const ref = useRef<HTMLIFrameElement | null>(null);
  const load = useCallback(async () => { const r = await getSignature(); if (r.ok) setSig(r); }, []);
  useEffect(() => { load(); }, [load]);
  if (!sig) return null;
  const fit = () => { const d = ref.current?.contentDocument; if (d?.body) setH(Math.min(500, Math.max(60, d.documentElement.scrollHeight + 4))); };
  return (
    <div className="panel-b stack ibx-sig" style={{ gap: 8, borderTop: "1px solid var(--line)" }}>
      <div><b>Your signature</b><div className="faint" style={{ fontSize: 13 }}>Read from the emails you send in Outlook, and added under replies you send from here, logo and all, with their email quoted below the way Outlook does it.</div></div>
      {sig.html
        ? <iframe ref={ref} title="Your signature" sandbox="allow-same-origin" srcDoc={`<style>html,body{margin:0;padding:10px 12px;background:#fff}img{max-width:100%;height:auto}table img{max-width:none}${sig.css}</style><div class="WordSection1">${sig.html}</div>`} style={{ height: h, opacity: sig.on ? 1 : 0.45 }} onLoad={() => { fit(); setTimeout(fit, 400); }} />
        : <div className="faint">Not found yet. It&apos;s read from emails you&apos;ve sent to customers from Outlook; send one or two, then press the button below.</div>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn sm" disabled={busy} onClick={async () => { setBusy(true); setMsg(""); const r = await refreshSignature(); setBusy(false); setMsg(r.ok ? "Signature updated from your latest Outlook emails." : r.error); load(); }}>{busy ? "Reading your sent email…" : sig.html ? "Update from Outlook" : "Find my signature"}</button>
        {sig.html && <label className="row" style={{ gap: 6, alignItems: "center" }}><input type="checkbox" checked={sig.on} onChange={async (e) => { const on = e.target.checked; setSig({ ...sig, on }); await setSignatureOn(on); }} /> Add it to my replies</label>}
        {msg && <span className="faint" style={{ fontSize: 12.5 }}>{msg}</span>}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>Changed your signature in Outlook? Send an email from Outlook, wait a few minutes, then press Update from Outlook.</div>
    </div>
  );
}
