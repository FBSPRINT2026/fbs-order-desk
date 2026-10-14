"use client";
import { useEffect, useRef, useState } from "react";
import { aiEmailChat, aiLookUp, emailChatHistory } from "@/app/shop/ai-actions";
import type { EmailAction, EmailChatMsg } from "@/lib/ai/emailChat";
import { wantsLookup } from "@/components/OrderAssist";
import { MicButton } from "@/components/SearchInput";

/**
 * The Inbox Assistant, as a text-message conversation (Oct 10, Nick: "like an iPhone text message… what you said
 * versus what I said"): your messages on the right in blue, the Assistant's on the left in gray, short answers, and
 * its next steps as small buttons under its bubble (open Create order, put a reply in the answer box, file it under
 * an order, no reply needed). Things that happened (an order made) show as a small centered note.
 */
const when = (t: string) => new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function EmailChat({ activityId, onAction, busyOutside, bump = 0, summary, onHide, onBack, who, listen, hush }: { activityId: string; /** changes each time the Assistant button opens it: start the microphone */ listen?: number; /** the Assistant is hidden: stop listening */ hush?: boolean; /** fold the Assistant out of the way (Inbox) */ onHide?: () => void; /** phones: the chat fills the screen; this goes back to the email */ onBack?: () => void; /** phones: who the email is from, under "Assistant" */ who?: string; onAction: (a: EmailAction) => void; busyOutside?: boolean; /** changes when something happened outside (an order made): reload */ bump?: number; /** the AI's one-line read of the email, its first message */ summary?: string }) {
  const [msgs, setMsgs] = useState<EmailChatMsg[]>([]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [note, setNote] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null), boxRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setMsgs([]); setNote(""); }, [activityId]);
  useEffect(() => { emailChatHistory(activityId).then((r) => { if (r.ok) setMsgs(r.messages); }).catch(() => null); }, [activityId, bump]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, busy]);
  async function send(t = text) {
    const q = t.trim(); if (!q || busy) return;
    setNote(""); setText("");
    setMsgs((m) => [...m, { role: "staff", text: q, at: new Date().toISOString() }]);
    let found = null;
    if (wantsLookup(q)) { setBusy("look"); const lu = await aiLookUp(q, activityId.startsWith("inbox:") ? {} : { activityId }).catch(() => null); found = lu?.ok ? lu.lookedUp : null; }
    setBusy("read");
    const r = await aiEmailChat(activityId, q, found);
    setBusy("");
    if (!r.ok) { setNote(r.error || "The Assistant didn't answer. Try again."); setText(q); setMsgs((m) => m.slice(0, -1)); return; }
    setMsgs(r.messages);
  }
  const starters = ["What should I do with this?", "Is this a reorder?", "Can we make their date?", "What's missing to quote it?"];
  return (
    <div className="tx">
      <div className="tx-h">{onBack && <button type="button" className="tx-back" onClick={onBack} aria-label="Back to the email"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg><span>Email</span></button>}<span className="tx-av" aria-hidden>✦</span><span className="tx-ht"><b>Assistant</b>{who && <small>{who}</small>}</span>{onHide && <button type="button" className="tx-hide" onClick={onHide} aria-label="Hide the Assistant" title="Hide the Assistant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button>}</div>
      <div className="tx-list" ref={listRef} aria-live="polite">
        {summary && <div className="tx-row ai"><div className="tx-b ai">{summary}</div></div>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const gap = !prev || new Date(m.at).getTime() - new Date(prev.at).getTime() > 15 * 60_000;
          return (
            <div key={i} className="tx-item">
              {gap && <div className="tx-time">{when(m.at)}</div>}
              {m.role === "event" ? (
                <div className="tx-event">{m.text}{m.href && <> · <a href={m.href} target="_blank" rel="noreferrer">Open it</a></>}</div>
              ) : (
                <div className={"tx-row " + m.role}>
                  <div className={"tx-b " + m.role}>
                    {m.text}
                    {m.lookedUp && <div className="tx-found">Looked up: {m.lookedUp.text}{m.lookedUp.sources.length > 0 && <> ({m.lookedUp.sources.map((x, k) => <a key={k} href={x.url} target="_blank" rel="noreferrer">{k ? ", " : ""}{x.title || "source"}</a>)})</>}</div>}
                  </div>
                  {(m.actions || []).length > 0 && (
                    <div className="tx-acts">
                      {m.actions!.map((a, k) => <button key={k} type="button" className={k === 0 ? "first" : ""} disabled={!!busy || busyOutside} title={a.kind === "reply" ? "Puts this answer in the reply box for you to check and send" : undefined} onClick={() => onAction(a)}>{a.label}</button>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {busy && <div className="tx-row ai"><div className="tx-b ai tx-typing" aria-label={busy === "look" ? "Looking it up online" : "Thinking"}><i /><i /><i /></div></div>}
      </div>
      {!msgs.length && !busy && <div className="tx-starters">{starters.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}</div>}
      {note && <div className="tx-note">{note}</div>}
      <form className="tx-in" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <div className="tx-field">
          <textarea rows={1} value={text} aria-label="Message the Assistant" ref={(el) => { boxRef.current = el; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 110)}px`; } }} placeholder="Message"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <MicButton target={() => boxRef.current} append keepListening autoStart={listen} off={hush} label="Talk to the Assistant (microphone)" className="tx-mic" />
        </div>
        <button type="submit" className="tx-send" disabled={!!busy || !text.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
        </button>
      </form>
    </div>
  );
}
