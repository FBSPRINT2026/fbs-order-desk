"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { hm, jobMinutes, timeLabel, type JobTime } from "@/lib/timeclock";

/**
 * The employee app (portal.fbsprint.com/work), English / Spanish: logs time on each job, nothing else (the shift
 * clock is separate). Sign in once on your phone with your employee number and PIN. Scan Job (the barcode on the
 * box label or work order, or type the number) → what you're starting (Front, Back, Setup…) → Start; Finish.
 */
type Lang = "en" | "es";
type Job = { kind: "o" | "a"; id: string; number: string; name: string; customer: string; qty: number; due: string | null; spots: string[] };
type Plan = Job & { assignment: string; note: string; station: string; done: boolean };
type Me = { signedIn: boolean; name?: string; lang?: Lang; code?: number; tasks?: string[]; job?: JobTime | null; today?: JobTime[]; shift?: { starts_at: string; ends_at: string; station: string } | null; plan?: Plan[] };

const T = {
  en: {
    signIn: "Sign In", empNo: "Employee #", pin: "PIN", hi: "Hi", today: "Today", myJobs: "My Jobs Today", shift: "Your shift", noPlan: "No jobs assigned yet. Scan a job ticket to start one.", allDone: "The whole job is done", doneTag: "Done", logged: "logged", other: "Scan A Job Ticket", notOnJob: "Not on a job right now.", total: "total", running: "now", scan: "Scan Job", type: "Type the order #", find: "Find", onJob: "Working on",
    finish: "Finish", switch: "Scan Another Job", whatStart: "What are you starting?", start: "Start", pieces: "How many pieces did you finish?", skip: "Skip",
    cancel: "Cancel", notFound: "No order with that number.", nojob: "You're not on a job.", bad: "Wrong employee # or PIN.", locked: "Too many tries. Wait 5 minutes.", nopin: "You don't have a PIN yet. Ask a manager.",
    aim: "Point the camera at the barcode", noCam: "Can't use the camera. Type the number instead.",
    started: "Started", finished: "Finished", signOut: "Sign out", pcs: "pcs", due: "due", thanks: "Nice work!", saved: "Saved",
  },
  es: {
    signIn: "Entrar", empNo: "Nº de empleado", pin: "PIN", hi: "Hola", today: "Hoy", myJobs: "Mis Trabajos de Hoy", shift: "Tu turno", noPlan: "Aún no tienes trabajos asignados. Escanea una orden para empezar.", allDone: "El trabajo completo está terminado", doneTag: "Listo", logged: "registrado", other: "Escanear Una Orden", notOnJob: "No estás en un trabajo ahora.", total: "total", running: "ahora", scan: "Escanear Trabajo", type: "Escribe el nº de orden", find: "Buscar", onJob: "Trabajando en",
    finish: "Terminar", switch: "Escanear Otro Trabajo", whatStart: "¿Qué vas a empezar?", start: "Empezar", pieces: "¿Cuántas piezas terminaste?", skip: "Omitir",
    cancel: "Cancelar", notFound: "No hay orden con ese número.", nojob: "No estás en un trabajo.", bad: "Nº de empleado o PIN incorrecto.", locked: "Demasiados intentos. Espera 5 minutos.", nopin: "Todavía no tienes PIN. Pídelo a un gerente.",
    aim: "Apunta la cámara al código de barras", noCam: "No se puede usar la cámara. Escribe el número.",
    started: "Empezaste", finished: "Terminaste", signOut: "Salir", pcs: "pzs", due: "entrega", thanks: "¡Buen trabajo!", saved: "Guardado",
  },
};
const ES: Record<string, string> = {
  "Setup": "Preparación", "Printing": "Impresión", "Embroidery": "Bordado", "DTF / Heat Press": "DTF / Plancha", "Screen Prep": "Preparar mallas", "Folding & Bagging": "Doblar y embolsar",
  "Quality Check": "Revisión de calidad", "Packing & Shipping": "Empacar y enviar", "Cleanup": "Limpieza", "Full Front": "Frente", "Full Back": "Espalda", "Front": "Frente", "Back": "Espalda",
  "Left Chest": "Pecho izquierdo", "Right Chest": "Pecho derecho", "Sleeve": "Manga", "Left Sleeve": "Manga izquierda", "Right Sleeve": "Manga derecha", "Back Neck": "Nuca", "Nape": "Nuca",
  "Hat Front": "Frente de gorra", "Pocket": "Bolsillo", "(Embroidery)": "(Bordado)",
};
const tr = (lang: Lang, s: string) => (lang === "es" ? s.split(/(\(.*?\))/).map((p) => ES[p.trim()] || ES[p] || p).join(" ").replace(/\s+/g, " ").trim() : s);

declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }; ZXingBrowser?: { BrowserMultiFormatReader: new () => { decodeFromStream: (s: MediaStream, v: HTMLVideoElement, cb: (r: { getText: () => string } | undefined) => void) => Promise<{ stop: () => void }> } } } }

export default function WorkApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const [code, setCode] = useState(""), [pin, setPin] = useState(""), [field, setField] = useState<"code" | "pin">("code");
  const [view, setView] = useState<"" | "scan" | "job" | "finish">("");
  const [job, setJob] = useState<Job | null>(null);
  const [typed, setTyped] = useState(""), [pieces, setPieces] = useState(""), [allDone, setAllDone] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [toast, setToast] = useState("");
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const r = await fetch("/api/work", { cache: "no-store" }).catch(() => null);
    const j = r ? ((await r.json().catch(() => null)) as Me | null) : null;
    if (j) { setMe(j); if (j.lang) setLang(j.lang); }
  }, []);
  useEffect(() => {
    try { const l = localStorage.getItem("fbs_lang"); if (l === "es" || l === "en") setLang(l); } catch { /* private mode */ }
    load(); const i = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(i);
  }, [load]);
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    return { ok: !!r?.ok, j: r ? await r.json().catch(() => ({})) : { error: "offline" } };
  };
  const errText = (e: string) => (t as Record<string, string>)[e] || e;
  // opened from a job's phone menu ("Log time"): go straight to that job
  const fromLink = useRef(false);
  useEffect(() => {
    if (!me?.signedIn || fromLink.current) return;
    const j = new URLSearchParams(location.search).get("job");
    fromLink.current = true;
    if (j) { history.replaceState(null, "", location.pathname); lookup(j); }
  }, [me?.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3500); };
  function switchLang(l: Lang) { setLang(l); try { localStorage.setItem("fbs_lang", l); } catch { /* ignore */ } if (me?.signedIn) post({ action: "lang", lang: l }); }

  async function login() {
    setBusy(true); setErr("");
    const r = await post({ action: "login", code, pin });
    setBusy(false); setPin("");
    if (!r.ok) return setErr(errText(r.j.error || "bad"));
    load();
  }
  async function lookup(text: string) {
    setBusy(true); setErr("");
    const r = await post({ action: "lookup", text });
    setBusy(false);
    if (!r.ok) { setErr(t.notFound); setView("scan"); return; }
    setJob(r.j.job); setView("job");
  }
  async function start(task: string) {
    if (!job) return;
    setBusy(true); setErr("");
    const r = await post({ action: "job_start", job: { kind: job.kind, id: job.id }, task });
    setBusy(false);
    if (!r.ok) return setErr(errText(r.j.error || "bad"));
    setMe({ ...me!, ...r.j }); setView(""); setJob(null); flash(`${t.started}: #${job.number} · ${tr(lang, task)}`);
  }
  async function finish() {
    setBusy(true); setErr("");
    const run = me?.job;
    const plan = run ? (me?.plan || []).find((p) => (p.kind === "o" ? run.order_id : run.archived_order_id) === p.id) : null;
    const r = await post({ action: "job_stop", pieces: pieces === "" ? null : +pieces, done: allDone, assignment: plan?.assignment });
    setBusy(false);
    if (!r.ok) return setErr(errText(r.j.error || "bad"));
    setMe({ ...me!, ...r.j }); setView(""); setPieces(""); setAllDone(false); flash(`${t.finished}. ${t.thanks}`);
  }

  const Langs = () => <div className="wk-lang">{(["en", "es"] as Lang[]).map((l) => <button key={l} type="button" className={lang === l ? "on" : ""} onClick={() => switchLang(l)}>{l === "en" ? "English" : "Español"}</button>)}</div>;

  if (!me) return <div className="wk wk-center"><div className="tc-spin" /></div>;
  if (!me.signedIn) {
    const val = field === "code" ? code : pin;
    const setVal = field === "code" ? setCode : setPin;
    return (
      <div className="wk">
        <header className="wk-top"><img src="/brand/fbs-logo-white.svg" alt="FBS" /><Langs /></header>
        <main className="wk-main">
          <h1>{t.signIn}</h1>
          <div className="wk-fields">
            <button type="button" className={"wk-field" + (field === "code" ? " on" : "")} onClick={() => setField("code")}><span>{t.empNo}</span><b>{code || "—"}</b></button>
            <button type="button" className={"wk-field" + (field === "pin" ? " on" : "")} onClick={() => setField("pin")}><span>{t.pin}</span><b>{pin ? "•".repeat(pin.length) : "—"}</b></button>
          </div>
          {err && <div className="wk-err">{err}</div>}
          <div className="wk-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "next"].map((k) => (
            <button key={k} type="button" className={k.length > 1 ? "fn" : ""} onClick={() => {
              if (k === "back") return setVal(val.slice(0, -1));
              if (k === "next") return field === "code" ? setField("pin") : login();
              setVal((val + k).slice(0, field === "code" ? 6 : 6));
            }}>{k === "back" ? "⌫" : k === "next" ? (field === "code" ? "→" : "✓") : k}</button>
          ))}</div>
          <button type="button" className="wk-go" disabled={!code || pin.length < 4 || busy} onClick={login}>{busy ? "…" : t.signIn}</button>
        </main>
      </div>
    );
  }

  const running = me.job || null;
  return (
    <div className="wk">
      <header className="wk-top"><img src="/brand/fbs-logo-white.svg" alt="FBS" /><Langs /></header>
      <main className="wk-main">
        {toast && <div className="wk-toast">{toast}</div>}
        {err && <div className="wk-err">{err}</div>}

        {view === "scan" ? (
          <Scanner t={t} busy={busy} typed={typed} setTyped={setTyped} onCode={lookup} onCancel={() => { setView(""); setErr(""); }} />
        ) : view === "job" && job ? (
          <section className="wk-card">
            <div className="wk-jobh"><b>#{job.number}</b><span>{job.customer}</span><small>{[job.name, job.qty ? `${job.qty} ${t.pcs}` : ""].filter(Boolean).join(" · ")}</small></div>
            <h2>{t.whatStart}</h2>
            <div className="wk-tiles">
              {job.spots.map((s) => <button key={s} type="button" className="wk-tile spot" disabled={busy} onClick={() => start(s)}>{tr(lang, s)}</button>)}
              {(me.tasks || []).map((s) => <button key={s} type="button" className="wk-tile" disabled={busy} onClick={() => start(s)}>{tr(lang, s)}</button>)}
            </div>
            <button type="button" className="wk-ghost" onClick={() => { setView(""); setJob(null); }}>{t.cancel}</button>
          </section>
        ) : view === "finish" && running ? (
          <section className="wk-card">
            <div className="wk-jobh"><b>{running.job_label}</b><small>{tr(lang, running.task)} · {hm(jobMinutes(running))}</small></div>
            <h2>{t.pieces}</h2>
            <div className="wk-pieces">{pieces || "—"}</div>
            <div className="wk-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map((k, i) => k ? <button key={i} type="button" className={k === "back" ? "fn" : ""} onClick={() => setPieces((p) => (k === "back" ? p.slice(0, -1) : (p + k).slice(0, 5)))}>{k === "back" ? "⌫" : k}</button> : <span key={i} />)}</div>
            {(me.plan || []).some((p) => (p.kind === "o" ? running.order_id : running.archived_order_id) === p.id) && <label className="wk-check"><input type="checkbox" checked={allDone} onChange={(e) => setAllDone(e.target.checked)} />{t.allDone}</label>}
            <div className="wk-row"><button type="button" className="wk-ghost" disabled={busy} onClick={() => { setPieces(""); finish(); }}>{t.skip}</button><button type="button" className="wk-go stop" disabled={busy} onClick={finish}>{t.finish}{pieces ? ` · ${pieces} ${t.pcs}` : ""}</button></div>
            <button type="button" className="wk-ghost" onClick={() => setView("")}>{t.cancel}</button>
          </section>
        ) : (<>
          <h1 className="wk-hi">{t.hi}, {me.name}</h1>
          {me.shift && <div className="wk-shiftline">{t.shift}: <b>{timeLabel(me.shift.starts_at)} – {timeLabel(me.shift.ends_at)}</b>{me.shift.station ? ` · ${me.shift.station}` : ""}</div>}
          {running ? (
            <section className="wk-card wk-onjob">
              <span className="wk-state">{t.onJob}</span>
              <b className="wk-jl">{running.job_label}</b>
              <span>{tr(lang, running.task)}{running.station ? ` · ${running.station}` : ""} · {timeLabel(running.started_at)} · <b>{hm(jobMinutes(running))}</b></span>
              <button type="button" className="wk-go stop big" onClick={() => { setView("finish"); setErr(""); }}>{t.finish}</button>
              <button type="button" className="wk-ghost" onClick={() => { setView("scan"); setErr(""); }}>{t.switch}</button>
            </section>
          ) : null}
          <section className="wk-card wk-plan">
            <div className="wk-logh"><b>{t.myJobs}</b></div>
            {(me.plan || []).length ? <ul>{(me.plan || []).map((p, i) => {
              const mins = (me.today || []).filter((j) => (p.kind === "o" ? j.order_id : j.archived_order_id) === p.id).reduce((a, j) => a + jobMinutes(j), 0);
              const on = running && (p.kind === "o" ? running.order_id : running.archived_order_id) === p.id;
              return (
                <li key={p.assignment}><button type="button" className={"wk-pj" + (p.done ? " done" : "") + (on ? " on" : "")} onClick={() => { setJob(p); setView("job"); setErr(""); }}>
                  <i>{p.done ? "✓" : i + 1}</i>
                  <span className="wk-pjm"><b>#{p.number} {p.customer}</b><small>{[p.name, p.qty ? `${p.qty} ${t.pcs}` : "", p.station, p.note].filter(Boolean).join(" · ")}</small></span>
                  <span className="wk-pjt">{on ? t.running : p.done ? t.doneTag : ""}{mins ? <b>{hm(mins)}</b> : null}</span>
                </button></li>
              );
            })}</ul> : <p className="wk-hint">{t.noPlan}</p>}
          </section>
          <button type="button" className="wk-scan" onClick={() => { setView("scan"); setErr(""); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" /><path d="M7 8v8M10 8v8M13 8v8M17 8v8" /></svg>
            {(me.plan || []).length ? t.other : t.scan}
          </button>
          {(me.today || []).length > 0 && (
            <section className="wk-card wk-log">
              <div className="wk-logh"><b>{t.today}</b><span>{hm((me.today || []).reduce((a, j) => a + jobMinutes(j), 0))} {t.total}</span></div>
              <ul>{(me.today || []).map((j) => (
                <li key={j.id}><span><b>{j.job_label.split(" ")[0]}</b> {tr(lang, j.task)}</span><span className="wk-logt">{timeLabel(j.started_at)}{j.ended_at ? `–${timeLabel(j.ended_at)}` : ` · ${t.running}`}</span><b>{hm(jobMinutes(j))}{j.pieces != null ? ` · ${j.pieces} ${t.pcs}` : ""}</b></li>
              ))}</ul>
            </section>
          )}
          <button type="button" className="wk-out" onClick={async () => { await post({ action: "logout" }); setMe({ signedIn: false }); }}>{t.signOut} · #{me.code}</button>
        </>)}
      </main>
    </div>
  );
}

/** The camera scanner: the phone's built-in barcode reader when it has one, otherwise a small reader library. */
function Scanner({ t, busy, typed, setTyped, onCode, onCancel }: { t: (typeof T)["en"]; busy: boolean; typed: string; setTyped: (s: string) => void; onCode: (s: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [camErr, setCamErr] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, controls: { stop: () => void } | null = null, raf = 0;
    const found = (s: string) => { if (stop) return; stop = true; if (navigator.vibrate) navigator.vibrate(80); onCode(s); };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream; await video.current.play().catch(() => {});
        if (window.BarcodeDetector) {
          const det = new window.BarcodeDetector({ formats: ["code_128", "code_39", "qr_code", "ean_13", "upc_a"] });
          const loop = async () => { if (stop || !video.current) return; try { const c = await det.detect(video.current); if (c[0]?.rawValue) return found(c[0].rawValue); } catch { /* keep trying */ } raf = requestAnimationFrame(loop); };
          loop();
        } else {
          await new Promise<void>((res, rej) => { if (window.ZXingBrowser) return res(); const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js"; sc.onload = () => res(); sc.onerror = () => rej(new Error("load")); document.head.appendChild(sc); });
          if (!window.ZXingBrowser || !video.current || !stream) throw new Error("no reader");
          controls = await new window.ZXingBrowser.BrowserMultiFormatReader().decodeFromStream(stream, video.current, (r) => { if (r) found(r.getText()); });
        }
      } catch { setCamErr(true); }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); controls?.stop(); stream?.getTracks().forEach((x) => x.stop()); };
  }, [onCode]);
  return (
    <section className="wk-card wk-scanner">
      {!camErr ? <div className="wk-cam"><video ref={video} playsInline muted /><i className="wk-aim" /><span>{t.aim}</span></div> : <div className="wk-err">{t.noCam}</div>}
      <div className="wk-typed"><input inputMode="numeric" placeholder={t.type} value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d-]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && typed) onCode(typed); }} /><button type="button" className="wk-go" disabled={!typed || busy} onClick={() => onCode(typed)}>{t.find}</button></div>
      <button type="button" className="wk-ghost" onClick={onCancel}>{t.cancel}</button>
    </section>
  );
}
