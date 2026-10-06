"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { checkMailNow, customerFromEmail, getMailStatus, markNotCustomer, sendEmailReply, setEmailCustomer, setEmailOrder } from "../mail-actions";
import { aiRewriteDraft, quoteFromSuggestion } from "../ai-actions";

/**
 * Inbox: the customer email from the shop mailbox (Nicholas's), sorted by what needs an answer. Vendors, newsletters
 * and personal mail never get here (they're skipped, not stored). Each email: who it's from, the order it's about,
 * the AI's one-line summary, a drafted reply to edit and send (from nicholas@fbsprint.com, in the same thread), and
 * buttons to make a quote, file it under an order, or sort the sender.
 */
type Act = { id: string; customer_id: string | null; order_id: string | null; direction: string; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; meta: { from_name?: string; lead?: boolean; ignored?: boolean; match?: string; references?: string[]; attachments?: { name: string; path: string; type: string; size: number }[]; triage?: { intent?: string; summary?: string; urgency?: string; needs_reply?: boolean } } };
type Sug = { id: string; kind: string; status: string; activity_id: string | null; title: string; body: string; draft: { subject?: string; body?: string } | null; payload: { groups?: unknown[] } | null; order_id: string | null };
type Cust = { id: string; company: string | null; name: string | null };
type Ord = { id: string; number: number; nickname: string | null; customer_id: string | null; status: string };
type Status = { ready: boolean; mailbox: string; last_ok_at?: string | null; last_error?: string | null; last_run_at?: string | null; stats?: Record<string, Record<string, number>> };

const ago = (t: string) => { const m = (Date.now() - new Date(t).getTime()) / 60000; return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const INTENT: Record<string, string> = { new_order: "New order", reorder: "Reorder", change_to_order: "Order change", artwork: "Artwork", payment: "Payment", question: "Question", other: "Other" };

export default function Inbox() {
  const [st, setSt] = useState<Status | null>(null);
  const [acts, setActs] = useState<Act[] | null>(null), [sugs, setSugs] = useState<Sug[]>([]), [custs, setCusts] = useState<Map<string, Cust>>(new Map()), [orders, setOrders] = useState<Ord[]>([]);
  const [tab, setTab] = useSticky<"reply" | "leads" | "all">("inbox.tab", "reply");
  const [open, setOpen] = useState<string | null>(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");

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

  // answered = we sent something later in the same thread
  const rows = useMemo(() => {
    const out = (acts || []).filter((x) => x.direction === "out");
    return (acts || []).filter((x) => x.direction === "in").map((x) => {
      const answered = out.some((o) => o.occurred_at > x.occurred_at && ((x.external_id && (o.meta?.references || []).includes(x.external_id)) || (o.thread_id && (o.thread_id === x.thread_id || o.thread_id === x.external_id))));
      const mine = sugs.filter((s) => s.activity_id === x.id);
      const reply = mine.find((s) => s.kind === "email_reply" && (s.status === "open" || s.status === "snoozed"));
      const quote = mine.find((s) => s.kind === "draft_order" && s.status === "open");
      const needs = !answered && (!!reply || !!quote || x.meta?.triage?.needs_reply === true);
      return { x, answered, reply, quote, needs };
    });
  }, [acts, sugs]);
  const shown = rows.filter((r) => (tab === "reply" ? r.needs : tab === "leads" ? r.x.meta?.lead && !r.x.customer_id : true));
  const counts = { reply: rows.filter((r) => r.needs).length, leads: rows.filter((r) => r.x.meta?.lead && !r.x.customer_id).length, all: rows.length };
  const today = st?.stats ? Object.values(st.stats)[0] || {} : {};

  const who = (x: Act) => { const c = x.customer_id ? custs.get(x.customer_id) : null; return c ? c.company || c.name || x.from_email : `${x.meta?.from_name || x.from_email}`; };
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Sales</div><h1>Inbox</h1></div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="faint" style={{ fontSize: 13 }}>{!st ? "" : !st.ready ? "Mailbox not connected" : st.last_error ? "" : `${st.mailbox} · checked ${st.last_ok_at ? ago(st.last_ok_at) : "not yet"}`}</span>
          <button type="button" className="btn" disabled={!!busy || !st?.ready} onClick={async () => { setBusy("check"); const r = await checkMailNow(); setBusy(""); if (!r.ok) flash(r.error); else { flash("Checked."); load(); } }}>{busy === "check" ? "Checking…" : "Check now"}</button>
        </div>
      </div>
      {st && !st.ready && <div className="ink-none" style={{ marginBottom: 12 }}><b>Connect the mailbox</b><span>In Vercel → Settings → Environment Variables, add <b>MAIL_PASSWORD</b> (the password for {st.mailbox}). If HostPilot shows different server names than east.exch021.serverdata.net, add <b>MAIL_IMAP_HOST</b> and <b>MAIL_SMTP_HOST</b> too, and make sure IMAP is ticked for the mailbox (HostPilot → Services → Mailboxes → your name → Advanced Settings). Redeploy and the Inbox fills in within a couple of minutes.</span></div>}
      {st?.ready && st.last_error && <div className="pv-err" style={{ marginBottom: 12 }}>{st.last_error}</div>}
      {msg && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 10 }}>{msg}</div>}
      <section className="panel"><div className="panel-b stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "reply"} className={"chip" + (tab === "reply" ? " on" : "")} onClick={() => setTab("reply")}>Needs a reply ({counts.reply})</button>
          <button type="button" role="tab" aria-selected={tab === "leads"} className={"chip" + (tab === "leads" ? " on" : "")} onClick={() => setTab("leads")}>New leads ({counts.leads})</button>
          <button type="button" role="tab" aria-selected={tab === "all"} className={"chip" + (tab === "all" ? " on" : "")} onClick={() => setTab("all")}>All customer email ({counts.all})</button>
          {st?.ready && <span className="faint" style={{ fontSize: 12.5, marginLeft: "auto" }}>Today: {(today.inbox_customer || 0)} customer · {(today.inbox_lead || 0)} leads · {(today.inbox_skipped || 0)} skipped (not customers)</span>}
        </div>
        {!acts ? <div className="faint">Loading…</div> : !shown.length ? <div className="faint">{tab === "reply" ? "Nothing waiting on you." : tab === "leads" ? "No new leads." : "No customer email in the last 30 days yet."}</div> : (
          <div className="ibx-list">{shown.map(({ x, answered, reply, quote, needs }) => {
            const waitH = (Date.now() - new Date(x.occurred_at).getTime()) / 36e5;
            const ord = orders.find((o) => o.id === x.order_id);
            return (
              <div key={x.id} className={"ibx-row" + (open === x.id ? " on" : "")}>
                <button type="button" className="ibx-head" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
                  <span className={"ibx-dot" + (needs ? (waitH > 24 ? " late" : " due") : answered ? " ok" : "")} aria-hidden />
                  <span className="ibx-who"><b>{who(x)}</b>{x.meta?.lead && !x.customer_id && <span className="tag">Lead</span>}{x.meta?.triage?.intent && INTENT[x.meta.triage.intent] && <span className="tag soft">{INTENT[x.meta.triage.intent]}</span>}</span>
                  <span className="ibx-sub"><b>{x.subject || "(no subject)"}</b>{x.meta?.triage?.summary && <small>{x.meta.triage.summary}</small>}</span>
                  <span className="ibx-when">{ord ? <span className="tag soft">#{ord.number}</span> : null}{(x.meta?.attachments || []).length > 0 && <span title="Attachments">📎{x.meta!.attachments!.length}</span>}<span className={needs && waitH > 24 ? "inv-warn" : "faint"}>{ago(x.occurred_at)}</span>{answered && <span className="faint">· answered</span>}</span>
                </button>
                {open === x.id && <Detail x={x} reply={reply} quote={quote} orders={orders.filter((o) => o.customer_id && o.customer_id === x.customer_id)} thread={(acts || []).filter((o) => o.id !== x.id && ((o.thread_id && (o.thread_id === x.thread_id || o.thread_id === x.external_id)) || (x.external_id && (o.meta?.references || []).includes(x.external_id))))}
                  busy={busy} setBusy={setBusy} done={(t) => { flash(t); load(); }} />}
              </div>
            );
          })}</div>
        )}
      </div></section>
    </>
  );
}

function Detail({ x, reply, quote, orders, thread, busy, setBusy, done }: { x: Act; reply?: Sug; quote?: Sug; orders: Ord[]; thread: Act[]; busy: string; setBusy: (s: string) => void; done: (msg: string) => void }) {
  const [subject, setSubject] = useState(reply?.draft?.subject || (x.subject?.toLowerCase().startsWith("re:") ? x.subject : `Re: ${x.subject || ""}`));
  const [body, setBody] = useState(reply?.draft?.body || "");
  const [err, setErr] = useState(""), [company, setCompany] = useState(""), [custQ, setCustQ] = useState(""), [hits, setHits] = useState<Cust[]>([]);
  async function urlFor(path: string) { const { data } = await createClient().storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }
  async function find(q: string) { setCustQ(q); if (q.trim().length < 2) return setHits([]); const { data } = await createClient().from("customers").select("id, company, name").or(`company.ilike.%${q.replace(/[,()]/g, "")}%,name.ilike.%${q.replace(/[,()]/g, "")}%,email.ilike.%${q.replace(/[,()]/g, "")}%`).limit(8); setHits((data || []) as Cust[]); }
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => { setBusy(key); setErr(""); const r = await fn(); setBusy(""); if (!r.ok) setErr(r.error || "Something went wrong."); else done(ok); };
  return (
    <div className="ibx-detail">
      <div className="faint" style={{ fontSize: 12.5 }}>From {x.meta?.from_name ? `${x.meta.from_name} <${x.from_email}>` : x.from_email} · {new Date(x.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{x.meta?.match === "domain" ? " · matched by their company's email domain" : x.meta?.match === "thread" ? " · a reply in a thread we have" : ""}</div>
      <pre className="ibx-body">{x.body}</pre>
      {(x.meta?.attachments || []).length > 0 && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{x.meta!.attachments!.map((f) => <button key={f.path} type="button" className="btn sm" onClick={() => urlFor(f.path)}>📎 {f.name}</button>)}</div>}
      {thread.length > 0 && <div className="ibx-thread">{thread.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((t) => <div key={t.id} className={"ibx-t " + t.direction}><b>{t.direction === "out" ? "You" : t.meta?.from_name || t.from_email}</b> · {new Date(t.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<div>{t.body.slice(0, 600)}</div></div>)}</div>}
      <div className="ibx-reply">
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
        <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply, or ask the AI to draft one" aria-label="Reply" />
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn primary sm" disabled={!!busy || !body.trim()} onClick={() => run("send", () => sendEmailReply({ activityId: x.id, subject, body, suggestionId: reply?.id }), `Sent to ${x.from_email}.`)}>{busy === "send" ? "Sending…" : "Send reply"}</button>
          <button type="button" className="btn sm ghost" disabled={!!busy} onClick={async () => { setBusy("ai"); setErr(""); const r = await aiRewriteDraft({ purpose: `Reply to this email from ${x.meta?.from_name || x.from_email}: "${x.subject}". ${x.body.slice(0, 2500)}`, orderId: x.order_id, customerId: x.customer_id, subject, body }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't write that."); else { setSubject(r.subject || subject); setBody(r.body); } }}>{busy === "ai" ? "Writing…" : body ? "✦ Rewrite with AI" : "✦ Draft with AI"}</button>
          <span className="faint" style={{ fontSize: 12 }}>Sends from your mailbox in the same thread, with their message quoted, and saves to Sent Items.</span>
        </div>
      </div>
      <div className="row ibx-acts" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {quote && x.customer_id && <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => run("quote", async () => { const r = await quoteFromSuggestion(quote.id); if (r.ok) window.open(`/shop/orders/${r.id}`, "_blank"); return r; }, "Quote created from the email.")}>Create quote from email</button>}
        {x.customer_id && <select aria-label="File under an order" value={x.order_id || ""} disabled={!!busy} onChange={(e) => run("ord", () => setEmailOrder(x.id, e.target.value || null), "Filed under the order.")}>
          <option value="">Not about an order</option>{orders.slice(0, 40).map((o) => <option key={o.id} value={o.id}>#{o.number} {o.nickname || ""} ({o.status})</option>)}
        </select>}
        {x.customer_id && <Link className="btn sm" href={`/shop/customers/${x.customer_id}`}>Customer</Link>}
        {x.order_id && <Link className="btn sm" href={`/shop/orders/${x.order_id}`}>Order</Link>}
        {!x.customer_id && <>
          <input className="ibx-in" placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="New customer company" />
          <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => run("new", () => customerFromEmail(x.id, company), "New customer made from the email.")}>Make them a customer</button>
          <span className="faint">or it&apos;s</span>
          <span className="ibx-find"><input className="ibx-in" placeholder="Find a customer…" value={custQ} onChange={(e) => find(e.target.value)} aria-label="Find customer" />
            {hits.length > 0 && <span className="ibx-hits">{hits.map((c) => <button key={c.id} type="button" onClick={() => run("cust", () => setEmailCustomer(x.id, c.id), `Now filed under ${c.company || c.name}. Their future email will be too.`)}>{c.company || c.name}</button>)}</span>}</span>
        </>}
        <button type="button" className="btn sm ghost" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={() => run("ign", () => markNotCustomer(x.id), `${x.from_email} won't be read again.`)}>Not a customer</button>
      </div>
      {err && <div className="pv-err">{err}</div>}
    </div>
  );
}
