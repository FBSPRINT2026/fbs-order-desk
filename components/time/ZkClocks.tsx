"use client";
import { useCallback, useEffect, useState } from "react";

type Scan = { pin: string; wall: string; done: boolean; note: string };
type Clock = { id: string; name: string; active: boolean; serial: string; last_seen_at: string | null; created_at: string; users: Record<string, string>; usersAt: string; about: string; waiting: number; cmdsOpen: number; scans: Scan[] };
type Emp = { first_name: string; last_name: string; code: number };

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};
const KIND: Record<string, string> = { in: "Clock In", out: "Clock Out", break_start: "Start Break", break_end: "End Break" };

/**
 * The ZKTeco face clock (SpeedFace-V4L, Oct 16 2026): how to point it at us, turn it on, send it our employees by ID,
 * and see its latest scans. Owners and admins only (the API checks).
 */
export default function ZkClocks() {
  const [clocks, setClocks] = useState<Clock[] | null>(null);
  const [emps, setEmps] = useState<Emp[]>([]);
  const [msg, setMsg] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/time/zk", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't load the clocks."); setClocks([]); return; }
    setClocks(j.clocks || []); setEmps(j.employees || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(id + action); setErr(""); setMsg("");
    const r = await fetch("/api/time/zk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) setErr(j.error || "That didn't work."); else if (j.message) setMsg(j.message);
    load();
  }
  const nameOf = (pin: string) => { const e = emps.find((x) => String(x.code) === pin.replace(/^0+/, "")); return e ? `${e.first_name} ${e.last_name}` : ""; };

  return (
    <section className="db-card db-teal">
      <div className="db-card-h"><h2>Face Clock (ZKTeco)</h2><span className="faint db-h-note">SpeedFace on the wall, sends each scan here</span></div>
      <details className="zk-how" open={!clocks?.length}>
        <summary>How to connect the clock</summary>
        <ol>
          <li>On the clock: <b>COMM → Cloud Server Setting</b> (on some models <b>COMM → ADMS</b>).</li>
          <li><b>Server Mode</b>: ADMS. <b>Enable Domain Name</b>: ON. <b>Server Address</b>: <code>portal.fbsprint.com</code></li>
          <li><b>Server Port</b>: <code>443</code>. <b>HTTPS</b>: ON. <b>Enable Proxy Server</b>: OFF.</li>
          <li>Save. Within a minute the clock shows up below as <b>Off</b> with its serial number. Turn it on, then <b>Send Employee List</b>.</li>
          <li>At the clock: <b>User Mgt → All Users</b>, pick each person (their ID is their employee number, 101–130) → <b>Face</b> to add their face.</li>
        </ol>
        <p className="faint">Scans don&apos;t pick in or out: each one follows the person&apos;s last punch (out → in, in → out, on break → back). A second scan within 2 minutes is ignored. Someone who forgot to clock out yesterday starts today with a clock-in.</p>
      </details>
      {clocks === null ? <p className="faint">Loading…</p> : !clocks.length ? <p className="faint" style={{ margin: "8px 0 0" }}>No face clock has checked in yet.</p> : clocks.map((c) => {
        const live = c.last_seen_at && Date.now() - Date.parse(c.last_seen_at) < 5 * 60000;
        const onClock = Object.keys(c.users).length;
        const missing = emps.filter((e) => !c.users[String(e.code)]);
        return (
          <div className="zk-clock" key={c.id}>
            <div className="zk-top">
              <span className="db-main"><b>{c.name}</b><span className="faint">Serial {c.serial} · {live ? <span className="zk-live">● Connected</span> : <span className="zk-off">Last heard from {ago(c.last_seen_at)}</span>}</span></span>
              <span className="db-side">
                <span className={"tmx-tag " + (c.active ? "ok" : "bad")}>{c.active ? "On" : "Off"}</span>
                <button type="button" className={"btn sm" + (c.active ? "" : " primary")} disabled={!!busy} onClick={() => act(c.id, c.active ? "off" : "on")}>{c.active ? "Turn Off" : "Turn On"}</button>
                {c.active && <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(c.id, "users")}>{busy === c.id + "users" ? "Sending…" : "Send Employee List"}</button>}
              </span>
            </div>
            <div className="zk-facts">
              <span><b>{onClock}</b> people on the clock{c.usersAt ? ` (as of ${ago(c.usersAt)})` : ""}{onClock > 0 && missing.length > 0 ? ` · not on it yet: ${missing.slice(0, 6).map((e) => e.first_name).join(", ")}${missing.length > 6 ? ` +${missing.length - 6}` : ""}` : ""}</span>
              {c.cmdsOpen > 0 && <span>{c.cmdsOpen} change{c.cmdsOpen === 1 ? "" : "s"} waiting for the clock</span>}
              {c.waiting > 0 && <span className="zk-warn">{c.waiting} scan{c.waiting === 1 ? "" : "s"} not counted yet{c.active ? "" : " (clock is off)"}{c.active && <> · <button type="button" className="linkbtn" onClick={() => act(c.id, "process")}>Bring them over</button></>}</span>}
            </div>
            {c.scans.length > 0 && (
              <table className="zk-scans"><thead><tr><th>Scan (shop time)</th><th>ID</th><th>Person</th><th>Counted as</th></tr></thead><tbody>
                {c.scans.map((s, i) => <tr key={i}><td>{s.wall}</td><td>{s.pin}</td><td>{nameOf(s.pin) || <span className="zk-warn">no employee with this ID</span>}</td><td>{s.done ? KIND[s.note] || s.note : <span className="faint">{s.note || (c.active ? "waiting" : "clock is off")}</span>}</td></tr>)}
              </tbody></table>
            )}
          </div>
        );
      })}
      {err && <div className="pv-err">{err}</div>}
      {msg && <p className="faint" style={{ margin: "8px 0 0" }}>{msg}</p>}
    </section>
  );
}
