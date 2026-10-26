"use client";
import { useEffect, useState } from "react";
import { connectSiteMailbox, disconnectSiteMailbox, saveSiteEmail, siteMailboxStatus, testSiteEmail } from "./actions";
import type { SiteEmail } from "@/lib/siteEmail";

export default function SiteEmailForm({ initial, current: current0 }: { initial: SiteEmail; current: string }) {
  // what it sends from, updated on Save (it showed the old address until the page was reloaded)
  const [current, setCurrent] = useState(current0);
  const [v, setV] = useState<SiteEmail>({ fromName: initial.fromName || "FBS Print", fromAddress: initial.fromAddress || "", replyTo: initial.replyTo || "" });
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const set = (k: keyof SiteEmail, x: string) => { setV((o) => ({ ...o, [k]: x })); setMsg(""); };
  // the mailbox it sends through (Oct 26: no email service was connected; the portal mailbox sends like a staff reply)
  const [box, setBox] = useState<{ connected: boolean; email?: string; host?: string; okAt?: string | null } | null>(null);
  const [bx, setBx] = useState({ email: initial.fromAddress || "portal@fbsprint.com", password: "", host: "" });
  const [bmsg, setBmsg] = useState("");
  useEffect(() => { void siteMailboxStatus().then(setBox); }, []);
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
          <button type="button" className="btn primary" disabled={busy} onClick={async () => { setBusy(true); const r = await saveSiteEmail(v); setBusy(false); setMsg(r.ok ? "Saved. Emails from the site use it from now on." : r.error || "Not saved."); if (r.ok) setCurrent(v.fromAddress?.trim() ? `${(v.fromName || "FBS Print").trim()} <${v.fromAddress.trim().toLowerCase()}>` : current0); }}>Save</button>
          <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); const r = await testSiteEmail(); setBusy(false); setMsg(r.ok ? `Test sent to ${r.to} from ${r.from}.` : r.error || "Not sent."); }}>Send a test to me</button>
          {msg && <span className="faint" style={{ fontSize: 12.5 }}>{msg}</span>}
        </div>
        <div className="se-box">
          <div className="lbl">Send through the portal mailbox</div>
          {box?.connected ? (
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span>Connected: <b data-notranslate>{box.email}</b>{box.okAt ? <span className="faint"> · signed in {new Date(box.okAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}</span>
              <button type="button" className="btn sm" onClick={async () => { await disconnectSiteMailbox(); setBox({ connected: false }); setBmsg("Disconnected."); }}>Disconnect</button>
              <span className="faint" style={{ fontSize: 12.5 }}>Site emails go out through this mailbox. Its password is kept encrypted and never shown.</span>
            </div>
          ) : (
            <>
              <div className="grid g3">
                <div className="field"><label htmlFor="se-bx">Mailbox</label><input id="se-bx" type="email" value={bx.email} onChange={(e) => setBx({ ...bx, email: e.target.value })} /></div>
                <div className="field"><label htmlFor="se-bp">Its password</label><input id="se-bp" type="password" autoComplete="new-password" value={bx.password} onChange={(e) => setBx({ ...bx, password: e.target.value })} /></div>
                <div className="field"><label htmlFor="se-bh">Mail server (leave blank for ours)</label><input id="se-bh" type="text" placeholder="east.exch021.serverdata.net" value={bx.host} onChange={(e) => setBx({ ...bx, host: e.target.value })} /></div>
              </div>
              <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn" disabled={busy || !bx.email || !bx.password} onClick={async () => { setBusy(true); setBmsg("Signing in…"); const r = await connectSiteMailbox(bx.email, bx.password, bx.host); setBusy(false); setBx({ ...bx, password: "" }); if (r.ok) { setBox(await siteMailboxStatus()); setBmsg("Connected. Now Send a test to me."); } else setBmsg(r.error || "Couldn't sign in."); }}>Connect</button>
                <span className="faint" style={{ fontSize: 12.5 }}>Signs in to check it (nothing is sent). Same mail server as your own mailbox.</span>
              </div>
            </>
          )}
          {bmsg && <div className="faint" style={{ fontSize: 12.5 }}>{bmsg}</div>}
        </div>
      </div>
    </section>
  );
}
