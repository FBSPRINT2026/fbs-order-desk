"use client";
import { useEffect, useRef, useState } from "react";
import { aiDraftReply } from "@/app/shop/ai-actions";

/**
 * Phones: the Assistant button in an email's bottom bar (Oct 12, Nick: "click the Assistant and it just listens to what
 * I say… 'yes we do everything, I'd love to set up a time to come' and it creates a draft… like the AI button on the
 * iPhone, the screen gets an effect but it's still listening"). The email stays on screen behind a glowing edge in
 * the shop's colors and what you say shows as you say it. Nothing is sent: the draft goes into the reply box to check
 * and send.
 *
 * A microphone you turn on and off yourself (Oct 12, Nick: "it thinks I'm done and goes to the next thing while I'm
 * thinking"): it keeps listening through pauses until you tap the mic off, you can type into what it heard, and it only
 * writes the reply when you tap Write the reply.
 */
export type Draft = { subject: string; body: string };
type Listener = { text: string; on: boolean; err: string; sub: (() => void) | null; stop: () => void };
/** iPhones and iPads hand the words back more reliably one stretch at a time (it starts again after each pause) */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * Start listening right away (it has to start inside the tap, or the phone won't allow the microphone). The phone stops
 * listening by itself after a pause; while the mic is on it quietly starts again, keeping everything said so far.
 * When it can't listen here at all, the keyboard comes up instead (its own mic works everywhere): a stand-in field takes
 * the focus inside the tap, so the box can take it over a moment later.
 */
export function startListening(before = ""): Listener | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any, S = w.SpeechRecognition || w.webkitSpeechRecognition;
  const keyboard = () => {
    const t = document.createElement("textarea");
    t.setAttribute("aria-hidden", "true"); t.style.cssText = "position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;font-size:16px";
    document.body.appendChild(t); t.focus(); setTimeout(() => t.remove(), 800);
  };
  if (!S) { keyboard(); return null; }
  let want = true, kept = before.trim(), restarts = 0;
  const l: Listener = { text: kept, on: true, err: "", sub: null, stop: () => { want = false; try { r.stop(); } catch { /* stopped */ } } };
  let r = make();
  function make() {
    const x = new S();
    x.lang = "en-US"; x.interimResults = true; x.continuous = !isIOS(); x.maxAlternatives = 1;
    let fin = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + " "; else interim += t; }
      l.text = [kept, (fin + interim).trim()].filter(Boolean).join(" ").replace(/\s+/g, " "); restarts = 0; l.sub?.();
    };
    x.onend = () => {
      kept = l.text;
      // still on: listen again (a pause isn't the end); a few quick ends in a row with nothing new means it can't
      if (want && restarts++ < 6) { setTimeout(() => { if (!want) return; try { r = make(); r.start(); } catch { want = false; l.on = false; l.sub?.(); } }, 150); return; }
      want = false; l.on = false; l.sub?.();
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x.onerror = (e: any) => {
      if (e?.error === "no-speech" || e?.error === "aborted") return; // a quiet moment: it starts again on its own
      want = false; l.on = false;
      l.err = e?.error === "not-allowed" ? "The microphone isn't allowed. Type it here, or tap the mic and choose Allow." : "Couldn't hear that. Tap the mic to try again, or type it.";
      l.sub?.();
    };
    return x;
  }
  try { r.start(); } catch { keyboard(); return null; }
  return l;
}

export default function VoiceDraft({ chatId, who, listener: first, onDraft, onClose, openChat }: { chatId: string; who?: string; listener: Listener | null; onDraft: (d: Draft) => void; onClose: () => void; openChat?: () => void }) {
  const [listener, setListener] = useState(first);
  const [text, setText] = useState(first?.text || ""), [on, setOn] = useState(!!first?.on);
  const [phase, setPhase] = useState<"listen" | "think" | "answer">("listen"), [answer, setAnswer] = useState(""), [err, setErr] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null), textRef = useRef(text); textRef.current = text;
  const micOff = () => { listener?.stop(); setOn(false); };
  const micOn = () => { setErr(""); const l = startListening(textRef.current); setListener(l); setOn(!!l?.on); };
  const write = async () => {
    const said = textRef.current.trim();
    if (!said || phase === "think") return;
    micOff(); setPhase("think"); setErr("");
    const r = await aiDraftReply(chatId, said).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { setPhase("listen"); setErr(r.error); return; }
    if (r.draft) { onDraft(r.draft); onClose(); return; }
    setAnswer(r.said || "It didn't write a reply. Say a little more about what to tell them."); setPhase("answer");
  };
  useEffect(() => {
    if (!listener) { setTimeout(() => boxRef.current?.focus(), 60); return; }
    listener.sub = () => { setText(listener.text); setOn(listener.on); if (listener.err) setErr(listener.err); };
    return () => { listener.sub = null; };
  }, [listener]);
  // closing stops the microphone
  const stopRef = useRef(micOff); stopRef.current = micOff;
  useEffect(() => () => stopRef.current(), []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  // the box follows what it hears; scrolled to the end
  useEffect(() => { const el = boxRef.current; if (el && on) el.scrollTop = el.scrollHeight; }, [text, on]);

  return (
    <div className={"vd" + (phase === "think" ? " think" : "") + (on ? " live" : "")} role="dialog" aria-modal="true" aria-label="Assistant">
      <div className="vd-glow" aria-hidden /><div className="vd-glow vd-glow2" aria-hidden />
      <button type="button" className="vd-shade" aria-label="Close" onClick={onClose} />
      <div className="vd-card">
        <div className="vd-h">
          <span className="vd-orb" aria-hidden />
          <b>{phase === "think" ? "Writing your reply…" : phase === "answer" ? "Assistant" : on ? "Listening… take your time" : "What do you want to tell them?"}</b>
          {who && phase !== "answer" && <span className="vd-who">Reply to {who}</span>}
        </div>
        {phase === "answer" ? <p className="vd-ans">{answer}</p>
          : <textarea ref={boxRef} className={"vd-in" + (on ? " live" : "")} rows={4} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => { if (on) micOff(); }} disabled={phase === "think"}
            placeholder={on ? "Say what you want to tell them, like “Yes, we do all of that. I'd love to set up a time to come by.” Pause as long as you like." : "Say or type what you want to tell them"} aria-label="What you want to tell them" />}
        {err && <div className="vd-err">{err}</div>}
        <div className="vd-acts">
          <button type="button" className="vd-b" onClick={onClose}>Cancel</button>
          {phase !== "think" && phase !== "answer" && <button type="button" className={"vd-mic" + (on ? " on" : "")} onClick={on ? micOff : micOn} aria-pressed={on} aria-label={on ? "Turn the microphone off" : "Turn the microphone on"}>
            <svg viewBox="0 0 24 24" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />{!on && <path d="M4 4l16 16" />}</svg>
          </button>}
          {phase === "answer" && openChat && <button type="button" className="vd-b" onClick={() => { onClose(); openChat(); }}>Open the chat</button>}
          {phase !== "think" && <button type="button" className="vd-b go" disabled={!text.trim()} onClick={() => { if (phase === "answer") { setPhase("listen"); setAnswer(""); } void write(); }}>Write the reply</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * Phones: "Tell the AI what to say" as a mic button in every reply box (Oct 12, Nick: "make this an automatic mic button
 * when you click, like the Assistant"). Tap it, it listens, and the reply it writes goes into the reply box.
 */
export function SayButton({ chatId, who, onDraft }: { chatId: string; who?: string; onDraft: (d: Draft) => void }) {
  const [v, setV] = useState<{ l: Listener | null } | null>(null);
  return (
    <>
      <button type="button" className="vd-say" onClick={() => setV({ l: startListening() })}>
        <span className="vd-say-mic" aria-hidden><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg></span>
        <span className="vd-say-t">Tell the AI what to say</span>
        <span className="vd-say-ai" aria-hidden>✦</span>
      </button>
      {v && <VoiceDraft chatId={chatId} who={who} listener={v.l} onDraft={onDraft} onClose={() => setV(null)} />}
    </>
  );
}
