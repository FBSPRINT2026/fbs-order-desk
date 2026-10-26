"use client";
import { useState } from "react";
import { saveSiteEmail, testSiteEmail } from "./actions";
import type { SiteEmail } from "@/lib/siteEmail";

export default function SiteEmailForm({ initial, current }: { initial: SiteEmail; current: string }) {
  const [v, setV] = useState<SiteEmail>({ fromName: initial.fromName || "FBS Print", fromAddress: initial.fromAddress || "", replyTo: initial.replyTo || "" });
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const set = (k: keyof SiteEmail, x: string) => { setV((o) => ({ ...o, [k]: x })); setMsg(""); };
  return (
    <section className="panel">
      <div className="panel-h"><h2>Site email</h2><span className="faint">The address the portal sends from: sign-in links, proofs, invoices, receipts, the launch email</span></div>
      <div className="panel-b stack">
        <div className="grid g3">
          <div className="field"><label htmlFor="se-n">From name</label><input id="se-n" type="text" value={v.fromName} placeholder="FBS Print" onChange={(e) => set("fromName", e.target.value)} /></div>
          <div className="field"><label htmlFor="se-a">Send from</label><input id="se-a" type="email" value={v.fromAddress} placeholder="portal@fbsprint.com" onChange={(e) => set("fromAddress", e.target.value)} /></div>
          <div className="field"><label htmlFor="se-r">Replies go to</label><input id="se-r" type="email" value={v.replyTo} placeholder="portal@fbsprint.com" onChange={(e) => set("replyTo", e.target.value)} /></div>
        </div>
        <div className="faint" style={{ fontSize: 12.5 }}>Sending from now: <b data-notranslate>{current || "not set"}</b>. Leave Send from blank to keep using it.</div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); const r = await saveSiteEmail(v); setBusy(false); setMsg(r.ok ? "Saved. Emails from the site use it from now on." : r.error || "Not saved."); }}>Save</button>
          <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); const r = await testSiteEmail(); setBusy(false); setMsg(r.ok ? `Test sent to ${r.to} from ${r.from}.` : r.error || "Not sent."); }}>Send a test to me</button>
          {msg && <span className="faint" style={{ fontSize: 12.5 }}>{msg}</span>}
        </div>
      </div>
    </section>
  );
}
