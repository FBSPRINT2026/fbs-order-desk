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
type Listener = { text: string; on: boolean; err: string; heard: boolean; /** when the microphone actually opened (after you allowed it) */ liveAt: number; sub: (() => void) | null; stop: () => void; abort: () => void };
/** iPhones and iPads: listening "continuously" there often never hands back the words; one sentence at a time does */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const DEAD = "fbs:voice.dead"; // listening didn't work on this phone lately (the Home Screen app often can't): type instead
const voiceDead = () => { try { return Date.now() - Number(localStorage.getItem(DEAD) || 0) < 864e5; } catch { return false; } };
const markDead = () => { try { localStorage.setItem(DEAD, String(Date.now())); } catch { /* fine */ } };

/**
 * Start listening right away (it has to start inside the tap, or the phone won't allow the microphone). When it can't
 * listen here, the keyboard comes up instead (its own mic works everywhere): a stand-in field takes the focus inside
 * the tap, so the reply box can take it over a moment later.
 */
export function startListening(): Listener | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any, S = w.SpeechRecognition || w.webkitSpeechRecognition;
  const keyboard = () => {
    const t = document.createElement("textarea");
    t.setAttribute("aria-hidden", "true"); t.style.cssText = "position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;font-size:16px";
    document.body.appendChild(t); t.focus(); setTimeout(() => t.remove(), 800);
  };
  if (!S || voiceDead()) { keyboard(); return null; }
  const r = new S();
  r.lang = "en-US"; r.interimResults = true; r.continuous = !isIOS(); r.maxAlternatives = 1;
  let final = "";
  const l: Listener = { text: "", on: true, err: "", heard: false, liveAt: 0, sub: null, stop: () => { try { r.stop(); } catch { /* stopped */ } }, abort: () => { try { r.abort(); } catch { /* stopped */ } } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t + " "; else interim += t; }
    l.text = (final + interim).replace(/\s+/g, " ").trim(); l.heard = true; l.sub?.();
  };
  r.onaudiostart = () => { l.liveAt = Date.now(); l.sub?.(); };
  r.onend = () => { l.on = false; l.sub?.(); };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  r.onerror = (e: any) => { l.on = false; l.err = e?.error === "not-allowed" ? "The microphone isn't allowed. Type it here, or tap Assistant again and choose Allow." : e?.error === "no-speech" ? "" : "Couldn't hear that. Try again, or type it."; l.sub?.(); };
  try { r.start(); } catch { keyboard(); return null; }
  return l;
}

export default function VoiceDraft({ chatId, who, listener: first, onDraft, onClose, openChat }: { chatId: string; who?: string; listener: Listener | null; onDraft: (d: Draft) => void; onClose: () => void; openChat?: () => void }) {
  const [listener, setListener] = useState(first);
  const [text, setText] = useState(listener?.text || ""), [on, setOn] = useState(!!listener?.on);
  // typing instead: the keyboard (with its own mic) when listening isn't working or you'd rather type
  const typeInstead = (why = "") => { listener?.abort(); setOn(false); if (why) setErr(why); setTimeout(() => boxRef.current?.focus(), 30); };
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
      // it stopped without words: only say so when it was really listening (not while the phone asked about the mic)
      if (!listener.on && !listener.text && !listener.err && listener.liveAt) setErr("Didn't catch anything. Tap Talk to try again, or type it.");
    };
    // nothing heard after a few seconds (some phones open the microphone but never pass the words on): type it instead
    // (counted from when the microphone opened, so the phone's "allow the microphone?" question doesn't count)
    const dead = setInterval(() => { if (listener.liveAt && !listener.heard && listener.on && !sent.current && Date.now() - listener.liveAt > 7000) { clearInterval(dead); markDead(); typeInstead("Listening isn't working here. Type it, or tap the mic on your keyboard and talk."); } }, 500);
    return () => { clearInterval(dead); listener.sub = null; listener.abort(); if (quiet.current) clearTimeout(quiet.current); };
  }, [listener]); // eslint-disable-line react-hooks/exhaustive-deps
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
          {phase === "listen" && listener && on && <button type="button" className="vd-b" onClick={() => typeInstead()}>Type</button>}
          {phase === "listen" && !on && !text.trim() && <button type="button" className="vd-b" onClick={() => { setErr(""); try { localStorage.removeItem("fbs:voice.dead"); } catch { /* fine */ } const l = startListening(); setListener(l); setOn(!!l?.on); }}>Talk</button>}
          {phase === "answer" && openChat && <button type="button" className="vd-b" onClick={() => { onClose(); openChat(); }}>Open the chat</button>}
          {phase === "listen" && listener && on
            ? <button type="button" className="vd-b go" onClick={() => { if (text.trim()) void write(text); else typeInstead("Didn't catch anything yet. Type it here, or tap the mic on your keyboard."); }}>Done</button>
            : phase !== "think" && <button type="button" className="vd-b go" disabled={!text.trim()} onClick={() => { if (phase === "answer") { setPhase("listen"); setAnswer(""); } void write(text); }}>Write the reply</button>}
        </div>
      </div>
    </div>
  );
}
