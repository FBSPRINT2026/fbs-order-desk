"use client";
import { useEffect, useRef, useState } from "react";
import { timeAsk, timeApply, type DayPreview, type TimeOp } from "@/app/shop/time-actions";
import { dayLabel, hm } from "@/lib/timeclock";
import { useSticky } from "@/lib/useSticky";

/**
 * "Tell the time clock" (Oct 20, Nick: "I just wanna be able to talk to it that way and then it updates the time
 * cards"). Type or say what to fix; Claude works out the punches; you see each day before and after with its hours,
 * and nothing changes until Apply. Undo puts it back. Other parts of the page can hand it a sentence with the
 * `fbs:time-ask` event (the issue bubble's "Ask" does).
 */
type SR = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

const EXAMPLES = [
  "Johana didn't clock out for lunch today, give her a 30 minute lunch",
  "On Monday Maria Guzman worked from 10:32 to 4:35 with a 30 minute lunch",
  "Juan forgot to clock out yesterday, he left at 4:30",
];

export default function TimeAsk({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [res, setRes] = useState<{ said: string; understood: string; question: string; ops: TimeOp[]; preview: DayPreview[] } | null>(null);
  const [done, setDone] = useState<{ text: string; undo: TimeOp[] } | null>(null);
  const [lang, setLang] = useSticky<"en-US" | "es-US">("time.askLang", "en-US");
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null), boxRef = useRef<HTMLTextAreaElement>(null);
  const [canTalk, setCanTalk] = useState(false);
  useEffect(() => { const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }; setCanTalk(!!(w.SpeechRecognition || w.webkitSpeechRecognition)); }, []);
  // a sentence from elsewhere on the page (the issue bubble)
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t) { setText(t); setRes(null); setDone(null); setTimeout(() => { boxRef.current?.focus(); boxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 50); } };
    window.addEventListener("fbs:time-ask", on); return () => window.removeEventListener("fbs:time-ask", on);
  }, []);

  function talk() {
    if (listening) { recRef.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const C = w.SpeechRecognition || w.webkitSpeechRecognition; if (!C) return;
    const r = new C(); r.lang = lang; r.interimResults = true; r.continuous = false;
    const start = text.trim() ? text.trim() + " " : "";
    r.onresult = (e) => { let s = ""; for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript; setText(start + s); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recRef.current = r; setListening(true); setErr(""); r.start();
  }
  async function ask(said = text) {
    const t = said.trim(); if (!t) return;
    setBusy("Reading the time cards…"); setErr(""); setRes(null); setDone(null);
    const r = await timeAsk(t).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't reach the server." }));
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setRes({ said: t, understood: r.understood, question: r.question, ops: r.ops, preview: r.preview });
  }
  async function apply() {
    if (!res?.ops.length) return;
    setBusy("Saving…"); setErr("");
    const r = await timeApply(res.ops, res.said).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't save." }));
    setBusy("");
    if (!r.ok) return setErr(r.error);
    const who = [...new Set(res.preview.map((p) => p.name.split(" ")[0]))];
    setDone({ text: `Done. ${who.length === 1 ? `${who[0]}'s time card is` : `${who.join(", ")}'s time cards are`} updated (${r.done} change${r.done === 1 ? "" : "s"}).`, undo: r.undo });
    setRes(null); setText(""); onChanged();
  }
  async function undo() {
    if (!done?.undo.length) return;
    setBusy("Putting it back…");
    const r = await timeApply(done.undo, "Undo").catch(() => ({ ok: false as const, error: "Couldn't undo." }));
    setBusy("");
    if (!r.ok) return setErr(r.error);
    setDone({ text: "Put back the way it was.", undo: [] }); onChanged();
  }
  const opWord = (o: TimeOp) => {
    const k = { in: "Clock In", out: "Clock Out", break_start: "Lunch Out", break_end: "Lunch In" } as const;
    const t = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }) : "");
    return o.action === "add" ? `Add ${k[o.kind!]} ${t(o.at)}` : o.action === "move" ? `Move ${k[o.was!.kind]} ${t(o.was!.at)} → ${o.kind !== o.was!.kind ? k[o.kind!] + " " : ""}${t(o.at)}` : `Remove ${k[o.was!.kind]} ${t(o.was!.at)}`;
  };

  return (
    <section className="tk-ask" aria-label="Tell the time clock what to fix">
      <form className="tk-bar" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <span className="tk-spark" aria-hidden><svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg></span>
        <textarea ref={boxRef} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder={lang === "es-US" ? "Dígale al reloj qué corregir… “Johana no marcó su almuerzo hoy, dale 30 minutos”" : "Tell the time clock what to fix… “Johana didn't clock out for lunch today, give her 30 minutes”"} aria-label="What to fix" />
        {canTalk && <button type="button" className={"tk-mic" + (listening ? " on" : "")} onClick={talk} aria-label={listening ? "Stop listening" : "Say it"} title={listening ? "Listening… tap to stop" : "Say it"}><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></button>}
        {canTalk && <button type="button" className="tk-lang" onClick={() => setLang(lang === "en-US" ? "es-US" : "en-US")} title="Language for talking">{lang === "en-US" ? "EN" : "ES"}</button>}
        <button type="submit" className="btn primary tk-go" disabled={!!busy || !text.trim()}>{busy && !res ? "…" : "Fix it"}</button>
      </form>
      {!res && !done && !busy && !err && (
        <div className="tk-ex">{EXAMPLES.map((x) => <button key={x} type="button" onClick={() => { setText(x); boxRef.current?.focus(); }}>{x}</button>)}</div>
      )}
      {busy && <div className="tk-busy"><i /><i /><i /> {busy}</div>}
      {err && <div className="pv-err">{err}</div>}
      {res && (
        <div className="tk-res">
          {res.understood && <p className="tk-und">{res.understood}</p>}
          {res.question && <p className="tk-q">{res.question}</p>}
          {res.preview.map((p) => (
            <div key={p.employee_id + p.day} className="tk-pv">
              <div className="tk-pv-h"><b>{p.name}</b><span>{dayLabel(p.day)}</span></div>
              <div className="tk-pv-r was"><span>Before</span><em>{p.before.text}</em><b className="num">{hm(p.before.minutes)}</b></div>
              <div className="tk-pv-r now"><span>After</span><em>{p.after.text}</em><b className="num">{hm(p.after.minutes)}</b></div>
            </div>
          ))}
          {res.ops.length > 0 && <ul className="tk-ops">{res.ops.map((o, i) => <li key={i}>{opWord(o)}</li>)}</ul>}
          <div className="tk-act">
            <button type="button" className="btn ghost sm" onClick={() => setRes(null)}>Cancel</button>
            {res.ops.length > 0 && <button type="button" className="btn primary" disabled={!!busy} onClick={apply}>Apply {res.ops.length} change{res.ops.length === 1 ? "" : "s"}</button>}
          </div>
        </div>
      )}
      {done && <div className="tk-done"><span>✓ {done.text}</span>{done.undo.length > 0 && <button type="button" className="linkbtn" onClick={undo} disabled={!!busy}>Undo</button>}</div>}
    </section>
  );
}
