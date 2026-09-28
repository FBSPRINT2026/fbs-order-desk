"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings, type Settings, type Suggestion } from "@/lib/pricing";
import { applyDecisions, computeFollowUps, KIND_INFO, loadAssistantData, loadDecisions, type FollowUp } from "@/lib/crm/followups";
import { custLabel, fmtStamp } from "@/lib/format";
import { staffCustomerMessage, staffMessage } from "@/app/shop/actions";
import { addEmailToTimeline, aiRewriteDraft, getAiStatus, quoteFromSuggestion } from "@/app/shop/ai-actions";

type Group = "All" | "Reply" | "Quotes" | "Artwork" | "Money" | "Production" | "Relationships" | "AI & to-dos";
const GROUPS: Group[] = ["All", "Reply", "Quotes", "Artwork", "Money", "Production", "Relationships", "AI & to-dos"];
const PRI = { 1: "Urgent", 2: "Today", 3: "When you can" } as const;

/** One row the page can show: a rule follow-up or a saved suggestion (AI or a staff to-do). */
type Item = { id: string; key: string | null; kind: string; group: Group; priority: 1 | 2 | 3; title: string; body: string; customer: string; customer_id: string | null; order_id: string | null; href: string | null;
  draft?: { subject?: string; body?: string }; channel: "order" | "customer" | "none"; since: string; saved?: Suggestion; until?: string; fromEmail?: string };

export default function AssistantPage() {
  const router = useRouter();
  const sb = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  const [rules, setRules] = useState<FollowUp[]>([]);
  const [saved, setSaved] = useState<Suggestion[]>([]);
  const [custNames, setCustNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [group, setGroup] = useState<Group>("All");
  const [me, setMe] = useState("");
  const [ai, setAi] = useState<{ ready: boolean; reason: string }>({ ready: false, reason: "" });
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [flash, setFlash] = useState("");
  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 4000); };

  const load = useCallback(async () => {
    try {
      const [data, st, sg, dec, u] = await Promise.all([
        loadAssistantData(sb),
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
        sb.from("ai_suggestions").select("*").neq("source", "rules").in("status", ["open", "snoozed"]).order("created_at", { ascending: false }).limit(1000),
        loadDecisions(sb),
        sb.auth.getUser(),
      ]);
      const s = mergeSettings(st.data?.data);
      setSettings(s);
      setRules(computeFollowUps(data, s));
      // rule decisions only need key + status; AI suggestions and to-dos come in full
      setSaved([...((sg.data || []) as Suggestion[]), ...dec.map((d) => ({ ...d, source: "rules", id: "k:" + d.dedupe_key }) as unknown as Suggestion)]);
      setCustNames(Object.fromEntries(data.customers.map((c) => [c.id, custLabel(c)])));
      setMe(u.data.user?.email || "");
      if (sg.error) setErr(sg.error.message.includes("ai_suggestions") ? "The Assistant's table isn't in the database yet." : sg.error.message);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [sb]);
  useEffect(() => { load(); getAiStatus().then((r) => { if (r.ok) setAi({ ready: r.ready, reason: r.reason }); }); }, [load]);

  const { open, snoozed } = useMemo(() => {
    const now = Date.now();
    const d = applyDecisions(rules, saved.filter((x) => x.source === "rules"), now);
    const fromRule = (f: FollowUp & { until?: string }): Item => ({ id: f.key, key: f.key, kind: f.kind, group: KIND_INFO[f.kind].group, priority: f.priority, title: f.title, body: f.body, customer: f.customer,
      customer_id: f.customer_id, order_id: f.order_id, href: f.href, draft: f.draft, channel: f.channel, since: f.since, until: f.until });
    const fromSaved = (x: Suggestion): Item => ({ id: x.id, key: x.dedupe_key, kind: x.kind, group: "AI & to-dos", priority: x.priority, title: x.title, body: x.body, customer: x.customer_id ? custNames[x.customer_id] || "" : "",
      customer_id: x.customer_id, order_id: x.order_id, href: x.order_id ? `/shop/orders/${x.order_id}` : x.customer_id ? `/shop/customers/${x.customer_id}` : null,
      draft: x.draft?.body ? x.draft : undefined, channel: x.order_id ? "order" : x.customer_id ? "customer" : "none", since: x.created_at, saved: x, until: x.snoozed_until || undefined,
      fromEmail: typeof x.payload?.from_email === "string" ? (x.payload.from_email as string) : undefined });
    const extra = saved.filter((x) => x.source !== "rules");
    const extraOpen = extra.filter((x) => x.status === "open" || (x.status === "snoozed" && (!x.snoozed_until || new Date(x.snoozed_until).getTime() <= now))).map(fromSaved);
    const extraSnoozed = extra.filter((x) => x.status === "snoozed" && x.snoozed_until && new Date(x.snoozed_until).getTime() > now).map(fromSaved);
    const byPri = (a: Item, b: Item) => a.priority - b.priority || a.since.localeCompare(b.since);
    return { open: [...d.open.map(fromRule), ...extraOpen].sort(byPri), snoozed: [...d.snoozed.map(fromRule), ...extraSnoozed].sort(byPri) };
  }, [rules, saved, custNames]);

  const shown = open.filter((x) => group === "All" || x.group === group);
  const counts = Object.fromEntries(GROUPS.map((g) => [g, g === "All" ? open.length : open.filter((x) => x.group === g).length]));
  const urgent = open.filter((x) => x.priority === 1).length;

  /** Save a decision (done / dismissed / snoozed) for a rule item or an existing suggestion. */
  async function decide(it: Item, status: "done" | "dismissed" | "snoozed" | "open", days = 0) {
    const until = status === "snoozed" ? new Date(Date.now() + days * 86400000).toISOString() : null;
    const patch = { status, snoozed_until: until, decided_at: new Date().toISOString(), decided_by: me };
    const { data, error } = it.saved
      ? await sb.from("ai_suggestions").update(patch).eq("id", it.saved.id).select("*").single()
      : await sb.from("ai_suggestions").upsert({ ...patch, dedupe_key: it.key, kind: it.kind, source: "rules", priority: it.priority, title: it.title, body: it.body, customer_id: it.customer_id, order_id: it.order_id, draft: it.draft || {} }, { onConflict: "dedupe_key" }).select("*").single();
    if (error) return say("Couldn't save that: " + error.message);
    const row = data as Suggestion;
    setSaved((s) => [row, ...s.filter((x) => x.id !== row.id && (!row.dedupe_key || x.dedupe_key !== row.dedupe_key))]);
    if (status === "snoozed") say(`Snoozed for ${days === 1 ? "a day" : `${days} days`}.`);
  }

  // new to-do
  const [todo, setTodo] = useState({ title: "", due: "", body: "" });
  async function addTodo() {
    if (!todo.title.trim()) return;
    const { data, error } = await sb.from("ai_suggestions").insert({ kind: "todo", source: "staff", priority: 2, title: todo.title.trim().slice(0, 300), body: todo.body.trim().slice(0, 4000),
      status: todo.due ? "snoozed" : "open", snoozed_until: todo.due ? new Date(todo.due + "T08:00:00").toISOString() : null, due_at: todo.due ? new Date(todo.due + "T17:00:00").toISOString() : null, decided_by: me }).select("*").single();
    if (error) return say(error.message);
    setSaved((s) => [data as Suggestion, ...s]);
    setTodo({ title: "", due: "", body: "" });
    say(todo.due ? "Added. It shows up here on that day." : "Added.");
  }

  // paste an email
  const [mail, setMail] = useState<null | { from: string; subject: string; text: string; busy?: boolean }>(null);
  async function saveMail() {
    if (!mail || !mail.text.trim()) return;
    setMail({ ...mail, busy: true });
    const r = await addEmailToTimeline({ from: mail.from, subject: mail.subject, text: mail.text });
    if (!r.ok) { setMail({ ...mail, busy: false }); return say(r.error || "Couldn't save the email."); }
    setMail(null);
    say(r.customerId ? "Saved to the customer's timeline." + (ai.ready ? " The Assistant read it." : "") : "Saved. No customer matched that email address." + (ai.ready ? " The Assistant read it." : ""));
    load();
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div><h1>Assistant</h1></div>
        <div className="row">
          <Link href="/shop/settings#assistant" className={"as-ai" + (ai.ready ? " on" : "")} title={`${ai.reason || (ai.ready ? "AI is on" : "")} · Click to change AI settings`}>{ai.ready ? "AI on" : "AI off"} ⚙</Link>
          <button type="button" className="btn" onClick={() => setMail(mail ? null : { from: "", subject: "", text: "" })}>Paste an email</button>
          <button type="button" className="btn" onClick={() => { setLoading(true); load(); }}>Refresh</button>
        </div>
      </div>
      {err && <div className="banner">{err}</div>}
      {flash && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{flash}</div>}

      {mail && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-h"><h2>Add an email to a customer&apos;s timeline</h2><span className="faint" style={{ fontSize: 12 }}>{ai.ready ? "The Assistant will read it and suggest a reply or an order." : "Saved to their timeline. With AI on, the Assistant also reads it."}</span></div>
          <div className="panel-b stack">
            <div className="grid g2">
              <div className="field"><label htmlFor="pm-from">From (their email address)</label><input id="pm-from" type="email" value={mail.from} onChange={(e) => setMail({ ...mail, from: e.target.value })} placeholder="dana@example.com" /></div>
              <div className="field"><label htmlFor="pm-sub">Subject</label><input id="pm-sub" type="text" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="pm-text">Email text</label><textarea id="pm-text" rows={6} value={mail.text} onChange={(e) => setMail({ ...mail, text: e.target.value })} /></div>
            <div className="row"><button type="button" className="btn primary" disabled={mail.busy || !mail.text.trim()} onClick={saveMail}>{mail.busy ? "Saving…" : "Save email"}</button><button type="button" className="btn ghost" onClick={() => setMail(null)}>Cancel</button></div>
          </div>
        </section>
      )}

      <div className="as-top">
        <div className="as-sum"><b className={urgent ? "alert" : ""}>{urgent}</b><span>urgent</span></div>
        <div className="as-sum"><b>{open.length}</b><span>to do</span></div>
        <div className="as-sum"><b>{snoozed.length}</b><span>snoozed</span></div>
        <form className="as-todo" onSubmit={(e) => { e.preventDefault(); addTodo(); }}>
          <input type="text" aria-label="New to-do" placeholder="Add a to-do: call Dana about the banner…" value={todo.title} onChange={(e) => setTodo({ ...todo, title: e.target.value })} />
          <input type="date" aria-label="Remind me on" title="Remind me on (optional)" value={todo.due} onChange={(e) => setTodo({ ...todo, due: e.target.value })} />
          <button type="submit" className="btn" disabled={!todo.title.trim()}>Add</button>
        </form>
      </div>

      <div className="toolbar">
        <div className="chips">
          {GROUPS.map((g) => <button key={g} type="button" className={"chip" + (group === g ? " on" : "")} onClick={() => setGroup(g)}>{g}{counts[g] ? ` (${counts[g]})` : ""}</button>)}
        </div>
      </div>

      {loading ? <div className="empty">Looking through your orders…</div> : shown.length ? (
        <div className="as-list">
          {shown.map((it) => <Card key={it.id} it={it} ai={ai.ready} onDecide={decide} onSent={() => say("Sent. The customer gets it in their portal and by email.")} onQuote={async () => {
            if (!it.saved) return;
            const r = await quoteFromSuggestion(it.saved.id);
            if (!r.ok) return say(r.error || "Couldn't create the quote.");
            router.push(`/shop/orders/${r.id}`);
          }} />)}
        </div>
      ) : (
        <div className="empty">{open.length ? "Nothing in this group." : "All caught up. Nothing needs a follow-up right now."}</div>
      )}

      {snoozed.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button type="button" className="btn ghost sm" onClick={() => setShowSnoozed(!showSnoozed)}>{showSnoozed ? "Hide" : "Show"} snoozed ({snoozed.length})</button>
          {showSnoozed && <div className="as-list" style={{ marginTop: 8 }}>
            {snoozed.map((it) => (
              <div key={it.id} className="as-card snz">
                <div className="as-main"><div className="as-t">{it.title}</div><div className="as-meta">{it.customer}{it.until ? ` · back ${fmtStamp(it.until)}` : ""}</div></div>
                <div className="as-acts"><button type="button" className="btn sm" onClick={() => decide(it, "open")}>Unsnooze</button></div>
              </div>
            ))}
          </div>}
        </div>
      )}

      <p className="faint" style={{ fontSize: 12, marginTop: 22 }}>
        Rules: quotes after {settings.assistant.quoteFollowUpDays} days, proofs after {settings.assistant.proofFollowUpDays} days, replies after {settings.assistant.replyWithinHours} hours,
        jobs due within {settings.assistant.atRiskDays} days, customers idle {settings.assistant.reorderAfterDays} days. Change these in <Link href="/shop/settings#assistant">Pricing &amp; shop → Assistant &amp; AI</Link>.
      </p>
    </>
  );
}

function Card({ it, ai, onDecide, onSent, onQuote }: { it: Item; ai: boolean; onDecide: (it: Item, s: "done" | "dismissed" | "snoozed", days?: number) => Promise<void>; onSent: () => void; onQuote: () => Promise<void> }) {
  const [draft, setDraft] = useState<null | { subject: string; body: string }>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const canSend = it.channel !== "none" && (it.channel === "order" ? !!it.order_id : !!it.customer_id);
  const hasOrder = it.kind === "draft_order" && Array.isArray((it.saved?.payload as { groups?: unknown[] })?.groups);

  async function send() {
    if (!draft?.body.trim()) return;
    setBusy("send"); setErr("");
    const r = it.channel === "order" && it.order_id ? await staffMessage(it.order_id, draft.body) : await staffCustomerMessage(it.customer_id || "", draft.body);
    setBusy("");
    if (!r.ok) return setErr(r.error || "Couldn't send.");
    onSent();
    await onDecide(it, "done");
  }
  async function rewrite() {
    setBusy("ai"); setErr("");
    const r = await aiRewriteDraft({ purpose: `${it.title}. ${it.body}`, orderId: it.order_id, customerId: it.customer_id, subject: draft?.subject || it.draft?.subject, body: draft?.body || it.draft?.body });
    setBusy("");
    if (!r.ok) return setErr(r.error || "The AI couldn't write that.");
    setDraft({ subject: r.subject, body: r.body });
  }

  return (
    <div className={"as-card p" + it.priority}>
      <span className="as-dot" title={PRI[it.priority]} />
      <div className="as-main">
        <div className="as-t">{it.href ? <Link href={it.href}>{it.title}</Link> : it.title}</div>
        {it.body && <div className="as-b">{it.body}</div>}
        <div className="as-meta">
          <span className="tag">{it.saved ? (it.saved.source === "ai" ? "AI" : "To-do") : KIND_INFO[it.kind as keyof typeof KIND_INFO]?.label || it.kind}</span>
          {it.customer && <span>{it.customer}</span>}
          <span>{PRI[it.priority]}</span>
        </div>
        {draft && (
          <div className="as-draft">
            <input type="text" aria-label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            <textarea rows={7} aria-label="Message" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="row">
              {canSend && <button type="button" className="btn primary sm" disabled={!!busy || !draft.body.trim()} onClick={send}>{busy === "send" ? "Sending…" : "Send to customer"}</button>}
              <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(draft.body)}>Copy</button>
              {it.fromEmail && <a className="btn sm" href={`mailto:${it.fromEmail}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}>Open in email</a>}
              <button type="button" className="btn sm ghost" disabled={!!busy} onClick={rewrite} title={ai ? "Rewrite with Claude using this order's details" : "Turn on AI in Pricing & shop to use this"}>{busy === "ai" ? "Writing…" : "✦ Rewrite with AI"}</button>
              <button type="button" className="btn sm ghost" onClick={() => setDraft(null)}>Close</button>
            </div>
            {canSend && <span className="sub">{it.channel === "order" ? "Posts on the order's message thread in their portal and emails them." : "Posts in their portal messages and emails them."}</span>}
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
      <div className="as-acts">
        {hasOrder && <button type="button" className="btn primary sm" onClick={async () => { setBusy("q"); await onQuote(); setBusy(""); }} disabled={!!busy}>{busy === "q" ? "Creating…" : "Create quote"}</button>}
        {!draft && (it.draft?.body || it.channel !== "none") && <button type="button" className={"btn sm" + (hasOrder ? "" : " primary")} onClick={() => setDraft({ subject: it.draft?.subject || "", body: it.draft?.body || "" })}>{it.draft?.body ? "Draft message" : "Write message"}</button>}
        <button type="button" className="btn sm" onClick={() => onDecide(it, "done")}>Done</button>
        <select aria-label="Snooze" className="as-snz" value="" onChange={(e) => { const d = +e.target.value; if (d) onDecide(it, "snoozed", d); }}>
          <option value="">Snooze…</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">1 week</option><option value="30">1 month</option>
        </select>
        <button type="button" className="btn sm ghost" onClick={() => onDecide(it, "dismissed")} title="Hide this; it won't come back unless something changes">Dismiss</button>
      </div>
    </div>
  );
}
