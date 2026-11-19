"use client";
import { useState } from "react";
import { useT } from "./lang";

/**
 * Sign out, at the top right of the crew's phone menu and a job's menu (Nick, Nov 19 2026: "no way to log out", Linda on
 * the receiving computer). Signs out the person (their employee # and PIN); a shop computer stays signed in as itself, so
 * the next person signs in with theirs. Someone on their own office login is signed out of that.
 */
export default function CrewSignOut() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  async function out() {
    setBusy(true);
    const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }).catch(() => null);
    if (r && r.status === 401) { const f = document.createElement("form"); f.method = "post"; f.action = "/auth/signout"; document.body.appendChild(f); f.submit(); return; }
    location.href = "/crew";
  }
  return (
    <button type="button" className="jm-out" onClick={() => void out()} disabled={busy} aria-label={t("Sign out")} title={t("Sign out")}>
      <svg viewBox="0 0 24 24" aria-hidden><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></svg><span>{t("Sign out")}</span>
    </button>
  );
}
