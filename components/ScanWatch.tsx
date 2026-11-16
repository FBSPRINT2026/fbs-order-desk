"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SCAN_EVENT, jobCode, type ScanDetail } from "@/lib/scan";
import { useRole } from "@/components/RoleContext";
import CheckinModal from "@/components/CheckinModal";
import type { CheckJob } from "@/lib/checkinShared";

/**
 * Catches a scanner anywhere, on any page, nothing clicked first (lib/scan.ts; Nick, Nov 16 2026: "you shouldn't have to
 * be on a page… you scan it and it automatically will do something like pop up count in or pull up the order"). A
 * scanner's keys come in a burst (well under 50 ms apart) ending in Enter; a person typing a number and pressing Enter is
 * never taken for a scan. A scan into a box that's for typing (a search, a count) is left to that box.
 * What it does, unless the page does something of its own (Outbound's label-or-ship question):
 * - receiving (the person's role, FBS-REC) or anyone on Goods & Receiving: the Count in pop-up for that job, right there;
 * - shipping (FBS-SHIP): Outbound, asking Print box label / Start shipping for that job;
 * - everyone else: the order opens (an old Printavo job opens its page);
 * - the crew menu and a job's phone menu (FBS-PRESS, phones with a scanner): that job's phone menu.
 */
export default function ScanWatch({ mode = "shop" }: { mode?: "shop" | "crew" }) {
  const path = usePathname() || "";
  const { role } = useRole();
  const [count, setCount] = useState<CheckJob | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let buf = "", last = 0, fast = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) { buf = ""; return; }
      const now = Date.now(), gap = now - last;
      last = now;
      if (gap > 120) { buf = ""; fast = 0; } else if (gap < 50) fast++;
      if (e.key === "Enter") {
        const raw = buf, n = jobCode(raw), byScanner = raw.length > 1 && fast >= Math.min(3, raw.length - 1);
        buf = ""; fast = 0;
        if (!n || !byScanner) return;
        e.preventDefault(); e.stopPropagation();
        const ev = new CustomEvent<ScanDetail>(SCAN_EVENT, { detail: { n, raw }, cancelable: true });
        if (window.dispatchEvent(ev)) void act(n);
        return;
      }
      if (e.key.length === 1) buf += e.key;
    };
    async function act(n: string) {
      if (mode === "crew") { window.location.href = `/j/${n}`; return; }
      if (role === "shipping") { window.location.href = `/shop/outbound?scan=${n}`; return; }
      const sb = createClient();
      const { data: o } = await sb.from("orders").select("id").eq("number", +n).is("discarded_at", null).maybeSingle();
      const { data: a } = o ? { data: null } : await sb.from("archived_orders").select("id").eq("visual_id", n).is("removed_at", null).limit(1).maybeSingle();
      if (!o && !a) { setNote(`#${n} isn't an order we have.`); return; }
      if (role === "receiving" || path.startsWith("/shop/receiving")) {
        setNote(`Opening #${n}…`);
        const r = await fetch(`/api/goods/checkin?ref=${o ? o.id : "pv:" + a!.id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
        const job = ((r?.jobs || []) as CheckJob[]).concat((r?.problems || []) as CheckJob[])[0];
        if (job) { setNote(""); setCount(job); return; }
        setNote(`#${n} has nothing to count in.`); return;
      }
      window.location.href = o ? `/shop/orders/${o.id}` : `/shop/archive/${a!.id}`;
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, role, path]);

  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 4000); return () => clearTimeout(t); }, [note]);
  return <>
    {note && <div className="scw-note" role="status">{note}</div>}
    {count && <CheckinModal job={count} onClose={() => setCount(null)} onSaved={(c) => { setCount(null); setNote(c.status === "issue" ? `#${count.number} counted in with a problem: it's under the issues.` : `#${count.number} counted in: all ${c.received} here.`); }} />}
  </>;
}
