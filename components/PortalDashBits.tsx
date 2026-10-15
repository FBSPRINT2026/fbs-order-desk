"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reorderRequest } from "@/app/portal/request-actions";
import { reorderArchived } from "@/app/portal/assist-actions";

/** Order again: a new order with the same garments, sizes and logos (a past Printavo job becomes a reorder request). */
export function DashReorder({ id, archived, canAct }: { id: string; archived?: boolean; canAct: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (msg) return <span className="pdx-done">{msg}</span>;
  return (
    <button type="button" className="btn sm" disabled={!canAct || pending} title={canAct ? "Start a new order with the same garments, sizes and logos" : "Turned off in preview"}
      onClick={() => start(async () => {
        if (archived) { const r = await reorderArchived(id); setMsg(r.ok ? "Sent! We'll quote it and message you." : r.error || "Couldn't send it."); return; }
        const r = await reorderRequest(id);
        if (r.ok && r.id) router.push(`/portal/request/${r.id}`); else setMsg(r.error || "Couldn't start the reorder.");
      })}>{pending ? "Starting…" : "Reorder"}</button>
  );
}
