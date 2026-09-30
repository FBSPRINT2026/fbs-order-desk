"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName, type Employee } from "@/lib/timeclock";
import { mergeProduction, estimate, CREW_ROLES, SKILLS, DEFAULT_SKILL, fmtMin, type Crew, type CrewMembers, type CrewSkill, type Need, type ProductionSettings } from "@/lib/production";
import { EmployeeEditor } from "@/components/time/TimeEmployees";
import { useSticky } from "@/lib/useSticky";
import type { TeamData } from "./types";

/**
 * Production → Employees → People & Teams. Everyone who works here (add, edit, remove), which team they're on
 * (Screen Printing, Embroidery, Fulfillment…), and each press crew: the press operator who runs it, an assistant
 * and a catcher. The crew's pay rates add up to what an hour on that press costs, which is how the production
 * calendar prices each job's labor. Pay is only shown to owners and admins.
 */
const COLORS = ["#0E9BD8", "#F26660", "#FCB122", "#0F8C78", "#7C5CD6", "#D0487A", "#3F7F2E", "#B8621B"];
const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;

export default function TeamPeople({ d }: { d: TeamData }) {
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [showOld, setShowOld] = useSticky("team.showOld", false);
  const [prod, setProd] = useState<ProductionSettings | null>(null);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const load = async () => {
    const sb = createClient();
    const [{ data: st }, pay] = await Promise.all([
      sb.from("settings").select("data").eq("id", 1).maybeSingle(),
      d.boss ? sb.from("employee_pay").select("employee_id, rate") : Promise.resolve({ data: [] as { employee_id: string; rate: number | null }[] }),
    ]);
    setProd(mergeProduction((st?.data as { production?: unknown } | null)?.production));
    setRates(Object.fromEntries(((pay.data || []) as { employee_id: string; rate: number | null }[]).filter((x) => x.rate != null).map((x) => [x.employee_id, +x.rate!])));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [d.employees]);

  const active = d.employees.filter((e) => e.active);
  const list = d.employees.filter((e) => showOld || e.active);
  const depts = d.settings.departments;
  const byId = useMemo(() => new Map(d.employees.map((e) => [e.id, e])), [d.employees]);
  const timeData = { me: d.me, role: d.boss ? "owner" : "staff", employees: d.employees, settings: d.settings, reload: d.reload };

  async function setDept(e: Employee, dept: string) {
    setBusy(e.id);
    await createClient().from("employees").update({ department: dept, updated_at: new Date().toISOString() }).eq("id", e.id);
    setBusy(""); await d.reload();
  }
  // crews live in Settings → Production; the operator's first name is the crew's name on the calendar
  async function setMember(c: Crew, role: keyof CrewMembers, id: string) {
    if (!prod) return;
    setBusy(c.id + role);
    const sb = createClient();
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const cur = mergeProduction((data?.data as { production?: unknown } | null)?.production);
    const crews = cur.crews.map((x) => {
      if (x.id !== c.id) return x;
      const members = { ...(x.members || {}), [role]: id || null };
      const op = role === "operator" && id ? byId.get(id) : null;
      return { ...x, members, leader: op ? op.first_name.trim() : x.leader };
    });
    const production = { ...cur, crews, machines: cur.machines.map(({ week: _w, off: _o, brk: _b, skill: _k, ...m }) => m) };
    const r = await sb.from("settings").upsert({ id: 1, data: { ...(data?.data || {}), production }, updated_at: new Date().toISOString() });
    setBusy("");
    if (r.error) { setMsg(r.error.message); return; }
    setMsg(""); await load();
  }

  // crew speed sliders: saved a moment after the last change
  const [skills, setSkills] = useState<Record<string, CrewSkill>>({});
  const skillOf = (c: Crew) => skills[c.id] || { ...DEFAULT_SKILL, ...(c.skill || {}) };
  const timers = useMemo(() => new Map<string, ReturnType<typeof setTimeout>>(), []);
  function setSkill(c: Crew, k: keyof CrewSkill, v: number) {
    const next = { ...skillOf(c), [k]: v };
    setSkills((x) => ({ ...x, [c.id]: next }));
    clearTimeout(timers.get(c.id));
    timers.set(c.id, setTimeout(async () => {
      const sb = createClient();
      const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
      const cur = mergeProduction((data?.data as { production?: unknown } | null)?.production);
      const crews = cur.crews.map((x) => (x.id === c.id ? { ...x, skill: next } : x));
      const production = { ...cur, crews, machines: cur.machines.map(({ week: _w, off: _o, brk: _b, skill: _k, ...m }) => m) };
      const r = await sb.from("settings").upsert({ id: 1, data: { ...(data?.data || {}), production }, updated_at: new Date().toISOString() });
      setMsg(r.error ? r.error.message : "");
    }, 700));
  }
  // what the sliders do to a typical job: 144 shirts, 4-color front + 1-color back
  const sample: Need = { type: "screen", needColors: 4, qty: 144, label: "", steps: [
    { method: "screen", location: "Full Front", colors: 4, screens: 4, qty: 144, dark: false, garment: "tee", stitches: 0, note: "" },
    { method: "screen", location: "Full Back", colors: 1, screens: 1, qty: 144, dark: false, garment: "tee", stitches: 0, note: "" }] };
  const typical = (c: Crew) => { if (!prod) return null; const m = prod.machines.find((x) => x.crew === c.id); if (!m) return null; const base = estimate(prod, sample, { ...m, skill: undefined }).minutes, mine = estimate(prod, sample, { ...m, skill: skillOf(c) }).minutes; return { base, mine }; };

  const crewRate = (c: Crew) => CREW_ROLES.reduce((t, [k]) => { const id = c.members?.[k]; return t + (id && rates[id] ? rates[id] : 0); }, 0);
  const onCrew = (id: string) => prod?.crews.filter((c) => CREW_ROLES.some(([k]) => c.members?.[k] === id)).map((c) => c.leader || "a crew") || [];
  const presses = (c: Crew) => prod?.machines.filter((m) => m.crew === c.id).map((m) => m.name.split(" · ")[0]) || [];
  const pick = (c: Crew, role: keyof CrewMembers) => {
    const cur = c.members?.[role] || "";
    const sorted = [...active].sort((a, b) => (a.department === "Screen Printing" ? 0 : 1) - (b.department === "Screen Printing" ? 0 : 1) || fullName(a).localeCompare(fullName(b)));
    return (
      <select value={cur} disabled={busy === c.id + role} onChange={(e) => setMember(c, role, e.target.value)} aria-label={role}>
        <option value="">— nobody —</option>
        {sorted.map((e) => <option key={e.id} value={e.id}>{fullName(e)}{d.boss && rates[e.id] ? ` · ${money(rates[e.id])}/hr` : ""}{e.department && e.department !== "Screen Printing" ? ` · ${e.department}` : ""}</option>)}
      </select>
    );
  };

  return (
    <div className="tmx">
      <div className="tmx-bar">
        <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show former employees</label>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => setEdit({ first_name: "", last_name: "", email: "", phone: "", staff_email: null, department: "", title: "", pay_type: "hourly", color: "", active: true, hire_date: null, notes: "" })}>+ Add Employee</button>
      </div>
      {msg && <div className="pv-err">{msg}</div>}

      <section className="db-card db-blue">
        <div className="db-card-h"><h2>Press Crews</h2><a className="linkbtn" href="/shop/settings/production">Crew hours &amp; presses</a></div>
        <p className="faint" style={{ fontSize: 12.5, margin: "0 0 10px" }}>Who runs each press. The press operator&apos;s name shows on the production calendar{d.boss ? ", and the crew's rates add up to the labor cost of every job on that press" : ""}.</p>
        {!prod ? <div className="db-empty">Loading…</div> : (
          <div className="tp-crews">{prod.crews.map((c) => { const r = crewRate(c), ps = presses(c); return (
            <div key={c.id} className="tp-crew">
              <div className="tp-crew-h"><b>{ps.length ? ps.join(", ") : "No press yet"}</b><span className="faint">{c.leader ? `${c.leader}'s crew` : "Crew"}</span>{d.boss && <span className={"tmx-tag" + (r ? " ok" : "")}>{r ? `${money(r)}/hr` : "no rates"}</span>}</div>
              {CREW_ROLES.map(([k, l]) => <label key={k} className="tp-role"><span>{l}</span>{pick(c, k)}</label>)}
              <details className="tp-skill">
                <summary><b>Crew speed</b>{(() => { const t = typical(c); if (!t) return null; const pc = Math.round((t.base / Math.max(1, t.mine) - 1) * 100); return <span className={pc > 0 ? "ok" : pc < 0 ? "bad" : ""}>{pc === 0 ? "standard" : `${pc > 0 ? pc + "% faster" : -pc + "% slower"} on a typical job`}</span>; })()}</summary>
                {SKILLS.map(([k, l, hint]) => { const v = skillOf(c)[k]; return (
                  <label key={k} className="tp-sl" title={hint}>
                    <span className="tp-sl-l">{l}<small>{hint}</small></span>
                    <input type="range" min={50} max={150} step={5} value={v} onChange={(e) => setSkill(c, k, +e.target.value)} aria-label={`${l} speed`} />
                    <span className={"tp-sl-v" + (v > 100 ? " ok" : v < 100 ? " bad" : "")}>{v === 100 ? "Standard" : v > 100 ? `+${v - 100}%` : `−${100 - v}%`}</span>
                  </label>
                ); })}
                {(() => { const t = typical(c); return t ? <div className="faint" style={{ fontSize: 12 }}>A typical job (144 shirts, 4-color front + 1-color back): {fmtMin(t.base)} standard → <b>{fmtMin(t.mine)}</b> with this crew. The calendar and Re-plan use these speeds for every job on {presses(c).join(", ") || "this crew's press"}.</div> : null; })()}
              </details>
            </div>
          ); })}</div>
        )}
      </section>

      <section className="db-card db-teal">
        <div className="db-card-h"><h2>Teams</h2><span className="faint" style={{ fontSize: 12.5 }}>Change the team list on <a href="/shop/time?tab=settings">Time Clock → Settings</a></span></div>
        <div className="tp-depts">
          {[...depts, ""].map((dep) => { const ppl = list.filter((e) => (dep ? e.department === dep : !depts.includes(e.department))); if (!dep && !ppl.length) return null; return (
            <div key={dep || "none"} className="tp-dept">
              <div className="tp-dept-h"><b>{dep || "No team yet"}</b><span className="aa-n">{ppl.length}</span></div>
              {!ppl.length ? <div className="faint" style={{ fontSize: 12.5 }}>Nobody yet.</div> : (
                <ul>{ppl.map((e, i) => { const crews = onCrew(e.id); return (
                  <li key={e.id} className={e.active ? "" : "old"}>
                    <button type="button" className="tp-p" onClick={() => setEdit(e)} title="Edit">
                      <span className="tmx-av sm" style={{ background: e.color || COLORS[i % COLORS.length] }}>{(e.first_name[0] || "") + (e.last_name[0] || "")}</span>
                      <span className="tp-p-n"><b>{fullName(e)}{!e.active ? " · former" : ""}</b><small className="faint">{[crews.length ? `${crews.join(", ")}'s crew` : "", d.boss && rates[e.id] ? `${money(rates[e.id])}/hr` : ""].filter(Boolean).join(" · ") || "#" + (e.code ?? "")}</small></span>
                    </button>
                    <select value={depts.includes(e.department) ? e.department : ""} disabled={busy === e.id} onChange={(ev) => setDept(e, ev.target.value)} aria-label="Team"><option value="">No team</option>{depts.map((x) => <option key={x}>{x}</option>)}</select>
                  </li>
                ); })}</ul>
              )}
            </div>
          ); })}
        </div>
      </section>
      {edit && <EmployeeEditor d={timeData} e={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await d.reload(); }} />}
    </div>
  );
}
