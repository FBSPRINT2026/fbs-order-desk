import type { Flag, FlagKey } from "@/lib/orderStages";

/**
 * On hold (Nov 3, Nick: "it can't just sit here and say approved… no one on my team knows why… when you click on hold…
 * a pop-up… why is this job on hold? Payment, receiving, quality control, art… and there should be an explanation so
 * that when a customer goes into their customer portal… your order's on hold, why").
 *
 * A hold sits on top of the order's status, it doesn't replace it: the job keeps its place (Approved, In production…)
 * and comes back to it when the hold is taken off. It's one of the order's flags (orders.flags, lib/orderStages.ts), so
 * everything that already reads holds (the portal's stamp, the Job Center, the work order) keeps working. Wherever a
 * status shows, a held order shows "On hold · <reason>" (holdOf / holdLabel).
 *
 * Who sees it: everyone in the shop; the customer sees the note, just "on hold", or nothing (the flag's `show`). A
 * payment hold keeps the job out of production's lists until it's paid (Nick: "he's not gonna see it if it's
 * prepayment… until it's paid").
 */
export type HoldShow = "message" | "hold" | "none";
export type HoldReason = { key: FlagKey; label: string; sub: string; icon: string; show: HoldShow; text: string };

/** the reasons offered when someone puts a job on hold, in this order */
export const HOLD_REASONS: HoldReason[] = [
  { key: "hold_payment", label: "Payment", sub: "Pre-pay or deposit not in", icon: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", show: "message", text: "We need your payment before we can start." },
  { key: "hold_receiving", label: "Receiving", sub: "Goods short, wrong or damaged", icon: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10", show: "message", text: "The garments came in short or wrong. We're getting it fixed and will let you know." },
  { key: "hold_qc", label: "Quality control", sub: "Misprint, reprint, checking", icon: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3M8 11l2 2 4-4", show: "none", text: "" },
  { key: "art_problem", label: "Art", sub: "Bad file, art not usable", icon: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01", show: "message", text: "The art file we have won't print well. Please send a better file (vector or high resolution)." },
  { key: "hold_customer", label: "Waiting on customer", sub: "A question or a decision", icon: "M21 12a8 8 0 0 1-11.8 7L3 21l2-6.2A8 8 0 1 1 21 12zM12 8v4M12 16h.01", show: "message", text: "We have a question for you before we go on. We'll reach out, or send us a message." },
];

/** every flag that holds a job, and the reason it's shown as (goods issues' own hold is Receiving; the old shop hold, Shop) */
const AS: Record<string, string> = { hold_payment: "Payment", art_problem: "Art", goods_wrong: "Receiving", hold_receiving: "Receiving", hold_customer: "Waiting on customer", hold_qc: "Quality control", hold_shop: "Shop" };
export const HOLD_KEYS = Object.keys(AS) as FlagKey[];
export const isHoldKey = (k: string) => k in AS;

/** the order's hold, if it's on one: the first by what matters most (payment, art, receiving, the customer, QC, shop) */
export function holdOf(flags?: Flag[] | null | unknown): (Flag & { reason: string }) | null {
  const fs = (Array.isArray(flags) ? flags : []) as Flag[];
  for (const k of HOLD_KEYS) { const f = fs.find((x) => x?.key === k); if (f) return { ...f, reason: AS[k] }; }
  return null;
}
/** every hold on the order (a job can be held for two things at once) */
export const holdsOf = (flags?: Flag[] | null | unknown) => ((Array.isArray(flags) ? flags : []) as Flag[]).filter((f) => f && isHoldKey(f.key)).map((f) => ({ ...f, reason: AS[f.key] }));
/** "On hold · Payment", or "" */
export const holdLabel = (flags?: Flag[] | null | unknown) => { const h = holdOf(flags); return h ? `On hold · ${h.reason}` : ""; };
/** a payment hold keeps a job out of production's lists until it's paid */
export const heldForPayment = (flags?: Flag[] | null | unknown) => ((Array.isArray(flags) ? flags : []) as Flag[]).some((f) => f?.key === "hold_payment");
/** who put a hold on by itself */
export const AUTO_HOLD = "Automatic";
