"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName, type Employee } from "@/lib/timeclock";
import { isBoss, seesPay, type TimeData } from "./types";
import { useSticky } from "@/lib/useSticky";
import { fmtPhone } from "@/lib/phone";
import { sendToFaceClock } from "@/app/shop/time-actions";

const COLORS = ["#0E9BD8", "#F26660", "#FCB122", "#0F8C78", "#7C5CD6", "#D0487A", "#3F7F2E", "#B8621B"];
const blank = (): Partial<Employee> => ({ first_name: "", last_name: "", email: "", phone: "", staff_email: null, department: "", title: "", pay_type: "hourly", paid_by: "payroll", color: "", active: true, hire_date: new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }), notes: "" });

/** Everyone on the clock: name, department, their shop login (for phone punching), PIN, and pay (owners/admins). */
export default function TimeEmployees({ d }: { d: TimeData }) {
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const [rates, setRates] = useState<Record<string, { rate: number | null; salary: number | null }>>({});
  const pay = seesPay(d);
  useEffect(() => { if (pay) createClient().from("employee_pay").select("employee_id, rate, salary").then(({ data }) => setRates(Object.fromEntries(((data || []) as { employee_id: string; rate: number | null; salary: number | null }[]).map((x) => [x.employee_id, x])))); }, [pay, d.employees]);
  const [showOld, setShowOld] = useSticky("time.showOld", false);
  const list = d.employees.filter((e) => showOld || e.active);
  return (
    <div className="tmx">
      <div className="tmx-bar">
        <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show former employees</label>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => setEdit(blank())}>+ Add Employee</button>
      </div>
      <section className="db-card db-blue">
        {!list.length ? <div className="db-empty">No employees yet. Add everyone who clocks in, then give each a PIN for the wall clock.</div> : (
          <ul className="db-list">{list.map((e, i) => (
            <li key={e.id} className="db-row tmx-row" style={{ cursor: "pointer" }} onClick={() => setEdit(e)}>
              <span className="tmx-av" style={{ background: e.color || COLORS[i % COLORS.length] }}>{(e.first_name[0] || "") + (e.last_name[0] || "")}</span>
              <span className="db-main"><b>{e.last_name ? `${e.last_name}, ${e.first_name}` : e.first_name}{!e.active && <span className="faint"> · former</span>}</b><span className="faint">{[e.title, e.department, e.staff_email ? "has a shop login" : ""].filter(Boolean).join(" · ") || "—"}</span></span>
              <span className="db-side">{e.code ? <span className="faint">ID {e.code}</span> : null}<span className={"tmx-tag " + (e.paid_by === "contract" ? "warn" : "ok")}>{e.paid_by === "contract" ? "Contract" : "Payroll"}</span><span className="faint">{e.pay_type === "salary" ? (pay && rates[e.id]?.salary ? `$${Math.round(+rates[e.id].salary!).toLocaleString()}/yr` : "Salary") : pay && rates[e.id]?.rate ? `$${(+rates[e.id].rate!).toFixed(2)}/hr` : "Hourly"}</span></span>
            </li>
          ))}</ul>
        )}
      </section>
      {edit && <EmployeeEditor d={d} e={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await d.reload(); }} />}
    </div>
  );
}

export function EmployeeEditor({ d, e, onClose, onSaved }: { d: TimeData; e: Partial<Employee>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Employee>>(e);
  const [staff, setStaff] = useState<{ email: string; name: string }[]>([]);
  const [pin, setPin] = useState(""), [rate, setRate] = useState(""), [salary, setSalary] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [note, setNote] = useState("");
  // a new employee: just the essentials first (Oct 20, Nick: "make it really easy to add a new employee… pop one out")
  const [more, setMore] = useState(!!e.id);
  const [added, setAdded] = useState<{ name: string; code: number | null; clock: string } | null>(null);
  const boss = isBoss(d), pay = seesPay(d);
  useEffect(() => {
    const sb = createClient();
    sb.from("staff").select("email, name").order("name").then(({ data }) => setStaff((data || []) as { email: string; name: string }[]));
    if (pay && e.id) sb.from("employee_pay").select("rate, salary").eq("employee_id", e.id).maybeSingle().then(({ data }) => { setRate(data?.rate != null ? String(data.rate) : ""); setSalary(data?.salary != null ? String(data.salary) : ""); });
  }, [pay, e.id]);
  const set = <K extends keyof Employee>(k: K, x: Employee[K]) => setV({ ...v, [k]: x });
  const f = (k: "first_name" | "last_name" | "email" | "phone" | "title", label: string, type = "text") => <label>{label}<input type={type} value={(v[k] as string) || ""} onChange={(ev) => set(k, ev.target.value)} onBlur={type === "tel" ? (ev) => { const p = fmtPhone(ev.target.value); if (p !== ev.target.value) set(k, p); } : undefined} /></label>;

  async function save() {
    if (!(v.first_name || "").trim()) return setErr("Enter a first name.");
    if (pin && !/^\d{4,6}$/.test(pin)) return setErr("PINs are 4 to 6 digits.");
    setBusy(true); setErr("");
    const sb = createClient();
    if (!v.id && boss && v.pay_type !== "salary" && rate === "") return setErr("Enter their hourly rate (or pick Salary).");
    const row = { first_name: v.first_name?.trim(), last_name: (v.last_name || "").trim(), email: v.email || "", phone: v.phone || "", staff_email: v.staff_email || null, department: v.department || "", title: v.title || "", pay_type: v.pay_type || "hourly", paid_by: v.paid_by === "contract" ? "contract" : "payroll", color: v.color || "", active: v.active !== false, hire_date: v.hire_date || null, end_date: v.active === false ? v.end_date || new Date().toISOString().slice(0, 10) : null, notes: v.notes || "", updated_at: new Date().toISOString() };
    const r = v.id ? await sb.from("employees").update(row).eq("id", v.id).select("id, code").single() : await sb.from("employees").insert(row).select("id, code").single();
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    const id = r.data.id as string;
    if (pin && boss) {
      const pr = await fetch("/api/time/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: id, pin }) });
      if (!pr.ok) { const j = await pr.json().catch(() => ({})); setBusy(false); return setErr(j.error || "Couldn't save the PIN."); }
    }
    if (boss && (rate !== "" || salary !== "")) {
      const pr = await sb.from("employee_pay").upsert({ employee_id: id, rate: rate === "" ? null : +rate, salary: salary === "" ? null : +salary, updated_at: new Date().toISOString() });
      if (pr.error) { setBusy(false); return setErr(`Saved, but the pay didn't save: ${pr.error.message}`); }
    }
    // someone new (or back): onto the face clock, so they can be scanned in today
    if (!v.id || (v.active !== false && e.active === false)) {
      const fc = await sendToFaceClock().catch(() => ({ ok: false, message: "" }));
      setBusy(false);
      return setAdded({ name: fullName({ first_name: row.first_name || "", last_name: row.last_name }), code: (r.data.code as number | null) ?? null, clock: fc.message });
    }
    setBusy(false); onSaved();
  }
  // removing someone keeps their punches and job time on record: they move to former employees and drop off the clock
  async function remove() {
    if (!v.id) return;
    setBusy(true);
    const r = await createClient().from("employees").update({ active: false, end_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq("id", v.id);
    setBusy(false);
    if (r.error) return setErr(r.error.message);
    onSaved();
  }
  async function clearPin() {
    if (!v.id) return;
    await fetch("/api/time/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: v.id, pin: "" }) });
    setV({ ...v, has_pin: false }); setNote("PIN removed.");
  }
  if (added) return (
    <div className="pp-modal" onClick={onSaved}>
      <div className="pp-sheet tmx-ed tk-added" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Employee added">
        <div className="tk-added-b">
          <span className="tk-added-ok" aria-hidden>✓</span>
          <h3>{added.name} is set up</h3>
          {added.code != null && <p className="tk-added-id">Clock ID <b>{added.code}</b></p>}
          <p>{added.clock || "Add them on the face clock with this ID."}</p>
          <ol className="tk-added-steps"><li>At the face clock: <b>Menu → User Mgt → All Users</b>, pick ID {added.code ?? "…"}.</li><li>Tap <b>Face</b> and have them look at the screen.</li><li>They scan in. Their time shows on Today right away.</li></ol>
          <button type="button" className="btn primary" onClick={onSaved}>Done</button>
        </div>
      </div>
    </div>
  );
  const payType = v.pay_type || "hourly";
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Employee">
        <div className="pp-sheet-h"><b>{v.id ? fullName(v as Employee) : "New Employee"}{v.code ? <span className="faint"> · Clock ID {v.code}</span> : null}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="tmx-2">{f("first_name", "First name")}{f("last_name", "Last name")}</div>
          <label>Department<select value={v.department || ""} onChange={(ev) => set("department", ev.target.value)}><option value="">—</option>{d.settings.departments.map((x) => <option key={x}>{x}</option>)}</select></label>
          <div className="tk-paybox">
            <div className="tk-seg-row">
              <div className="rv-seg" role="group" aria-label="Pay">{(["hourly", "salary"] as const).map((k) => <button key={k} type="button" className={payType === k ? "on" : ""} onClick={() => set("pay_type", k)}>{k === "hourly" ? "Hourly" : "Salary"}</button>)}</div>
              {boss ? (payType === "salary"
                ? <label className="tk-money">$<input type="number" min={0} step="1" value={salary} onChange={(ev) => setSalary(ev.target.value)} placeholder="50000" aria-label="Salary per year" /><span>a year</span></label>
                : <label className="tk-money">$<input type="number" min={0} step="0.01" value={rate} onChange={(ev) => setRate(ev.target.value)} placeholder="15.00" aria-label="Hourly rate" autoFocus={!v.id} /><span>an hour</span></label>)
                : pay && <span className="faint">{payType === "salary" ? (salary ? `$${(+salary).toLocaleString()}/yr` : "") : rate ? `$${(+rate).toFixed(2)}/hr` : ""}</span>}
            </div>
            <div className="tk-seg-row">
              <span className="lbl">Paid through</span>
              <div className="rv-seg" role="group" aria-label="Paid through">{([["payroll", "QuickBooks Payroll"], ["contract", "Contract Labor"]] as const).map(([k, l]) => <button key={k} type="button" className={(v.paid_by || "payroll") === k ? "on" : ""} onClick={() => set("paid_by", k)}>{l}</button>)}</div>
            </div>
            {boss && payType === "hourly" && rate && +rate > 0 && <div className="faint" style={{ fontSize: 12.5 }}>Overtime: ${(+rate * (d.settings.otRate || 1.5)).toFixed(2)} an hour past {d.settings.otWeekly} hours a week</div>}
          </div>
          {!more ? <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setMore(true)}>+ More details (phone, email, hire date, login, PIN…)</button> : <>
          <div className="tmx-2">{f("email", "Email", "email")}{f("phone", "Phone", "tel")}</div>
          <div className="tmx-2">
            {f("title", "Job title")}
            <label>Hire date<input type="date" value={v.hire_date || ""} onChange={(ev) => set("hire_date", ev.target.value || null)} /></label>
          </div>
          <label>Shop login (lets them punch from their phone)<select value={v.staff_email || ""} onChange={(ev) => set("staff_email", ev.target.value || null)}><option value="">None</option>{staff.map((s) => <option key={s.email} value={s.email}>{s.name || s.email} · {s.email}</option>)}</select></label>
          {boss ? (
            <div className="tmx-pin">
              <label>{v.has_pin ? "New PIN for the tablet clock (leave blank to keep it)" : "PIN for the tablet clock (4–6 digits, optional)"}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(ev) => setPin(ev.target.value.replace(/\D/g, ""))} placeholder="••••" /></label>
              {v.has_pin && <button type="button" className="linkbtn" onClick={clearPin}>Remove PIN</button>}
            </div>
          ) : <div className="faint">{v.has_pin ? "PIN is set." : "No PIN."}</div>}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><span className="lbl">Color</span>{COLORS.map((c) => <button key={c} type="button" className={"tmx-sw" + (v.color === c ? " on" : "")} style={{ background: c }} onClick={() => set("color", c)} aria-label={c} />)}</div>
          <label>Notes<input type="text" value={v.notes || ""} onChange={(ev) => set("notes", ev.target.value)} /></label>
          </>}
          {v.id && <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={v.active === false} onChange={(ev) => set("active", !ev.target.checked)} /> No longer works here (keeps their hours on record)</label>}
          {note && <div className="faint">{note}</div>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            {v.id && v.active !== false && <button type="button" className="btn danger" style={{ marginRight: "auto" }} disabled={busy} onClick={remove}>Remove Employee</button>}
            {v.id && v.active === false && <button type="button" className="btn" style={{ marginRight: "auto" }} disabled={busy} onClick={() => set("active", true)}>Bring Back</button>}
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : v.id ? "Save" : "Add Employee"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
