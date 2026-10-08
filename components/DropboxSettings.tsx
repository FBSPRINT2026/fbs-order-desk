"use client";
import { useEffect, useState } from "react";

/** Settings → Dropbox: the film folder connection (read only). The owner connects it once. */
export default function DropboxSettings() {
  const [s, setS] = useState<{ configured: boolean; connected: boolean; who: string; error?: string } | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    fetch("/api/dropbox/connect", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => setS({ configured: false, connected: false, who: "", error: "Couldn't check Dropbox." }));
    const m = new URLSearchParams(location.search).get("dropbox");
    if (m) setMsg(m === "connected" ? "Dropbox is connected." : m);
  }, []);
  return (
    <section className="panel" id="dropbox">
      <div className="panel-h"><h2>Dropbox</h2><span className="faint" style={{ fontSize: 12 }}>FBS Film Folder: reorders take their real print sizes from the job&apos;s film. Read only: nothing in Dropbox is changed.</span></div>
      <div className="panel-b stack" style={{ gap: 8 }}>
        {msg && <div className={msg === "Dropbox is connected." ? "faint" : "err"}>{msg}</div>}
        {!s ? <div className="faint">Checking…</div>
          : !s.configured ? <div className="faint">Not set up yet: add <code>DROPBOX_APP_KEY</code> and <code>DROPBOX_APP_SECRET</code> in Vercel (from the Dropbox app), redeploy, then come back here and press Connect.</div>
          : s.connected ? <div className="row" style={{ gap: 10, flexWrap: "wrap" }}><span>Connected{s.who ? ` as ${s.who}` : ""}.</span><a className="btn sm" href="/api/dropbox/connect?go=1">Connect again</a></div>
          : <div className="row" style={{ gap: 10, flexWrap: "wrap" }}><span>Not connected.</span><a className="btn primary sm" href="/api/dropbox/connect?go=1">Connect Dropbox</a></div>}
      </div>
    </section>
  );
}
