"use client";
import { useCallback, useEffect, useState } from "react";
import { checkFilms, myPendingFilms, snoozeFilms, type PendingFilm } from "@/app/shop/sep-film-actions";

/**
 * "Did the films print right?" in the bottom-right corner of every shop page (Nick, Nov 23 2026: "it takes a while to
 * print the film… he should be able to go on to other tasks… a pop-up in the bottom right… hey, it printed right, or no
 * it didn't… then are we going to put it into Separo, are we going to print it ourselves… make it easy"). Each Print
 * Films is a card until someone answers; Later hides it for half an hour. Something's wrong asks what (it teaches the
 * separations) and how it'll be fixed: here in the Studio, in Separo, or by hand in Illustrator.
 */
export const FILMS_SENT = "fbs:films-sent";
export const PROBLEMS = ["Wrong size", "Colors split wrong", "Halftones / dots", "Rough edges", "Missing part", "Underbase wrong", "Too many screens", "Other"];

export default function FilmCheck() {
  const [rows, setRows] = useState<PendingFilm[]>([]);
  const load = useCallback(async () => { const r = await myPendingFilms().catch(() => null); if (r && r.ok) setRows(r.rows); }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    const on = () => void load();
    window.addEventListener(FILMS_SENT, on);
    return () => { clearInterval(t); window.removeEventListener(FILMS_SENT, on); };
  }, [load]);
  if (!rows.length) return null;
  return (
    <div className="fck-tray" data-nopopfit>
      {rows.map((r) => <div key={r.id}><Card r={r} done={() => setRows((x) => x.filter((y) => y.id !== r.id))} /></div>)}
    </div>
  );
}

function Card({ r, done }: { r: PendingFilm; done: () => void }) {
  const [step, setStep] = useState<"ask" | "bad">("ask"), [probs, setProbs] = useState<string[]>([]), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const mins = Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000);
  const href = `/shop/separations/${r.separation_id}`;
  const answer = async (ok: boolean, then?: string) => {
    setBusy(true); setErr("");
    const x = await checkFilms(r.id, ok, probs, note);
    setBusy(false);
    if (!x.ok) { setErr(x.error); return; }
    done();
    if (then) window.location.href = then;
  };
  return (
    <div className={"fck-card" + (step === "bad" ? " bad" : "")} role="status">
      <div className="fck-h">
        <b data-notranslate>{r.label} {r.location}</b>
        <small>{r.colors ? `${r.colors} film${r.colors === 1 ? "" : "s"} · ` : ""}{r.width_in ? `${(+r.width_in).toFixed(2).replace(/\.?0+$/, "")}" × ${(+(r.height_in || 0)).toFixed(2).replace(/\.?0+$/, "")}" · ` : ""}sent {mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}</small>
      </div>
      {step === "ask" ? <>
        <p>Did the films come out right? Check them on the light table.</p>
        <div className="fck-btns">
          <button type="button" className="fck-y" disabled={busy} onClick={() => void answer(true)}>✓ Printed right</button>
          <button type="button" className="fck-n" disabled={busy} onClick={() => setStep("bad")}>✗ Something&apos;s wrong</button>
        </div>
        <button type="button" className="linkbtn fck-later" onClick={() => { void snoozeFilms(r.id, 30); done(); }}>Later</button>
      </> : <>
        <p>What was wrong? (pick any)</p>
        <div className="fck-chips">{PROBLEMS.map((p) => <button key={p} type="button" className={probs.includes(p) ? "on" : ""} onClick={() => setProbs((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}>{p}</button>)}</div>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else (optional)" />
        <p className="fck-k">How will you fix it?</p>
        <div className="fck-opts">
          <button type="button" disabled={busy || !probs.length} onClick={() => void answer(false, href)}><b>Fix it here</b><small>Back to the Studio, then print again</small></button>
          <button type="button" disabled={busy || !probs.length} onClick={() => { window.open("https://separo.io", "_blank", "noopener"); void answer(false, `${href}?films=separo`); }}><b>Send to Separo</b><small>Opens Separo and the job: download the art, upload what comes back</small></button>
          <button type="button" disabled={busy || !probs.length} onClick={() => void answer(false, `${href}?films=illustrator`)}><b>Make them in Illustrator</b><small>Download our file, save your films back on the job</small></button>
        </div>
        {!probs.length && <small className="fck-hint">Pick what was wrong first.</small>}
        <button type="button" className="linkbtn fck-later" onClick={() => setStep("ask")}>Back</button>
      </>}
      {err && <small className="fck-err">{err}</small>}
    </div>
  );
}
