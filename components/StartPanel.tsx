"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startRequest } from "@/app/portal/request-actions";

/** Portal dashboard: the two things customers can start on their own. */
export default function StartPanel({ preview, mockupHref }: { preview: boolean; mockupHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="start-panel">
      <div className="sp-card">
        <span className="sp-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v13H4zM8 7V4h8v3M12 11v6M9 14h6" /></svg></span>
        <div><b>Start an order</b><span>Pick garments, sizes and where your logos go. We&apos;ll price it and send it back for your OK.</span></div>
        <button type="button" className="btn primary" disabled={preview || busy} onClick={async () => { setBusy(true); setErr(""); const r = await startRequest(); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else { setBusy(false); setErr(r.error || "Couldn't start an order."); } }}>{busy ? "Starting…" : "Start an order"}</button>
      </div>
      <div className="sp-card">
        <span className="sp-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z" /></svg></span>
        <div><b>Make a mockup</b><span>Put your logo on a shirt, try colors and sizes, and save it to your artwork.</span></div>
        <Link className="btn" href={mockupHref}>Open mockup builder</Link>
      </div>
      {err && <div className="banner" role="alert" style={{ gridColumn: "1 / -1" }}>{err}</div>}
    </div>
  );
}
