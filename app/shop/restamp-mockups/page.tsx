"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { stampOrderMockups } from "@/lib/mockupStamp";
import { orderGroups, type Order } from "@/lib/pricing";

/**
 * The customer supplied mockups already stamped in the darker gray, stamped again in the very light gray (Oct 31, Nick:
 * "apply that to all the customer supplied proofs… stored in the system"). Every order with a customer's mockup, one at a
 * time: the same Production files listing gets the light picture (lib/mockupStamp.ts). Orders opened later do it too.
 */
export default function RestampMockups() {
  const sb = createClient();
  const [state, setState] = useState<{ done: number; of: number; redone: number; msg: string } | null>(null);
  const [running, setRunning] = useState(false);
  async function run() {
    setRunning(true);
    setState({ done: 0, of: 0, redone: 0, msg: "Finding the orders…" });
    const { data: af } = await sb.from("art_files").select("order_id").like("file_path", "%custmockup-%").limit(1000);
    const ids = [...new Set(((af || []) as { order_id: string }[]).map((x) => x.order_id).filter(Boolean))];
    let redone = 0;
    for (const [i, id] of ids.entries()) {
      const { data: o } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
      if (o) redone += await stampOrderMockups(sb, id, orderGroups(o as Order)).catch(() => 0);
      setState({ done: i + 1, of: ids.length, redone, msg: "" });
    }
    setState({ done: ids.length, of: ids.length, redone, msg: "Done" });
    setRunning(false);
  }
  return (
    <div className="stack">
      <div className="page-head"><div><h1>Customer mockup stamps</h1><div className="eyebrow">Stamp the customer supplied mockups again in the very light gray</div></div>
        <button type="button" className="btn primary" disabled={running} onClick={() => void run()}>Stamp them again</button></div>
      {state && <div className="panel"><div className="panel-b">{state.msg && state.msg !== "Done" ? state.msg : `${state.done} of ${state.of} orders · ${state.redone} mockup${state.redone === 1 ? "" : "s"} stamped light`}{state.msg === "Done" ? " · done" : ""}</div></div>}
    </div>
  );
}
