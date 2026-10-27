"use client";
import { useEffect, useState } from "react";
import { checkManifestMailNow, receivingSettings, saveManifestMailbox } from "@/app/shop/receiving/settings-actions";
import type { ManifestBoxPublic } from "@/lib/manifestMail";

/**
 * Goods & Receiving → Settings (Oct 27, Nick: "just go settings… what email are you receiving it to? Because we might
 * change this over time… we might also put some other settings in there, like for that tool"). For now: the mailbox the
 * supplier manifests (S&S's daily decorator manifest, SanMar's) arrive in. The hourly goods pass imports them from it.
 */
const when = (s?: string | null) => (s ? new Date(s).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export default function ReceivingSettings() {
  const [box, setBox] = useState<ManifestBoxPublic | null>(null), [can, setCan] = useState(false), [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [on, setOn] = useState(true);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [err, setErr] = useState("");
  useEffect(() => {
    void receivingSettings().then((r) => {
      setLoaded(true);
      if (!r.ok) { setErr(r.error); return; }
      setCan(r.can); setBox(r.box);
      setEmail(r.box?.email || "shipping@fbsprint.com"); setOn(r.box ? r.box.enabled : true);
    });
  }, []);
  async function save() {
    setBusy("save"); setErr(""); setMsg("");
    const r = await saveManifestMailbox({ email, password: pw || undefined, enabled: on });
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setBox(r.box); setPw(""); setMsg(on ? `Saved. Signed in to ${email}.` : "Saved. Turned off: the mailbox isn't read.");
  }
  async function check() {
    setBusy("check"); setErr(""); setMsg("");
    const r = await checkManifestMailNow(4);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    setBox(r.box);
    const x = r.result as { skipped?: string; error?: string; looked?: number; imported?: number; lines?: number; errors?: string[] };
    if (x.skipped) setErr(x.skipped);
    else if (x.error) setErr(x.error);
    else setMsg(x.imported ? `Imported ${x.imported} manifest file${x.imported === 1 ? "" : "s"}: ${x.lines} new line${x.lines === 1 ? "" : "s"}.` : x.looked ? `Looked at ${x.looked} supplier email${x.looked === 1 ? "" : "s"}: nothing new to import.` : "No new supplier manifests in the last 4 days.");
  }
  if (!loaded) return <div className="empty">Loading…</div>;
  return (
    <section className="panel rs">
      <div className="panel-h"><h2>Supplier manifests</h2><span className="faint">the mailbox S&amp;S and SanMar send their manifests to</span></div>
      <div className="panel-b stack" style={{ gap: 12 }}>
        <p className="faint rs-note">Every hour on weekdays (6 a.m. to 6 p.m.) Goods &amp; Receiving looks in this mailbox for the last few days&apos; supplier manifest emails and imports each one once, the same as Import Supplier Manifests. Nothing else in the mailbox is read, moved or answered.</p>
        <div className="rs-row">
          <div className="field"><label htmlFor="rs-email">Manifest mailbox</label><input id="rs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!can} autoComplete="off" placeholder="shipping@fbsprint.com" /></div>
          <div className="field"><label htmlFor="rs-pw">Its password</label><input id="rs-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={!can} autoComplete="new-password" placeholder={box?.hasPassword && box.email === email.trim().toLowerCase() ? "Saved (type to change)" : "Password"} /></div>
          <label className="check rs-on"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} disabled={!can} />Import from it</label>
        </div>
        {can ? <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn primary" disabled={!!busy || !email.trim()} onClick={() => void save()}>{busy === "save" ? "Signing in…" : "Save"}</button>
          <button type="button" className="btn" disabled={!!busy || !box?.enabled} onClick={() => void check()}>{busy === "check" ? "Looking…" : "Check now"}</button>
        </div> : <p className="faint">Only an owner or admin can change this.</p>}
        {err && <div className="pv-err">{err}</div>}
        {msg && <div className="banner">{msg}</div>}
        {box && <div className="rs-status">
          <span>Last looked: <b>{when(box.last_run)}</b></span>
          {box.last_error ? <span className="rs-bad">Problem: {box.last_error}</span> : box.last_ok ? <span className="rs-ok">Working</span> : null}
        </div>}
        {!!box?.log?.length && <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>When</th><th>Email</th><th>File</th><th>Supplier</th><th>Lines</th></tr></thead>
          <tbody>{[...box.log].reverse().slice(0, 15).map((l, i) => (
            <tr key={i}><td className="nw">{when(l.at)}</td><td>{l.subject}</td><td className="sub">{l.file}</td><td>{l.supplier === "sanmar" ? "SanMar" : l.supplier === "ss" ? "S&S" : "–"}</td>
              <td className="nw">{l.error ? <span className="rs-bad">{l.error}</span> : `${l.new} new of ${l.lines}`}</td></tr>
          ))}</tbody>
        </table></div>}
      </div>
    </section>
  );
}
