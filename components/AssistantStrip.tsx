"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings } from "@/lib/pricing";
import { applyDecisions, computeFollowUps, loadAssistantData, type FollowUp } from "@/lib/crm/followups";

/** A one-line "here's what needs you today" bar for the Orders page. */
export default function AssistantStrip() {
  const [items, setItems] = useState<FollowUp[] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const sb = createClient();
        const [data, st, sg] = await Promise.all([
          loadAssistantData(sb),
          sb.from("settings").select("data").eq("id", 1).maybeSingle(),
          sb.from("ai_suggestions").select("dedupe_key,status,snoozed_until").eq("source", "rules").limit(3000),
        ]);
        setItems(applyDecisions(computeFollowUps(data, mergeSettings(st.data?.data)), (sg.data || []) as { dedupe_key: string | null; status: string; snoozed_until: string | null }[]).open);
      } catch { setItems([]); }
    })();
  }, []);
  if (!items || !items.length) return null;
  const urgent = items.filter((x) => x.priority === 1);
  const top = (urgent.length ? urgent : items).slice(0, 3);
  return (
    <div className="as-strip">
      <b>{items.length} follow-up{items.length === 1 ? "" : "s"}</b>
      {urgent.length > 0 && <span className="as-chip u">{urgent.length} urgent</span>}
      {top.map((x) => <Link key={x.key} href={x.href} className="as-chip">{x.title}</Link>)}
      <span className="spacer" />
      <Link className="btn sm primary" href="/shop/assistant">Open Assistant</Link>
    </div>
  );
}
