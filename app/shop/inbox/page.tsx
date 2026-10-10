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
 * Inbox (reworked Oct 9, Nick: "it doesn't flow… too much information spread out… buttons in weird spots").
 * Three columns, each with one job:
 *  - the list: who, what it's about in one line, how long they've waited;
 *  - the email: who and the subject, one row of buttons (the everyday ones; the rest under More), the email, and the
 *    answer box docked at the bottom like Outlook. Create order swaps the email for the order in the same column;
 *  - the Assistant: what the email is, a short conversation, and the next steps as buttons. It stays open the whole
 *    time, while answering or making the order.
 * Vendors, newsletters and personal mail never get here (they're skipped, not stored).
 */
type Act = { id: string; customer_id: string | null; order_id: string | null; direction: string; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; meta: { account_id?: string; account?: string; from_name?: string; lead?: boolean; ignored?: boolean; no_reply?: boolean; match?: string; references?: string[]; attachments?: { name: string; path: string; type: string; size: number; from_link?: string; source?: string }[]; links?: { url: string; kind: string; ok: boolean; error?: string }[]; html?: string; inline?: Record<string, string>; triage?: { intent?: string; summary?: string; urgency?: string; urgent_reason?: string; needs_reply?: boolean }; reply_options?: { at: string; options: { label: string; subject: string; body: string }[] } } };
type Sug = { id: string; kind: string; status: string; activity_id: string | null; title: string; body: string; draft: { subject?: string; body?: string } | null; payload: { groups?: unknown[] } | null; order_id: string | null };
type Cust = { id: string; company: string | null; name: string | null };
type Ord = { id: string; number: number; nickname: string | null; customer_id: string | null; status: string };
type Box = { id: string; email: string; name: string; imap_host: string; enabled: boolean; last_ok_at: string | null; last_error: string | null; last_run_at: string | null; stats: Record<string, Record<string, number>> };
type Status = { mine: Box | null; all: Box[]; defaultHost: string; myEmail: string };

const ago = (t: string) => { const m = (Date.now() - new Date(t).getTime()) / 60000; return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const INTENT: Record<string, string> = { new_order: "New order", reorder: "Reorder", change_to_order: "Order change", artwork: "Artwork", payment: "Payment", question: "Question", other: "Other" };

export default function Inbox() {
  const [st, setSt] = useState<Status | null>(null);
  const [acts, setActs] = useState<Act[] | null>(null), [sugs, setSugs] = useState<Sug[]>([]), [custs, setCusts] = useState<Map<string, Cust>>(new Map()), [orders, setOrders] = useState<Ord[]>([]);
  const [tab, setTab] = useSticky<"reply" | "leads" | "all">("inbox.tab", "reply");
  const [whose, setWhose] = useSticky<"mine" | "everyone">("inbox.whose", "mine");
  const [settings, setSettings] = useState(false);
  // the list can be hidden to give the email more room (remembered)
  const [listOpen, setListOpen] = useSticky<boolean>("inbox.list", true);
  const [open, setOpen] = useState<string | null>(null), [focus, setFocus] = useState<string | null>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const sb = createClient();
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    // the mailbox status and the email go out together
    const [s, { data: a }] = await Promise.all([
      getMailStatus(),
      sb.from("activities").select("id, customer_id, order_id, direction, subject, body, from_email, to_email, external_id, thread_id, occurred_at, meta").eq("kind", "email").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(800),
    ]);
    if (s.ok) setSt(s as unknown as Status);
    const list = ((a || []) as Act[]).filter((x) => !x.meta?.ignored);
    setActs(list);
    const ids = list.filter((x) => x.direction === "in").map((x) => x.id);
    const cIds = [...new Set(list.map((x) => x.customer_id).filter(Boolean))] as string[];
    const [{ data: sg }, { data: cs }, { data: os }] = await Promise.all([
      ids.length ? sb.from("ai_suggestions").select("id, kind, status, activity_id, title, body, draft, payload, order_id").in("activity_id", ids) : Promise.resolve({ data: [] }),
      cIds.length ? sb.from("customers").select("id, company, name").in("id", cIds) : Promise.resolve({ data: [] }),
      cIds.length ? sb.from("orders").select("id, number, nickname, customer_id, status").in("customer_id", cIds).order("number", { ascending: false }).limit(500) : Promise.resolve({ data: [] }),
    ]);
    setSugs((sg || []) as Sug[]);
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

  const who = (x: Act) => { const c = x.customer_id ? custs.get(x.customer_id) : null; return c ? c.company || c.name || x.from_email : `${x.meta?.from_name || x.from_email}`; };
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  // the email showing: the one picked, else the first in the list (after sending, the next one)
  const [q, setQ] = useState("");
  const listed = q.trim() ? shown.filter((r) => `${who(r.x)} ${r.x.from_email} ${r.x.subject} ${r.x.meta?.triage?.summary || ""}`.toLowerCase().includes(q.trim().toLowerCase())) : shown;
  const sel = listed.find((r) => r.x.id === open) || (open ? rows.find((r) => r.x.id === open) : undefined) || listed[0];
  const [picked, setPicked] = useState(false); // phones: the list until an email is picked, then the email
  const pickRow = (id: string, answer = false) => { setOpen(id); setPicked(true); if (answer) setFocus(id); };
  // the email showing stays put: a new email arriving at the top of the list never swaps it out from under you
  useEffect(() => { if (!open && sel) setOpen(sel.x.id); }, [open, sel?.x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const listRef = useRef<HTMLDivElement | null>(null);
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = listed.findIndex((r) => r.x.id === sel?.x.id), n = listed[Math.max(0, Math.min(listed.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (n) { setOpen(n.x.id); listRef.current?.querySelector<HTMLElement>(`[data-id="${n.x.id}"]`)?.focus(); }
  };
  const box = st?.mine;

  return (
    <>
      <div className="page-head ibx2-head">
        <div><div className="eyebrow">Sales</div><h1>Inbox</h1></div>
        <div className="ibx2-status">
          {box?.enabled && <span className={"ibx2-box" + (box.last_error ? " bad" : "")} title={box.last_error || `${box.email}${st && st.all.length > 1 ? ` · also connected: ${st.all.filter((b) => b.id !== box.id).map((b) => b.email).join(", ")}` : ""}`}>
            <i aria-hidden />{box.last_error ? "Mailbox problem" : `Checked ${box.last_ok_at ? ago(box.last_ok_at) + " ago" : "—"}`}
          </span>}
          {box?.enabled && <button type="button" className="btn sm" disabled={!!busy} onClick={async () => { setBusy("check"); const r = await checkMailNow(); setBusy(""); if (!r.ok) flash(r.error); else { flash("Checked."); load(); } }}>{busy === "check" ? "Checking…" : "Check now"}</button>}
          {st && <button type="button" className="btn sm ghost" onClick={() => setSettings(!settings)}>{box?.enabled ? "Email settings" : "Connect my email"}</button>}
        </div>
      </div>
      {st && (settings || !box?.enabled) && <Connect st={st} onDone={(t) => { setSettings(false); flash(t); load(); }} />}
      {box?.enabled && box.last_error && <div className="pv-err" style={{ marginBottom: 10 }}>{box.last_error}</div>}
      {msg && <div className="ibx2-toast" role="status">{msg}</div>}

      <div className={"ibx2" + (picked && sel ? " picked" : "") + (!listOpen && sel ? " nolist" : "")}>
        {/* 1. the list */}
        <section className="ibx2-list" aria-label="Emails">
          <div className="ibx2-list-h">
            <div className="ibx2-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "reply"} className={tab === "reply" ? "on" : ""} onClick={() => setTab("reply")}>Needs reply <span className={counts.urgent ? "hot" : ""} title={counts.urgent ? `${counts.urgent} urgent` : undefined}>{counts.reply}</span></button>
              <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "on" : ""} onClick={() => setTab("leads")}>Leads <span>{counts.leads}</span></button>
              <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All</button>
            </div>
            <div className="ibx2-find">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search email" />
              {mineId && <select value={whose} onChange={(e) => setWhose(e.target.value as "mine" | "everyone")} aria-label="Whose email"><option value="mine">Mine</option><option value="everyone">Everyone</option></select>}
            </div>
          </div>
          <div className="ibx2-items" ref={listRef} onKeyDown={onKeys}>
            {!acts ? <div className="ibx2-none">Loading…</div> : !listed.length ? <div className="ibx2-none">{q ? "Nothing matches." : tab === "reply" ? "Nothing waiting on you." : tab === "leads" ? "No new leads." : "No customer email in the last 30 days."}</div>
              : listed.map(({ x, answered, needs, urgent }) => {
                const late = needs && (Date.now() - new Date(x.occurred_at).getTime()) / 36e5 > 24;
                const ord = orders.find((o) => o.id === x.order_id);
                return (
                  <button key={x.id} data-id={x.id} type="button" className={"ibx2-item" + (sel?.x.id === x.id ? " on" : "") + (needs ? " needs" : "") + (urgent ? " urgent" : "")} onClick={() => pickRow(x.id)} onDoubleClick={() => pickRow(x.id, true)} title="Double-click to answer it">
                    <span className="ibx2-item-1">
                      <b>{who(x)}</b>
                      {urgent && <em>Urgent</em>}
                      <time className={late ? "late" : ""}>{ago(x.occurred_at)}</time>
                    </span>
                    <span className="ibx2-item-2">{x.meta?.triage?.summary || x.subject || "(no subject)"}</span>
                    {(ord || (x.meta?.lead && !x.customer_id) || answered || (x.meta?.attachments || []).length > 0) && <span className="ibx2-item-3">
                      {x.meta?.lead && !x.customer_id && <span>New sender</span>}
                      {ord && <span>#{ord.number}</span>}
                      {(x.meta?.attachments || []).length > 0 && <span>📎 {x.meta!.attachments!.length}</span>}
                      {answered && <span>Answered</span>}
                    </span>}
                  </button>
                );
              })}
          </div>
        </section>

        {/* 2 + 3. the email and the Assistant */}
        {!sel ? <section className="ibx2-empty"><b>{acts ? "Nothing to answer" : "Loading…"}</b>{acts && <span>New customer email shows up here within a couple of minutes.</span>}</section>
          : <Detail key={sel.x.id + (focus === sel.x.id ? ":f" : "")} focus={focus === sel.x.id} x={sel.x} who={who(sel.x)} reply={sel.reply} quote={sel.quote} needs={sel.needs} urgent={sel.urgent} answered={sel.answered}
              orders={orders.filter((o) => o.customer_id && o.customer_id === sel.x.customer_id)}
              thread={(acts || []).filter((o) => o.id !== sel.x.id && ((o.thread_id && (o.thread_id === sel.x.thread_id || o.thread_id === sel.x.external_id)) || (sel.x.external_id && (o.meta?.references || []).includes(sel.x.external_id)) || (o.external_id && (sel.x.meta?.references || []).includes(o.external_id))))}
              back={() => setPicked(false)} listOpen={listOpen} toggleList={() => setListOpen(!listOpen)} busy={busy} setBusy={setBusy} done={(t, next) => { flash(t); void load().then(() => { if (next) setOpen(null); }); }} />}
      </div>
    </>
  );
}

type Opt = { label: string; subject: string; body: string };

/**
 * The email column and the Assistant column for one email. The email column is either the email (with the answer box
 * docked at the bottom) or, after Create order, the order being made from it; the Assistant stays beside it.
 */
function Detail({ x, who, reply, quote, needs, urgent, answered, focus, orders, thread, back, busy, setBusy, done, listOpen, toggleList }: { x: Act; who: string; reply?: Sug; quote?: Sug; needs: boolean; urgent: boolean; answered: boolean; focus: boolean; orders: Ord[]; thread: Act[]; back: () => void; busy: string; setBusy: (s: string) => void; /** next: it's handled, show the next email */ done: (msg: string, next?: boolean) => void; listOpen: boolean; toggleList: () => void }) {
  const draftSubject = reply?.draft?.subject || (x.subject?.toLowerCase().startsWith("re:") ? x.subject : `Re: ${x.subject || ""}`);
  // an order was made from this email: its confirmation ("Thanks for your order…") is the answer, ready to send
  const confirm0 = (x.meta?.reply_options?.options || [])[0] as Opt | undefined;
  const confirm = confirm0?.label === "Order confirmation" ? confirm0 : undefined;
  const [subject, setSubject] = useState(confirm?.subject || draftSubject);
  const [body, setBody] = useState(confirm?.body || reply?.draft?.body || "");
  const [err, setErr] = useState("");
  const [opts, setOpts] = useState<Opt[] | null>(x.meta?.reply_options?.options || null), [picked, setPicked] = useState(confirm ? 0 : reply?.draft?.body ? -2 : -1), [ask, setAsk] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null), moreRef = useRef<HTMLDetailsElement | null>(null);
  // the answer box: a slim bar until you start answering (an email opened to answer starts open)
  const [writing, setWriting] = useState(focus || !!confirm);
  // the email column shows the email, or the order being made from it
  const [view, setView] = useState<"mail" | "order">("mail"), [orderStart, setOrderStart] = useState<{ told?: string; job?: string; n: number } | null>(null), [ordering, setOrdering] = useState(false);
  // phones: one column at a time
  const [side, setSide] = useState<"mail" | "ai">("mail");
  const [made, setMade] = useState<{ id: string; number: number } | null>(null), [bump, setBump] = useState(0);
  useEffect(() => { setOrdering(false); setOrderStart(null); setMade(null); setView("mail"); }, [x.id]);
  const startOrder = (s?: { told?: string; job?: string }) => { if (s) setOrderStart((p) => ({ ...s, n: (p?.n || 0) + 1 })); setOrdering(true); setView("order"); setSide("mail"); };
  const write = (focusBox = true) => { setWriting(true); setView("mail"); setSide("mail"); if (focusBox) setTimeout(() => boxRef.current?.focus(), 40); };
  // a step the Assistant suggested: open Create order with what to know, put a reply in the box, file it, no reply
  function act(a: EmailAction) {
    if (a.kind === "create_order") startOrder({ told: a.told, job: a.job });
    else if (a.kind === "reply") { if (a.subject) setSubject(a.subject); setBody(a.body); setPicked(-1); write(); }
    else if (a.kind === "file_under") { const o = orders.find((z) => z.number === a.order_number); if (o) void run("ord", () => setEmailOrder(x.id, o.id), `Filed under #${o.number}.`); else setErr(`#${a.order_number} isn't one of their open orders.`); }
    else if (a.kind === "no_reply") void run("nr", () => markNoReply(x.id), "Off your Needs reply list.");
    else if (a.kind === "order_goods") window.open(`/shop/order-goods?email=${x.id}`, "_blank");
  }
  const orderish = ["new_order", "reorder"].includes(x.meta?.triage?.intent || "") || !!quote;
  const reorder = x.meta?.triage?.intent === "reorder";
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
    write();
  }
  // emails waiting on an answer get their suggested answers straight away (written once, then kept with the email)
  useEffect(() => { if ((needs || focus) && !opts && !busy) loadOpts(); }, [x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) setTimeout(() => boxRef.current?.focus(), 60); }, [focus]);
  async function urlFor(path: string) { const { data } = await createClient().storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => { setBusy(key); setErr(""); if (moreRef.current) moreRef.current.open = false; const r = await fn(); setBusy(""); if (!r.ok) setErr(r.error || "Something went wrong."); else done(ok, key === "send" || key === "nr" || key === "ign"); };
  // the order confirmation arrives after the order is made: into the empty answer box, never over what's typed
  const confirmAt = x.meta?.reply_options?.at;
  useEffect(() => { if (confirm && !body.trim()) { setSubject(confirm.subject); setBody(confirm.body); setPicked(0); setWriting(true); } }, [confirmAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // the More menu closes when you click anywhere else
  useEffect(() => {
    const off = (e: PointerEvent) => { const m = moreRef.current; if (m?.open && !m.contains(e.target as Node)) m.open = false; };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, []);
  const when = new Date(x.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const filed = orders.find((o) => o.id === x.order_id);
  const fromName = x.meta?.from_name || x.from_email;
  const suggestions: { i: number; label: string; text: string }[] = [
    ...(reply?.draft?.body ? [{ i: -2, label: "AI's draft", text: reply.draft.body }] : []),
    ...(opts || []).map((o, i) => ({ i, label: o.label, text: o.body })),
  ];

  return (
    <div className="ibx2-work" data-side={side}>
      <div className="ibx2-sw" role="tablist" aria-label="Show">
        <button type="button" className="ibx2-back" onClick={back} aria-label="Back to the emails">←</button>
        <button type="button" role="tab" aria-selected={side === "mail"} className={side === "mail" ? "on" : ""} onClick={() => setSide("mail")}>{view === "order" ? "Order" : "Email"}</button>
        <button type="button" role="tab" aria-selected={side === "ai"} className={side === "ai" ? "on" : ""} onClick={() => setSide("ai")}>✦ Assistant</button>
      </div>

      {/* 2. the email (or the order being made from it) */}
      <section className="ibx2-mail" aria-label="The email">
        <header className="ibx2-mh">
          <div className="ibx2-mh-1">
            <button type="button" className="ibx2-listbtn" onClick={toggleList} title={listOpen ? "Hide the list" : "Show the list"} aria-label={listOpen ? "Hide the list" : "Show the list"}>{listOpen ? "⟨" : "☰"}</button>
            <span className="ibx2-who" title={x.from_email}><b>{who}</b>{who !== fromName && <span> · {fromName}</span>}<span> · {x.from_email}</span></span>
            <span className="ibx2-when">{when}</span>
          </div>
          <h2>{x.subject || "(no subject)"}</h2>
          {x.meta?.triage?.summary && <div className="ibx2-sum">✦ {x.meta.triage.summary}</div>}
          <div className="ibx2-meta">
            {urgent && <span className="ibx2-urgent">Urgent{x.meta?.triage?.urgent_reason ? `: ${x.meta.triage.urgent_reason}` : ""}</span>}
            {x.meta?.triage?.intent && INTENT[x.meta.triage.intent] && <span className="ibx2-chip">{INTENT[x.meta.triage.intent]}</span>}
            {x.customer_id && <Link className="ibx2-chip link" href={`/shop/customers/${x.customer_id}`}>Customer</Link>}
            {filed && <Link className="ibx2-chip link" href={`/shop/orders/${filed.id}`}>#{filed.number}</Link>}
            {answered && <span className="ibx2-chip ok">Answered</span>}
          </div>
          {/* the everyday buttons in one row; the rest under More */}
          <div className="ibx2-acts">
            {x.direction !== "in" ? null : view === "order"
              ? <button type="button" className="btn sm" onClick={() => setView("mail")}>← Back to the email</button>
              : <>
                <button type="button" className={"btn sm" + (!orderish || x.order_id ? " primary" : "")} onClick={() => write()}>Reply</button>
                <button type="button" className={"btn sm" + (orderish && !x.order_id ? " primary" : "")} disabled={!!busy} onClick={() => startOrder()} title="The AI reads the email and its attachments and fills in the order (new, or a reorder of a past job) for you to check">{ordering ? "Back to the order" : reorder ? "Create reorder" : "Create order"}</button>
              </>}
            {x.customer_id && <select className="ibx2-file" aria-label="File under an order" value={x.order_id || ""} disabled={!!busy} onChange={(e) => run("ord", () => setEmailOrder(x.id, e.target.value || null), e.target.value ? "Filed under the order." : "Not filed under an order now.")}>
              <option value="">File under…</option>{orders.slice(0, 40).map((o) => <option key={o.id} value={o.id}>#{o.number} {o.nickname || ""} ({o.status})</option>)}
            </select>}
            {needs && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => run("nr", () => markNoReply(x.id), "Off your Needs reply list.")}>No reply needed</button>}
            {x.direction === "in" ? 
            <details className="ibx2-more" ref={moreRef}>
              <summary className="btn sm ghost">More</summary>
              <div className="ibx2-menu">
                {x.direction === "in" && <a href={`/shop/order-goods?email=${x.id}`} target="_blank" rel="noreferrer" onClick={() => { if (moreRef.current) moreRef.current.open = false; }}>Order goods from S&amp;S</a>}
                {!needs && x.meta?.no_reply && <button type="button" disabled={!!busy} onClick={() => run("nr-undo", () => markNoReply(x.id, false), "Back on Needs reply.")}>Needs a reply after all</button>}
                {!needs && !x.meta?.no_reply && answered && <button type="button" disabled={!!busy} onClick={() => run("back", () => putBackInInbox(x.id), "Back in the Inbox.")}>Back to Needs reply</button>}
                <button type="button" disabled={!!busy} onClick={() => run("ign", () => markNotCustomer(x.id), `${x.from_email} won't be read again.`)}>Not a customer (stop reading their email)</button>
              </div>
            </details> : null}
          </div>
          {made && <div className="ibx2-made">Order <b>#{made.number}</b> created. <a href={`/shop/orders/${made.id}`} target="_blank" rel="noreferrer">Open it</a></div>}
          {err && <div className="pv-err">{err}</div>}
        </header>

        {ordering && <div className="ibx2-order" hidden={view !== "order"}>
          <EmailOrderPanel key={`${x.id}:${orderStart?.n || 0}`} activityId={x.id} start={orderStart || undefined}
            onClose={() => { setOrdering(false); setView("mail"); }}
            onCreated={(id, n, opened) => { setOrdering(false); setView("mail"); setMade({ id, number: n }); if (!opened) window.open(`/shop/orders/${id}`, "_blank"); void noteEmailChat(x.id, `Order #${n} created from this email.`, `/shop/orders/${id}`).then(() => setBump((b) => b + 1)); done(`Order #${n} created. Our mockup is being built in a new tab.`); }} />
        </div>}

        {view === "mail" && <>
          <div className="ibx2-read">
            {!x.customer_id && x.direction === "in" && <NewSender x={x} busy={busy} run={run} />}
            <EmailBody x={x} />
            {(x.meta?.attachments || []).length > 0 && <div className="ibx2-files">{x.meta!.attachments!.map((f) => <button key={f.path} type="button" onClick={() => urlFor(f.path)}>📎 {f.name}</button>)}</div>}
            <CanvaGet x={x} busy={busy} run={run} />
            {thread.length > 0 && <details className="ibx2-thread">
              <summary>Earlier in this conversation ({thread.length})</summary>
              {[...thread].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((t) => <div key={t.id} className={"ibx-t " + t.direction}><b>{t.direction === "out" ? "You" : t.meta?.from_name || t.from_email}</b> · {new Date(t.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<div>{t.body.slice(0, 700)}</div></div>)}
            </details>}
          </div>

          {/* the answer, docked at the bottom like Outlook */}
          {x.direction === "in" && <div className={"ibx2-compose" + (writing ? " open" : "")}>
            {suggestions.length > 0 || busy === "opts" ? <div className="ibx2-sugs" role="list" aria-label="Suggested answers">
              {busy === "opts" ? <span className="ibx2-thinking">✦ Thinking of answers…</span> : suggestions.map((s) => (
                <button key={s.i} type="button" role="listitem" className={"ibx2-sug" + (picked === s.i ? " on" : "")} title={s.text.slice(0, 400)} onClick={() => pick(s.i)}>{s.label}</button>
              ))}
              {busy !== "opts" && <button type="button" className="ibx2-sug ghost" disabled={!!busy} onClick={() => loadOpts(!!opts)}>{opts ? "✦ Others" : "✦ Suggest"}</button>}
            </div> : null}
            {!writing ? (
              <button type="button" className="ibx2-replybar" onClick={() => write()}>Reply to {fromName.split(/[\s@]/)[0]}…</button>
            ) : <>
              <div className="ibx2-to"><span>To {x.from_email}</span><input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></div>
              <textarea ref={boxRef} rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your answer, pick one above, or tell the AI what to say below" aria-label="Reply" />
              <form className="ibx2-tell" onSubmit={async (e) => { e.preventDefault(); if (!ask.trim()) return; setBusy("ai"); setErr(""); const r = await aiWriteReply({ activityId: x.id, instruction: ask, subject }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't write that."); else { setSubject(r.subject || subject); setBody(r.body); setPicked(-1); setAsk(""); boxRef.current?.focus(); } }}>
                <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Tell the AI what to say, e.g. “yes, if we get the order by Saturday”" aria-label="Tell the AI what to say" />
                <button type="submit" className="btn sm" disabled={!!busy || !ask.trim()}>{busy === "ai" ? "Writing…" : "✦ Write it"}</button>
              </form>
              <div className="ibx2-send">
                <button type="button" className="btn primary" disabled={!!busy || !body.trim()} onClick={() => run("send", () => sendEmailReply({ activityId: x.id, subject, body, suggestionId: reply?.id }), `Sent to ${x.from_email}.`)}>{busy === "send" ? "Sending…" : "Send"}</button>
                {body.trim() && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={async () => { setBusy("polish"); setErr(""); const r = await aiWriteReply({ activityId: x.id, subject, body }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't rewrite that."); else setBody(r.body); }}>{busy === "polish" ? "Polishing…" : "✦ Polish"}</button>}
                <span className="faint">Your signature and their email go underneath.</span>
                <span className="spacer" />
                <button type="button" className="btn sm ghost" onClick={() => setWriting(false)}>Close</button>
              </div>
            </>}
          </div>}
        </>}
      </section>

      {/* 3. the Assistant: stays open while answering or making the order */}
      <aside className="ibx2-ai" aria-label="Assistant">
        {x.direction === "in"
          ? <EmailChat activityId={x.id} onAction={act} busyOutside={!!busy} bump={bump} summary={x.meta?.triage?.summary} />
          : <div className="ibx2-none">Your sent email.</div>}
      </aside>
    </div>
  );
}

/** A sender who isn't a customer yet: make them one, or add them as a contact at a customer you have. */
/** whether the shop's Canva account is connected (asked once per page load) */
let canvaOnP: Promise<boolean> | null = null;
const canvaOn = () => (canvaOnP ||= fetch("/api/canva/status", { cache: "no-store" }).then((r) => r.json()).then((j: { connected?: boolean }) => !!j.connected).catch(() => false));

/** A Canva link in the email whose design isn't saved yet: export it through the shop's Canva account (lib/linkArt.ts) */
function CanvaGet({ x, busy, run }: { x: Act; busy: string; run: (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => Promise<void> }) {
  const got = new Set((x.meta?.attachments || []).filter((f) => f.source === "canva-export").map((f) => f.from_link));
  const todo = (x.meta?.links || []).filter((l) => l.kind === "canva" && !got.has(l.url));
  const [on, setOn] = useState(false);
  useEffect(() => { if (todo.length) void canvaOn().then(setOn); }, [todo.length]);
  if (!todo.length || !on) return null;
  const err = todo.find((l) => l.error)?.error;
  const get = async () => {
    const r = await fetch("/api/inbox/link-art", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: x.id, force: true }) }).then((r) => r.json()).catch(() => null) as { ok?: boolean; error?: string; found?: { kind: string; saved?: unknown; error?: string }[] } | null;
    if (!r?.ok) return { ok: false, error: r?.error || "Couldn't reach Canva." };
    const bad = (r.found || []).find((f) => f.kind === "canva" && !f.saved);
    return bad ? { ok: false, error: bad.error || "Canva didn't send the design." } : { ok: true };
  };
  return (
    <div className="ibx2-files">
      <button type="button" disabled={!!busy} onClick={() => run("canva", get, "Saved the design from Canva with this email.")}>{busy === "canva" ? "Getting the design from Canva…" : "Get the design from Canva"}</button>
      {err && busy !== "canva" && <span className="faint" style={{ fontSize: 12.5, alignSelf: "center" }}>{err}</span>}
    </div>
  );
}

function NewSender({ x, busy, run }: { x: Act; busy: string; run: (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => Promise<void> }) {
  const [mode, setMode] = useState<"" | "new" | "contact">(""), [company, setCompany] = useState(""), [custQ, setCustQ] = useState(""), [hits, setHits] = useState<Cust[]>([]);
  async function find(q: string) { setCustQ(q); if (q.trim().length < 2) return setHits([]); const s = q.replace(/[,()]/g, ""); const { data } = await createClient().from("customers").select("id, company, name").or(`company.ilike.%${s}%,name.ilike.%${s}%,email.ilike.%${s}%`).limit(8); setHits((data || []) as Cust[]); }
  const first = x.meta?.from_name?.split(" ")[0] || "them";
  return (
    <div className="ibx2-new">
      <span><b>New sender.</b> Not a customer yet.</span>
      {mode === "" && <>
        <button type="button" className="btn sm" onClick={() => setMode("new")}>Make them a customer</button>
        <button type="button" className="btn sm ghost" onClick={() => setMode("contact")}>Add to a customer</button>
      </>}
      {mode === "new" && <>
        <input placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="New customer company" autoFocus />
        <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => run("new", () => customerFromEmail(x.id, company), "New customer made from the email.")}>Make customer</button>
        <button type="button" className="btn sm ghost" onClick={() => setMode("")}>Cancel</button>
      </>}
      {mode === "contact" && <span className="ibx2-pick">
        <input placeholder={`Which customer is ${first} at?`} value={custQ} onChange={(e) => find(e.target.value)} aria-label="Find the customer they work for" autoFocus />
        {hits.length > 0 && <span className="ibx-hits">{hits.map((c) => <button key={c.id} type="button" onClick={() => run("cust", () => setEmailCustomer(x.id, c.id), `${x.meta?.from_name || x.from_email} is now a contact at ${c.company || c.name}.`)}>{c.company || c.name}</button>)}</span>}
        <button type="button" className="btn sm ghost" onClick={() => setMode("")}>Cancel</button>
      </span>}
    </div>
  );
}

/**
 * The email as Outlook shows it: its own formatting, signature and pictures, in a locked-down frame (no scripts run;
 * links open in a new tab). Pictures sent inside the email come from our private copy; email stored before we kept
 * the formatting shows as plain text until the next mailbox check fills it in.
 */
/**
 * An email with no saved formatting, shown like Outlook would: the whole text (no box with its own scrollbar),
 * Gmail's hard line breaks joined back into paragraphs, and "[image: name.png]" replaced by that picture.
 */
function PlainBody({ x }: { x: Act }) {
  const [pics, setPics] = useState<Record<string, string>>({});
  const imgs = (x.meta?.attachments || []).filter((f) => /^image\//.test(f.type));
  useEffect(() => {
    let live = true;
    if (!imgs.length) return;
    createClient().storage.from("proofs").createSignedUrls(imgs.map((f) => f.path), 3600).then(({ data }) => {
      if (!live) return;
      const m: Record<string, string> = {};
      imgs.forEach((f) => { const u = data?.find((r) => r.path === f.path)?.signedUrl; if (u) m[f.name.toLowerCase()] = u; });
      setPics(m);
    });
    return () => { live = false; };
  }, [x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // join lines a mail program wrapped at ~76 characters back into paragraphs
  const lines = String(x.body || "").replace(/\r/g, "").split("\n"), out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev != null && prev.length >= 55 && prev.length <= 80 && l.trim() && !/^\s*([-*•>]|\d+[.)]|\[image:)/.test(l) && !/[:]$/.test(prev)) out[out.length - 1] = `${prev} ${l.trim()}`;
    else out.push(l);
  }
  const text = out.join("\n");
  const parts = text.split(/(\[image: [^\]]+\])/g);
  return (
    <div className="ibx2-plain">
      {parts.map((p, i) => {
        const m = p.match(/^\[image: ([^\]]+)\]$/);
        if (m) { const u = pics[m[1].toLowerCase()]; return u ? <img key={i} src={u} alt={m[1]} /> : <span key={i} className="faint">[{m[1]}]</span>; }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

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
  // the frame grows to the whole email (the pane scrolls, not a box inside it)
  const fit = () => { const d = ref.current?.contentDocument; if (d?.body) setH(Math.min(20000, Math.max(120, d.documentElement.scrollHeight + 4))); };
  if (!x.meta?.html || plain || doc == null) return (
    <div>
      <PlainBody x={x} />
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
