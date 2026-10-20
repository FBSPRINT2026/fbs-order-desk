"use client";
import { useEffect } from "react";

/**
 * A page that crashed (Oct 20: an order page showed "Application error: a client-side exception" right after an update
 * went live, while the old page asked for files the update had replaced). A stale page reloads itself once; anything
 * else says what happened, with a button to try again, instead of a blank screen.
 */
const STALE = /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i;
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = STALE.test(`${error?.name || ""} ${error?.message || ""}`);
  useEffect(() => {
    if (!stale) return;
    try { if (sessionStorage.getItem("fbs:reloaded") === location.pathname) return; sessionStorage.setItem("fbs:reloaded", location.pathname); } catch { /* reload anyway */ }
    location.reload();
  }, [stale]);
  return (
    <div style={{ padding: "48px 24px", maxWidth: 560, margin: "0 auto", fontFamily: "inherit" }}>
      <h2 style={{ margin: "0 0 8px" }}>{stale ? "Updating to the newest version…" : "Something went wrong on this page"}</h2>
      {!stale && <p style={{ color: "#5b6576", margin: "0 0 16px", lineHeight: 1.45 }}>The page hit an error. Reloading usually fixes it; if it keeps happening, use Report an issue (bottom of the menu) so we can look.<br /><small style={{ color: "#8a93a3" }}>{error?.message?.slice(0, 200)}</small></p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" onClick={() => location.reload()}>Reload the page</button>
        {!stale && <button type="button" className="btn" onClick={() => reset()}>Try again</button>}
      </div>
    </div>
  );
}
