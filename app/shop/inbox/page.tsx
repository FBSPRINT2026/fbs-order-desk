"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { mailRows } from "@/lib/inbox";
import { checkMailNow, connectMailbox, customerFromEmail, disconnectMailbox, getMailStatus, getSignature, markNotCustomer, refreshSignature, sendEmailReply, setEmailCustomer, setEmailOrder, setSignatureOn } from "../mail-actions";
import { aiReplyOptions, aiWriteReply, markNoReply, quoteFromSuggestion } from "../ai-actions";

/**
 * Inbox: the customer email from the shop mailbox (Nicholas's), sorted by what needs an answer. Vendors, newsletters
 * and personal mail never get here (they're skipped, not stored). Each email: who it's from, the order it's about,
 * the AI's one-line summary, a drafted reply to edit and send (from nicholas@fbsprint.com, in the same thread), and
 * buttons to make a quote, file it under an order, or sort the sender.
 */
type Act = { id: string; customer_id: string | null; order_id: string | null; direction: string; subject: string; body: string; from_email: string; to_email: string; external_id: string | null; thread_id: string | null; occurred_at: string; meta: { account_id?: string; account?: string; from_name?: string; lead?: boolean; ignored?: boolean; no_reply?: boolean; match?: string; references?: string[]; attachments?: { name: string; path: string; type: string; size: number }[]; html?: string; inline?: Record<string, string>; triage?: { intent?: string; summary?: string; urgency?: string; needs_reply?: boolean } } };
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
      setOpen(id); setFocus(id);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [acts, st]); // eslint-disable-line react-hooks/exhaustive-deps
  const scoped = whose === "mine" && mineId ? rows.filter((r) => r.x.meta?.account_id === mineId) : rows;
  const shown = scoped.filter((r) => (tab === "reply" ? r.needs : tab === "leads" ? r.x.meta?.lead && !r.x.customer_id : true));
  const counts = { reply: scoped.filter((r) => r.needs).length, leads: scoped.filter((r) => r.x.meta?.lead && !r.x.customer_id).length, all: scoped.length };
  const today = st?.mine?.stats ? st.mine.stats[new Date().toISOString().slice(0, 10)] || {} : {};

  const who = (x: Act) => { const c = x.customer_id ? custs.get(x.customer_id) : null; return c ? c.company || c.name || x.from_email : `${x.meta?.from_name || x.from_email}`; };
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Sales</div><h1>Inbox</h1></div>
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {st?.mine?.enabled && <span className="faint" style={{ fontSize: 13 }}>{st.mine.email} · checked {st.mine.last_ok_at ? ago(st.mine.last_ok_at) : "not yet"}</span>}
          {st?.mine?.enabled && <button type="button" className="btn" disabled={!!busy} onClick={async () => { setBusy("check"); const r = await checkMailNow(); setBusy(""); if (!r.ok) flash(r.error); else { flash("Checked."); load(); } }}>{busy === "check" ? "Checking…" : "Check now"}</button>}
          {st && <button type="button" className="btn" onClick={() => setConnecting(!connecting)}>{st.mine?.enabled ? "My email settings" : "Connect my email"}</button>}
        </div>
      </div>
      {st && (connecting || !st.mine?.enabled) && <Connect st={st} onDone={(t) => { setConnecting(false); flash(t); load(); }} />}
      {st?.mine?.enabled && st.mine.last_error && <div className="pv-err" style={{ marginBottom: 12 }}>{st.mine.last_error}</div>}
      {st && st.all.length > 0 && <div className="faint ibx-boxes">Connected: {st.all.map((b) => <span key={b.id} className={b.enabled ? (b.last_error ? "bad" : "ok") : "off"} title={b.last_error || (b.last_ok_at ? `checked ${ago(b.last_ok_at)}` : "")}>{b.email}{!b.enabled ? " (off)" : b.last_error ? " (problem)" : ""}</span>)}</div>}
      {msg && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 10 }}>{msg}</div>}
      <section className="panel"><div className="panel-b stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "reply"} className={"chip" + (tab === "reply" ? " on" : "")} onClick={() => setTab("reply")}>Needs a reply ({counts.reply})</button>
          <button type="button" role="tab" aria-selected={tab === "leads"} className={"chip" + (tab === "leads" ? " on" : "")} onClick={() => setTab("leads")}>New leads ({counts.leads})</button>
          <button type="button" role="tab" aria-selected={tab === "all"} className={"chip" + (tab === "all" ? " on" : "")} onClick={() => setTab("all")}>All customer email ({counts.all})</button>
          <span className="ibx-whose">{mineId && <><button type="button" className={"chip sm" + (whose === "mine" ? " on" : "")} onClick={() => setWhose("mine")}>Mine</button><button type="button" className={"chip sm" + (whose === "everyone" ? " on" : "")} onClick={() => setWhose("everyone")}>Everyone</button></>}</span>
          {st?.mine?.enabled && <span className="faint" style={{ fontSize: 12.5, marginLeft: "auto" }}>Today: {(today.inbox_customer || 0)} customer · {(today.inbox_lead || 0)} leads · {(today.inbox_skipped || 0)} skipped (not customers)</span>}
        </div>
        {!acts ? <div className="faint">Loading…</div> : !shown.length ? <div className="faint">{tab === "reply" ? "Nothing waiting on you." : tab === "leads" ? "No new leads." : "No customer email in the last 30 days yet."}</div> : (
          <div className="ibx-list">{shown.map(({ x, answered, reply, quote, needs }) => {
            const waitH = (Date.now() - new Date(x.occurred_at).getTime()) / 36e5;
            const ord = orders.find((o) => o.id === x.order_id);
            return (
              <div key={x.id} className={"ibx-row" + (open === x.id ? " on" : "")}>
                <button type="button" className="ibx-head" onClick={() => setOpen(open === x.id ? null : x.id)} onDoubleClick={() => { setOpen(x.id); setFocus(x.id); }} title="Double-click to answer it" aria-expanded={open === x.id}>
                  <span className={"ibx-dot" + (needs ? (waitH > 24 ? " late" : " due") : answered ? " ok" : "")} aria-hidden />
                  <span className="ibx-who"><b>{who(x)}</b>{x.meta?.lead && !x.customer_id && <span className="tag">Lead</span>}{x.meta?.triage?.intent && INTENT[x.meta.triage.intent] && <span className="tag soft">{INTENT[x.meta.triage.intent]}</span>}</span>
                  <span className="ibx-sub"><b>{x.subject || "(no subject)"}</b>{x.meta?.triage?.summary && <small>{x.meta.triage.summary}</small>}</span>
                  <span className="ibx-when">{ord ? <span className="tag soft">#{ord.number}</span> : null}{(x.meta?.attachments || []).length > 0 && <span title="Attachments">📎{x.meta!.attachments!.length}</span>}<span className={needs && waitH > 24 ? "inv-warn" : "faint"}>{ago(x.occurred_at)}</span>{answered && <span className="faint">· answered</span>}</span>
                </button>
                {open === x.id && <Detail key={x.id + (focus === x.id ? ":f" : "")} focus={focus === x.id} x={x} reply={reply} quote={quote} needs={needs} orders={orders.filter((o) => o.customer_id && o.customer_id === x.customer_id)} thread={(acts || []).filter((o) => o.id !== x.id && ((o.thread_id && (o.thread_id === x.thread_id || o.thread_id === x.external_id)) || (x.external_id && (o.meta?.references || []).includes(x.external_id))))}
                  busy={busy} setBusy={setBusy} done={(t) => { flash(t); load(); }} />}
              </div>
            );
          })}</div>
        )}
      </div></section>
    </>
  );
}

type Opt = { label: string; subject: string; body: string };
const OPTS = new Map<string, Opt[]>(); // reply options already written, per email (this visit)

function Detail({ x, reply, quote, needs, focus, orders, thread, busy, setBusy, done }: { x: Act; reply?: Sug; quote?: Sug; needs: boolean; focus: boolean; orders: Ord[]; thread: Act[]; busy: string; setBusy: (s: string) => void; done: (msg: string) => void }) {
  const [subject, setSubject] = useState(reply?.draft?.subject || (x.subject?.toLowerCase().startsWith("re:") ? x.subject : `Re: ${x.subject || ""}`));
  const [body, setBody] = useState(reply?.draft?.body || "");
  const [err, setErr] = useState(""), [company, setCompany] = useState(""), [custQ, setCustQ] = useState(""), [hits, setHits] = useState<Cust[]>([]);
  const [opts, setOpts] = useState<Opt[] | null>(OPTS.get(x.id) || null), [picked, setPicked] = useState(-1), [ask, setAsk] = useState("");
  const replyRef = useRef<HTMLDivElement | null>(null), boxRef = useRef<HTMLTextAreaElement | null>(null);
  async function loadOpts() {
    setBusy("opts"); setErr("");
    const r = await aiReplyOptions(x.id);
    setBusy("");
    if (!r.ok) return setErr(r.error || "The AI couldn't come up with answers.");
    OPTS.set(x.id, r.options); setOpts(r.options); setPicked(-1);
  }
  function pick(i: number) { const o = opts?.[i]; if (!o) return; setPicked(i); setSubject(o.subject); setBody(o.body); boxRef.current?.focus(); }
  // double-clicked (or opened from the dashboard): straight to the reply, with answers to pick from
  useEffect(() => {
    if (!focus) return;
    setTimeout(() => { replyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); boxRef.current?.focus(); }, 80);
    if (!OPTS.has(x.id) && !busy) loadOpts();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  async function urlFor(path: string) { const { data } = await createClient().storage.from("proofs").createSignedUrl(path, 600); if (data?.signedUrl) window.open(data.signedUrl, "_blank"); }
  async function find(q: string) { setCustQ(q); if (q.trim().length < 2) return setHits([]); const { data } = await createClient().from("customers").select("id, company, name").or(`company.ilike.%${q.replace(/[,()]/g, "")}%,name.ilike.%${q.replace(/[,()]/g, "")}%,email.ilike.%${q.replace(/[,()]/g, "")}%`).limit(8); setHits((data || []) as Cust[]); }
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => { setBusy(key); setErr(""); const r = await fn(); setBusy(""); if (!r.ok) setErr(r.error || "Something went wrong."); else done(ok); };
  return (
    <div className="ibx-detail">
      <div className="faint" style={{ fontSize: 12.5 }}>From {x.meta?.from_name ? `${x.meta.from_name} <${x.from_email}>` : x.from_email} · {new Date(x.occurred_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{x.meta?.match === "domain" ? " · matched by their company's email domain" : x.meta?.match === "thread" ? " · a reply in a thread we have" : ""}</div>
      <EmailBody x={x} />
      {(x.meta?.attachments || []).length > 0 && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{x.meta!.attachments!.map((f) => <button key={f.path} type="button" className="btn sm" onClick={() => urlFor(f.path)}>📎 {f.name}</button>)}</div>}
      {thread.length > 0 && <div className="ibx-thread">{thread.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((t) => <div key={t.id} className={"ibx-t " + t.direction}><b>{t.direction === "out" ? "You" : t.meta?.from_name || t.from_email}</b> · {new Date(t.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}<div>{t.body.slice(0, 600)}</div></div>)}</div>}
      <div className="ibx-reply" ref={replyRef}>
        <div className="ibx-opts">
          <button type="button" className="btn sm" disabled={!!busy} onClick={loadOpts}>{busy === "opts" ? "Thinking of answers…" : opts ? "✦ Other answers" : "✦ Reply options"}</button>
          {opts?.map((o, i) => <button key={i} type="button" className={"chip" + (picked === i ? " on" : "")} onClick={() => pick(i)} title={o.body.slice(0, 300)}>{o.label}</button>)}
          {!opts && busy !== "opts" && <span className="faint" style={{ fontSize: 12.5 }}>3–4 ways to answer (yes, no, yes if…), each written out. Pick one and edit it.</span>}
        </div>
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
        <textarea ref={boxRef} rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply, pick an answer above, or tell the AI what to say below" aria-label="Reply" />
        <form className="ibx-tell" onSubmit={async (e) => { e.preventDefault(); if (!ask.trim()) return; setBusy("ai"); setErr(""); const r = await aiWriteReply({ activityId: x.id, instruction: ask, subject }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't write that."); else { setSubject(r.subject || subject); setBody(r.body); setPicked(-1); setAsk(""); boxRef.current?.focus(); } }}>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Tell the AI what to say, e.g. “yes, if we get the order by Saturday”" aria-label="Tell the AI what to say" />
          <button type="submit" className="btn sm" disabled={!!busy || !ask.trim()}>{busy === "ai" ? "Writing…" : "✦ Write it"}</button>
        </form>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn primary sm" disabled={!!busy || !body.trim()} onClick={() => run("send", () => sendEmailReply({ activityId: x.id, subject, body, suggestionId: reply?.id }), `Sent to ${x.from_email}.`)}>{busy === "send" ? "Sending…" : "Send reply"}</button>
          {body.trim() && <button type="button" className="btn sm ghost" disabled={!!busy} onClick={async () => { setBusy("polish"); setErr(""); const r = await aiWriteReply({ activityId: x.id, subject, body }); setBusy(""); if (!r.ok) setErr(r.error || "The AI couldn't rewrite that."); else setBody(r.body); }}>{busy === "polish" ? "Polishing…" : "✦ Polish"}</button>}
          {needs ? <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => run("nr", () => markNoReply(x.id), "Off your Needs a reply list.")}>No reply needed</button>
            : x.meta?.no_reply ? <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => run("nr", () => markNoReply(x.id, false), "Back on Needs a reply.")}>Needs a reply after all</button> : null}
          <span className="faint" style={{ fontSize: 12 }}>Sends from your mailbox in the same thread, with your signature and their email quoted, and saves to Sent Items.</span>
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
          <span className="faint">or add {x.meta?.from_name?.split(" ")[0] || "them"} as a contact at</span>
          <span className="ibx-find"><input className="ibx-in" placeholder="Find a customer…" value={custQ} onChange={(e) => find(e.target.value)} aria-label="Find the customer they work for" />
            {hits.length > 0 && <span className="ibx-hits">{hits.map((c) => <button key={c.id} type="button" onClick={() => run("cust", () => setEmailCustomer(x.id, c.id), `${x.meta?.from_name || x.from_email} is now a contact at ${c.company || c.name}. Their email will file there from now on.`)}>{c.company || c.name}</button>)}</span>}</span>
        </>}
        <button type="button" className="btn sm ghost" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={() => run("ign", () => markNotCustomer(x.id), `${x.from_email} won't be read again.`)}>Not a customer</button>
      </div>
      {err && <div className="pv-err">{err}</div>}
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
      const head = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; form-action 'none'"><style>html,body{margin:0;padding:10px 12px;font:14px/1.45 Calibri,Segoe UI,Arial,sans-serif;color:#222;background:#fff;overflow-x:auto}img{max-width:100%;height:auto}table{max-width:100%}</style>`;
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
    <section className="panel ibx-connect"><form className="panel-b stack" style={{ gap: 10 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); const r = await connectMailbox({ email, password: pw, name, host }); setBusy(false); setPw(""); if (!r.ok) setErr(r.error); else onDone("Your email is connected. Customer email will show up within a couple of minutes."); }}>
      <div><b>{st.mine?.enabled ? "Your email" : "Connect your email"}</b><div className="faint" style={{ fontSize: 13 }}>The portal reads your Inbox and Sent Items every 2 minutes and keeps only customer email. Replies you send from here go out from your address and land in your Sent Items. Your password is checked with the mail server, then stored encrypted; nobody can see it.</div></div>
      <div className="ibx-form">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>Your name (signs replies)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nicholas" /></label>
        <label>Email password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
      </div>
      <div className="faint" style={{ fontSize: 12.5 }}>IMAP has to be ticked for your mailbox in HostPilot first (Services → Exchange → your name → Advanced Settings); the owner can do that for everyone.</div>
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
        ? <iframe ref={ref} title="Your signature" sandbox="allow-same-origin" srcDoc={`<style>html,body{margin:0;padding:10px 12px;background:#fff}img{max-width:100%;height:auto}${sig.css}</style><div class="WordSection1">${sig.html}</div>`} style={{ height: h, opacity: sig.on ? 1 : 0.45 }} onLoad={() => { fit(); setTimeout(fit, 400); }} />
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
