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

/** Put text in a React-controlled input as if it were typed, so its onChange runs. */
function typeInto(el: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (set) set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function MicButton({ target, onDone }: { target: () => HTMLInputElement | null; onDone?: (text: string) => void }) {
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<Rec>(null);
  useEffect(() => { setOk(!!speechApi()); return () => { try { rec.current?.abort(); } catch { /* already stopped */ } }; }, []);
  if (!ok) return null;

  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const S = speechApi(); if (!S) return;
    const r = new S(); rec.current = r;
    r.lang = "en-US"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let said = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) said += t; else interim += t;
      }
      const el = target(); if (el) typeInto(el, (said + interim).trim());
    };
    r.onend = () => { setOn(false); const el = target(); if (said.trim() && el) { el.focus(); onDone?.(el.value); } };
    r.onerror = () => setOn(false);
    setOn(true);
    try { r.start(); } catch { setOn(false); }
  };

  return (
    <button type="button" className={"mic" + (on ? " on" : "")} onClick={toggle} aria-pressed={on}
      aria-label={on ? "Stop listening" : "Search by voice"} title={on ? "Listening… click to stop" : "Search by voice"}>
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
