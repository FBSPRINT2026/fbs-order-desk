"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mergeSettings } from "@/lib/pricing";
import { applyDecisions, computeFollowUps, loadAssistantData, loadDecisions, type FollowUp } from "@/lib/crm/followups";

/** A one-line "here's what needs you today" bar for the Orders page. `keep`: only these customers' (the dashboard's
 *  Everyone / Mine, Oct 15: "Amanda toggles to Mine and still sees Little Groupies") */
export default function AssistantStrip({ keep }: { keep?: (customerId: string | null) => boolean } = {}) {
  const [items, setItems] = useState<FollowUp[] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const sb = createClient();
        const [data, st, sg] = await Promise.all([
          loadAssistantData(sb),
          sb.from("settings").select("data").eq("id", 1).maybeSingle(),
          loadDecisions(sb),
        ]);
        setItems(applyDecisions(computeFollowUps(data, mergeSettings(st.data?.data)), sg).open);
      } catch { setItems([]); }
    })();
  }, []);
  const shown = items && keep ? items.filter((x) => keep(x.customer_id)) : items;
  if (!shown || !shown.length) return null;
  const urgent = shown.filter((x) => x.priority === 1);
  const top = (urgent.length ? urgent : shown).slice(0, 3);
  return (
    <div className="as-strip">
      <b>{shown.length} follow-up{shown.length === 1 ? "" : "s"}</b>
      {urgent.length > 0 && <span className="as-chip u">{urgent.length} urgent</span>}
      {top.map((x) => <Link key={x.key} href={x.href} className="as-chip">{x.title}</Link>)}
      <span className="spacer" />
      <Link className="btn sm primary" href="/shop/assistant">Open Assistant</Link>
    </div>
  );
}
