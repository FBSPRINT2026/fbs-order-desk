"use client";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/**
 * A search box with a microphone on the right: click it, speak, and the words are typed into the box
 * (the browser's own speech recognition: Chrome, Edge and Safari; the mic hides where it isn't available).
 * Drop-in for <input type="search" …>; onDictated fires once you stop talking (e.g. to run the search).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;
function speechApi(): Rec | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Put text in a React-controlled input or textarea as if it were typed, so its onChange runs. */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (set) set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * `append`: add what's said after what's already in the box (a message being written) instead of replacing it (a
 * search). `keepListening`: stay on through pauses until clicked again (talking through a longer note). `label`: what
 * the button says to screen readers and on hover.
 */
export function MicButton({ target, onDone, append = false, keepListening = false, label = "Search by voice", className = "", autoStart, off }: {
  target: () => HTMLInputElement | HTMLTextAreaElement | null; onDone?: (text: string) => void;
  append?: boolean; keepListening?: boolean; label?: string; className?: string;
  /** start listening whenever this changes to a new non-zero value (the Inbox's Assistant button) */ autoStart?: number;
  /** stop listening while true (the panel is hidden) */ off?: boolean;
}) {
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<Rec>(null);
  const want = useRef(false); // still wanted on (keepListening restarts after the browser's own stop)
  const startRef = useRef<() => void>(() => {});
  const onRef = useRef(false); onRef.current = on;
  useEffect(() => { setOk(!!speechApi()); return () => { want.current = false; try { rec.current?.abort(); } catch { /* already stopped */ } }; }, []);
  const seen = useRef(autoStart); // only a new press starts it, never the value it mounted with
  useEffect(() => { if (!ok || !autoStart || autoStart === seen.current) return; seen.current = autoStart; if (!onRef.current) startRef.current(); }, [autoStart, ok]);
  useEffect(() => { if (off && onRef.current) { want.current = false; setOn(false); try { rec.current?.stop(); } catch { /* already stopped */ } } }, [off]);
  if (!ok) return null;

  // keepListening: on until it's clicked off. The browser ends a recognition by itself after a pause, so it's started
  // again right away, keeping what was said (Oct 23, Nick: "the microphone… keeps turning off before I'm done talking…
  // because I'm pausing")
  const toggle = () => {
    // off: always off at once, even between the browser's stop and the restart (Oct 23, Nick: "doesn't shut off")
    if (on) { want.current = false; setOn(false); try { rec.current?.stop(); } catch { /* already stopped */ } return; }
    const S = speechApi(); if (!S) return;
    let said = "", typed = "";
    const before = append ? (target()?.value || "").replace(/\s+$/, "") : "";
    const join = (t: string) => (before && t ? `${before} ${t}` : before || t);
    want.current = true;
    const startRec = () => {
      const r = new S(); rec.current = r;
      r.lang = "en-US"; r.interimResults = true; r.continuous = keepListening; r.maxAlternatives = 1;
      const base = said;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onresult = (e: any) => {
        let fin = "", interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        said = (base && fin ? `${base.replace(/\s+$/, "")} ${fin.replace(/^\s+/, "")}` : base + fin);
        const el = target(); if (!el) return;
        // the box was emptied while listening (the message was sent): what was said before isn't brought back
        if (typed && !el.value.trim()) { want.current = false; setOn(false); try { r.stop(); } catch { /* */ } return; }
        typed = join(`${said} ${interim}`.replace(/\s+/g, " ").trim()); typeInto(el, typed);
      };
      r.onend = () => {
        if (keepListening && want.current) { setTimeout(() => { if (want.current) { try { startRec(); } catch { want.current = false; setOn(false); } } }, 120); return; }
        want.current = false; setOn(false);
        const el = target(); if (said.trim() && el) { el.focus(); onDone?.(el.value); }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.onerror = (e: any) => { if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") want.current = false; };
      r.start();
    };
    setOn(true);
    try { startRec(); } catch { want.current = false; setOn(false); }
  };
  startRef.current = toggle;

  return (
    <button type="button" className={"mic" + (on ? " on" : "") + (className ? " " + className : "")} onClick={toggle} aria-pressed={on}
      aria-label={on ? "Stop listening" : label} title={on ? "Listening… click to stop" : label}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
    </button>
  );
}

export default function SearchInput({ onDictated, ...rest }: InputHTMLAttributes<HTMLInputElement> & { onDictated?: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="sx">
      <input ref={ref} type="search" {...rest} />
      <MicButton target={() => ref.current} onDone={onDictated} />
    </span>
  );
}
