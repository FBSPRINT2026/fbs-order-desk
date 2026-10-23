"use client";
import { useEffect, useState } from "react";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import type { OrderStart } from "@/components/OrderStartPick";

/** Create order opened from anywhere (the Order chat's "make the next order from this email"): the one tool
 *  (components/tools/CreateOrderTool.tsx), on the right of every shop page, started where it was asked to */
export function CreateOrderDock() {
  const [st, setSt] = useState<null | { activity: string; start: OrderStart; n: number }>(null);
  useEffect(() => {
    if (window.self !== window.top) return;
    const on = (e: Event) => { const d = (e as CustomEvent<{ activity: string; start: OrderStart }>).detail; if (d?.activity) setSt({ ...d, n: Date.now() }); };
    window.addEventListener("fbs:create-order", on);
    return () => window.removeEventListener("fbs:create-order", on);
  }, []);
  if (!st) return null;
  return <CreateOrderTool key={st.n} activityId={st.activity} text="" begin={st.start} onClose={() => setSt(null)} />;
}
