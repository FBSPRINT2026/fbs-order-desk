"use client";
import { useEffect, useMemo, useState } from "react";
import SettingsTabs from "@/components/SettingsTabs";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_PRODUCTION, estimate, fmtMin, mergeProduction, needsForOrder, needsForPrintavo, type Crew, type Machine, type MachineType, type ProductionSettings, type Shift } from "@/lib/production";
import { jobKey, jobMinutes, type JobTime } from "@/lib/timeclock";
import type { Group } from "@/lib/pricing";

/**
 * Settings → Production: the machines the calendar schedules, and the time standards it uses to figure how long a job
 * takes. They start from industry averages; "Your shop's real speed" compares them with logged job time and can
 * adopt the measured speed with one click.
 */
const TYPES: [MachineType, string][] = [["screen", "Screen press"], ["embroidery", "Embroidery"], ["heat", "Heat press"]];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromTime = (v: string) => { const [h, m] = v.split(":").map(Number); return isNaN(h) ? null : Math.min(1440, h * 60 + (m || 0)); };
// lunch can start any quarter hour from 11:00 to 12:00 (so it's over by 12:30); noon unless it needs to move
const LUNCH_STARTS = [660, 675, 690, 705, 720];
const clock12 = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")}`;
const hrs = (sh: Shift) => (sh ? ((sh[1] - sh[0]) / 60).toFixed((sh[1] - sh[0]) % 60 ? 1 : 0) : "");

export default function ProductionSettingsPage() {
  const [s, setS] = useState<ProductionSettings | null>(null);
  const [state, setState] = useState("");
  useEffect(() => { createClient().from("settings").select("data").eq("id", 1).maybeSingle().then(({ data }) => setS(mergeProduction((data?.data as { production?: unknown } | null)?.production))); }, []);
  const upd = (fn: (d: ProductionSettings) => void) => setS((prev) => { const d = structuredClone(prev!); fn(d); setState("Not saved"); return d; });
  async function save() {
    setState("Saving…");
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const clean = { ...s!, machines: s!.machines.map(({ week: _w, off: _o, brk: _b, skill: _k, ...m }) => m) };
    const { error } = await sb.from("settings").upsert({ id: 1, data: { ...(data?.data || {}), production: clean }, updated_at: new Date().toISOString() });
    setState(error ? `Couldn't save: ${error.message}` : "Saved");
  }
  if (!s) return <div className="empty">Loading…</div>;
  const n = (v: string) => (v === "" ? 0 : +v);
  const num = (label: string, value: number, set: (x: number) => void, step = 1, hint = "") => (
    <div className="field"><label>{label}</label><input type="number" step={step} value={value} onChange={(e) => set(n(e.target.value))} />{hint && <small className="faint">{hint}</small>}</div>
  );
  const exMach = s.machines.find((m) => m.type === "screen" && m.colors >= 12) || s.machines[0];
  const ex = needsForOrder(s, { groups: [{ id: "x", lines: [{ id: "l", style: "", brand: "", garment: "Tee", color: "Black", cost: 0, sizes: { M: 144 }, priceOverride: null }], imprints: [{ id: "a", method: "screen", location: "Full Front", colors: 3, inks: "", size: "", notes: "" }, { id: "b", method: "screen", location: "Full Back", colors: 1, inks: "", size: "", notes: "" }] }] as Group[], lines: [], number: 0, nickname: "" } as never);
  const exE = needsForOrder(s, { groups: [{ id: "y", lines: [{ id: "l", style: "", brand: "", garment: "Polo", color: "Navy", cost: 0, sizes: { M: 48 } as never, priceOverride: null }], imprints: [{ id: "c", method: "embroidery", location: "Left Chest", colors: 5, inks: "", size: "", notes: "" }] }] as Group[], lines: [], number: 0, nickname: "" } as never);
  const e6 = s.machines.find((m) => m.type === "embroidery" && m.heads === 6) || s.machines.find((m) => m.type === "embroidery");

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Machines and the times the production calendar uses</div><h1>Settings</h1></div>
        <div className="row"><span className="save-state">{state}</span><button className="btn primary" type="button" onClick={save}>Save changes</button></div>
      </div>
      <SettingsTabs />
      <div className="stack">
        <section className="panel">
          <div className="panel-h"><h2>Crews</h2><button type="button" className="btn sm" onClick={() => upd((d) => { d.crews.push({ id: "c" + Date.now().toString(36), leader: "", week: [null, [420, 1080], [420, 1080], [420, 1080], [420, 1080], [420, 1080], null] }); })}>+ Add Crew</button></div>
          <div className="panel-b">
            <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Each crew&apos;s regular schedule. A press with a crew (pick it in Machines below) runs on that crew&apos;s hours on the production calendar. Vacations and days a crew is out are marked on the calendar itself (tap a press&apos;s hours, or &quot;off?&quot; on a day).</p>
            <div className="tbl-wrap"><table className="rv-tbl ps-crews"><thead><tr><th>Crew leader</th><th>Starts</th><th>Ends</th><th>Days</th><th className="r">Hours</th><th>Lunch</th><th>Runs</th><th /></tr></thead>
              <tbody>{s.crews.map((c, i) => {
                const set = (fn: (x: Crew) => void) => upd((d) => fn(d.crews[i]));
                const gen = (c.week.find(Boolean) || [420, 1080]) as [number, number];
                // one schedule for every day the crew works
                const setHours = (a: number, b: number) => set((x) => { const on = x.week.some(Boolean) ? x.week.map(Boolean) : [false, true, true, true, true, true, false]; x.week = on.map((w) => (w ? [a, Math.max(a + 15, b)] as [number, number] : null)); });
                const presses = s.machines.filter((m) => m.crew === c.id).map((m) => m.name.split(" · ")[0]);
                return (
                  <tr key={c.id}>
                    <td><input type="text" value={c.leader} placeholder="Name" onChange={(e) => set((x) => { x.leader = e.target.value; })} /></td>
                    <td><input type="time" step={900} value={toTime(gen[0])} aria-label="Starts" onChange={(e) => { const v = fromTime(e.target.value); if (v != null) setHours(v, gen[1]); }} /></td>
                    <td><input type="time" step={900} value={toTime(gen[1] % 1440)} aria-label="Ends" onChange={(e) => { const v = fromTime(e.target.value); if (v != null) setHours(gen[0], v); }} /></td>
                    <td><div className="ps-days">{WEEK_ORDER.map((di) => <button key={di} type="button" className={c.week[di] ? "on" : ""} onClick={() => set((x) => { x.week[di] = x.week[di] ? null : [...gen] as [number, number]; })}>{DAYS[di][0]}</button>)}</div></td>
                    <td className="r">{hrs(gen)}</td>
                    <td>{gen[1] - gen[0] > s.breaks.lunchAfterHours * 60 && s.breaks.lunchMin > 0
                      ? <select value={c.lunchAt ?? s.breaks.lunchAt} aria-label="Lunch starts" onChange={(e) => set((x) => { x.lunchAt = +e.target.value; })}>{LUNCH_STARTS.map((t) => <option key={t} value={t}>{clock12(t)} – {clock12(t + s.breaks.lunchMin)}</option>)}</select>
                      : <span className="faint" style={{ fontSize: 12.5 }} title={`Lunch is only scheduled on shifts over ${s.breaks.lunchAfterHours} hours`}>None</span>}</td>
                    <td className="faint" style={{ fontSize: 12.5 }}>{presses.length ? presses.join(", ") : "No press yet"}</td>
                    <td><button type="button" className="linkbtn danger" onClick={() => upd((d) => { d.crews.splice(i, 1); d.machines.forEach((m) => { if (m.crew === c.id) m.crew = undefined; }); })}>Remove</button></td>
                  </tr>
                );
              })}</tbody></table></div>
            <div className="ps-brk">
              <b>Every shift</b>
              {num("Press warm-up (minutes)", s.breaks.warmupMin, (x) => upd((d) => { d.breaks.warmupMin = Math.max(0, Math.min(120, x)); }), 5, "Blocked at the start of each shift, shown in red")}
              {num("Lunch (minutes)", s.breaks.lunchMin, (x) => upd((d) => { d.breaks.lunchMin = Math.max(0, Math.min(90, x)); }), 5, "0 = no lunch block")}
              {num("Warm-up after lunch (minutes)", s.breaks.rewarmMin, (x) => upd((d) => { d.breaks.rewarmMin = Math.max(0, Math.min(60, x)); }), 5, "Warming the press back up")}
              {num("Lunch when a shift is over (hours)", s.breaks.lunchAfterHours, (x) => upd((d) => { d.breaks.lunchAfterHours = Math.max(0, Math.min(16, x)); }), 0.5)}
              <div className="field"><label>Lunch usually starts</label><select value={s.breaks.lunchAt} onChange={(e) => upd((d) => { d.breaks.lunchAt = +e.target.value; })}>{LUNCH_STARTS.map((t) => <option key={t} value={t}>{clock12(t)}</option>)}</select><small className="faint">Each crew can move it above</small></div>
            </div>
            <div className="ps-brk">
              <b>Labor cost</b>
              {num("People per crew", s.labor.crewSize, (x) => upd((d) => { d.labor.crewSize = Math.max(1, Math.min(20, x)); }), 1)}
              {num("Average wage ($/hr)", s.labor.wage, (x) => upd((d) => { d.labor.wage = Math.max(0, x); }), 0.5)}
              {num("Overtime / Saturday rate (×)", s.labor.otMultiplier, (x) => upd((d) => { d.labor.otMultiplier = Math.max(1, Math.min(3, x)); }), 0.25, "Used to price overtime and Saturday shifts when the schedule is too tight")}
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Machines</h2><button type="button" className="btn sm" onClick={() => upd((d) => { d.machines.push({ id: "m" + Date.now().toString(36), name: "New machine", type: "screen", colors: 6, heads: 1, startMin: 420, hoursPerDay: 11, days: [1, 2, 3, 4, 5], pvMatch: "", active: true, speed: 1 }); })}>+ Add Machine</button></div>
          <div className="panel-b">
            <table className="rv-tbl ps-mach"><thead><tr><th>Name</th><th>Type</th><th className="r">Colors / heads</th><th>Crew</th><th>Starts</th><th className="r">Hours / day</th><th>Days</th><th className="r">Speed</th><th>Printavo status has</th><th>On</th></tr></thead>
              <tbody>{s.machines.map((m, i) => {
                const set = (fn: (x: Machine) => void) => upd((d) => fn(d.machines[i]));
                return (
                  <tr key={m.id}>
                    <td><input type="text" value={m.name} onChange={(e) => set((x) => { x.name = e.target.value; })} /></td>
                    <td><select value={m.type} onChange={(e) => set((x) => { x.type = e.target.value as MachineType; })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td className="r">{m.type === "screen" ? <input type="number" min={1} max={20} value={m.colors} onChange={(e) => set((x) => { x.colors = n(e.target.value); })} title="Colors (print heads)" /> : m.type === "embroidery" ? <input type="number" min={1} max={30} value={m.heads} onChange={(e) => set((x) => { x.heads = n(e.target.value); })} title="Heads" /> : <span className="faint">—</span>}</td>
                    <td><select value={m.crew || ""} onChange={(e) => set((x) => { x.crew = e.target.value || undefined; })}><option value="">No crew (own hours)</option>{s.crews.map((c) => <option key={c.id} value={c.id}>{c.leader || "Unnamed crew"}</option>)}</select></td>
                    {m.crew && s.crews.some((c) => c.id === m.crew) ? <td colSpan={3} className="faint" style={{ fontSize: 12.5 }}>{s.crews.find((c) => c.id === m.crew)!.leader || "Crew"}&apos;s hours (Crews above)</td> : <>
                    <td><input type="time" step={900} value={`${String(Math.floor((m.startMin ?? 420) / 60)).padStart(2, "0")}:${String((m.startMin ?? 420) % 60).padStart(2, "0")}`} onChange={(e) => set((x) => { const [h, mm] = e.target.value.split(":").map(Number); if (!isNaN(h)) x.startMin = h * 60 + (mm || 0); })} /></td>
                    <td className="r"><input type="number" min={0} max={24} step={0.5} value={m.hoursPerDay} onChange={(e) => set((x) => { x.hoursPerDay = n(e.target.value); })} /></td>
                    <td><div className="ps-days">{DAYS.map((dl, di) => <button key={di} type="button" className={m.days.includes(di) ? "on" : ""} onClick={() => set((x) => { x.days = x.days.includes(di) ? x.days.filter((y) => y !== di) : [...x.days, di].sort(); })}>{dl[0]}</button>)}</div></td></>}
                    <td className="r"><input type="number" min={0.2} max={3} step={0.05} value={m.speed} onChange={(e) => set((x) => { x.speed = n(e.target.value) || 1; })} title="1 = standard; 1.2 = 20% faster" /></td>
                    <td><input type="text" value={m.pvMatch} onChange={(e) => set((x) => { x.pvMatch = e.target.value; })} placeholder="e.g. Press 1" /></td>
                    <td><input type="checkbox" checked={m.active} onChange={(e) => set((x) => { x.active = e.target.checked; })} aria-label="In use" /></td>
                  </tr>
                );
              })}</tbody></table>
            <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Colors: the most screens a job can have to go on that press (a job with 11 screens only fits a 12-color press). &quot;Printavo status has&quot;: Printavo jobs whose status contains this text show on that machine until go-live.</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Screen Printing Times</h2></div>
          <div className="panel-b grid g4">
            {num("Setup per screen (min)", s.screen.setupPerScreen, (x) => upd((d) => { d.screen.setupPerScreen = x; }), 0.5, "industry rule of thumb 5–8")}
            {num("Teardown per screen (min)", s.screen.teardownPerScreen, (x) => upd((d) => { d.screen.teardownPerScreen = x; }), 0.5, "rule of thumb 3")}
            {num("Pieces / hour, simple job", s.screen.baseRate, (x) => upd((d) => { d.screen.baseRate = x; }), 10, "auto press planning figure ~400")}
            {num("Slower per color over 4 (%)", Math.round(s.screen.perExtraColor * 100), (x) => upd((d) => { d.screen.perExtraColor = x / 100; }), 1)}
            {num("Dark shirts: speed (%)", Math.round(s.screen.darkFactor * 100), (x) => upd((d) => { d.screen.darkFactor = x / 100; }), 5, "flash + underbase ~75%")}
            {num("Hoodies / jackets: speed (%)", Math.round(s.screen.heavyFactor * 100), (x) => upd((d) => { d.screen.heavyFactor = x / 100; }), 5, "loading ~50–60%")}
            {num("Totes / bags: speed (%)", Math.round(s.screen.bagFactor * 100), (x) => upd((d) => { d.screen.bagFactor = x / 100; }), 5)}
            {num("Pockets / sleeves: speed (%)", Math.round(s.screen.smallLocFactor * 100), (x) => upd((d) => { d.screen.smallLocFactor = x / 100; }), 5)}
            {num("Shortest a location takes (min)", s.screen.minMinutes, (x) => upd((d) => { d.screen.minMinutes = x; }))}
            <div className="field"><label className="check"><input type="checkbox" checked={s.screen.underbaseOnDark} onChange={(e) => upd((d) => { d.screen.underbaseOnDark = e.target.checked; })} /> Add a white underbase screen on dark shirts</label></div>
          </div>
          <div className="panel-b preview">Check: <b>144 black tees, 3-color front + 1-color back</b> on {exMach.name} → {ex[0] ? <b>{fmtMin(estimate(s, ex[0], exMach).minutes)}</b> : "—"} ({ex[0] ? estimate(s, ex[0], exMach).parts.map((p) => `${p.label.split(":")[0]} ${fmtMin(p.minutes)}`).join(", ") : ""}).</div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Embroidery Times</h2></div>
          <div className="panel-b grid g4">
            {num("Stitches / min, flats", s.embroidery.spmFlat, (x) => upd((d) => { d.embroidery.spmFlat = x; }), 10, "rated 1,000+, shops run ~600–800")}
            {num("Stitches / min, caps", s.embroidery.spmCap, (x) => upd((d) => { d.embroidery.spmCap = x; }), 10)}
            {num("Hoop swap per run (sec)", s.embroidery.hoopSecs, (x) => upd((d) => { d.embroidery.hoopSecs = x; }), 5, "0 if someone pre-hoops")}
            {num("Trims / color changes per design", s.embroidery.trimsPerDesign, (x) => upd((d) => { d.embroidery.trimsPerDesign = x; }))}
            {num("Seconds per trim / change", s.embroidery.trimSecs, (x) => upd((d) => { d.embroidery.trimSecs = x; }))}
            {num("Thread breaks (min per 10k stitches)", s.embroidery.breakMinPer10k, (x) => upd((d) => { d.embroidery.breakMinPer10k = x; }), 0.5)}
            {num("Job setup (min)", s.embroidery.setupMin, (x) => upd((d) => { d.embroidery.setupMin = x; }), 1, "~15")}
            {num("Each extra location (min)", s.embroidery.extraLocationSetupMin, (x) => upd((d) => { d.embroidery.extraLocationSetupMin = x; }))}
          </div>
          <div className="panel-b">
            <div className="lbl" style={{ marginBottom: 6 }}>Stitches when the order doesn&apos;t say</div>
            <div className="ps-st">{Object.entries(s.embroidery.stitches).map(([k, v]) => <label key={k}>{k === "default" ? "Anything else" : k}<input type="number" step={500} value={v} onChange={(e) => upd((d) => { d.embroidery.stitches[k] = n(e.target.value); })} /></label>)}</div>
          </div>
          {e6 && exE[0] && <div className="panel-b preview">Check: <b>48 navy polos, left chest</b> on {e6.name} → <b>{fmtMin(estimate(s, exE[0], e6).minutes)}</b> ({estimate(s, exE[0], e6).parts[0]?.label}).</div>}
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Heat Press &amp; Scheduling</h2></div>
          <div className="panel-b grid g4">
            {num("Heat press: seconds per piece", s.heat.secsPerPiece, (x) => upd((d) => { d.heat.secsPerPiece = x; }), 1, "press + handling, ~45–60")}
            {num("Heat press: setup (min)", s.heat.setupMin, (x) => upd((d) => { d.heat.setupMin = x; }))}
            {num("Finish this many business days before in-hands", s.bufferDays, (x) => upd((d) => { d.bufferDays = x; }))}
            {num("Fill each machine's day to (%)", Math.round(s.fillTarget * 100), (x) => upd((d) => { d.fillTarget = Math.min(1, x / 100); }), 5, "85% leaves room for rushes")}
          </div>
        </section>

        <Learning s={s} onApply={(t, f) => upd((d) => { d.factor[t] = f; })} />
        <div className="row"><button type="button" className="btn" onClick={() => { setS(structuredClone(DEFAULT_PRODUCTION)); setState("Not saved"); }}>Reset To Industry Averages</button></div>
      </div>
    </>
  );
}

/** Compares the estimate with logged job time (last 60 days) per kind of work, and offers the measured speed. */
function Learning({ s, onApply }: { s: ProductionSettings; onApply: (t: MachineType, f: number) => void }) {
  const [rows, setRows] = useState<{ type: MachineType; est: number; actual: number; jobs: number }[] | null>(null);
  useEffect(() => {
    (async () => {
      const sb = createClient();
      const since = new Date(Date.now() - 60 * 86400000).toISOString();
      const [{ data: jt }, { data: sl }] = await Promise.all([
        sb.from("job_time").select("*").eq("voided", false).not("ended_at", "is", null).gte("started_at", since).limit(5000),
        sb.from("production_slots").select("order_id, archived_order_id, machine, kind").gte("day", since.slice(0, 10)),
      ]);
      const js = (jt || []) as JobTime[];
      const oIds = [...new Set(js.map((j) => j.order_id).filter(Boolean))] as string[], aIds = [...new Set(js.map((j) => j.archived_order_id).filter(Boolean))] as string[];
      const [{ data: os }, { data: as }] = await Promise.all([
        oIds.length ? sb.from("orders").select("id, groups, lines, number, nickname").in("id", oIds) : Promise.resolve({ data: [] }),
        aIds.length ? sb.from("archived_orders").select("id, qty, status_name, nickname, pvgroups:data->groups").in("id", aIds) : Promise.resolve({ data: [] }),
      ]);
      const acc: Record<string, { est: number; actual: number; jobs: number }> = {};
      const add = (key: string, needs: ReturnType<typeof needsForOrder>) => {
        const actual = js.filter((j) => jobKey(j) === key).reduce((a, j) => a + jobMinutes(j), 0);
        if (!actual || !needs.length) return;
        const need = needs[0];
        const slot = ((sl || []) as { order_id: string | null; archived_order_id: string | null; machine: string }[]).find((x) => (x.order_id ? "o:" + x.order_id : "a:" + x.archived_order_id) === key);
        const mach = s.machines.find((m) => m.id === slot?.machine) || s.machines.find((m) => m.type === need.type && (need.type !== "screen" || m.colors >= need.needColors));
        if (!mach) return;
        const unfactored = estimate({ ...s, factor: { screen: 1, embroidery: 1, heat: 1 } }, need, mach).minutes;
        const a = (acc[need.type] ||= { est: 0, actual: 0, jobs: 0 }); a.est += unfactored; a.actual += actual; a.jobs++;
      };
      for (const o of (os || []) as { id: string }[]) add("o:" + o.id, needsForOrder(s, o as never));
      for (const o of (as || []) as { id: string; qty: number; status_name: string; nickname: string; pvgroups: unknown }[]) add("a:" + o.id, needsForPrintavo(s, { qty: o.qty, status_name: o.status_name, nickname: o.nickname, data: { groups: o.pvgroups as never } }));
      setRows(Object.entries(acc).map(([type, v]) => ({ type: type as MachineType, ...v })));
    })();
  }, [s]);
  const label = useMemo(() => Object.fromEntries(TYPES), []);
  return (
    <section className="panel">
      <div className="panel-h"><h2>Your Shop&apos;s Real Speed</h2><span className="faint">from logged job time, last 60 days</span></div>
      <div className="panel-b">
        {rows === null ? <div className="faint">Checking the logs…</div> : !rows.length ? <div className="faint">No finished job time yet. As people log jobs in the employee app, this compares what the calendar expected with what really happened (a week or two of jobs is enough to start), and you can adopt your shop&apos;s real speed here.</div> : (
          <table className="rv-tbl"><thead><tr><th>Work</th><th className="r">Jobs</th><th className="r">Standard says</th><th className="r">Actually took</th><th className="r">Factor now</th><th /></tr></thead>
            <tbody>{rows.map((r) => { const f = Math.round((r.actual / Math.max(1, r.est)) * 100) / 100; return (
              <tr key={r.type}><td><b>{label[r.type]}</b></td><td className="r">{r.jobs}</td><td className="r">{fmtMin(r.est)}</td><td className="r">{fmtMin(r.actual)}</td><td className="r">{s.factor[r.type]}</td>
                <td className="r">{r.jobs >= 3 ? <button type="button" className="btn sm" onClick={() => onApply(r.type, f)}>Use {f}× ({f < 1 ? `${Math.round((1 - f) * 100)}% faster` : `${Math.round((f - 1) * 100)}% slower`})</button> : <span className="faint">needs 3+ jobs</span>}</td></tr>
            ); })}</tbody></table>
        )}
      </div>
    </section>
  );
}
