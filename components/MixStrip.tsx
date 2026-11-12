"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IN_WORK_STATUSES, type Group } from "@/lib/pricing";
import { kindsOf, mixParts, MIX_ABBR, type MixPart, type MixSlot } from "@/lib/mixParts";

/**
 * A mixed job's parts as a small strip under its status (Nov 12, Nick, option B): SP / EMB / HP, green done, blue
 * printing, gray booked, amber dashed not on the schedule; hover for when and where. One look for the Orders list, the
 * order's header and the schedule's job card (lib/mixParts.ts).
 */
export function MixStrip({ parts }: { parts: MixPart[] | undefined }) {
  if (!parts || parts.length < 2) return null;
  return <div className="mxs" data-notranslate>{parts.map((p) => <span key={p.kind} className={"mxs-p " + p.state} title={p.note}>{MIX_ABBR[p.kind]}{p.state === "ok" ? <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</span>)}</div>;
}

type O = { id: string; status?: string | null; groups?: unknown };
/** the parts of every mixed order in the list that's in the works: one read of their bookings */
export function useMixParts(orders: O[]): Record<string, MixPart[]> {
  const ids = useMemo(() => orders.filter((o) => IN_WORK_STATUSES.includes(o.status || "") && kindsOf(o.groups as Group[]).length > 1).map((o) => o.id).sort(), [orders]);
  const key = ids.join(",");
  const [data, setData] = useState<{ slots: MixSlot[]; names: Record<string, string> }>({ slots: [], names: {} });
  useEffect(() => {
    if (!ids.length) { setData({ slots: [], names: {} }); return; }
    let live = true;
    const sb = createClient();
    void (async () => {
      const slots: MixSlot[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data: rows } = await sb.from("production_slots").select("order_id, kind, status, day, machine, finished_at").in("order_id", ids.slice(i, i + 200));
        slots.push(...((rows || []) as MixSlot[]));
      }
      const { data: st } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
      const ms = ((st?.data as { production?: { machines?: { id: string; name: string }[] } } | null)?.production?.machines) || [];
      if (live) setData({ slots, names: Object.fromEntries(ms.map((m) => [m.id, m.name.replace(/^.*·\s*/, "")])) });
    })();
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const out: Record<string, MixPart[]> = {};
    for (const o of orders) if (ids.includes(o.id)) out[o.id] = mixParts(o.groups as Group[], data.slots.filter((s) => s.order_id === o.id), (m) => data.names[m] || m);
    return out;
  }, [orders, ids, data]);
}
