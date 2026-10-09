"use client";
import { useEffect, useRef, useState } from "react";
import { aiEmailChat, aiLookUp, emailChatHistory } from "@/app/shop/ai-actions";
import type { EmailAction, EmailChatMsg } from "@/lib/ai/emailChat";
import { wantsLookup } from "@/components/OrderAssist";
import { MicButton } from "@/components/SearchInput";

/**
 * Inbox chat: talk an email through with the AI. "What should I do with this?" → it says what the email is and what
 * it would do (new order, a reorder of a past job, ask for details, more time, turn it down), with buttons for those
 * steps: open Create order with what to know, put a reply in the answer box, file it under an order, no reply needed.
 */
export default function EmailChat({ activityId, onAction, busyOutside, bump = 0 }: { activityId: string; onAction: (a: EmailAction) => void; busyOutside?: boolean; /** changes when something happened outside (an order made): reload */ bump?: number }) {
  const [msgs, setMsgs] = useState<EmailChatMsg[]>([]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [note, setNote] = useState(""), [all, setAll] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null), boxRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setMsgs([]); setNote(""); }, [activityId]);
  useEffect(() => { emailChatHistory(activityId).then((r) => { if (r.ok) setMsgs(r.messages); }).catch(() => null); }, [activityId, bump]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, busy]);
  async function send(t = text) {
    const q = t.trim(); if (!q || busy) return;
    setNote(""); setText("");
    setMsgs((m) => [...m, { role: "staff", text: q, at: new Date().toISOString() }]);
    let found = null;
    if (wantsLookup(q)) { setBusy("Looking it up online…"); const lu = await aiLookUp(q, { activityId }).catch(() => null); found = lu?.ok ? lu.lookedUp : null; }
    setBusy("Reading the email…");
    const r = await aiEmailChat(activityId, q, found);
    setBusy("");
    if (!r.ok) { setNote(r.error || "The AI didn't answer."); setText(q); setMsgs((m) => m.slice(0, -1)); return; }
    setMsgs(r.messages);
  }
  const starters = ["What should I do with this?", "Is this a reorder?", "Can we make their date?", "What's missing to quote it?"];
  return (
    <div className="oc ibx-chat">
      <h3>✦ Talk it over with the AI</h3>
      {msgs.length > 0 && (
        <div className="oc-list" ref={listRef}>
          {/* compact: the last few messages; earlier ones on request */}
          {!all && msgs.length > 6 && <button type="button" className="oc-more" onClick={() => setAll(true)}>Show {msgs.length - 6} earlier</button>}
          {(all ? msgs : msgs.slice(-6)).map((m, i) => m.role === "event" ? (
            <div key={i} className="oc-event">{m.text}{m.href && <> <a href={m.href} target="_blank" rel="noreferrer">Open it</a></>}</div>
          ) : (
            <div key={i} className={"oc-msg " + m.role}>
              <div className="oc-text">{m.text}</div>
              {m.lookedUp && <div className="eo-found"><b>Looked up online:</b> {m.lookedUp.text}{m.lookedUp.sources.length > 0 && <span className="faint"> ({m.lookedUp.sources.map((x, k) => <a key={k} href={x.url} target="_blank" rel="noreferrer">{k ? ", " : ""}{x.title || "source"}</a>)})</span>}</div>}
              {(m.actions || []).length > 0 && (
                <div className="oc-acts">
                  {m.actions!.map((a, k) => <button key={k} type="button" className={"btn xs" + (k === 0 ? " primary" : "")} disabled={!!busy || busyOutside} title={a.kind === "reply" ? "Puts this answer in the reply box for you to check and send" : undefined} onClick={() => onAction(a)}>{a.label}</button>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!msgs.length && !busy && <div className="eo-chips oc-starters">{starters.map((q) => <button key={q} type="button" className="eo-chip" onClick={() => send(q)}>{q}</button>)}</div>}
      {busy && <div className="muted" style={{ fontSize: 13 }}>{busy}</div>}
      <form className="oc-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea rows={1} value={text} aria-label="Talk about this email with the AI" ref={(el) => { boxRef.current = el; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; } }} placeholder="Ask about this email…"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <MicButton target={() => boxRef.current} append keepListening label="Talk to the AI (microphone)" className="sc-mic oc-mic" />
        <button type="submit" className="btn sm primary" disabled={!!busy || !text.trim()}>Send</button>
      </form>
      {note && <span className="ai-off">{note}</span>}
    </div>
  );
}
