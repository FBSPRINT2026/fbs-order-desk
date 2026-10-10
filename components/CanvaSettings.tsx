"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Settings → Canva (owner only): connect the shop's Canva account so the portal can
 *  - get a customer's Canva design from their link (Inbox): print-quality PDF + see-through PNG, saved with the email
 *  - Design in Canva from the Mockup Creator: a blank design sized for the print area; Return in Canva brings it back
 *    as the customer's logo, on the shirt.
 * Never shows a key or token: only whether each setting is there.
 */
type St = { configured: boolean; missing: string[]; connected: boolean; name: string; connectedBy: string; connectedAt: string; redirectUri: string; returnUrl: string; customersConnected?: number };
const when = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className="conn-row"><span className={"conn-dot " + (ok ? "ok" : "bad")} aria-hidden="true" /><div>{children}</div></div>;
}

export default function CanvaSettings() {
  const [st, setSt] = useState<St | null>(null);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/canva/status", { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : (setSt(j), setErr("")))).catch(() => setErr("Couldn't load the Canva settings.")), []);
  useEffect(() => {
    void load();
    const m = new URLSearchParams(location.search).get("canva");
    if (m) setFlash(m.startsWith("connected:") ? `Connected to ${m.slice(10)}.` : m);
  }, [load]);
  const disconnect = async () => {
    if (!confirm("Disconnect Canva? Designs already saved stay. Connect again to get designs from Canva links and to design in Canva.")) return;
    setBusy(true);
    await fetch("/api/canva/disconnect", { method: "POST" }).catch(() => null);
    setBusy(false); setFlash("Disconnected."); void load();
  };
  if (err) return <div className="err">{err}</div>;
  if (!st) return <div className="empty">Loading…</div>;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {flash && <div className={flash.startsWith("Connected") || flash === "Disconnected." ? "faint" : "err"} style={{ fontSize: 14 }}>{flash}</div>}
      <p className="faint" style={{ margin: 0, maxWidth: 860 }}>
        With the shop&apos;s Canva account connected, the portal gets a customer&apos;s design straight from their Canva link (a print-quality PDF and a
        see-through PNG, saved with the email), and staff can press <b>Design with Canva</b> in the Mockup Creator: Canva opens on a canvas the size of
        the print area, and pressing <b>Return</b> in Canva brings the design back as the customer&apos;s logo, on the shirt.
      </p>

      <section className="panel">
        <div className="panel-h"><h2>Connection</h2></div>
        <div className="panel-b stack" style={{ gap: 8 }}>
          {(["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"] as const).map((k) => (
            <Check key={k} ok={!st.missing.includes(k)}><b><code>{k}</code></b> <span className="faint">{st.missing.includes(k) ? "missing: add it in Vercel → Settings → Environment Variables, then redeploy" : "set"}</span></Check>
          ))}
          <Check ok={st.connected}>
            {st.connected
              ? <><b>Connected{st.name ? ` to ${st.name}` : ""}</b> <span className="faint">by {st.connectedBy} {when(st.connectedAt)} · the sign-in renews itself</span></>
              : <b>Not connected</b>}
          </Check>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {st.configured ? <a className={"btn sm" + (st.connected ? "" : " primary")} href="/api/canva/connect">{st.connected ? "Connect again" : "Connect Canva"}</a> : <span className="faint">Connect appears once the keys are in Vercel.</span>}
            {st.connected && <button className="btn sm ghost danger" type="button" disabled={busy} onClick={disconnect}>{busy ? "Disconnecting…" : "Disconnect"}</button>}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Setup (once)</h2></div>
        <div className="panel-b">
          <ol className="stack" style={{ gap: 6, margin: 0, paddingLeft: 20, maxWidth: 860 }}>
            <li>Sign in to Canva with the shop&apos;s account and open the <a href="https://www.canva.com/developers/" target="_blank" rel="noreferrer">Canva Developer Portal</a> → <b>Your integrations</b> → <b>Create an integration</b>. Choose <b>Public</b> (private integrations need a Canva Enterprise plan). You don&apos;t need to submit it for review: until it&apos;s reviewed it works for accounts on your own Canva team, which is all the shop needs.</li>
            <li>Name it (e.g. FBS Print portal). Under <b>Outside Canva</b>, press <b>Start integrating</b> and turn on <b>Canva REST APIs</b>.</li>
            <li>Under <b>Scopes</b>, tick: design:content (read and write), design:meta (read), asset (read and write), profile (read).</li>
            <li>Under <b>Redirect URLs</b>, add <code>{st.redirectUri}</code></li>
            <li>Under <b>Return navigation</b>, turn it on and set the return URL to <code>{st.returnUrl}</code></li>
            <li>Under <b>Credentials</b>, copy the <b>Client ID</b>, press <b>Generate secret</b> and copy the secret (Canva shows it only once).</li>
            <li>In Vercel → the portal project → Settings → Environment Variables, add <code>CANVA_CLIENT_ID</code> and <code>CANVA_CLIENT_SECRET</code> (Production), then redeploy.</li>
            <li>Come back here and press <b>Connect Canva</b>, then <b>Allow</b> in Canva.</li>
          </ol>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Customers</h2><span className="faint" style={{ fontSize: 12 }}>{st.customersConnected || 0} customer{st.customersConnected === 1 ? "" : "s"} connected</span></div>
        <div className="panel-b stack" style={{ gap: 6, maxWidth: 860 }}>
          <div>Customers press <b>Design with Canva</b> in their portal&apos;s Mockup Creator and sign in to their own Canva account (or make a free one). Their design is made in their account and comes back onto their mockup.</div>
          <div className="faint" style={{ fontSize: 12.5 }}>Customers can only sign in once Canva has approved the integration: until it&apos;s reviewed, it works only for accounts on the shop&apos;s own Canva team. Once it works for the team, submit it for review in the Canva Developer Portal (Your integrations → the integration → Submit for review).</div>
          <div className="faint" style={{ fontSize: 12.5 }}>On a free Canva plan, Canva can&apos;t export a see-through PNG: the mockup picture is drawn from the design&apos;s PDF instead, and a design with a background is noted on it.</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Good to know</h2></div>
        <div className="panel-b">
          <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 20, maxWidth: 860 }}>
            <li>Canva only exports designs the shop&apos;s account can open. A customer&apos;s &quot;collaborate&quot; link: open it once while signed in to Canva (it joins your account), then press <b>Get the design from Canva</b> on the email.</li>
            <li>Canva&apos;s API gives PDF and PNG, not SVG. The PDF is vector where the design is vector (text and shapes); photos stay pictures.</li>
            <li>Canva allows about 20 exports a minute per account; a busy minute just waits and tries again.</li>
            <li>Designs made with Design with Canva keep their link to Canva: pick one on a print and press <b>Edit in Canva</b> to change it.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
