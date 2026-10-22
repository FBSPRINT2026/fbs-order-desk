"use client";
import { useEffect, useRef, useState } from "react";
import { aiEmailChat, aiLookUp, emailChatHistory } from "@/app/shop/ai-actions";
import type { EmailAction, EmailChatMsg } from "@/lib/ai/emailChat";
import { wantsLookup } from "@/components/OrderAssist";
import { MicButton } from "@/components/SearchInput";
import { Card } from "@/components/AiWorkbench";
import { emailWorkChat } from "@/app/shop/ai/actions";
import type { WBCard, WBEvent, WBMsg } from "@/lib/ai/workbenchShared";

/**
 * The Inbox Assistant, as a text-message conversation (Oct 10, Nick: "like an iPhone text message… what you said
 * versus what I said"): your messages on the right in blue, the Assistant's on the left in gray, short answers, and
 * its next steps as small buttons under its bubble (open Create order, put a reply in the answer box, file it under
 * an order, no reply needed). Things that happened (an order made) show as a small centered note.
 *
 * Real work (Oct 22, Nick: "how can I get it to do actual work for me, like create mock-ups"): asking for mockups, a
 * quote, a garment or anything to look up goes to the AI Workbench's agent instead, in a Workbench chat for this
 * email (started with the email, its customer and its attachments). Its mockup and quote cards show right here, and
 * the chat is also in AI Workbench. Quick questions stay quick.
 */
const WORK = /\b(mock[\s-]?ups?|quote|propose|garments?|blanks?|s&s|spreadsheet|roster|find (me )?(a |the )?(shirt|hoodie|style|tee|hat|cap|polo)|on (an? )?(gildan|bella|canvas|comfort colors|next level|port|district|sport-tek|independent|richardson|champion|hanes|jerzees)|put (this|it|that|them) (in|together)|enter (this|it|them) as|make (an? |the )?(order|quote)|in (black|white|navy|red|royal|heather|grey|gray|charcoal|green|maroon|pink|orange|purple|gold|yellow)\b.*\band\b|look (it |them )?up|search (for|the web))/i;
const when = (t: string) => new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function EmailChat({ activityId, onAction, busyOutside, bump = 0, summary, onHide, onBack, who, listen, hush }: { activityId: string; /** changes each time the Assistant button opens it: start the microphone */ listen?: number; /** the Assistant is hidden: stop listening */ hush?: boolean; /** fold the Assistant out of the way (Inbox) */ onHide?: () => void; /** phones: the chat fills the screen; this goes back to the email */ onBack?: () => void; /** phones: who the email is from, under "Assistant" */ who?: string; onAction: (a: EmailAction) => void; busyOutside?: boolean; /** changes when something happened outside (an order made): reload */ bump?: number; /** the AI's one-line read of the email, its first message */ summary?: string }) {
  const [msgs, setMsgs] = useState<EmailChatMsg[]>([]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [note, setNote] = useState("");
  // the Workbench chat for this email: real work (mockups, quotes, lookups)
  const [work, setWork] = useState<{ can: boolean; id: string; msgs: WBMsg[] }>({ can: false, id: "", msgs: [] });
  const [status, setStatus] = useState(""), [live, setLive] = useState<{ text: string; cards: WBCard[] } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null), boxRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setMsgs([]); setNote(""); setWork({ can: false, id: "", msgs: [] }); setLive(null); }, [activityId]);
  useEffect(() => { emailChatHistory(activityId).then((r) => { if (r.ok) setMsgs(r.messages); }).catch(() => null); }, [activityId, bump]);
  useEffect(() => { emailWorkChat(activityId).then((r) => setWork({ can: r.can, id: r.id, msgs: r.messages })).catch(() => null); }, [activityId]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs.length, work.msgs.length, busy, live?.cards.length]);
  // one timeline: the quick answers and the work, by time (the email itself, the work chat's first message, isn't shown)
  type Item = { at: string; quick?: EmailChatMsg; w?: WBMsg };
  const items: Item[] = [...msgs.map((m) => ({ at: m.at, quick: m })), ...work.msgs.filter((m) => !m.seed).map((m) => ({ at: m.at, w: m }))].sort((a, b) => a.at.localeCompare(b.at));
  const lastIsWork = !!items[items.length - 1]?.w;
  const changeCard = (c: WBCard) => setWork((w) => ({ ...w, msgs: w.msgs.map((m) => m.cards?.some((x) => x.id === c.id) ? { ...m, cards: m.cards.map((x) => (x.id === c.id ? c : x)) } : m) }));

  async function doWork(q: string) {
    const mine: WBMsg = { role: "user", text: q, at: new Date().toISOString() };
    setWork((w) => ({ ...w, msgs: [...w.msgs, mine] }));
    setBusy("work"); setStatus("Working…"); setLive({ text: "", cards: [] });
    try {
      const res = await fetch("/api/ai/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(work.id ? { chat: work.id, text: q } : { email: activityId, text: q }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "The Assistant didn't answer. Try again."); }
      const rd = res.body.getReader(), dec = new TextDecoder();
      let buf = "", done: WBMsg | null = null, id = work.id;
      for (;;) {
        const { value, done: end } = await rd.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          const ev = JSON.parse(ln) as WBEvent;
          if (ev.t === "chat") id = ev.id;
          else if (ev.t === "status") setStatus(ev.text);
          else if (ev.t === "text") setLive((l) => ({ text: [l?.text, ev.text].filter(Boolean).join("\n\n"), cards: l?.cards || [] }));
          else if (ev.t === "card") setLive((l) => ({ text: l?.text || "", cards: [...(l?.cards || []), ev.card] }));
          else if (ev.t === "done") done = ev.msg;
          else if (ev.t === "error") throw new Error(ev.error);
        }
      }
      if (!done) throw new Error("The answer was cut off. Open the email again to see what was saved.");
      const fin = done;
      setWork((w) => ({ ...w, id, msgs: [...w.msgs, fin] }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The Assistant didn't answer. Try again."); setText(q);
      setWork((w) => ({ ...w, msgs: w.msgs.filter((m) => m !== mine) }));
    }
    setBusy(""); setStatus(""); setLive(null);
  }

  async function send(t = text) {
    const q = t.trim(); if (!q || busy) return;
    setNote(""); setText("");
    // real work, or a follow-up to it ("now in navy"): the Workbench
    if (work.can && (WORK.test(q) || lastIsWork)) { await doWork(q); return; }
    setMsgs((m) => [...m, { role: "staff", text: q, at: new Date().toISOString() }]);
    let found = null;
    if (wantsLookup(q)) { setBusy("look"); const lu = await aiLookUp(q, activityId.startsWith("inbox:") ? {} : { activityId }).catch(() => null); found = lu?.ok ? lu.lookedUp : null; }
    setBusy("read");
    const r = await aiEmailChat(activityId, q, found);
    setBusy("");
    if (!r.ok) { setNote(r.error || "The Assistant didn't answer. Try again."); setText(q); setMsgs((m) => m.slice(0, -1)); return; }
    setMsgs(r.messages);
  }
  const starters = ["What should I do with this?", "Is this a reorder?", ...(work.can ? ["Make mockups of their art"] : []), "Can we make their date?", "What's missing to quote it?"];
  return (
    <div className="tx">
      <div className="tx-h">{onBack && <button type="button" className="tx-back" onClick={onBack} aria-label="Back to the email"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg><span>Email</span></button>}<span className="tx-av" aria-hidden>✦</span><span className="tx-ht"><b>Assistant</b>{who && <small>{who}</small>}</span>{onHide && <button type="button" className="tx-hide" onClick={onHide} aria-label="Hide the Assistant" title="Hide the Assistant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button>}</div>
      <div className="tx-list" ref={listRef} aria-live="polite">
        {summary && <div className="tx-row ai"><div className="tx-b ai">{summary}</div></div>}
        {items.map((it, i) => {
          const prev = items[i - 1];
          const gap = !prev || new Date(it.at).getTime() - new Date(prev.at).getTime() > 15 * 60_000;
          if (it.w) {
            const w = it.w;
            return (
              <div key={i} className="tx-item">
                {gap && <div className="tx-time">{when(w.at)}</div>}
                <div className={"tx-row " + (w.role === "user" ? "staff" : "ai")}>
                  {(w.text || w.files?.length) ? <div className={"tx-b " + (w.role === "user" ? "staff" : "ai")}>{w.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,4}\s+/gm, "")}{w.files?.length ? <div className="tx-found">Brought in: {w.files.map((f) => f.name).join(", ")}</div> : null}</div> : null}
                </div>
                {w.cards?.map((c) => <div key={c.id} className="tx-card"><Card card={c} chatId={work.id} onCard={changeCard} /></div>)}
              </div>
            );
          }
          const m = it.quick!;
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
        {live && (live.text || live.cards.length > 0) && (
          <div className="tx-item">
            {live.text && <div className="tx-row ai"><div className="tx-b ai">{live.text.replace(/\*\*(.+?)\*\*/g, "$1")}</div></div>}
            {live.cards.map((c) => <div key={c.id} className="tx-card"><Card card={c} chatId={work.id} onCard={() => { /* kept once the answer is in */ }} pending /></div>)}
          </div>
        )}
        {busy && <div className="tx-row ai"><div className="tx-b ai tx-typing" aria-label={busy === "look" ? "Looking it up online" : status || "Thinking"}><i /><i /><i /></div>{busy === "work" && status && <span className="tx-status">{status}</span>}</div>}
      </div>
      {!items.length && !busy && <div className="tx-starters">{starters.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}</div>}
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
