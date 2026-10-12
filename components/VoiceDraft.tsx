"use client";
import { useEffect, useRef, useState } from "react";
import { aiDraftReply } from "@/app/shop/ai-actions";

/**
 * Phones: the Assistant button in an email's bottom bar (Oct 12, Nick: "click the Assistant and it just listens to what
 * I say… 'yes we do everything, I'd love to set up a time to come' and it creates a draft… like the AI button on the
 * iPhone, the screen gets an effect but it's still listening"). The email stays on screen behind a glowing edge in
 * the shop's colors, what you say shows as you say it, and when you stop talking it writes the reply. Nothing is sent:
 * the draft goes into the reply box to check and send.
 */
export type Draft = { subject: string; body: string };
type Listener = { text: string; on: boolean; err: string; sub: (() => void) | null; stop: () => void; abort: () => void };

/** start listening right away (it has to start inside the tap, or the phone won't allow the microphone) */
export function startListening(): Listener | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any, S = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!S) return null;
  const r = new S();
  r.lang = "en-US"; r.interimResults = true; r.continuous = true; r.maxAlternatives = 1;
  let final = "";
  const l: Listener = { text: "", on: true, err: "", sub: null, stop: () => { try { r.stop(); } catch { /* stopped */ } }, abort: () => { try { r.abort(); } catch { /* stopped */ } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t + " "; else interim += t; }
    l.text = (final + interim).replace(/\s+/g, " ").trim(); l.sub?.();
  };
  r.onend = () => { l.on = false; l.sub?.(); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.onerror = (e: any) => { l.on = false; l.err = e?.error === "not-allowed" ? "The microphone isn't allowed for the portal. Type it instead, or allow it in Settings → Safari → Microphone." : e?.error === "no-speech" ? "" : "Couldn't hear that. Try again, or type it."; l.sub?.(); };
  try { r.start(); } catch { return null; }
  return l;
}

export default function VoiceDraft({ chatId, who, listener, onDraft, onClose, openChat }: { chatId: string; who?: string; listener: Listener | null; onDraft: (d: Draft) => void; onClose: () => void; openChat?: () => void }) {
  const [text, setText] = useState(listener?.text || ""), [on, setOn] = useState(!!listener?.on);
  const [phase, setPhase] = useState<"listen" | "think" | "answer">("listen"), [answer, setAnswer] = useState(""), [err, setErr] = useState("");
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null), sent = useRef(false), boxRef = useRef<HTMLTextAreaElement | null>(null);
  const write = async (said: string) => {
    if (sent.current || !said.trim()) return;
    sent.current = true; listener?.abort(); setOn(false); setPhase("think"); setErr("");
    const r = await aiDraftReply(chatId, said).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { sent.current = false; setPhase("listen"); setErr(r.error); return; }
    if (r.draft) { onDraft(r.draft); onClose(); return; }
    setAnswer(r.said || "It didn't write a reply. Say a little more about what to tell them."); setPhase("answer"); sent.current = false;
  };
  const writeRef = useRef(write); writeRef.current = write;
  useEffect(() => {
    if (!listener) { setTimeout(() => boxRef.current?.focus(), 60); return; }
    listener.sub = () => {
      setText(listener.text); setOn(listener.on); if (listener.err) setErr(listener.err);
      // when you stop talking for a moment, it writes the reply (like Siri)
      if (quiet.current) clearTimeout(quiet.current);
      if (listener.text && listener.on) quiet.current = setTimeout(() => void writeRef.current(listener.text), 2200);
      if (!listener.on && listener.text) void writeRef.current(listener.text);
    };
    return () => { listener.sub = null; listener.abort(); if (quiet.current) clearTimeout(quiet.current); };
  }, [listener]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  return (
    <div className={"vd" + (phase === "think" ? " think" : "")} role="dialog" aria-modal="true" aria-label="Assistant">
      <div className="vd-glow" aria-hidden /><div className="vd-glow vd-glow2" aria-hidden />
      <button type="button" className="vd-shade" aria-label="Close" onClick={onClose} />
      <div className="vd-card">
        <div className="vd-h">
          <span className="vd-orb" aria-hidden />
          <b>{phase === "think" ? "Writing your reply…" : phase === "answer" ? "Assistant" : on ? "Listening…" : "What do you want to tell them?"}</b>
          {who && phase !== "answer" && <span className="vd-who">Reply to {who}</span>}
        </div>
        {phase === "answer" ? <p className="vd-ans">{answer}</p>
          : listener && on ? <p className={"vd-said" + (text ? "" : " empty")} aria-live="polite">{text || "Say what you want to tell them, like “Yes, we do all of that. I'd love to set up a time to come by.”"}</p>
          : <textarea ref={boxRef} className="vd-in" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={phase === "think"} placeholder="Say or type what you want to tell them" aria-label="What you want to tell them" />}
        {err && <div className="vd-err">{err}</div>}
        <div className="vd-acts">
          <button type="button" className="vd-b" onClick={onClose}>Cancel</button>
          {phase === "answer" && openChat && <button type="button" className="vd-b" onClick={() => { onClose(); openChat(); }}>Open the chat</button>}
          {phase !== "think" && <button type="button" className="vd-b go" disabled={!text.trim()} onClick={() => { if (phase === "answer") { setPhase("listen"); setAnswer(""); } void write(text); }}>Write the reply</button>}
        </div>
      </div>
    </div>
  );
}
