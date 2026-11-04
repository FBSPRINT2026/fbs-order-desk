"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Is the time clock online? (Nov 4, Nick: "a clock monitor tool into the payroll center that says like the clock is
 * online… more than 5 minutes, it sends up a notification"). An online clock checks in about every half minute; past
 * 5 minutes it's offline, and the database's own clock (clock_watch_tick, migration 283) sends the owner an alert, and
 * another when it's back. Punches made while it's offline stay on the clock and upload when it reconnects.
 */
type Dev = { name: string; last_seen_at: string | null };
const ago = (ms: number) => (ms < 90000 ? "just now" : ms < 3600000 ? `${Math.round(ms / 60000)} min ago` : `${Math.floor(ms / 3600000)} hr ${Math.round((ms % 3600000) / 60000)} min ago`);
const at = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", ...(Date.now() - Date.parse(iso) > 20 * 3600000 ? { month: "short", day: "numeric" } : {}) });

export default function ClockStatus() {
  const [devs, setDevs] = useState<Dev[] | null>(null), [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const load = () => { void createClient().from("timeclock_devices").select("name, last_seen_at").eq("active", true).eq("kind", "zk").then(({ data }) => { if (live) { setDevs((data || []) as Dev[]); setNow(Date.now()); } }); };
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!devs?.length) return null;
  return <>{devs.map((d, i) => {
    const ms = d.last_seen_at ? now - Date.parse(d.last_seen_at) : Infinity, on = ms <= 5 * 60000;
    return (
      <span key={i} className={"clk-st" + (on ? " on" : " off")} title={d.name} role="status">
        <i aria-hidden />{on ? <>Clock online <small>· checked in {ago(ms)}</small></> : <>Clock offline <small>· {d.last_seen_at ? `since ${at(d.last_seen_at)}` : "never checked in"}</small></>}
      </span>
    );
  })}</>;
}
