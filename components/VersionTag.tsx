"use client";
import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";

/**
 * The version this page is running, small under the logo; when a newer one is live it says so and a click reloads
 * (Oct 20, Nick: "when I click refresh I'll be able to know if you've updated").
 */
export default function VersionTag() {
  const [live, setLive] = useState("");
  useEffect(() => {
    let on = true;
    const check = () => fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((j: { ver?: string }) => { if (on && j.ver) setLive(j.ver); }).catch(() => null);
    void check();
    const t = setInterval(check, 60_000);
    const back = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", back);
    return () => { on = false; clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, []);
  const newer = !!live && live !== APP_VERSION;
  return newer
    ? <button type="button" className="ver-tag new" onClick={() => window.location.reload()} title={`You're on v${APP_VERSION}. Click to load v${live}.`} data-notranslate>v{live} ready · Refresh</button>
    : <span className="ver-tag" title="The portal's version: it goes up with every update" data-notranslate>v{APP_VERSION}</span>;
}
