"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startRequest } from "@/app/portal/request-actions";

/** Portal dashboard: the two things customers can start on their own. */
export default function StartPanel({ preview, mockupHref, settingsHref, compact = false }: { preview: boolean; mockupHref: string; /** the customer's Settings (Oct 24) */ settingsHref?: string; /** small action tiles for the dashboard's top bar */ compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const start = async () => { setBusy(true); setErr(""); const r = await startRequest(); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else { setBusy(false); setErr(r.error || "Couldn't start an order."); } };
  if (compact) return (
    <>
      <button type="button" className="pd-act main" disabled={preview || busy} onClick={start}>
        <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg></span>
        <span><b>{busy ? "Starting…" : "Start an order/quote"}</b><small>{err || "Send details, we'll confirm"}</small></span>
      </button>
      <Link className="pd-act" href={mockupHref}>
        <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z" /></svg></span>
        <span><b>Mockup Creator</b><small>Your logo on a shirt</small></span>
      </Link>
      {settingsHref && (
        <Link className="pd-act" href={settingsHref}>
          <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></span>
          <span><b>Settings</b><small>Contacts, addresses, your logo</small></span>
        </Link>
      )}
    </>
  );
  return (
    <div className="start-panel">
      <div className="sp-card">
        <span className="sp-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v13H4zM8 7V4h8v3M12 11v6M9 14h6" /></svg></span>
        <div><b>Start an order/quote</b><span>Send us the details and we&apos;ll send you a confirmation.</span></div>
        <button type="button" className="btn primary" disabled={preview || busy} onClick={async () => { setBusy(true); setErr(""); const r = await startRequest(); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else { setBusy(false); setErr(r.error || "Couldn't start an order."); } }}>{busy ? "Starting…" : "Start an order/quote"}</button>
      </div>
      <div className="sp-card">
        <span className="sp-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z" /></svg></span>
        <div><b>Mockup Creator</b><span>Put your logo or your words on a shirt, try colors and sizes, or create something new in the Design Lab.</span></div>
        <Link className="btn" href={mockupHref}>Open Mockup Creator</Link>
      </div>
      {err && <div className="banner" role="alert" style={{ gridColumn: "1 / -1" }}>{err}</div>}
    </div>
  );
}
