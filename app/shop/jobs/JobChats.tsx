"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMsg, ChatSummary } from "@/lib/jobChats";
import { jobChatSend, jobChatThread } from "./actions";

const ago = (s: string) => {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
};
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
// the short answers we send most (Nov 2, Nick: "approved, not approved, looks good, where's my tracking")
const QUICK = ["Thanks!", "Got it, we're on it.", "New proof coming today.", "Tracking sent.", "It's ready for pickup."];

/**
 * The Job Center's messages, on the left of the open tab (Nov 2, Nick, option 1 flipped: messages left, jobs right):
 * the conversations in this tab (each with who, which job, the short message and how long ago; unread in blue), and the
 * open one under them with quick replies and Send. Picking one also picks its job in the list.
 */
export default function JobChats({ chats, open, onOpen, color, label, onSent, tagOf, bare = false }: {
  chats: ChatSummary[]; open: string | null; onOpen: (key: string | null) => void; color: string; label: string;
  onSent: () => void; /** the stage a conversation's job is at, for the All tab */ tagOf?: (c: ChatSummary) => { t: string; c: string } | null;
  /** its title is the Messages tab above it (the Job Center) */ bare?: boolean;
}) {
  const cur = chats.find((c) => c.key === open) || null;
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) { setMsgs(null); return; }
    let live = true; setMsgs(null); setErr("");
    void jobChatThread(open).then((r) => { if (live) { if (r.ok) setMsgs(r.messages); else setErr(r.error); } });
    return () => { live = false; };
  }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs]);
  async function send(body: string) {
    if (!open || !body.trim()) return;
    setBusy(true); setErr("");
    const r = await jobChatSend(open, body);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setText("");
    setMsgs((m) => [...(m || []), { id: `n${Date.now()}`, from: "staff", who: "", body: body.trim(), at: new Date().toISOString(), files: 0 }]);
    onSent();
  }
  const fresh = chats.reduce((a, c) => a + c.unread, 0);
  return (
    <div className={"jcm" + (bare ? " bare" : "")} style={{ ["--c" as string]: color }}>
      {!bare && <div className="jcm-h"><b>Messages</b>{fresh > 0 ? <span className="jcm-n">{fresh} new</span> : <span className="faint">{label}</span>}</div>}
      <div className="jcm-list">
        {!chats.length && <div className="jcm-none faint">No customer messages here.</div>}
        {chats.map((c) => { const tg = tagOf?.(c); return (
          <button key={c.key} type="button" className={"jcm-c" + (c.key === open ? " on" : "") + (c.unread ? " new" : "")} onClick={() => onOpen(c.key === open ? null : c.key)} style={tg ? { ["--tc" as string]: tg.c } : undefined}>
            <span className="jcm-av" aria-hidden>{initials(c.last.from === "customer" ? c.last.who : c.customer)}</span>
            <span className="jcm-m">
              <span className="jcm-top"><b>{c.last.from === "customer" ? c.last.who || c.customer : c.customer}</b><small>{ago(c.last.at)}</small></span>
              <span className="jcm-q">{c.last.from === "staff" ? "You: " : ""}{c.last.body}</span>
              <small className="jcm-j">{c.number ? `#${c.number}${c.nickname ? ` ${c.nickname}` : ""}` : "General"}{c.topic === "goods" ? " · goods" : ""}{tg && tg.t !== "General" ? <> · <span className="jcm-tag">{tg.t}</span></> : null}</small>
            </span>
            {c.unread > 0 && <span className="jcm-dot" aria-label={`${c.unread} new`} />}
          </button>
        ); })}
      </div>
      {cur && (
        <div className="jcm-t">
          <div className="jcm-th"><b>{cur.number ? `#${cur.number} ${cur.nickname}` : cur.customer || "General"}</b><button type="button" className="linkbtn" onClick={() => onOpen(null)}>Close</button></div>
          <div className="jcm-msgs">
            {!msgs ? <span className="faint">Loading…</span> : msgs.slice(-30).map((m) => (
              <div key={m.id} className={"jcm-b " + m.from}>{m.from === "customer" && <small>{m.who} · {ago(m.at)}</small>}<span>{m.body || (m.files ? `Sent ${m.files} file${m.files === 1 ? "" : "s"}` : "")}</span></div>
            ))}
            <div ref={end} />
          </div>
          <div className="jcm-quick">{QUICK.map((q) => <button key={q} type="button" disabled={busy} onClick={() => void send(q)}>{q}</button>)}</div>
          <form className="jcm-in" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…" aria-label="Reply" />
            <button type="submit" className="btn primary sm" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send"}</button>
          </form>
          {err && <p className="jcm-err">{err}</p>}
        </div>
      )}
    </div>
  );
}
