"use client";
import { useState } from "react";
import Link from "next/link";
import type { MsgRead } from "@/lib/messageRead";
import { msgAiApply, msgAiDone, msgAiNo, msgAiRead } from "@/app/shop/jobs/actions";

/**
 * The AI's read of a customer's message, as one card under it (Nick, Nov 16 2026: "would you like me to update the
 * shipping address to this?… this is on our side"). One line saying what it means, the order now → after, and one
 * button that does it through the AI order helper (lib/ai/messageRead.ts). The same card wherever the message shows:
 * the Job Center's FBS Messages thread and a job's timeline.
 */
export default function MsgAiCard({ id, read, handled, orderId, onChanged, onReply }: {
  id: string; read: MsgRead; handled: boolean; orderId?: string | null;
  /** something changed: the list should be read again */ onChanged?: () => void;
  /** put this text in the reply box */ onReply?: (text: string) => void;
}) {
  const [r, setR] = useState<MsgRead>(read), [done, setDone] = useState(handled);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [no, setNo] = useState<string | null>(null);
  const go = async (k: string, f: () => Promise<{ ok: boolean; error?: string }>) => { setBusy(k); setErr(""); const x = await f(); setBusy(""); if (!x.ok) setErr(x.error || "Couldn't."); return x.ok; };

  const apply = () => go("apply", async () => {
    const x = await msgAiApply(id);
    if (x.ok) { setR({ ...r, done: { at: new Date().toISOString(), by: "", applied: x.applied } }); setDone(true); onChanged?.(); }
    return x;
  });
  const again = () => go("read", async () => { const x = await msgAiRead(id); if (x.ok) { setR(x.read); setDone(x.read.kind === "filed"); onChanged?.(); } return x; });
  const mark = (on: boolean) => go("done", async () => { const x = await msgAiDone(id, on); if (x.ok) { setDone(on); if (!on) setR({ ...r, kind: "todo" }); onChanged?.(); } return x; });
  const saveNo = () => go("no", async () => { const x = await msgAiNo(id, no || ""); if (x.ok) { setR({ ...r, kind: "todo", no: { at: new Date().toISOString(), by: "", note: no || undefined } }); setNo(null); setDone(false); onChanged?.(); } return x; });

  // applied
  if (r.done) return (
    <div className="mai ok" role="status">
      <span className="mai-s" aria-hidden>✓</span>
      <div className="mai-w"><b>Done{r.done.applied.length ? `: ${r.done.applied.join("; ")}` : ""}</b>
        {r.reply && onReply && <span className="mai-sub">Tell them? The reply is written for you to check.</span>}</div>
      {r.reply && onReply && <span className="mai-b"><button type="button" className="btn sm" onClick={() => onReply(r.reply!)}>Tell them it&apos;s done</button></span>}
    </div>
  );
  // filed: nothing for us to do
  if (r.kind === "filed" && done) return (
    <div className="mai filed">
      <span className="mai-s" aria-hidden>✓</span>
      <div className="mai-w"><span>Filed: {r.head}</span></div>
      <span className="mai-b"><button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => void mark(false)} title="Back on To do">Needs something after all</button></span>
    </div>
  );
  // done by hand
  if (done) return (
    <div className="mai filed">
      <span className="mai-s" aria-hidden>✓</span>
      <div className="mai-w"><span>Done: {r.head}</span></div>
      <span className="mai-b"><button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => void mark(false)}>Back on To do</button></span>
    </div>
  );
  const changes = !!r.changes?.length;
  return (
    <div className="mai">
      <span className="mai-s" aria-hidden>✦</span>
      <div className="mai-w">
        <b>{r.err && !changes && r.head === "Couldn't read this one" ? "The AI couldn't read this one" : r.head}</b>
        {(r.ba || []).map((x, i) => <span key={i} className="mai-ba">{x.k}: <s>{x.was}</s> → <b>{x.now}</b></span>)}
        {(r.says || []).map((x, i) => <span key={`s${i}`} className="mai-ba">{x}</span>)}
        {r.need === "change" && !changes && r.err && <span className="mai-sub">The order helper couldn&apos;t make it by itself{r.err && r.head !== "Couldn't read this one" ? `: ${r.err}` : "."}</span>}
        {!changes && r.reply && r.need !== "change" && <span className="mai-q">“{r.reply}”</span>}
        {r.no && <span className="mai-sub">You said: {r.no.note || "not this"}. It stays on To do.</span>}
        {no !== null && <span className="mai-no">
          <input type="text" value={no} onChange={(e) => setNo(e.target.value)} placeholder="What should it be? (it learns from this)" aria-label="What it should be" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") void saveNo(); if (e.key === "Escape") setNo(null); }} />
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => void saveNo()}>Save</button>
        </span>}
        {err && <span className="mai-err">{err}</span>}
      </div>
      <span className="mai-b">
        {changes && <button type="button" className="btn sm primary" disabled={!!busy} onClick={() => void apply()}>{busy === "apply" ? "Changing…" : r.btn || "Make the change"}</button>}
        {!changes && r.tool && <Link className="btn sm primary" href={r.tool.href}>{r.tool.label}</Link>}
        {!changes && r.need === "change" && orderId && <Link className="btn sm primary" href={`/shop/orders/${orderId}`}>Open the order</Link>}
        {!changes && r.reply && r.need !== "change" && onReply && <button type="button" className="btn sm primary" onClick={() => onReply(r.reply!)}>Use this reply</button>}
        {r.err && r.head === "Couldn't read this one"
          ? <button type="button" className="btn sm" disabled={!!busy} onClick={() => void again()}>{busy === "read" ? "Reading…" : "Read it again"}</button>
          : no === null && !r.no && <button type="button" className="btn sm" disabled={!!busy} onClick={() => setNo("")}>Not this</button>}
        {r.no && <button type="button" className="btn sm" disabled={!!busy} onClick={() => void again()}>{busy === "read" ? "Reading…" : "Read again"}</button>}
        <button type="button" className="btn sm ghost" disabled={!!busy} onClick={() => void mark(true)} title="Off To do without changing anything (handled by hand)">Done</button>
      </span>
    </div>
  );
}
