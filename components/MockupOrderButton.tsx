"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { orderFromMockup } from "@/app/portal/request-actions";

/**
 * "Order this" on a customer's mockup (Oct 24, Nick: "they click on the mockup and they can either edit it or they can order
 * it… it starts an order with that already filled in"): a new order with the mockup's garments, colors, prints and inks,
 * for them to add sizes and send in like any order they start.
 */
export default function MockupOrderButton({ id, canAct, className = "btn sm primary" }: { id: string; canAct: boolean; className?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (msg) return <span className="faint mk-ord-msg">{msg}</span>;
  return (
    <button type="button" className={className} disabled={!canAct || pending} title={canAct ? "Start an order with this mockup filled in: add your sizes and send it in" : "Turned off in preview"}
      onClick={() => start(async () => {
        const r = await orderFromMockup(id);
        if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else setMsg(r.error || "Couldn't start the order.");
      })}>{pending ? "Starting…" : "Order this"}</button>
  );
}
