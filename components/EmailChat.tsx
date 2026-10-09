"use client";
import { useEffect, useRef, useState } from "react";
import { aiEmailChat, aiLookUp, emailChatHistory } from "@/app/shop/ai-actions";
import type { EmailAction, EmailChatMsg } from "@/lib/ai/emailChat";
import { wantsLookup } from "@/components/OrderAssist";

/**
 * Inbox chat: talk an email through with the AI. "What should I do with this?" → it says what the email is and what
 * it would do (new order, a reorder of a past job, ask for details, more time, turn it down), with buttons for those
 * steps: open Create order with what to know, put a reply in the answer box, file it under an order, no reply needed.
 */
export default function EmailChat({ activityId, onAction, busyOutside }: { activityId: string; onAction: (a: EmailAction) => void; busyOutside?: boolean }) {
  const [msgs, setMsgs] = useState<EmailChatMsg[]>([]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [note, setNote] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setMsgs([]); setNote(""); emailChatHistory(activityId).then((r) => { if (r.ok) setMsgs(r.messages); }).catch(() => null); }, [activityId]);
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
    <div className="ai-box oc ibx-chat">
      <h3>✦ Talk it over with the AI</h3>
      {msgs.length > 0 && (
        <div className="oc-list" ref={listRef}>
          {msgs.map((m, i) => (
            <div key={i} className={"oc-msg " + m.role}>
              <div className="oc-text">{m.text}</div>
              {m.lookedUp && <div className="eo-found"><b>Looked up online:</b> {m.lookedUp.text}{m.lookedUp.sources.length > 0 && <span className="faint"> ({m.lookedUp.sources.map((x, k) => <a key={k} href={x.url} target="_blank" rel="noreferrer">{k ? ", " : ""}{x.title || "source"}</a>)})</span>}</div>}
              {(m.actions || []).length > 0 && (
                <div className="oc-acts">
                  {m.actions!.map((a, k) => <button key={k} type="button" className={"btn sm" + (k === 0 ? " primary" : "")} disabled={!!busy || busyOutside} title={a.kind === "reply" ? "Puts this answer in the reply box for you to check and send" : undefined} onClick={() => onAction(a)}>{a.label}</button>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!msgs.length && !busy && <div className="eo-chips">{starters.map((q) => <button key={q} type="button" className="eo-chip" onClick={() => send(q)}>{q}</button>)}</div>}
      {busy && <div className="muted" style={{ fontSize: 13 }}>{busy}</div>}
      <form className="oc-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea rows={2} value={text} aria-label="Talk about this email with the AI" placeholder='e.g. "What should I do with this?" · "It&apos;s a reorder of 31174, we used the Lakers PMS colors, look them up"'
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button type="submit" className="btn sm primary" disabled={!!busy || !text.trim()}>Send</button>
      </form>
      {note && <span className="ai-off">{note}</span>}
    </div>
  );
}
