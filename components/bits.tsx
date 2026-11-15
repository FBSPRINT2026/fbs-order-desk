import { ST, statusText } from "@/lib/pricing";
import { daysUntil, fmtDate, money } from "@/lib/format";

/** pv: an old Printavo job's own status words (from the saved copy), shown instead of ours; customers keep the friendly words */
export function Pill({ status, portal = false, pv, hold, ship }: { status: string; portal?: boolean; pv?: string | null; /** the order's delivery_method: Ready says pickup / ship / deliver */ ship?: string | null;
  /** on hold (lib/holds.ts holdLabel): "On hold · Payment" shows instead, in the hold color, with the status in its tooltip */ hold?: string | null }) {
  if (hold) return <span className="pill pill-hold" style={{ ["--sc" as string]: "var(--warn)" }} title={`${hold} (${statusText(status, ship, portal)})`}><span className="pill-t">{hold}</span></span>;
  const s = ST[status] || ST.quote;
  const text = portal ? statusText(status, ship, true) : pv || statusText(status, ship);
  return <span className="pill" style={{ ["--sc" as string]: s.c }} title={pv && !portal ? `${text}: Printavo's status (an old Printavo job)` : text}><span className="pill-t">{text}</span></span>;
}

export function Due({ date, status }: { date: string | null; status: string }) {
  if (!date) return <span className="faint">No date</span>;
  const n = daysUntil(date)!;
  const done = status === "completed";
  let cls = "";
  if (!done && n < 0) cls = "due-late";
  else if (!done && n <= 3) cls = "due-soon";
  const rel = done ? "" : n === 0 ? " · today" : n === 1 ? " · tomorrow" : n < 0 ? ` · ${-n}d late` : n <= 7 ? ` · ${n}d` : "";
  return <span className={"due" + (cls ? " " + cls : "")}>{fmtDate(date)}{rel}</span>;
}

/**
 * The paid mark on an order card on a phone (Nov 1, Nick: "instead of listing the dollar amounts twice… a little $ sign
 * when it is paid… blank if it's unpaid… put it on the left near the number"). Sits beside the Quote/Inv tag in every
 * order list (Orders, a customer's orders, Search): green when paid in full, outlined when part paid (what's still due
 * in its tooltip), nothing when nothing is paid. Hidden on wider screens, where the Balance column shows (`.ol-bal`).
 */
export function PaidMark({ total, balance }: { total: number; balance: number }) {
  if (!(total > 0)) return null;
  if (balance <= 0.004) return <span className="ol-paid" title="Paid in full" aria-label="Paid">$</span>;
  if (balance < total - 0.004) return <span className="ol-paid part" title={`Part paid · ${money(balance)} still due`} aria-label="Part paid">$</span>;
  return null;
}
