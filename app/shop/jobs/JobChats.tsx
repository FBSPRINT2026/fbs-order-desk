"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMsg, ChatSummary } from "@/lib/jobChats";
import { archiveJobChat, jobChatSend, jobChatThread } from "./actions";

export const ago = (s: string) => {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
};
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
export const whoOf = (c: ChatSummary) => (c.last.from === "customer" ? c.last.who || c.customer : "You");
// the short answers we send most (Nov 2, Nick: "approved, not approved, looks good, where's my tracking")

/** a conversation in one line: who, how long ago, what they said; colored by the stage its job is at */
export function ChatLine({ c, color, on, onClick, full = false }: { c: ChatSummary; color: string; on: boolean; onClick: () => void; full?: boolean }) {
  return (
    <button type="button" className={"jmb-c" + (on ? " on" : "") + (c.unread ? " new" : "") + (full ? " full" : "")} style={{ ["--mc" as string]: color }} onClick={onClick} aria-expanded={on}>
      {full && <span className="jmb-av" aria-hidden>{initials(c.last.from === "customer" ? c.last.who : c.customer)}</span>}
      <span className="jmb-m">
        <span className="jmb-top"><b>{whoOf(c)}</b><small>{ago(c.last.at)}</small>{c.unread > 0 && <span className="jmb-dot" aria-label={`${c.unread} new`} />}</span>
        <span className="jmb-q">{c.last.body}</span>
        {full && <small className="jmb-j">{c.number ? `#${c.number}${c.nickname ? ` ${c.nickname}` : ""}` : c.customer || "General"}{c.topic === "goods" ? " · goods" : ""}</small>}
      </span>
    </button>
  );
}

/**
 * One conversation, opened under its job in the Job Center's main panel (Nov 2, Nick: "the dropdown would be on the next
 * line… in the big area… a big typing area, reply, send attachments… send links"): the thread on the left, the reply on
 * the right with quick answers, files, the order's portal link and the pay link. Opening it marks it read.
 */
export function ChatThread({ c, color, onSent, onClose, onArchived, narrow = false }: { c: ChatSummary; color: string; onSent: () => void; onClose: () => void; /** archived or brought back: off the list */ onArchived?: () => void; /** in the message column: one column */ narrow?: boolean }) {
  const [arcBusy, setArcBusy] = useState(false);
  // Archive (Nov 6, Nick: "customer says… quote declined, too late, but I already called him… just click archive"): off the
  // Message Center with no reply; it comes back when they write again, and Archived shows it till then
  const archive = async (on: boolean) => { setArcBusy(true); const r = await archiveJobChat(c.key, on); setArcBusy(false); if (r.ok) onArchived?.(); };
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [files, setFiles] = useState<{ path: string; name: string; mime: string; size: number }[]>([]);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const pick = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let live = true; setMsgs(null); setErr("");
    void jobChatThread(c.key).then((r) => { if (live) { if (r.ok) setMsgs(r.messages); else setErr(r.error); } });
    return () => { live = false; };
  }, [c.key]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs]);
  async function addFiles(list: FileList | null) {
    if (!list?.length || !c.customerId) return;
    setUp(true); setErr("");
    try {
      for (const f of [...list].slice(0, 10)) {
        const path = `messages/${c.customerId}/${crypto.randomUUID()}/${f.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file"}`;
        const r = await createClient().storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
        if (r.error) throw new Error(r.error.message);
        setFiles((x) => [...x, { path, name: f.name, mime: f.type || "application/octet-stream", size: f.size }]);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add that file."); }
    setUp(false);
  }
  async function send(body: string) {
    if (!body.trim() && !files.length) return;
    setBusy(true); setErr("");
    const r = await jobChatSend(c.key, body, files);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setMsgs((m) => [...(m || []), { id: `n${Date.now()}`, from: "staff", who: "", body: body.trim(), at: new Date().toISOString(), files: files.map((f) => ({ name: f.name, url: "" })) }]);
    setText(""); setFiles([]);
    onSent();
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const add = (s: string) => setText((t) => (t.trim() ? `${t.trim()} ${s}` : s));
  return (
    <div className={"jmb-t" + (narrow ? " narrow" : "")} style={{ ["--mc" as string]: color }}>
      <div className="jmb-th">
        <div className="jmb-th-h"><b>{c.last.from === "customer" ? c.last.who || c.customer : c.customer}</b><span className="faint">{c.number ? `#${c.number}${c.nickname ? ` ${c.nickname}` : ""}` : "General"}{c.customer ? ` · ${c.customer}` : ""}</span>{onArchived && <button type="button" className="linkbtn jmb-arc" disabled={arcBusy} onClick={() => void archive(!c.archived)} title={c.archived ? "Back on the Message Center" : "Finished: off New and Waiting on them; back in New when they write again"}>{c.archived ? "Not done" : "Done"}</button>}<button type="button" className="linkbtn" onClick={onClose}>Close</button></div>
        <div className="jmb-msgs" ref={box}>
          {!msgs ? <span className="faint">Loading…</span> : msgs.slice(-40).map((m) => (
            <div key={m.id} className={"jmb-b " + m.from}>
              <small>{m.from === "customer" ? m.who || "Customer" : "We"} · {ago(m.at)}</small>
              {m.body && <span>{m.body}</span>}
              {m.files.map((f, i) => f.url ? <a key={i} className="jmb-f" href={f.url} target="_blank" rel="noreferrer">📎 {f.name}</a> : <span key={i} className="jmb-f">📎 {f.name}</span>)}
            </div>
          ))}
        </div>
      </div>
      <div className="jmb-rep">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={`Write a reply${c.last.from === "customer" && c.last.who ? ` to ${c.last.who.split(/\s+/)[0]}` : ""}…`} aria-label="Reply"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(text); } }} />
        {files.length > 0 && <div className="jmb-files">{files.map((f, i) => <span key={f.path}>📎 {f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}>×</button></span>)}</div>}
        <div className="jmb-bar">
          <input ref={pick} type="file" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" className="btn sm" disabled={up || !c.customerId} onClick={() => pick.current?.click()}>{up ? "Adding…" : "📎 Attach"}</button>
          {c.orderId && <button type="button" className="btn sm" onClick={() => add(`${origin}/portal/orders/${c.orderId}`)}>🔗 Order link</button>}
          <button type="button" className="btn sm" onClick={() => add(`${origin}/portal?area=payments`)}>Pay link</button>
          <button type="button" className="btn primary sm jmb-send" disabled={busy || up || (!text.trim() && !files.length)} onClick={() => void send(text)}>{busy ? "Sending…" : "Send"}</button>
        </div>
        <small className="faint">Shows in their portal. No email for now.</small>
        {err && <p className="jmb-err">{err}</p>}
      </div>
    </div>
  );
}
