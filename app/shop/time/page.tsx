"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mergeTime, type Employee, type TimeSettings } from "@/lib/timeclock";
import TimeToday from "@/components/time/TimeToday";
import TimeCards from "@/components/time/TimeCards";
import TimeSchedule from "@/components/time/TimeSchedule";
import TimeEmployees from "@/components/time/TimeEmployees";
import TimeOffPanel from "@/components/time/TimeOffPanel";
import TimeSettingsPanel from "@/components/time/TimeSettingsPanel";
import TimeImport from "@/components/time/TimeImport";
import type { TimeData } from "@/components/time/types";

/**
 * Time Clock: our own time & attendance (replacing uAttend). Who's in right now, timecards and payroll export,
 * the weekly schedule, employees and their PINs, time off, and the clock's settings. Punches come from the wall
 * clock (/clock), phones (staff logins, near the shop), or a manager adding one by hand.
 */
const TABS = [["today", "Today"], ["cards", "Timecards"], ["schedule", "Schedule"], ["employees", "Employees"], ["off", "Time Off"], ["settings", "Settings"], ["import", "Import"]] as const;
type Tab = (typeof TABS)[number][0];

export default function TimePage() {
  const sp = useSearchParams(), router = useRouter();
  const tab = (sp.get("tab") as Tab) || "today";
  const [me, setMe] = useState(""), [role, setRole] = useState("");
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [settings, setSettings] = useState<TimeSettings>(mergeTime({}));

  const reload = useCallback(async () => {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const email = (user?.email || "").toLowerCase();
    const [{ data: st }, { data: emps }, { data: s }] = await Promise.all([
      sb.from("staff").select("role").eq("email", email).maybeSingle(),
      sb.from("employees").select("*").order("last_name").order("first_name"),
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    setMe(email); setRole((st?.role as string) || "");
    setEmployees((emps || []) as Employee[]);
    setSettings(mergeTime((s?.data as { time?: unknown } | null)?.time));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const go = (t: Tab) => { const p = new URLSearchParams(sp.toString()); if (t === "today") p.delete("tab"); else p.set("tab", t); router.replace(`/shop/time${p.size ? "?" + p : ""}`, { scroll: false }); };
  const d: TimeData | null = useMemo(() => (employees ? { me, role, employees, settings, reload } : null), [me, role, employees, settings, reload]);
  const boss = role === "owner" || role === "admin";

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Time &amp; attendance</div><h1>Time Clock</h1></div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href="/clock" target="_blank" rel="noreferrer">Open Wall Clock</a>
        </div>
      </div>
      <div className="aa-sub tm-tabs" role="tablist">
        {TABS.filter(([k]) => boss || (k !== "settings" && k !== "import")).map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => go(k)}>{l}</button>)}
      </div>
      {!d ? <div className="empty">Loading…</div>
        : tab === "cards" ? <TimeCards d={d} />
        : tab === "schedule" ? <TimeSchedule d={d} />
        : tab === "employees" ? <TimeEmployees d={d} />
        : tab === "off" ? <TimeOffPanel d={d} />
        : tab === "settings" && boss ? <TimeSettingsPanel d={d} />
        : tab === "import" && boss ? <TimeImport d={d} />
        : <TimeToday d={d} />}
    </>
  );
}

