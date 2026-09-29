"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { KIND_LABEL, hm, timeLabel, type Punch } from "@/lib/timeclock";

/**
 * The wall time clock (a tablet at the shop). Tap your name, enter your PIN, then Clock In / Start Break /
 * End Break / Clock Out. It can take a photo with each punch. A manager sets the tablet up once
 * (Time Clock → Settings → "Use this device as a time clock"); nobody has to be signed in on it.
 */
type Emp = { id: string; first_name: string; last_name: string; department: string; color: string; has_pin: boolean; state: "in" | "out" | "break"; since: string | null };
type Status = { next: Punch["kind"][]; todayMinutes: number; state: "in" | "out" | "break"; since: string | null; name?: string };

const COLORS = ["#0E9BD8", "#F26660", "#FCB122", "#0F8C78", "#7C5CD6", "#D0487A", "#3F7F2E", "#B8621B"];
const colorOf = (e: Emp, i: number) => e.color || COLORS[i % COLORS.length];
const initials = (e: Emp) => ((e.first_name[0] || "") + (e.last_name[0] || "")).toUpperCase() || "?";
const IDLE_MS = 25000;

export default function TimeClock() {
  const [info, setInfo] = useState<{ paired: boolean; device?: string; shop?: string; photo?: boolean; employees?: Emp[]; tasks?: string[]; stations?: string[] } | null>(null);
  const [now, setNow] = useState(new Date());
  const [who, setWho] = useState<Emp | null>(null);
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [done, setDone] = useState<{ text: string; sub: string } | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/time/kiosk", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (j) setInfo(j);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); const c = setInterval(() => setNow(new Date()), 1000); return () => { clearInterval(t); clearInterval(c); }; }, [load]);

  const stopCam = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const reset = useCallback(() => { setWho(null); setPin(""); setStatus(null); setErr(""); setDone(null); setQ(""); stopCam(); }, []);
  const poke = useCallback(() => { if (idle.current) clearTimeout(idle.current); idle.current = setTimeout(reset, IDLE_MS); }, [reset]);
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); stopCam(); }, []);

  // the camera preview appears with the punch buttons
  useEffect(() => { if (status && stream.current && video.current && !video.current.srcObject) { video.current.srcObject = stream.current; video.current.play().catch(() => {}); } }, [status]);
  async function startCam() {
    if (!info?.photo || stream.current || !navigator.mediaDevices?.getUserMedia) return;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); }
    } catch { /* no camera or not allowed: punches still work */ }
  }
  function snap(): string | null {
    const v = video.current;
    if (!v || !stream.current || !v.videoWidth) return null;
    const c = document.createElement("canvas"); const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w);
    c.width = w; c.height = h; c.getContext("2d")?.drawImage(v, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.72);
  }

  async function check(p: string) {
    if (!who) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/time/kiosk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: who.id, pin: p }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "No connection. Check the WiFi and try again." };
    setBusy(false);
    if (!r || !r.ok) { setErr(j.error || "Something went wrong."); setPin(""); return; }
    setStatus(j); startCam(); poke();
  }
  async function punch(kind: Punch["kind"]) {
    if (!who) return;
    setBusy(true); setErr("");
    const photo = snap();
    const r = await fetch("/api/time/kiosk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: who.id, pin, kind, photo }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "No connection. Your punch wasn't saved. Try again." };
    setBusy(false); stopCam();
    if (!r || !r.ok) { setErr(j.error || "Something went wrong."); return; }
    const t = timeLabel(j.punch?.at || new Date());
    const msg = kind === "in" ? `Clocked in at ${t}` : kind === "out" ? `Clocked out at ${t}` : kind === "break_start" ? `Break started at ${t}` : `Back from break at ${t}`;
    const sub = kind === "out" ? `${hm(j.todayMinutes || 0)} worked today. Have a great evening, ${who.first_name}!` : kind === "in" ? `Have a great day, ${who.first_name}!` : kind === "break_start" ? "Enjoy your break." : "Welcome back.";
    setDone({ text: msg, sub }); load();
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(reset, 4000);
  }
  function key(k: string) {
    poke();
    if (busy) return;
    if (k === "clear") return setPin("");
    if (k === "back") return setPin((p) => p.slice(0, -1));
    const p = (pin + k).slice(0, 6); setPin(p);
    if (p.length === 6) check(p);
  }

  if (!info) return <div className="tc tc-center"><div className="tc-spin" /></div>;
  if (!info.paired) return (
    <div className="tc tc-center">
      <img src="/brand/fbs-logo-white.svg" alt="" className="tc-logo-big" />
      <h1>This device isn&apos;t a time clock yet</h1>
      <p>A manager can set it up: sign in on this device, open <b>Time Clock → Settings</b>, and tap <b>Use this device as a time clock</b>.</p>
      <a className="tc-btn" href="/login?next=/shop/time?tab=settings">Sign in to set it up</a>
    </div>
  );

  const list = (info.employees || []).filter((e) => !q || `${e.first_name} ${e.last_name}`.toLowerCase().includes(q.toLowerCase()));
  const inNow = (info.employees || []).filter((e) => e.state !== "out").length;
  return (
    <div className="tc" onPointerDown={() => who && poke()}>
      <header className="tc-top">
        <img src="/brand/fbs-logo-white.svg" alt={info.shop || ""} className="tc-logo" />
        <div className="tc-clock"><b>{now.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}</b><span>{now.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" })}</span></div>
        <div className="tc-in">{inNow} clocked in</div>
      </header>

      {!who ? (
        <main className="tc-main">
          <div className="tc-h"><h1>Tap your name</h1><input className="tc-find" placeholder="Find your name…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="tc-grid">{list.map((e, i) => (
            <button key={e.id} type="button" className={"tc-emp " + e.state} disabled={!e.has_pin} onClick={() => { setWho(e); setPin(""); setErr(""); poke(); }} title={e.has_pin ? "" : "No PIN yet: ask a manager"}>
              <i style={{ background: colorOf(e, i) }}>{initials(e)}</i>
              <b>{e.first_name} {e.last_name ? e.last_name[0] + "." : ""}</b>
              <span>{e.state === "in" ? `In since ${timeLabel(e.since!)}` : e.state === "break" ? `On break since ${timeLabel(e.since!)}` : e.has_pin ? "Out" : "No PIN yet"}</span>
            </button>
          ))}{!list.length && <div className="tc-none">{q ? "No one by that name." : "No employees yet. Add them in Time Clock → Employees."}</div>}</div>
        </main>
      ) : done ? (
        <main className="tc-main tc-center"><div className="tc-done"><div className="tc-check">✓</div><h1>{done.text}</h1><p>{done.sub}</p></div></main>
      ) : !status ? (
        <main className="tc-main tc-center">
          <div className="tc-pinbox">
            <h1>Hi {who.first_name}</h1><p>Enter your PIN</p>
            <div className="tc-dots">{Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? "on" : ""} />)}</div>
            {err && <div className="tc-err">{err}</div>}
            <div className="tc-pad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => (
              <button key={k} type="button" className={"tc-k" + (k.length > 1 ? " fn" : "")} onClick={() => key(k)} disabled={busy}>{k === "clear" ? "Clear" : k === "back" ? "⌫" : k}</button>
            ))}</div>
            <div className="tc-pin-acts"><button type="button" className="tc-btn ghost" onClick={reset}>Cancel</button><button type="button" className="tc-btn" disabled={pin.length < 4 || busy} onClick={() => check(pin)}>{busy ? "Checking…" : "OK"}</button></div>
          </div>
        </main>
      ) : (
        <main className="tc-main tc-center">
          <div className="tc-act">
            {info.photo && <video ref={video} className="tc-cam" playsInline muted />}
            <h1>{who.first_name} {who.last_name}</h1>
            <p className="tc-state">{status.state === "in" ? `Clocked in since ${timeLabel(status.since!)}` : status.state === "break" ? `On break since ${timeLabel(status.since!)}` : "Clocked out"} · {hm(status.todayMinutes)} today</p>
            {err && <div className="tc-err">{err}</div>}
            <div className="tc-acts">{status.next.map((k) => (
              <button key={k} type="button" className={"tc-big " + k} disabled={busy} onClick={() => punch(k)}>{KIND_LABEL[k]}</button>
            ))}</div>
            <button type="button" className="tc-btn ghost" onClick={reset}>Not you? Cancel</button>
          </div>
        </main>
      )}
      <footer className="tc-foot">{info.device} · {info.shop}</footer>
    </div>
  );
}
