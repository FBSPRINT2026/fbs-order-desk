"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * An order's open Issues (Nick, Nov 12 2026): pieces still to print after its run, because goods were missing, some
 * were rejects, or it needs a reprint (raised from the schedule's right-click, `production_issues`). Shown beside the
 * order's status on the Orders list and the order's header; the order stays In Production until they're printed. The
 * customer's portal never shows it.
 */
export type OpenIssue = { order_id: string; why: "missing" | "reject" | "reprint"; pcs: number; goods_at: string | null };
const WORD: Record<OpenIssue["why"], string> = { missing: "Missing", reject: "Reject", reprint: "Reprint" };

export function useOpenIssues(orders: { id: string }[]): Record<string, OpenIssue[]> {
  const ids = useMemo(() => orders.map((o) => o.id).sort(), [orders]);
  const key = ids.join(",");
  const [by, setBy] = useState<Record<string, OpenIssue[]>>({});
  useEffect(() => {
    if (!ids.length) { setBy({}); return; }
    let live = true;
    void (async () => {
      const sb = createClient(), out: Record<string, OpenIssue[]> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await sb.from("production_issues").select("order_id, why, pcs, goods_at").eq("status", "open").in("order_id", ids.slice(i, i + 200));
        for (const r of (data || []) as OpenIssue[]) (out[r.order_id] ||= []).push(r);
      }
      if (live) setBy(out);
    })();
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return by;
}

export function IssueTag({ issues }: { issues?: OpenIssue[] }) {
  if (!issues?.length) return null;
  return <>{issues.map((x, i) => (
    <span key={i} className={"mjx-tag " + x.why} title={`${x.pcs ? `${x.pcs} pcs still to print` : "how many to be counted"}${x.why === "missing" && !x.goods_at ? ": waiting on the goods" : ""}`}>{WORD[x.why]}{x.pcs ? ` · ${x.pcs} pcs` : ""}</span>
  ))}</>;
}
