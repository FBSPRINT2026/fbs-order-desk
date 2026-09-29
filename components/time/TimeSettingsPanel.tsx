"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dayLabel, periodOf, type TimeSettings } from "@/lib/timeclock";
import type { TimeData } from "./types";

type Device = { id: string; name: string; active: boolean; created_at: string; last_seen_at: string | null };

/** Pay period, overtime, rounding, photos, phone punching near the shop, departments, and the wall clocks. */
export default function TimeSettingsPanel({ d }: { d: TimeData }) {
  const [v, setV] = useState<TimeSettings>(d.settings);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [here, setHere] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [devName, setDevName] = useState("Front wall clock");
  const [depts, setDepts] = useState(d.settings.departments.join(", "));

  const loadDevices = useCallback(async () => {
    const { data } = await createClient().from("timeclock_devices").select("id, name, active, created_at, last_seen_at").order("created_at", { ascending: false });
    setDevices((data || []) as Device[]);
    const r = await fetch("/api/time/device", { cache: "no-store" }).then((x) => x.json()).catch(() => ({ device: null }));
    setHere(r.device);
  }, []);
  useEffect(() => { loadDevices(); }, [loadDevices]);

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const time = { ...v, departments: depts.split(",").map((x) => x.trim()).filter(Boolean) };
    const { error } = await sb.from("settings").upsert({ id: 1, data: { ...(data?.data || {}), time }, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg("Saved."); d.reload();
  }
  function useMyLocation() {
    if (!navigator.geolocation) return setErr("This browser can't share its location.");
    navigator.geolocation.getCurrentPosition((p) => setV({ ...v, geo: { ...v.geo, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) } }), () => setErr("Location wasn't allowed."), { enableHighAccuracy: true, timeout: 15000 });
  }
  async function pairHere() {
    const r = await fetch("/api/time/device", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: devName }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error || "Couldn't set up this device.");
    setMsg("This device is now a time clock. Open the wall clock to start."); loadDevices();
  }
  async function unpairHere() { await fetch("/api/time/device", { method: "DELETE" }); loadDevices(); }
  async function toggleDevice(x: Device) { await createClient().from("timeclock_devices").update({ active: !x.active }).eq("id", x.id); loadDevices(); }
  const p = periodOf(v, new Date().toISOString().slice(0, 10));

  return (
    <div className="tmx">
      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Wall Clocks</h2><span className="faint db-h-note">tablets people punch on</span></div>
        <div className="tmx-dev-here">
          {here === undefined ? null : here ? (
            <><span>This device is the time clock <b>{here.name}</b>.</span><a className="btn primary" href="/clock">Open Wall Clock</a><button type="button" className="btn" onClick={unpairHere}>Stop Using This Device</button></>
          ) : (
            <><span>Setting up the tablet? Open this page on it, then:</span><input type="text" value={devName} onChange={(e) => setDevName(e.target.value)} aria-label="Clock name" style={{ width: 200 }} /><button type="button" className="btn primary" onClick={pairHere}>Use This Device As A Time Clock</button></>
          )}
        </div>
        <p className="faint" style={{ fontSize: 12.5, margin: "6px 0 10px" }}>After setup, the tablet shows the clock at <b>portal.fbsprint.com/clock</b> with nobody signed in. Add it to the home screen and turn on the tablet&apos;s guided access / kiosk mode.</p>
        {devices.length > 0 && <ul className="db-list">{devices.map((x) => (
          <li key={x.id} className="db-row"><span className="db-main"><b>{x.name}</b><span className="faint">set up {new Date(x.created_at).toLocaleDateString()} · last used {x.last_seen_at ? new Date(x.last_seen_at).toLocaleString() : "never"}</span></span>
            <span className="db-side"><span className={"tmx-tag " + (x.active ? "ok" : "bad")}>{x.active ? "On" : "Off"}</span><button type="button" className="btn sm" onClick={() => toggleDevice(x)}>{x.active ? "Turn Off" : "Turn On"}</button></span></li>
        ))}</ul>}
      </section>

      <section className="db-card db-orange">
        <div className="db-card-h"><h2>Pay Period &amp; Overtime</h2></div>
        <div className="tmx-set">
          <label>Pay period<select value={v.period} onChange={(e) => setV({ ...v, period: e.target.value as TimeSettings["period"] })}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="semimonthly">Twice a month (1st–15th, 16th–end)</option></select></label>
          {v.period !== "semimonthly" && <label>A pay period starts on<input type="date" value={v.anchor} onChange={(e) => setV({ ...v, anchor: e.target.value })} /></label>}
          <label>Overtime after (hours a week)<input type="number" min={0} value={v.otWeekly} onChange={(e) => setV({ ...v, otWeekly: +e.target.value || 40 })} /></label>
          <label>Round punches to<select value={v.rounding} onChange={(e) => setV({ ...v, rounding: +e.target.value as TimeSettings["rounding"] })}><option value={0}>Exact minute</option><option value={5}>Nearest 5 minutes</option><option value={6}>Nearest 6 minutes (tenth of an hour)</option><option value={15}>Nearest 15 minutes</option></select></label>
          <label>Late after (minutes past the shift start)<input type="number" min={0} value={v.graceMin} onChange={(e) => setV({ ...v, graceMin: +e.target.value || 0 })} /></label>
          <label>Flag anyone clocked in longer than (hours)<input type="number" min={1} value={v.longShiftHours} onChange={(e) => setV({ ...v, longShiftHours: +e.target.value || 12 })} /></label>
        </div>
        <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>This period: {dayLabel(p.start)} – {dayLabel(p.end)}. Overtime is figured per workweek (7 days from the start day), the federal rule; Texas has no daily overtime.</p>
      </section>

      <section className="db-card db-teal">
        <div className="db-card-h"><h2>Punching</h2></div>
        <div className="tmx-set">
          <label className="check"><input type="checkbox" checked={v.photo} onChange={(e) => setV({ ...v, photo: e.target.checked })} /> Take a photo at each punch on the wall clock</label>
          <label className="check"><input type="checkbox" checked={v.phone} onChange={(e) => setV({ ...v, phone: e.target.checked })} /> Staff with a login can punch from their phone</label>
          <div className="tmx-geo">
            <span className="lbl">Phones can punch only near the shop</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="faint">{v.geo.lat != null ? `${v.geo.lat}, ${v.geo.lng}` : "Not set (phones can punch anywhere)"}</span>
              <button type="button" className="btn sm" onClick={useMyLocation}>Use My Current Location</button>
              {v.geo.lat != null && <button type="button" className="linkbtn" onClick={() => setV({ ...v, geo: { ...v.geo, lat: null, lng: null } })}>Clear</button>}
              <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>within<input type="number" min={50} step={25} value={v.geo.radiusM} onChange={(e) => setV({ ...v, geo: { ...v.geo, radiusM: +e.target.value || 200 } })} style={{ width: 80 }} />meters</label>
            </div>
          </div>
          <label className="wide">Departments (comma separated)<input type="text" value={depts} onChange={(e) => setDepts(e.target.value)} /></label>
        </div>
      </section>
      {err && <div className="pv-err">{err}</div>}
      <div className="row" style={{ gap: 10 }}><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Settings"}</button>{msg && <span className="faint">{msg}</span>}</div>
    </div>
  );
}
