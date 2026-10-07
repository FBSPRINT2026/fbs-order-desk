"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { changeText, type CoachChange, type Lesson } from "@/lib/sepCoach";
import { MicButton } from "@/components/SearchInput";

type Turn = { id: string | null; message: string; reply: string; changes: CoachChange[]; applied: boolean; lesson?: { id: string; lesson: string } | null; at: string };

/**
 * "Make Separations Better" (Separation Studio, production + owner): tell it how this separation came out, on screen or
 * on press. It looks at the proof and the settings, says what it would change (one click to apply) and remembers what
 * should carry over to other separations for 30 days.
 */
export default function SepCoach({ sepId, designId, context, images, onApply }: {
  sepId: string; designId: string | null;
  /** the separation as it is now (settings, inks, plates, fades) */
  context: () => Record<string, unknown>;
  /** the soft proof and the original art, as JPEG data */
  images: () => { label: string; data: string }[];
  onApply: (changes: CoachChange[]) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [showLessons, setShowLessons] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const [{ data: f }, { data: l }] = await Promise.all([
      sb.from("sep_feedback").select("id, message, reply, changes, applied, lesson_id, created_at").eq("separation_id", sepId).order("created_at").limit(40),
      sb.from("sep_lessons").select("*").eq("active", true).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(60),
    ]);
    const ls = (l || []) as Lesson[];
    setLessons(ls);
    setTurns(((f || []) as { id: string; message: string; reply: string; changes: CoachChange[]; applied: boolean; lesson_id: string | null; created_at: string }[])
      .map((x) => ({ id: x.id, message: x.message, reply: x.reply, changes: x.changes || [], applied: x.applied, lesson: x.lesson_id ? { id: x.lesson_id, lesson: ls.find((q) => q.id === x.lesson_id)?.lesson || "" } : null, at: x.created_at })));
  }, [sb, sepId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns.length, busy]);

  async function send() {
    const m = text.trim(); if (!m || busy) return;
    setBusy(true); setErr("");
    const pending: Turn = { id: null, message: m, reply: "", changes: [], applied: false, at: new Date().toISOString() };
    setTurns((t) => [...t, pending]); setText("");
    try {
      const r = await fetch("/api/separations/coach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ separation_id: sepId, design_id: designId, message: m, context: context(), images: images() }) });
      const j = await r.json().catch(() => ({}));
      if (j.off) throw new Error(j.reason || "AI is turned off in Settings → Assistant.");
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't reach the coach. Try again.");
      setTurns((t) => t.map((x) => (x === pending ? { ...x, id: j.id, reply: j.reply, changes: j.changes || [], lesson: j.lesson ? { id: j.lesson.id, lesson: j.lesson.lesson } : null } : x)));
      if (j.lesson) setLessons((l) => [j.lesson as Lesson, ...l]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTurns((t) => t.filter((x) => x !== pending)); setText(m);
    }
    setBusy(false);
  }
  async function apply(t: Turn) {
    onApply(t.changes);
    setTurns((all) => all.map((x) => (x === t ? { ...x, applied: true } : x)));
    if (t.id) await sb.from("sep_feedback").update({ applied: true }).eq("id", t.id);
  }
  /** a lesson that's wrong: turned off (kept for the record) */
  async function forget(id: string) {
    await sb.from("sep_lessons").update({ active: false }).eq("id", id);
    setLessons((l) => l.filter((x) => x.id !== id));
    setTurns((all) => all.map((x) => (x.lesson?.id === id ? { ...x, lesson: { ...x.lesson, lesson: "" } } : x)));
  }
  const days = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));

  return (
    <section className="sep-card sep-coach">
      <h3>Make Separations Better</h3>
      <p className="sep-help">Tell it how this one came out, on screen or on press (&quot;came out good but the gradients needed more work&quot;). It looks at the proof, suggests changes, and remembers what to do next time for 30 days.</p>
      {turns.length > 0 && (
        <div className="sc-thread">
          {turns.map((t, i) => (
            <div key={(t.id || "p") + i} className="sc-turn">
              <div className="sc-me">{t.message}</div>
              {t.reply ? (
                <div className="sc-ai">
                  <div>{t.reply}</div>
                  {t.changes.length > 0 && (
                    <div className="sc-ch">
                      <ul>{t.changes.map((c, q) => <li key={q} title={c.why}>{changeText(c)}{c.why ? <small> · {c.why}</small> : null}</li>)}</ul>
                      {t.applied ? <span className="sc-done">Applied</span> : <button type="button" className="btn sm primary" onClick={() => apply(t)}>Apply {t.changes.length === 1 ? "change" : `${t.changes.length} changes`}</button>}
                    </div>
                  )}
                  {t.lesson?.lesson && <div className="sc-lesson"><b>Remembered:</b> {t.lesson.lesson} <button type="button" className="linkbtn" onClick={() => forget(t.lesson!.id)}>Forget</button></div>}
                </div>
              ) : <div className="sc-ai faint">Looking at the separation…</div>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      <div className="sc-in">
        <textarea ref={inRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="How did it come out? What should be better?" rows={2} aria-label="Tell the coach how the separation came out"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        {/* talk instead of typing: what's said is added to the box; read it over, then Send */}
        <MicButton target={() => inRef.current} append keepListening label="Talk to the coach (microphone)" className="sc-mic" />
        <button type="button" className="btn sm primary" disabled={busy || !text.trim()} onClick={send}>{busy ? "Thinking…" : "Send"}</button>
      </div>
      {err && <div className="pv-err">{err}</div>}
      <button type="button" className="linkbtn sc-lessons-t" onClick={() => setShowLessons((x) => !x)}>{lessons.length ? `What it's learned (${lessons.length})` : "Nothing learned yet"}{lessons.length ? (showLessons ? " ▴" : " ▾") : ""}</button>
      {showLessons && lessons.length > 0 && (
        <ul className="sc-lessons">{lessons.map((l) => (
          <li key={l.id}><span>{l.lesson}{l.default_setting ? <small> · new {l.default_setting.when === "all" ? "" : `${l.default_setting.when} `}seps start at {changeText({ setting: l.default_setting.setting, value: l.default_setting.value })}</small> : null}</span>
            <small className="faint">{l.tags?.includes("preset") ? "preset" : l.tags?.includes("separo") ? `from Separo · ${days(l.expires_at)}d` : `${days(l.expires_at)}d left`}</small><button type="button" className="linkbtn" onClick={() => forget(l.id)}>Forget</button></li>
        ))}</ul>
      )}
    </section>
  );
}
