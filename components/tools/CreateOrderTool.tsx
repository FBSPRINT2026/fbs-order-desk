"use client";
import { useEffect, useState } from "react";
import OrderStartPick, { type OrderStart } from "@/components/OrderStartPick";
import QuickOrder from "@/components/QuickOrder";

/**
 * THE Create order / Create reorder tool (Oct 23, Nick: "think of each of these as an individual tool that just gets
 * applied multiple places in the site… the create order is in email, it's in the ClickUp thing, it's in the projects
 * area… one uniform tool that works throughout the site"). Whatever it's opened on (an email, a ClickUp job, files
 * dropped in the AI Workbench) is an activity; this asks new or reorder (OrderStartPick), then reads it and makes the
 * order (QuickOrder: the questions, the colors, the Helper for art on a shirt, the Printavo art). It opens as a panel on
 * the right with the page still usable beside it, so the email, its attachments and the job can be looked at while it
 * works (Oct 23, Nick: "a pop-up on the right, like Claude in Chrome… so I can still go back and click attachments"). Every Create order
 * button opens this; change it here and it changes everywhere. Listed in the AI Workbench's Tools (lib/aiTools.ts).
 */
export default function CreateOrderTool({ activityId, text, guess = "", suggested, onClose, onCreated, onReview }: {
  activityId: string;
  /** what it's about (the email's subject and summary, the job's name): past jobs named in it come first */ text: string;
  guess?: "new" | "reorder" | "";
  /** what the Assistant suggested ("Create the reorder of #31174") */ suggested?: { label: string; told?: string; job?: string };
  onClose: () => void;
  /** each order made */ onCreated?: (id: string, number: number, label: string) => void;
  /** "check every detail first": the page's full form, when it has one */ onReview?: (start: OrderStart) => void;
}) {
  const [quick, setQuick] = useState<(OrderStart & { n: number }) | null>(null);
  // open on the right: the left menu folds to icons while it's open (ShopNav listens), then comes back
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: true } }));
    return () => { window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: false } })); };
  }, []);
  if (quick) return (
    <QuickOrder key={quick.n} dock activityId={activityId} start={quick} onClose={() => { setQuick(null); onClose(); }}
      onReview={() => { const st = quick; setQuick(null); if (onReview) onReview(st); else onClose(); }}
      onCreated={(id, n, label) => onCreated?.(id, n, label)} />
  );
  return (
    <OrderStartPick dock activityId={activityId} text={text} guess={guess} suggested={suggested} onClose={onClose}
      onPick={(st) => { if (st.review && onReview) { onReview(st); return; } setQuick({ ...st, review: false, n: Date.now() }); }} />
  );
}
