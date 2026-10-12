"use client";
import { useCallback, useEffect, useState } from "react";
import { getAlerts, markAlertsSeen, removePushSub, savePushSub, setAlertPref, setAway, testPush, type AlertState } from "@/app/shop/alerts-actions";

/**
 * Alerts & Away mode (Oct 12, Nick). Three things:
 *  - Away mode: the AI reads new email while you're away and only alerts your phone for what has to happen today.
 *  - Phone alerts: turned on per phone / computer (iPhones: from the portal's Home Screen icon).
 *  - Job reminders (owners): every job's next steps from its in-hands date, as to-dos on My Day, alerting the phone
 *    on the day something has to happen (order goods today, sizes, art, proof, print, ship).
 */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const keyBytes = (b64: string) => { const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android phone" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows computer" : "This device"; };
const when = (t: string) => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type Here = "checking" | "unsupported" | "ios-add" | "blocked" | "off" | "on";

export default function AlertsView() {
  const [st, setSt] = useState<AlertState | null>(null), [err, setErr] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState("");
  const [here, setHere] = useState<Here>("checking"), [myEndpoint, setMyEndpoint] = useState("");
  const load = useCallback(async () => { const r = await getAlerts(); if (r.ok) setSt(r); else setErr(r.error); }, []);
  useEffect(() => { void load(); void markAlertsSeen(); }, [load]);
  // this device: can it get alerts, and is it set up?
  useEffect(() => {
    (async () => {
      const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!ok) { setHere(isIOS() && !standalone() ? "ios-add" : "unsupported"); return; }
      if (Notification.permission === "denied") { setHere("blocked"); return; }
      const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      setMyEndpoint(sub?.endpoint || "");
      setHere(sub && Notification.permission === "granted" ? "on" : "off");
    })();
  }, []);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 5000); };

  async function turnOn() {
    setErr(""); setBusy("on");
    try {
      if (!st) return;
      // asked inside the tap (iPhones only allow it then)
      const p = await Notification.requestPermission();
      if (p !== "granted") { setHere(p === "denied" ? "blocked" : "off"); setBusy(""); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      const sub = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(st.key) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await savePushSub(j, deviceName());
      if (!r.ok) { setErr(r.error); setBusy(""); return; }
      setMyEndpoint(j.endpoint); setHere("on"); await load();
      const t = await testPush();
      flash(t.ok ? "Alerts are on. A test notification is on its way." : `Alerts are on, but the test didn't go: ${t.error}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy("");
  }

  if (err && !st) return <div className="pv-err">{err}</div>;
  if (!st) return <div className="faint" style={{ padding: 20 }}>Loading…</div>;
  const ro = st.viewing;
  return (
    <div className="al">
      {msg && <div className="ibx2-toast" role="status">{msg}</div>}
      {err && <div className="pv-err">{err}</div>}
      {ro && <div className="al-note">You&apos;re viewing as {st.name}: this is what they get. Switch back to change anything.</div>}

      {/* Away mode */}
      <section className={"al-card al-away" + (st.away ? " on" : "")}>
        <div className="al-row">
          <div className="al-t">
            <h2>Away mode</h2>
            <p>{st.away
              ? <>On since {st.awaySince ? when(st.awaySince) : "now"}. The AI is reading your new email and will only alert your phone when something has to happen today.</>
              : <>Stepping away from email? Turn this on. The AI reads every new email and only alerts your phone for what can&apos;t wait: an order that has to go today, an upset customer, a rush, a payment problem. Everything else waits for you.</>}</p>
          </div>
          <button type="button" role="switch" aria-checked={st.away} className={"al-sw" + (st.away ? " on" : "")} disabled={ro || busy === "away"} onClick={async () => { setBusy("away"); const r = await setAway(!st.away); setBusy(""); if (!r.ok) setErr(r.error); else { flash(st.away ? "Away mode is off." : "Away mode is on. Go enjoy it."); await load(); } }}>
            <span className="al-knob" aria-hidden /><span className="al-swl">{st.away ? "On" : "Off"}</span>
          </button>
        </div>
        {st.away && here !== "on" && !st.devices.length && <div className="al-warn">Turn on phone alerts below, or Away mode can&apos;t reach you.</div>}
      </section>

      {/* this phone */}
      <section className="al-card">
        <h2>Alerts on this {deviceName() === "This device" ? "device" : deviceName()}</h2>
        {here === "checking" ? <p className="faint">Checking…</p>
          : here === "on" ? <div className="al-row"><p className="al-ok">✓ On. Urgent things show up here even when the portal is closed.</p><button type="button" className="btn sm" disabled={!!busy || ro} onClick={async () => { setBusy("test"); const r = await testPush(); setBusy(""); flash(r.ok ? "Test sent." : r.error); }}>{busy === "test" ? "Sending…" : "Send a test"}</button></div>
          : here === "ios-add" ? <div className="al-steps">
              <p>iPhones only send alerts to apps on the Home Screen. Three taps:</p>
              <ol>
                <li>In Safari, tap <b>Share</b> (the square with the arrow).</li>
                <li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
                <li>Open <b>FBS</b> from your Home Screen, come back to <b>Alerts &amp; Away</b>, and turn alerts on.</li>
              </ol>
              <p className="faint">Already have the portal on your Home Screen from before? Remove that icon and add it again: it now opens as its own app, which is what allows alerts. You&apos;ll sign in once in the app.</p>
            </div>
          : here === "blocked" ? <p>Notifications are blocked for the portal on this device. {isIOS() ? <>On iPhone: <b>Settings → Notifications → FBS</b> → Allow Notifications, then come back.</> : <>Allow them in the browser&apos;s site settings (the icon left of the address), then reload.</>}</p>
          : here === "unsupported" ? <p>This browser can&apos;t get alerts. Use Chrome, Edge or Safari, or the portal app on your iPhone&apos;s Home Screen.</p>
          : <div className="al-row"><p>Get a notification on this {isIOS() ? "iPhone" : "device"} when something has to happen today, even with the portal closed.</p><button type="button" className="btn primary" disabled={!!busy || ro} onClick={() => void turnOn()}>{busy === "on" ? "Turning on…" : "Turn on alerts"}</button></div>}
        {st.devices.length > 0 && <div className="al-devs">
          <div className="faint al-sub">Getting alerts</div>
          {st.devices.map((d) => <div key={d.id} className="al-dev">
            <span><b>{d.device || "Device"}</b>{d.endpoint === myEndpoint && <em> (this one)</em>}<span className="faint"> · since {when(d.created_at)}{d.last_error ? ` · last try failed: ${d.last_error.slice(0, 60)}` : d.last_ok_at ? ` · last alert ${when(d.last_ok_at)}` : ""}</span></span>
            <button type="button" className="md-link" disabled={ro} onClick={async () => { await removePushSub(d.id); if (d.endpoint === myEndpoint) { const reg = await navigator.serviceWorker.getRegistration("/"); const s = await reg?.pushManager.getSubscription(); await s?.unsubscribe(); setHere("off"); } await load(); }}>Remove</button>
          </div>)}
        </div>}
      </section>

      {/* job reminders */}
      {st.jobsFor && <section className="al-card">
        <div className="al-row">
          <div className="al-t">
            <h2>Needs you today</h2>
            <p>Jobs flow on their own; nothing shows up for them until a date is at risk. Then it&apos;s on your dashboard under <b>Needs you today</b>, and your phone gets one alert, for things like:</p>
          </div>
          <button type="button" role="switch" aria-checked={st.jobs} className={"al-sw" + (st.jobs ? " on" : "")} disabled={ro || busy === "jobs"} onClick={async () => { setBusy("jobs"); const r = await setAlertPref("jobs", !st.jobs); setBusy(""); if (!r.ok) setErr(r.error); else await load(); }}>
            <span className="al-knob" aria-hidden /><span className="al-swl">{st.jobs ? "On" : "Off"}</span>
          </button>
        </div>
        <ul className="al-list">
          <li><b>Order goods today</b> or the in-hands date is missed, using where S&amp;S really has them (Fort Worth 1 day, Kansas 2, farther 3–4), including orders still in email with no order made yet</li>
          <li><b>Sizes, approval, art or the proof</b> are still missing on the day they&apos;re needed</li>
          <li><b>Goods aren&apos;t in</b> when they should be</li>
        </ul>
        <p className="faint al-sub">Each job&apos;s alert goes to whoever owns it in Printavo; the dashboard shows you everything. Checked every 30 minutes; alerts on weekdays 7 am to 7 pm.</p>
        {st.jobs && <button type="button" className="btn sm" disabled={!!busy || ro} onClick={async () => { setBusy("check"); const r = await fetch("/api/away/tick?jobs=1").then((x) => x.json()).catch(() => null); setBusy(""); flash(r?.ok ? (r.jobs ? `${r.jobs} thing${r.jobs === 1 ? "" : "s"} need${r.jobs === 1 ? "s" : ""} someone today. They're on the dashboard.` : "Nothing is at risk today.") : "Couldn't check right now."); await load(); }}>{busy === "check" ? "Checking every job…" : "Check the jobs now"}</button>}
      </section>}

      {/* history */}
      <section className="al-card">
        <h2>Recent alerts</h2>
        {!st.recent.length ? <p className="faint">Nothing yet. When something needs you, it shows up here and on your phone.</p>
          : <div className="al-hist">{st.recent.map((a) => <a key={a.id} href={a.url || "/shop"} className={"al-h " + a.kind}>
              <span className="al-hk">{a.kind === "email" ? "Email" : "Job"}</span>
              <span className="al-hb"><b>{a.title}</b><span>{a.body}</span></span>
              <time>{when(a.created_at)}{!a.pushed_at ? " · waiting for the morning" : a.push_result === "no devices" ? " · no phone set up" : ""}</time>
            </a>)}</div>}
      </section>
    </div>
  );
}
