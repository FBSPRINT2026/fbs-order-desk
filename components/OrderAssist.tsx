"use client";
import { useEffect, useRef, useState } from "react";
import type { Group } from "@/lib/pricing";
import type { Check } from "@/lib/orderChecks";
import type { ProposedOrder } from "@/lib/ai/normalize";
import { aiLookUp, aiOrderChat, aiOrderFromText, aiReorderCheck, applyReorderFix, orderChatThread } from "@/app/shop/ai-actions";
import type { ChatMsg } from "@/lib/ai/orderChat";
import { MicButton } from "@/components/SearchInput";
import type { ReorderCheck, ReorderFix } from "@/lib/ai/reorderCheck";

/** one line of the order's status: ok (green ✓), wait (amber), bad (red), or info (grey) */
export type StatusLine = { tone: "ok" | "wait" | "bad" | "info"; text: string; sub?: string };

/**
 * "Order check": where the job stands, at a glance (Oct 15, Nick: "not an ask about this order… just like: we're on
 * time, goods have been received, art looks good, approved by customer. Big bullet points… it shouldn't take up some
 * huge space"). The rule checks only show when something needs a look.
 */
export function ChecksPanel({ checks, status, orderId, save, reorder }: { checks: Check[]; status: StatusLine[]; orderId: string; save: () => Promise<void>; /** a reorder of an earlier job: the AI compares it with that job */ reorder?: boolean }) {
  const high = checks.filter((c) => c.level === "high").length;
  const behind = status.filter((x) => x.tone === "bad").length + high;
  return (
    <section className="panel oc-panel">
      <div className="panel-h"><h2>Order check</h2><span className="faint num" style={{ color: behind ? "var(--danger)" : checks.length ? "var(--warn)" : "var(--ok)" }}>{behind ? "Needs a look" : checks.length ? `${checks.length} to look at` : "All good"}</span></div>
      <div className="panel-b">
        <ul className="os-list">
          {status.map((x, i) => <li key={i} className={"os " + x.tone}><i aria-hidden>{x.tone === "ok" ? "✓" : x.tone === "bad" ? "!" : x.tone === "wait" ? "•" : "–"}</i><span><b>{x.text}</b>{x.sub && <small>{x.sub}</small>}</span></li>)}
        </ul>
        {checks.length > 0 && <div className="chk-list os-checks">{checks.map((c, i) => <div key={i} className={"chk " + c.level}>{c.text}</div>)}</div>}
        {reorder && <ReorderCheckBox orderId={orderId} save={save} />}
      </div>
    </section>
  );
}

/** Paste a customer's email or call notes and let the AI fill in the order groups. */
export function FillFromText({ orderId, hasContent, onApply }: { orderId: string; hasContent: boolean; onApply: (groups: Group[], p: ProposedOrder, mode: "replace" | "add") => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<null | { groups: Group[]; proposal: ProposedOrder }>(null);
  async function run() {
    setBusy(true); setErr(""); setRes(null);
    const r = await aiOrderFromText(text, orderId);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't read that.");
    if (!r.groups.length) return setErr("Didn't find any garments or prints in that text.");
    setRes({ groups: r.groups, proposal: r.proposal });
  }
  if (!open) return <button type="button" className="btn sm ghost" onClick={() => setOpen(true)} title="Paste an email or call notes and let the AI fill in the garments, sizes and prints">✦ Fill from an email</button>;
  const pcs = res ? res.groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0) : 0;
  return (
    <div className="ai-box" style={{ flex: "1 1 100%" }}>
      <h3>✦ Fill in this order from an email or notes</h3>
      <textarea rows={5} aria-label="Customer's email or notes" placeholder="Paste the customer's email, a text message, or your notes from the call…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm primary" disabled={busy || text.trim().length < 10} onClick={run}>{busy ? "Reading…" : "Read it"}</button>
        <button type="button" className="btn sm ghost" onClick={() => { setOpen(false); setRes(null); setErr(""); }}>Close</button>
        {err && <span className="ai-off">{err}</span>}
      </div>
      {res && (
        <div className="stack" style={{ gap: 6, fontSize: 13 }}>
          <div><b>Found {res.groups.length} group{res.groups.length === 1 ? "" : "s"}, {pcs} pieces</b>{res.proposal.confidence ? ` · ${res.proposal.confidence} confidence` : ""}. Prices come from your price list; blank costs fill in when you pick each style.</div>
          {res.proposal.questions?.length ? <div className="muted">Still need to ask: {res.proposal.questions.join(" · ")}</div> : null}
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm primary" onClick={() => { onApply(res.groups, res.proposal, hasContent ? "add" : "replace"); setOpen(false); setRes(null); setText(""); }}>{hasContent ? "Add to this order" : "Use these"}</button>
            {hasContent && <button type="button" className="btn sm" onClick={() => { onApply(res.groups, res.proposal, "replace"); setOpen(false); setRes(null); setText(""); }}>Replace what&apos;s here</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const FIELD: Record<ReorderFix["field"], string> = { size: "Size", location: "Location", inks: "Inks", colors: "Colors", drop: "Drop" };
/**
 * Reorder check: the AI looks over the reorder next to the old job (its files, the film, the art on each print and
 * our mockup). Runs by itself the first time the order opens; each suggested fix applies with a click.
 */
function ReorderCheckBox({ orderId, save }: { orderId: string; save: () => Promise<void> }) {
  const [c, setC] = useState<ReorderCheck | null>(null);
  const [busy, setBusy] = useState<"" | "run" | number>("");
  const [note, setNote] = useState("");
  const [told, setTold] = useState<string | null>(null);
  async function run(onlyIfNone: boolean) {
    setBusy("run"); setNote("");
    if (!onlyIfNone) await save();
    // a new note: look up online what it points to first (team PMS colors…)
    let found: ReorderCheck["lookedUp"] | null | undefined;
    if (!onlyIfNone && told && told.trim() && told.trim() !== (c?.told || "")) { const lu = await aiLookUp(told, { orderId }).catch(() => null); found = lu?.ok ? lu.lookedUp : null; }
    const r = await aiReorderCheck(orderId, onlyIfNone, onlyIfNone || told == null ? undefined : told, found);
    setBusy("");
    if (!r.ok) return setNote(r.error || "The reorder check didn't work.");
    setC(r.check);
    setTold(r.check.told || "");
  }
  useEffect(() => { void run(true); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function apply(i: number, f: ReorderFix) {
    setBusy(i); setNote("");
    await save();
    const r = await applyReorderFix(orderId, f);
    if (!r.ok) { setBusy(""); return setNote(r.error || "Couldn't apply that."); }
    location.reload();
  }
  const tone = c?.verdict === "good" ? "ok" : c?.verdict === "problems" ? "high" : "medium";
  return (
    <div className="ai-box">
      <h3>✦ Reorder check</h3>
      {busy === "run" && !c && <div className="muted" style={{ fontSize: 13 }}>Comparing with the old job: its files, the film, the art and our mockup…</div>}
      {c && (
        <>
          <div className={"chk " + tone}>{c.summary}</div>
          {c.lookedUp && <div className="eo-found"><b>Looked up online:</b> {c.lookedUp.text}{c.lookedUp.sources.length > 0 && <span className="faint"> ({c.lookedUp.sources.map((x, i) => <a key={i} href={x.url} target="_blank" rel="noreferrer">{i ? ", " : ""}{x.title || "source"}</a>)})</span>}</div>}
          {c.issues.length > 0 && <div className="chk-list">{c.issues.map((x, i) => <div key={i} className={"chk " + x.severity}>{x.text}</div>)}</div>}
          {c.fixes.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              {c.fixes.map((f, i) => (
                <div key={i} className="row" style={{ gap: 8, fontSize: 13, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span><b>{FIELD[f.field] || f.field} → {f.value}</b> <span className="muted">{f.why}</span></span>
                  <button type="button" className="btn sm" disabled={busy !== ""} onClick={() => apply(i, f)}>{busy === i ? "Applying…" : "Apply"}</button>
                </div>
              ))}
            </div>
          )}
          {c.at && <div className="faint" style={{ fontSize: 12 }}>Checked {new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
        </>
      )}
      <label className="stack" style={{ gap: 4, fontSize: 13 }}>
        <span className="muted">Tell it what you know about this job (it looks the rest up)</span>
        <textarea rows={2} value={told || ""} placeholder='e.g. "We used the LA Lakers PMS colors" or "The back print was 3 inches wide"' onChange={(e) => setTold(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm ghost" onClick={() => run(false)} disabled={busy !== ""}>{busy === "run" ? "Checking…" : c ? "Check again" : "Run the reorder check"}</button>
        {note && <span className="ai-off">{note}</span>}
      </div>
    </div>
  );
}

/** a message that asks for something to be looked up online first */
export const wantsLookup = (t: string) => /\b(look(\s|-)?(it|them|that)?\s*up|pms|pantone|official|online|search|google)\b/i.test(t);

/**
 * Order chat: talk the order through with the AI ("looks good, did you pull the previous sizing from the film?").
 * Answers from the order, its notes, history and files (the old job, the film, the art, our mockup); fixes apply
 * with a click. The conversation is kept on the order.
 */
export function OrderChat({ orderId, save, reorder }: { orderId: string; save: () => Promise<void>; reorder?: boolean }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(""), [note, setNote] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { orderChatThread(orderId).then((r) => { if (r.ok) setMsgs(r.messages); }).catch(() => null); }, [orderId]);
  async function send(t = text) {
    const q = t.trim(); if (!q || busy) return;
    setNote(""); setText("");
    setMsgs((m) => [...m, { role: "staff", text: q, at: new Date().toISOString() }]);
    await save();
    let found = null;
    if (wantsLookup(q)) { setBusy("Looking it up online…"); const lu = await aiLookUp(q, { orderId }).catch(() => null); found = lu?.ok ? lu.lookedUp : null; }
    setBusy("Looking over the order…");
    const r = await aiOrderChat(orderId, q, found);
    setBusy("");
    if (!r.ok) { setNote(r.error || "The AI didn't answer."); setText(q); setMsgs((m) => m.slice(0, -1)); return; }
    setMsgs(r.messages);
  }
  async function apply(f: ReorderFix) {
    setBusy("Applying…");
    await save();
    const r = await applyReorderFix(orderId, f);
    if (!r.ok) { setBusy(""); return setNote(r.error || "Couldn't apply that."); }
    location.reload();
  }
  const starters = reorder ? ["Did you pull the size from the film folder?", "Does the art match the old job?", "What ink colors did we use last time?"] : ["Anything missing before this prints?", "Do the print sizes fit these garments?"];
  return (
    <div className="ai-box oc">
      <h3>✦ Ask about this order</h3>
      {msgs.length > 0 && (
        <div className="oc-list">
          {msgs.map((m, i) => (
            <div key={i} className={"oc-msg " + m.role}>
              <div className="oc-text">{m.text}</div>
              {m.lookedUp && <div className="eo-found"><b>Looked up online:</b> {m.lookedUp.text}{m.lookedUp.sources.length > 0 && <span className="faint"> ({m.lookedUp.sources.map((x, k) => <a key={k} href={x.url} target="_blank" rel="noreferrer">{k ? ", " : ""}{x.title || "source"}</a>)})</span>}</div>}
              {(m.fixes || []).map((f, k) => (
                <div key={k} className="row" style={{ gap: 8, fontSize: 13, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span><b>{FIELD[f.field] || f.field} → {f.value}</b> <span className="muted">{f.why}</span></span>
                  <button type="button" className="btn sm" disabled={!!busy} onClick={() => apply(f)}>Apply</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!msgs.length && <div className="eo-chips">{starters.map((q) => <button key={q} type="button" className="eo-chip" disabled={!!busy} onClick={() => send(q)}>{q}</button>)}</div>}
      {/* like iPhone Messages (Oct 15, Nick): the AI "typing" bubble while it works */}
      {busy && <div className="oc-typing" title={busy}><i /><i /><i /></div>}
      <form className="oc-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea ref={boxRef} rows={1} value={text} aria-label="Ask about this order" placeholder="Ask about this order"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <MicButton target={() => boxRef.current} append keepListening label="Talk to the AI (microphone)" className="sc-mic oc-mic" />
        <button type="submit" className="oc-send" aria-label="Send" disabled={!!busy || !text.trim()}><svg viewBox="0 0 24 24" aria-hidden><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg></button>
      </form>
      {note && <span className="ai-off">{note}</span>}
    </div>
  );
}
