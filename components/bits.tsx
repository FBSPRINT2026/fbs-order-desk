import { ST } from "@/lib/pricing";
import { daysUntil, fmtDate, money } from "@/lib/format";

/**
 * A 40,000-series order sent to Printavo: its status is Printavo's, word for word (Oct 15, Nick: "made in the new
 * system, managed production-wise in the old one… just have it mirror back"). "" for every other order.
 */
export function pvStatusOf(o: { number?: number | null; printavo_id?: string | null; pv_status?: string | null; printavo_state?: { status?: string } | null }) {
  const n = Number(o.number || 0);
  return o.printavo_id && n >= 40000 && n < 50000 ? String(o.pv_status || o.printavo_state?.status || "").trim() : "";
}

/** pv: Printavo's own status (pvStatusOf), shown instead of ours to the shop; customers keep the friendly words */
export function Pill({ status, portal = false, pv }: { status: string; portal?: boolean; pv?: string | null }) {
  const s = ST[status] || ST.quote;
  const text = portal ? s.portal : pv || s.label;
  return <span className="pill" style={{ ["--sc" as string]: s.c }} title={pv && !portal ? `${text}: Printavo's status (this job is run from Printavo)` : text}><span className="pill-t">{text}</span></span>;
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
