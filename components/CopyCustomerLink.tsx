"use client";
import { useState } from "react";
import { SITE_URL } from "@/lib/config";

/**
 * The link that opens this order in the customer's own portal (what Printavo's customer link was; Nick, Nov 18 2026:
 * "copy that link and when he opens, it goes right in the portal to his invoice"). One place builds it, for an order of
 * ours (/portal/orders/<id>) and an old Printavo job (/portal/archive/<id>); a customer not signed in signs in and lands
 * on it.
 */
export function customerLink(kind: "order" | "archive", id: string): string {
  const base = SITE_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/portal/${kind === "archive" ? "archive" : "orders"}/${id}`;
}

/** "Copy customer link": one button in an order's top row, beside Job ticket, Phone menu and Print. */
export default function CopyCustomerLink({ kind, id }: { kind: "order" | "archive"; id: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const link = customerLink(kind, id);
    try { await navigator.clipboard.writeText(link); } catch { window.prompt("Copy the customer link:", link); return; }
    setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return (
    <button type="button" className="btn" onClick={() => void copy()} title="Copies the link that opens this order in the customer's portal">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginRight: 5, verticalAlign: "-2px" }}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
      {done ? "Copied" : "Copy customer link"}
    </button>
  );
}
