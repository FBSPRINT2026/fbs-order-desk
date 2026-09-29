"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mergeTime, type Employee } from "@/lib/timeclock";
import TeamPlan from "@/components/team/TeamPlan";
import TeamFloor from "@/components/team/TeamFloor";
import TeamTimes from "@/components/team/TeamTimes";
import TeamEfficiency from "@/components/team/TeamEfficiency";
import TeamApp from "@/components/team/TeamApp";
import type { TeamData } from "@/components/team/types";

/**
 * Production → Employees: job efficiency. Plan who works which jobs each day, see who's on what right now,
 * every job's logged time (fixable), and efficiency by job, person and task. Time is logged in the employee app
 * (portal.fbsprint.com/work): scan the job ticket, pick Front / Back / Setup…, Start, Finish. Separate from pay time.
 */
const TABS = [["plan", "Today's Plan"], ["floor", "On The Floor"], ["times", "Job Times"], ["eff", "Efficiency"], ["app", "Employee App"]] as const;
type Tab = (typeof TABS)[number][0];

export default function EmployeesPage() {
  const sp = useSearchParams(), router = useRouter();
  const tab = (sp.get("tab") as Tab) || "plan";
  const [d, setD] = useState<TeamData | null>(null);
  const reload = useCallback(async () => {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const email = (user?.email || "").toLowerCase();
    const [{ data: st }, { data: emps }, { data: s }] = await Promise.all([
      sb.from("staff").select("role").eq("email", email).maybeSingle(),
      sb.from("employees").select("*").order("first_name"),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    setD({ me: email, boss: ["owner", "admin"].includes((st?.role as string) || ""), employees: (emps || []) as Employee[], settings: mergeTime((s?.data as { time?: unknown } | null)?.time), reload });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const go = (t: Tab) => { const p = new URLSearchParams(sp.toString()); if (t === "plan") p.delete("tab"); else p.set("tab", t); router.replace(`/shop/employees${p.size ? "?" + p : ""}`, { scroll: false }); };
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Job time &amp; efficiency</div><h1>Employees</h1></div>
        <div className="row" style={{ gap: 8 }}><a className="btn" href="/work" target="_blank" rel="noreferrer">Open Employee App</a></div>
      </div>
      <div className="aa-sub tm-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => go(k)}>{l}</button>)}</div>
      {!d ? <div className="empty">Loading…</div>
        : tab === "floor" ? <TeamFloor d={d} />
        : tab === "times" ? <TeamTimes d={d} />
        : tab === "eff" ? <TeamEfficiency d={d} />
        : tab === "app" ? <TeamApp d={d} />
        : <TeamPlan d={d} />}
    </>
  );
}
