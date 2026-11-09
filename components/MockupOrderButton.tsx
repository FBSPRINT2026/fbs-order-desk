"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orderFromMockup, staffJobFromMockup } from "@/app/portal/request-actions";

/**
 * "Order this" on a customer's mockup (Oct 24, Nick: "they click on the mockup and they can either edit it or they can order
 * it… it starts an order with that already filled in"): a new order with the mockup's garments, colors, prints and inks,
 * for them to add sizes and send in like any order they start.
 */
/** shop: "Start a job" (a quote with no sizes yet, opened in the shop) instead of the customer's "Order" */
export default function MockupOrderButton({ id, canAct, className = "btn sm primary", shop = false }: { id: string; canAct: boolean; className?: string; shop?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (msg) return <span className="faint mk-ord-msg">{msg}</span>;
  return (
    <button type="button" className={className} disabled={!canAct || pending} title={!canAct ? "Turned off in preview" : shop ? "Make this a job: a quote with this mockup on it, waiting on their sizes (it shows in the Job Center)" : "Start an order with this mockup filled in: add your sizes and send it in"}
      onClick={() => start(async () => {
        const r = shop ? await staffJobFromMockup(id) : await orderFromMockup(id);
        if (r.ok && r.id) router.push(shop ? `/shop/orders/${r.id}` : `/portal/request/${r.id}`); else setMsg(r.error || "Couldn't start the order.");
      })}>{pending ? "Starting…" : shop ? "Start a job" : "Order"}</button>
  );
}
