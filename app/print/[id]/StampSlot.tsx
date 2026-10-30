"use client";
import { useEffect, useState } from "react";

/**
 * The approval stamp in the document's top row, beside Save PDF / Print / Close, right side (Oct 30, Nick: "the
 * approved stamp should just go on the same line as Save PDF, Print and Close… a straight approved stamp… on that right
 * side I could say approved, declined"). The customer's page (/proof) tells the framed document what to show, since only
 * it knows what they've just done ("Looks good" before they submit): a message { fbsStamp: "ok" | "looks" | "changes" |
 * "declined" | "" }. Never printed.
 */
const LOOK: Record<string, { t: string; i: string }> = { ok: { t: "Approved", i: "✓" }, looks: { t: "Looks good", i: "✓" }, changes: { t: "Changes requested", i: "✎" }, declined: { t: "Declined", i: "×" } };
export default function StampSlot() {
  const [s, setS] = useState("");
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data && typeof e.data === "object" && "fbsStamp" in e.data) setS(String(e.data.fbsStamp || "")); };
    addEventListener("message", on);
    // ask the page around us, in case it spoke before this loaded
    if (parent !== window) parent.postMessage({ fbsStampAsk: 1 }, location.origin);
    return () => removeEventListener("message", on);
  }, []);
  const l = LOOK[s];
  if (!l) return null;
  return <span className={"doc-stamp " + s} role="status"><span aria-hidden>{l.i}</span>{l.t}</span>;
}
