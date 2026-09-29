"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName, type Employee } from "@/lib/timeclock";
import { isBoss, type TimeData } from "./types";
import { useSticky } from "@/lib/useSticky";

const COLORS = ["#0E9BD8", "#F26660", "#FCB122", "#0F8C78", "#7C5CD6", "#D0487A", "#3F7F2E", "#B8621B"];
const blank = (): Partial<Employee> => ({ first_name: "", last_name: "", email: "", phone: "", staff_email: null, department: "", title: "", pay_type: "hourly", color: "", active: true, hire_date: null, notes: "" });

/** Everyone on the clock: name, department, their shop login (for phone punching), PIN, and pay (owners/admins). */
export default function TimeEmployees({ d }: { d: TimeData }) {
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
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
              <span className="db-main"><b>{fullName(e)}{!e.active && <span className="faint"> · former</span>}</b><span className="faint">{[e.title, e.department, e.staff_email ? "has a shop login" : ""].filter(Boolean).join(" · ") || "—"}</span></span>
              <span className="db-side">{e.has_pin ? <span className="tmx-tag ok">PIN set</span> : <span className="tmx-tag warn">No PIN</span>}<span className="faint">{e.pay_type === "salary" ? "Salary" : "Hourly"}</span></span>
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
  const boss = isBoss(d);
  useEffect(() => {
    const sb = createClient();
    sb.from("staff").select("email, name").order("name").then(({ data }) => setStaff((data || []) as { email: string; name: string }[]));
    if (boss && e.id) sb.from("employee_pay").select("rate, salary").eq("employee_id", e.id).maybeSingle().then(({ data }) => { setRate(data?.rate != null ? String(data.rate) : ""); setSalary(data?.salary != null ? String(data.salary) : ""); });
  }, [boss, e.id]);
  const set = <K extends keyof Employee>(k: K, x: Employee[K]) => setV({ ...v, [k]: x });
  const f = (k: "first_name" | "last_name" | "email" | "phone" | "title", label: string, type = "text") => <label>{label}<input type={type} value={(v[k] as string) || ""} onChange={(ev) => set(k, ev.target.value)} /></label>;

  async function save() {
    if (!(v.first_name || "").trim()) return setErr("Enter a first name.");
    if (pin && !/^\d{4,6}$/.test(pin)) return setErr("PINs are 4 to 6 digits.");
    setBusy(true); setErr("");
    const sb = createClient();
    const row = { first_name: v.first_name?.trim(), last_name: (v.last_name || "").trim(), email: v.email || "", phone: v.phone || "", staff_email: v.staff_email || null, department: v.department || "", title: v.title || "", pay_type: v.pay_type || "hourly", color: v.color || "", active: v.active !== false, hire_date: v.hire_date || null, end_date: v.active === false ? v.end_date || new Date().toISOString().slice(0, 10) : null, notes: v.notes || "", updated_at: new Date().toISOString() };
    const r = v.id ? await sb.from("employees").update(row).eq("id", v.id).select("id").single() : await sb.from("employees").insert(row).select("id").single();
    if (r.error) { setBusy(false); return setErr(r.error.message); }
    const id = r.data.id as string;
    if (pin && boss) {
      const pr = await fetch("/api/time/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_id: id, pin }) });
      if (!pr.ok) { const j = await pr.json().catch(() => ({})); setBusy(false); return setErr(j.error || "Couldn't save the PIN."); }
    }
    if (boss && (rate !== "" || salary !== "")) await sb.from("employee_pay").upsert({ employee_id: id, rate: rate === "" ? null : +rate, salary: salary === "" ? null : +salary, updated_at: new Date().toISOString() });
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
  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-sheet tmx-ed" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Employee">
        <div className="pp-sheet-h"><b>{v.id ? fullName(v as Employee) : "New Employee"}</b><button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tmx-ed-b">
          <div className="tmx-2">{f("first_name", "First name")}{f("last_name", "Last name")}</div>
          <div className="tmx-2">{f("email", "Email", "email")}{f("phone", "Phone", "tel")}</div>
          <div className="tmx-2">
            <label>Department<select value={v.department || ""} onChange={(ev) => set("department", ev.target.value)}><option value="">—</option>{d.settings.departments.map((x) => <option key={x}>{x}</option>)}</select></label>
            {f("title", "Job title")}
          </div>
          <div className="tmx-2">
            <label>Pay<select value={v.pay_type || "hourly"} onChange={(ev) => set("pay_type", ev.target.value as Employee["pay_type"])}><option value="hourly">Hourly</option><option value="salary">Salary</option></select></label>
            <label>Hire date<input type="date" value={v.hire_date || ""} onChange={(ev) => set("hire_date", ev.target.value || null)} /></label>
          </div>
          {boss && <div className="tmx-2">
            <label>Hourly rate ($)<input type="number" min={0} step="0.01" value={rate} onChange={(ev) => setRate(ev.target.value)} placeholder="18.00" /></label>
            <label>Salary per year ($)<input type="number" min={0} step="1" value={salary} onChange={(ev) => setSalary(ev.target.value)} placeholder="—" /></label>
          </div>}
          <label>Shop login (lets them punch from their phone)<select value={v.staff_email || ""} onChange={(ev) => set("staff_email", ev.target.value || null)}><option value="">None</option>{staff.map((s) => <option key={s.email} value={s.email}>{s.name || s.email} · {s.email}</option>)}</select></label>
          {boss ? (
            <div className="tmx-pin">
              <label>{v.has_pin ? "New PIN (leave blank to keep the current one)" : "Clock PIN (4–6 digits)"}<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(ev) => setPin(ev.target.value.replace(/\D/g, ""))} placeholder="••••" /></label>
              {v.has_pin && <button type="button" className="linkbtn" onClick={clearPin}>Remove PIN</button>}
            </div>
          ) : <div className="faint">{v.has_pin ? "PIN is set." : "No PIN yet: an owner or admin sets PINs."}</div>}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><span className="lbl">Color</span>{COLORS.map((c) => <button key={c} type="button" className={"tmx-sw" + (v.color === c ? " on" : "")} style={{ background: c }} onClick={() => set("color", c)} aria-label={c} />)}</div>
          <label>Notes<input type="text" value={v.notes || ""} onChange={(ev) => set("notes", ev.target.value)} /></label>
          {v.id && <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={v.active === false} onChange={(ev) => set("active", !ev.target.checked)} /> No longer works here (keeps their hours on record)</label>}
          {note && <div className="faint">{note}</div>}
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            {v.id && v.active !== false && <button type="button" className="btn danger" style={{ marginRight: "auto" }} disabled={busy} onClick={remove}>Remove Employee</button>}
            {v.id && v.active === false && <button type="button" className="btn" style={{ marginRight: "auto" }} disabled={busy} onClick={() => set("active", true)}>Bring Back</button>}
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
