"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { addDays, dayLabel, fullName, localDay, mergeTime, periodOf, r2 } from "@/lib/timeclock";
import { advanceLeft, guessPayee, loadPayday, planLabel, type PaydayRow } from "@/lib/payday";
import { addVendor, closePayday, issueAdvance, makeChecks, markEntered, payrollQbo, pullActuals, type Payee } from "./actions";

/**
 * Payroll Center (Admin Tools, Oct 30, Nick: "make a payday tool… create checks from the time clock… paycheck
 * advances… deduct it automatically"). One payday, in order:
 *   1. fix the time clock problems (missed punches) so the hours are right;
 *   2. W-2 payroll: each person's regular and overtime hours, a bonus and the advance to take out, in QuickBooks'
 *      list order, to type into QuickBooks Payroll and Save for later (Nick submits it himself);
 *   3. contractor checks: one Print-later check each in QuickBooks, laid out like Nick's (REGULAR PAY, OVERTIME,
 *      the advance as a minus line), made only when he presses the button, never twice.
 * Paycheck advances: given once, then taken out of each check by their plan until they're paid off.
 * The numbers come from lib/payday.ts, the same function the server uses to write the checks.
 */
type Data = Awaited<ReturnType<typeof loadPayday>>;
const $ = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const h2 = (n: number) => n.toFixed(2);
const nm = (r: { e: { first_name: string; last_name: string } }) => `${r.e.last_name}, ${r.e.first_name}`.replace(/^, /, "");
/** paid in QuickBooks under another name (Sept 30 rule: Ana Guzman is "Miguel Rodriguez" there): the name to look for */
const asQb = (r: { e: { first_name: string; last_name: string; qbo_vendor_name?: string | null } }) => {
  const w = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const q = w(r.e.qbo_vendor_name || "");
  // only when it's really another name: their first name and every part of their last name aren't all in it
  return q.length > 0 && !(q.includes(w(r.e.first_name)[0]) && w(r.e.last_name).every((x) => q.includes(x)));
};

export default function PayrollCenter() {
  const today = localDay(new Date());
  const [tab, setTab] = useSticky<"payday" | "advances" | "past">("payroll.tab", "payday");
  const [start, setStart] = useState<string | null>(null);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(""), [msg, setMsg] = useState("");
  const [role, setRole] = useState("");
  const [qb, setQb] = useState<{ payees: Payee[]; accounts: string[] } | null>(null), [qbErr, setQbErr] = useState("");
  const [busy, setBusy] = useState(""), [confirm, setConfirm] = useState<"" | "checks" | "entered" | "close">("");
  const [newAdv, setNewAdv] = useState(false);

  // first: the last finished pay period
  useEffect(() => {
    const sb = createClient();
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      const [{ data: s }, { data: st }] = await Promise.all([sb.from("settings").select("data").eq("id", 1).maybeSingle(), sb.from("staff").select("role, sees_pay").eq("email", (user?.email || "").toLowerCase()).maybeSingle()]);
      const set = mergeTime((s?.data as { time?: unknown } | null)?.time);
      const rl = (st?.role as string) || "";
      setRole(rl);
      // payroll managers only: owners, admins, and whoever runs the time clock with pay
      if (!(rl === "owner" || rl === "admin" || (st as { sees_pay?: boolean } | null)?.sees_pay)) { setErr("The Payroll Center is for payroll managers."); return; }
      setStart(periodOf(set, addDays(periodOf(set, today).start, -1)).start);
    })();
  }, [today]);
  const load = useCallback(async () => {
    if (!start) return;
    try { setD(await loadPayday(createClient(), start)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [start]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => {
    if (role !== "owner") return;
    payrollQbo().then((r) => (r.ok ? setQb(r.data || null) : setQbErr(r.error)));
  }, [role]);

  const rows = d?.rows || [];
  const w2 = rows.filter((r) => r.kind === "payroll"), cons = rows.filter((r) => r.kind === "contract");
  const toFix = rows.filter((r) => r.issues > 0);
  const payeeOf = (r: PaydayRow) => (r.e.qbo_vendor_id ? { id: r.e.qbo_vendor_id, name: r.e.qbo_vendor_name || r.e.qbo_vendor_id, type: (r.e.qbo_payee_type || "Vendor") as Payee["type"], saved: true } : null);
  const guesses = useMemo(() => {
    const m = new Map<string, Payee>();
    if (!qb) return m;
    const vendors = qb.payees.filter((p) => p.type === "Vendor");
    for (const r of cons) if (!r.e.qbo_vendor_id) { const g = guessPayee<Payee>(r.e, vendors); if (g) m.set(r.e.id, g); }
    return m;
  }, [qb, cons]);
  const ready = cons.filter((r) => !r.line?.qbo_purchase_id && r.e.qbo_vendor_id && r.issues === 0 && r.total > 0 && (r.pay.rate != null || r.e.pay_type === "salary"));
  const made = cons.filter((r) => r.line?.qbo_purchase_id);
  const w2Open = w2.filter((r) => !r.line?.done_at);
  const advTotal = r2(rows.reduce((s, r) => s + r.advance, 0));
  const conTotal = r2(cons.reduce((s, r) => s + (r.line?.check_total ?? r.total), 0));
  const openAdv = (d?.advances || []).filter((a) => !a.closed_at);

  async function saveLine(r: PaydayRow, patch: { bonus?: number | null; advance_amount?: number | null }) {
    if (!d) return;
    const { error } = await createClient().from("payday_lines").upsert({ period_start: d.p.start, employee_id: r.e.id, bonus: r.line?.bonus ?? null, advance_amount: r.line?.advance_amount ?? null, ...patch, updated_at: new Date().toISOString() }, { onConflict: "period_start,employee_id" });
    if (error) setErr(error.message); else load();
  }
  async function setPayee(empId: string, p: Payee | null) {
    const { error } = await createClient().from("employees").update({ qbo_vendor_id: p?.id || null, qbo_vendor_name: p?.name || null, qbo_payee_type: p?.type || null }).eq("id", empId);
    if (error) setErr(error.message); else load();
  }
  /** a new contractor with no payee in QuickBooks yet (Oct 30, Nick: "Terena Nino is a new person"): add them as a 1099 vendor */
  async function newVendor(r: PaydayRow) {
    setBusy(`Adding ${fullName(r.e)} to QuickBooks…`); setErr(""); setMsg("");
    const res = await addVendor(r.e.id);
    setBusy("");
    if (!res.ok) { setErr(res.error); return; }
    setMsg(`${res.data?.name} added to QuickBooks as a vendor (1099) and set as ${r.e.first_name}'s payee.`);
    const p = await payrollQbo(); if (p.ok) setQb(p.data || null);
    load();
  }
  async function useGuesses() {
    setBusy("Saving payees…");
    for (const [id, p] of guesses) await createClient().from("employees").update({ qbo_vendor_id: p.id, qbo_vendor_name: p.name, qbo_payee_type: p.type }).eq("id", id);
    setBusy(""); load();
  }
  async function createChecks() {
    if (!d) return;
    setConfirm(""); setBusy(`Making ${ready.length} checks in QuickBooks…`); setErr(""); setMsg("");
    const r = await makeChecks(d.p.start, ready.map((x) => x.e.id));
    setBusy("");
    if (!r.ok) setErr(r.error);
    else setMsg(`${r.data?.made.length || 0} check${r.data?.made.length === 1 ? "" : "s"} made in QuickBooks (Print later)${r.data?.skipped.length ? `. Skipped: ${r.data.skipped.join("; ")}` : "."}`);
    load();
  }
  // Payroll finished (Oct 30, Nick: "something… that says payroll finished and we'll just close it out")
  const closed = d?.closed || null;
  const conOpen = cons.filter((r) => r.total > 0 && !r.line?.qbo_purchase_id);
  const canClose = !toFix.length && !conOpen.length;
  // the payday's totals (Oct 30, Nick: "contractor checks, the total for the W-2 employees plus the FBS taxes equals this…
  // and how much of it was overtime"): W-2 amounts as QuickBooks actually paid them, once read back
  const rec = d?.record || null;
  const hasW2 = rec?.w2_gross != null;
  const checksTotal = r2(made.reduce((s, r) => s + +(r.line?.check_total || 0), 0));
  const w2Cost = hasW2 ? r2(+(rec!.w2_gross || 0) + +(rec!.w2_employer_taxes || 0)) : 0;
  // overtime's extra cost (Oct 30, Nick: "I just want the cost extra for the overtime… that extra half of pay"): the half on
  // top of straight time, overtime hours × half the rate, everyone on this payday
  const otHalf = r2(rows.reduce((s, r) => s + (r.pay.rate != null ? r.pay.otHours * r.pay.rate * ((d?.settings.otRate || 1.5) - 1) : 0), 0));
  const otHours = r2(rows.reduce((s, r) => s + r.pay.otHours, 0));
  async function getActuals() {
    if (!d) return;
    setBusy("Reading the payroll from QuickBooks…"); setErr(""); setMsg("");
    const r = await pullActuals(d.p.start);
    setBusy("");
    if (!r.ok) setErr(r.error); else if (!r.data?.found) setMsg(`QuickBooks has no paychecks dated ${dayLabel(d.payDate)} yet. Submit the payroll there, then try again.`); else setMsg("The actual W-2 amounts came in from QuickBooks.");
    load();
  }
  async function closeOut(reopen = false) {
    if (!d) return;
    setConfirm(""); setBusy(reopen ? "Reopening…" : "Closing out this payday…"); setErr(""); setMsg("");
    const r = await closePayday(d.p.start, reopen);
    setBusy("");
    if (!r.ok) setErr(r.error); else setMsg(reopen ? "Payday reopened." : `Payroll finished for ${dayLabel(d.payDate)}. It's closed out.`);
    load();
  }
  async function entered() {
    if (!d) return;
    setConfirm(""); setBusy("Saving…");
    const r = await markEntered(d.p.start, w2Open.map((x) => x.e.id));
    setBusy("");
    if (!r.ok) setErr(r.error); else setMsg(r.data?.found ? "W-2 payroll entered. The actual amounts came in from QuickBooks (Step 4). Advance repayments are recorded." : `W-2 payroll marked as entered; advance repayments recorded. QuickBooks has no paychecks dated ${dayLabel(d.payDate)} yet: once it's submitted, press "Get totals from QuickBooks" in Step 4.`);
    load();
  }
  function copyList() {
    const lines = w2.map((r) => `${nm(r)}\t${r.e.pay_type === "salary" ? "Salary" : `Regular ${h2(r.pay.regHours)}\tOvertime ${h2(r.pay.otHours)}`}${r.pay.offHours ? `\tTime off ${h2(r.pay.offHours)}` : ""}${r.bonus ? `\tBonus ${$(r.bonus)}` : ""}${r.advance ? `\tAdvance ${$(r.advance)}` : ""}`);
    void navigator.clipboard?.writeText(lines.join("\n"));
    setMsg("Copied the W-2 list.");
  }

  const p = d?.p;
  // the payday as data, for the Run payroll skill (Claude fills QuickBooks Payroll from exactly these numbers, Oct 30, Nick:
  // "the whole point… is so that you enter it so I don't make mistakes"); read with document.getElementById("payroll-data")
  const feed = d && p ? JSON.stringify({
    period: { start: p.start, end: p.end }, payDate: d.payDate, clockProblems: toFix.map((r) => ({ name: nm(r), count: r.issues })),
    w2: w2.map((r) => ({ id: r.e.id, name: nm(r), quickbooksName: r.e.qbo_vendor_name || null, salary: r.e.pay_type === "salary", rate: r.pay.rate, regularHours: r.pay.regHours, overtimeHours: r.pay.otHours, timeOffHours: r.pay.offHours, bonus: r.bonus, advance: r.advance, entered: !!r.line?.done_at })),
    contractors: cons.map((r) => ({ id: r.e.id, name: nm(r), payee: r.e.qbo_vendor_name || null, lines: r.check, total: r.line?.check_total ?? r.total, checkMade: !!r.line?.qbo_purchase_id, ready: ready.includes(r) })),
  }).replace(/</g, "\\u003c") : "";
  return (
    <>
      {feed && <script type="application/json" id="payroll-data" dangerouslySetInnerHTML={{ __html: feed }} />}
      <div className="page-head">
        <div>
          <h1>Payroll Center</h1>
          <div className="eyebrow">{p ? <>Pay period {dayLabel(p.start)} – {dayLabel(p.end)} · pay date {dayLabel(d!.payDate)} · overtime past {d!.settings.otWeekly} hrs a week{closed && <> · <span className="pc-ok">Payroll finished ✓</span></>}</> : "Loading…"}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" disabled={!p} onClick={() => p && setStart(periodOf(d!.settings, addDays(p.start, -1)).start)} aria-label="Previous pay period" title="Previous pay period">←</button>
          <button type="button" className="btn" disabled={!p || addDays(p.end, 1) > today} onClick={() => p && setStart(addDays(p.end, 1))} aria-label="Next pay period" title="Next pay period">→</button>
          <button type="button" className="btn primary" onClick={() => { setTab("advances"); setNewAdv(true); }}>Issue paycheck advance</button>
        </div>
      </div>

      <div className="stats">
        <button type="button" className="stat" onClick={() => setTab("payday")}><span className={"v" + (toFix.length ? " alert" : "")}>{toFix.reduce((s, r) => s + r.issues, 0)}</span><span className="k">Clock problems</span></button>
        <button type="button" className="stat" onClick={() => setTab("payday")}><span className="v">{w2.length}</span><span className="k">W-2 payroll{w2.length ? ` · ${w2Open.length ? `${w2Open.length} to enter` : "entered"}` : ""}</span></button>
        <button type="button" className="stat" onClick={() => setTab("payday")}><span className="v">{$(conTotal)}</span><span className="k">{cons.length} contractor checks · {made.length} made</span></button>
        <button type="button" className="stat" onClick={() => setTab("advances")}><span className="v">{$(advTotal)}</span><span className="k">Advances repaid this payday</span></button>
      </div>

      <nav className="aa-nav ot-nav" aria-label="Payroll sections">
        {([["payday", "Payday", 0], ["advances", "Paycheck advances", openAdv.length], ["past", "Past paydays", 0]] as const).map(([k, l, n]) => (
          <button key={k} type="button" className={"aa-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}><span className="ot-l">{l}</span>{n > 0 && <span className="aa-n">{n}</span>}</button>
        ))}
      </nav>

      {err && <div className="pv-err" style={{ marginBottom: 12 }}>{err} <button type="button" className="linkbtn" onClick={() => setErr("")}>Dismiss</button></div>}
      {msg && <div className="pc-msg">{msg} <button type="button" className="linkbtn" onClick={() => setMsg("")}>Dismiss</button></div>}
      {busy && <div className="pc-msg">{busy}</div>}

      {!d ? <div className="empty">{err ? "" : "Loading…"}</div> : tab === "payday" ? (
        <div className="stack">
          {/* Step 1: the time clock problems, the same panel as steps 2 and 3 (Oct 30, Nick) */}
          <section className={"panel" + (toFix.length ? " pc-bad" : "")}>
            <div className="panel-h">
              <div><h2>Step 1 · Time clock problems</h2><span className="faint">{toFix.length ? "Their hours are short until they're fixed; their checks wait." : "None. Everyone's hours are complete."}</span></div>
              {toFix.length > 0 && <Link className="btn primary" href="/shop/time">Fix in Time Clock</Link>}
            </div>
            {toFix.length > 0 && <div className="panel-b pc-fix">{toFix.map((r) => <span key={r.e.id} className="pc-fix-p"><b>{nm(r)}</b> <span className="bad">{r.issues} problem{r.issues > 1 ? "s" : ""}</span></span>)}</div>}
          </section>

          <section className="panel">
            <div className="panel-h">
              <div><h2>Step 2 · W-2 payroll</h2><span className="faint">QuickBooks Payroll, in its list order. Salaries are filled by QuickBooks.</span></div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn" onClick={copyList} disabled={!w2.length}>Copy as list</button>
                {w2Open.length > 0 && (confirm === "entered"
                  ? <><button type="button" className="btn primary" onClick={entered}>Yes, it&apos;s saved in QuickBooks</button><button type="button" className="btn" onClick={() => setConfirm("")}>Cancel</button></>
                  : <button type="button" className="btn primary" onClick={() => setConfirm("entered")} disabled={!!busy}>Mark entered in QuickBooks</button>)}
              </div>
            </div>
            <div className="tbl-wrap pc-tbl">
              <table className="tbl">
                <thead><tr><th>Employee</th><th className="r">Rate</th><th className="r">Regular hrs</th><th className="r">Overtime hrs</th>{w2.some((r) => r.pay.offHours) && <th className="r">Time off hrs</th>}<th className="r">Bonus</th><th className="r">Advance to deduct</th><th>Status</th></tr></thead>
                <tbody>{w2.map((r) => (
                  <tr key={r.e.id} className={r.issues ? "flag" : ""}>
                    <td><b>{nm(r)}</b>{asQb(r) && <div className="sub">In QuickBooks as {r.e.qbo_vendor_name}</div>}{r.issues > 0 && <div className="sub bad">{r.issues} clock problem{r.issues > 1 ? "s" : ""}</div>}</td>
                    <td className="r">{r.e.pay_type === "salary" ? <span className="faint">Salary</span> : r.pay.rate != null ? $(r.pay.rate) : r.line?.done_at ? <span className="bad">no rate</span> : <RateCell id={r.e.id} onSaved={load} />}</td>
                    {r.e.pay_type === "salary"
                      ? <td className="r faint" colSpan={2}>QuickBooks fills it</td>
                      : <><td className="r">{h2(r.pay.regHours)}</td><td className={"r" + (r.pay.otHours ? " pc-ot" : "")}>{h2(r.pay.otHours)}</td></>}
                    {w2.some((x) => x.pay.offHours) && <td className="r">{h2(r.pay.offHours)}</td>}
                    <td className="r"><Money value={r.line?.bonus ?? null} disabled={!!r.line?.done_at} onSave={(v) => saveLine(r, { bonus: v })} /></td>
                    <td className="r"><AdvanceCell r={r} disabled={!!r.line?.done_at} onSave={(v) => saveLine(r, { advance_amount: v })} /></td>
                    <td>{r.line?.done_at ? <span className="pc-ok">Entered ✓</span> : <span className="faint">To enter</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="panel-b faint pc-note">In QuickBooks: Run payroll → each person&apos;s Regular pay hours and Overtime hours, the Bonus, and the advance under Action → Edit paycheck → Employee deductions. Save for later; you review and submit.</div>
          </section>

          <section className="panel">
            <div className="panel-h">
              <div><h2>Step 3 · Contractor checks</h2><span className="faint">Print later, from {qb?.accounts[0] || "Bank Of America"}, dated {dayLabel(d.payDate)}</span></div>
              <div className="row" style={{ gap: 8 }}>
                {guesses.size > 0 && <button type="button" className="btn" onClick={useGuesses} disabled={!!busy}>Use {guesses.size} suggested payee{guesses.size > 1 ? "s" : ""}</button>}
                {role === "owner" && ready.length > 0 && (confirm === "checks"
                  ? <><button type="button" className="btn primary" onClick={createChecks}>Yes, create {ready.length} checks · {$(r2(ready.reduce((s, r) => s + r.total, 0)))}</button><button type="button" className="btn" onClick={() => setConfirm("")}>Cancel</button></>
                  : <button type="button" className="btn primary" onClick={() => setConfirm("checks")} disabled={!!busy || !qb}>Create {ready.length} check{ready.length > 1 ? "s" : ""} in QuickBooks</button>)}
              </div>
            </div>
            {qbErr && <div className="pv-err" style={{ margin: "10px 16px" }}>{qbErr}</div>}
            <div className="tbl-wrap pc-tbl">
              <table className="tbl">
                <thead><tr><th>Employee</th><th>QuickBooks payee</th><th className="r">Rate</th><th className="r">Regular hrs</th><th className="r">Overtime hrs</th><th className="r">Regular pay</th><th className="r">Overtime pay</th><th className="r">Bonus</th><th className="r">Advance</th><th className="r">Check</th><th>Status</th></tr></thead>
                <tbody>{cons.map((r) => {
                  const pe = payeeOf(r), g = guesses.get(r.e.id), done = !!r.line?.qbo_purchase_id;
                  const reg = r.check.filter((l) => l.desc === "REGULAR PAY").reduce((s, l) => s + l.amount, 0), ot = r.check.filter((l) => l.desc === "OVERTIME").reduce((s, l) => s + l.amount, 0);
                  return (
                    <tr key={r.e.id} className={r.issues ? "flag" : ""}>
                      <td><b>{nm(r)}</b>{!r.e.active && <div className="sub">New from uAttend</div>}{r.issues > 0 && <div className="sub bad">{r.issues} clock problem{r.issues > 1 ? "s" : ""}</div>}</td>
                      <td>{done || !qb ? (pe?.name || <span className="faint">—</span>) : (
                        <select className="pc-payee" value={pe ? `${pe.type}:${pe.id}` : ""} onChange={(e) => { const v = e.target.value; if (v === "new") return newVendor(r); const [t, id] = v.split(":"); setPayee(r.e.id, qb.payees.find((x) => x.id === id && x.type === t) || null); }}>
                          <option value="">{g ? `Suggested: ${g.name}` : "Pick payee…"}</option>
                          {!g && <option value="new">+ Add {fullName(r.e)} to QuickBooks as a new vendor</option>}
                          <optgroup label="Vendors">{qb.payees.filter((x) => x.type === "Vendor").map((x) => <option key={"v" + x.id} value={`Vendor:${x.id}`}>{x.name}</option>)}</optgroup>
                          <optgroup label="Employees">{qb.payees.filter((x) => x.type === "Employee").map((x) => <option key={"e" + x.id} value={`Employee:${x.id}`}>{x.name}</option>)}</optgroup>
                        </select>)}</td>
                      <td className="r">{r.e.pay_type === "salary" ? <span className="faint">Salary</span> : r.pay.rate != null ? $(r.pay.rate) : done ? <span className="bad">no rate</span> : <RateCell id={r.e.id} onSaved={load} />}</td>
                      {r.e.pay_type === "salary"
                        ? <td className="r faint" colSpan={2}>Salary ÷ {d.settings.period === "biweekly" ? 26 : d.settings.period === "weekly" ? 52 : 24}</td>
                        : <><td className="r">{h2(r.pay.regHours)}</td><td className={"r" + (r.pay.otHours ? " pc-ot" : "")}>{h2(r.pay.otHours)}</td></>}
                      <td className="r">{r.pay.rate == null && r.e.pay_type !== "salary" ? <span className="faint">—</span> : $(reg)}</td>
                      <td className={"r" + (ot ? " pc-ot" : "")}>{ot ? $(ot) : <span className="faint">—</span>}</td>
                      <td className="r"><Money value={r.line?.bonus ?? null} disabled={done} onSave={(v) => saveLine(r, { bonus: v })} /></td>
                      <td className="r"><AdvanceCell r={r} disabled={done} onSave={(v) => saveLine(r, { advance_amount: v })} neg /></td>
                      <td className="r"><b>{$(r.line?.check_total ?? r.total)}</b></td>
                      <td>{done ? <span className="pc-ok">Check made ✓</span> : r.issues ? <span className="bad">Fix clock first</span> : r.pay.rate == null && r.e.pay_type !== "salary" ? <span className="pc-wait">Needs rate</span> : !pe ? <span className="pc-wait">Needs payee</span> : r.total > 0 ? <span className="faint">Ready</span> : <span className="faint">Nothing to pay</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="panel-b faint pc-note">Each check: Subcontractors - COS · REGULAR PAY, Subcontractors - COS · OVERTIME (time and a half past 40 hours a week), BONUS, and Repayment:Check Advance as a minus line for an advance. A salaried contractor&apos;s check is the salary ÷ {d.settings.period === "biweekly" ? 26 : d.settings.period === "weekly" ? 52 : 24}. Made only when you press the button, once per person per payday.</div>
          </section>

          {/* Step 4: payroll finished, closed out (Oct 30, Nick) */}
          <section className={"panel" + (closed ? " pc-done" : "")}>
            <div className="panel-h">
              <div><h2>Step 4 · Finish payroll</h2><span className="faint">{closed ? `Closed out ${new Date(closed.closed_at!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${closed.closed_by ? ` by ${closed.closed_by}` : ""}.` : "When the W-2 payroll is submitted in QuickBooks and the checks are printed."}</span></div>
              <div className="row" style={{ gap: 8 }}>
                {closed ? (role === "owner" && <button type="button" className="btn" onClick={() => closeOut(true)} disabled={!!busy}>Reopen</button>)
                  : confirm === "close"
                    ? <><button type="button" className="btn primary" onClick={() => closeOut()}>Yes, payroll is finished</button><button type="button" className="btn" onClick={() => setConfirm("")}>Cancel</button></>
                    : <button type="button" className="btn primary" onClick={() => setConfirm("close")} disabled={!!busy || !canClose}>Payroll finished · close it out</button>}
              </div>
            </div>
            <div className="panel-b pc-close">
              <span className={toFix.length ? "bad" : "pc-ok"}>{toFix.length ? `${toFix.length} with clock problems` : "Time clock ✓"}</span>
              <span className={conOpen.length ? "pc-wait" : "pc-ok"}>{conOpen.length ? `${conOpen.length} contractor check${conOpen.length > 1 ? "s" : ""} to make` : `${made.length} contractor checks made ✓ · ${$(r2(made.reduce((s, r) => s + +(r.line?.check_total || 0), 0)))}`}</span>
              <span className={w2Open.length && !closed ? "faint" : "pc-ok"}>{closed || !w2Open.length ? `W-2 payroll entered ✓ · ${w2.length}` : `W-2 payroll: ${w2.length} to submit in QuickBooks (closing marks them entered)`}</span>
              {closed && closed.advances_total > 0 && <span className="pc-ok">Advances repaid {$(closed.advances_total)}</span>}
            </div>
            {/* the payday's total: contractor checks + W-2 gross + FBS taxes, and the overtime in it (Oct 30, Nick) */}
            <div className="tbl-wrap pc-tbl pc-tot">
              <table className="tbl">
                <tbody>
                  <tr><td><b>Contractor checks</b><div className="sub">{made.length} check{made.length === 1 ? "" : "s"} made{advTotal ? ` · after ${$(advTotal)} in advance repayments` : ""}</div></td><td className="r">{$(checksTotal)}</td></tr>
                  <tr><td><b>W-2 employees, gross pay</b><div className="sub">{hasW2 ? <>{rec!.w2_paychecks} paychecks from QuickBooks, not counting the people left out of the Payroll Center · net {$(+(rec!.w2_net || 0))} · employee taxes withheld {$(+(rec!.w2_employee_taxes || 0))}{+(rec!.w2_deductions || 0) > 0 ? ` · other deductions ${$(+(rec!.w2_deductions || 0))}` : ""}</> : "From QuickBooks once the payroll is submitted"}</div></td>
                    <td className="r">{hasW2 ? $(+(rec!.w2_gross || 0)) : <button type="button" className="btn sm" onClick={getActuals} disabled={!!busy}>Get totals from QuickBooks</button>}</td></tr>
                  <tr><td><b>FBS taxes</b><div className="sub">Social Security and Medicare match, federal and Texas unemployment</div></td><td className="r">{hasW2 ? $(+(rec!.w2_employer_taxes || 0)) : <span className="faint">—</span>}</td></tr>
                  <tr className="pc-tot-sum"><td><b>Total payroll</b>{hasW2 && <div className="sub">W-2 with FBS taxes {$(w2Cost)}{rec?.qbo_pulled_at ? <> · from QuickBooks {new Date(rec.qbo_pulled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · <button type="button" className="linkbtn" onClick={getActuals} disabled={!!busy}>Read again</button></> : null}</div>}</td><td className="r"><b>{hasW2 ? $(r2(checksTotal + w2Cost)) : `${$(checksTotal)} + W-2`}</b></td></tr>
                  <tr className="pc-tot-ot"><td><b>Total overtime, extra paid</b><div className="sub">The extra half on {h2(otHours)} overtime hours: what overtime cost on top of straight time</div></td><td className="r pc-ot">{$(otHalf)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : tab === "advances" ? (
        <Advances d={d} role={role} open={newAdv} setOpen={setNewAdv} onDone={(m) => { setMsg(m); load(); }} />
      ) : (
        <PastPaydays />
      )}
    </>
  );
}

/** a money box that saves when you leave it (empty = none) */
function Money({ value, onSave, disabled, placeholder = "" }: { value: number | null; onSave: (v: number | null) => void; disabled?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value == null ? "" : String(+value));
  useEffect(() => setV(value == null ? "" : String(+value)), [value]);
  return <input className="pc-money" inputMode="decimal" value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.target.value)}
    onBlur={() => { const n = v.trim() === "" ? null : r2(parseFloat(v.replace(/[$,]/g, ""))); if (n !== (value == null ? null : +value) && (n == null || Number.isFinite(n))) onSave(n); }} />;
}
/** an hourly rate for someone who has none yet (a new person from uAttend), saved to their pay like Time Clock → Employees */
function RateCell({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [err, setErr] = useState("");
  return (
    <span className="pc-adv" title="Their hourly rate (saved on the employee)">
      <Money value={null} placeholder="Rate" onSave={async (v) => {
        if (v == null || !(v > 0)) return;
        const { error } = await createClient().from("employee_pay").upsert({ employee_id: id, rate: v, updated_at: new Date().toISOString() }, { onConflict: "employee_id" });
        if (error) setErr(error.message); else onSaved();
      }} />
      {err ? <small className="bad">{err}</small> : <small className="bad">needs a rate</small>}
    </span>
  );
}
/** this check's advance: the plan's amount, or what's typed in (0 to skip this payday) */
function AdvanceCell({ r, onSave, disabled, neg }: { r: PaydayRow; onSave: (v: number | null) => void; disabled?: boolean; neg?: boolean }) {
  if (!r.advances.length) return <span className="faint">—</span>;
  const left = r2(r.advances.reduce((s, a) => s + a.left, 0));
  // skip this payday (Oct 30, Nick: "sometimes employees tell me to skip… an advance payment"): nothing comes out this
  // time, the plan picks up again next payday
  const skipped = r.line?.advance_amount != null && +r.line.advance_amount === 0 && r.planned > 0;
  if (skipped) return (
    <span className="pc-adv"><span className="faint">Skipped</span>{!disabled && <button type="button" className="linkish" onClick={() => onSave(null)}>Undo</button>}<small className="faint">{$(left)} left</small></span>
  );
  return (
    <span className="pc-adv" title={`${$(left)} left · ${r.advances.map((a) => planLabel(a.advance)).join(", ")}`}>
      {!disabled && r.planned > 0 && <button type="button" className="linkish" title="Take nothing out this payday; the plan starts again next payday" onClick={() => onSave(0)}>Skip</button>}
      {neg && <span className="bad">−</span>}
      <Money value={r.line?.advance_amount != null ? +r.line.advance_amount : r.planned} disabled={disabled} onSave={(v) => onSave(v == null || v === r.planned ? null : v)} />
      <small className="faint">of {$(left)}</small>
    </span>
  );
}

function Advances({ d, role, open, setOpen, onDone }: { d: Data; role: string; open: boolean; setOpen: (b: boolean) => void; onDone: (m: string) => void }) {
  const [emp, setEmp] = useState(""), [amt, setAmt] = useState(""), [on, setOn] = useState(localDay(new Date()));
  const [plan, setPlan] = useState<"per" | "checks">("per"), [per, setPer] = useState(""), [n, setN] = useState("2"), [note, setNote] = useState("");
  const [write, setWrite] = useState(role === "owner"), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const people = d.employees.filter((e) => e.active && !e.payday_skip);
  const byId = new Map(d.employees.map((e) => [e.id, e]));
  const list = [...d.advances].sort((a, b) => (a.closed_at ? 1 : 0) - (b.closed_at ? 1 : 0) || b.given_on.localeCompare(a.given_on));
  const thisPay = (id: string) => d.rows.flatMap((r) => r.advances).find((x) => x.advance.id === id)?.take || 0;
  async function save() {
    setErr("");
    const amount = parseFloat(amt.replace(/[$,]/g, ""));
    if (!emp) return setErr("Pick the person.");
    if (!(amount > 0)) return setErr("Enter the amount.");
    const perCheck = plan === "per" ? parseFloat(per.replace(/[$,]/g, "")) : null, checks = plan === "checks" ? parseInt(n, 10) : null;
    if (plan === "per" && !(perCheck! > 0)) return setErr("Enter how much comes out of each check.");
    if (plan === "checks" && !(checks! > 0)) return setErr("Enter how many checks.");
    setBusy(true);
    const r = await issueAdvance({ employeeId: emp, amount, givenOn: on, perCheck, checks, note, writeCheck: write });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    const e = byId.get(emp);
    setOpen(false); setEmp(""); setAmt(""); setPer(""); setNote("");
    onDone(`Advance of ${$(amount)} for ${e ? fullName(e) : "them"} saved${write ? ` and the check is in QuickBooks (Print later${r.data?.doc ? `, #${r.data.doc}` : ""})` : ""}. It comes out of their checks starting next payday.`);
  }
  return (
    <section className="panel">
      <div className="panel-h">
        <div><h2>Paycheck advances</h2><span className="faint">Taken out of each paycheck by its plan until it&apos;s paid off</span></div>
        {!open && <button type="button" className="btn primary" onClick={() => setOpen(true)}>Issue paycheck advance</button>}
      </div>
      {open && (
        <div className="panel-b pc-form">
          <div className="field"><label>Employee</label>
            <select value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Pick a person…</option>{people.map((e) => <option key={e.id} value={e.id}>{e.last_name}, {e.first_name}</option>)}</select></div>
          <div className="field pc-sm"><label>Amount</label><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="500" /></div>
          <div className="field pc-sm"><label>Given on</label><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div>
          <div className="field"><label>Pay back</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value as "per" | "checks")}><option value="per">A set amount each check</option><option value="checks">Spread over a number of checks</option></select></div>
          {plan === "per"
            ? <div className="field pc-sm"><label>Each check</label><input inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} placeholder="250" /></div>
            : <div className="field pc-sm"><label>Checks</label><input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></div>}
          <div className="field pc-note-f"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Car repair" /></div>
          {role === "owner" && <label className="pc-check"><input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} /> Write the check in QuickBooks (Print later, Repayment:Check Advance)</label>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Issue advance"}</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {err && <div className="pv-err" style={{ flexBasis: "100%" }}>{err}</div>}
        </div>
      )}
      <div className="tbl-wrap pc-tbl">
        <table className="tbl">
          <thead><tr><th>Employee</th><th>Given</th><th className="r">Amount</th><th>Plan</th><th className="r">Repaid</th><th className="r">Left</th><th className="r">This payday</th><th>Status</th></tr></thead>
          <tbody>{list.length === 0 ? <tr><td colSpan={8} className="faint">No paycheck advances yet. Issue one with the button above.</td></tr> : list.map((a) => {
            const e = byId.get(a.employee_id), repaid = r2(d.payments.filter((p) => p.advance_id === a.id).reduce((s, p) => s + +p.amount, 0));
            const left = r2(+a.amount - repaid), now = thisPay(a.id);
            return (
              <tr key={a.id}>
                <td><b>{e ? `${e.last_name}, ${e.first_name}` : "—"}</b>{a.note && <div className="sub">{a.note}</div>}</td>
                <td>{dayLabel(a.given_on)}</td>
                <td className="r">{$(+a.amount)}</td>
                <td>{planLabel(a)}</td>
                <td className="r">{$(repaid)}</td>
                <td className="r"><b>{$(Math.max(0, left))}</b></td>
                <td className="r">{now ? $(now) : <span className="faint">—</span>}</td>
                <td>{a.closed_at ? <span className="pc-ok">Paid off</span> : advanceLeft(a, d.payments, d.p.start) > 0 ? <span className="faint">Repaying</span> : <span className="faint">Last payment this payday</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

/** every payday the Payroll Center ran: checks made, W-2 entered, totals */
function PastPaydays() {
  const [rows, setRows] = useState<{ period_start: string; checks: number; total: number; w2: number; closed?: string }[] | null>(null);
  useEffect(() => {
    const sb = createClient();
    Promise.all([sb.from("payday_lines").select("period_start, qbo_purchase_id, check_total, done_at").order("period_start", { ascending: false }).limit(2000), sb.from("paydays").select("period_start, closed_at, closed_by")]).then(([{ data }, { data: pd }]) => {
      const fin = new Map(((pd || []) as { period_start: string; closed_at: string | null; closed_by: string }[]).filter((x) => x.closed_at).map((x) => [x.period_start, `${dayLabel(x.closed_at!.slice(0, 10))}${x.closed_by ? ` · ${x.closed_by}` : ""}`]));
      const m = new Map<string, { period_start: string; checks: number; total: number; w2: number; closed?: string }>();
      for (const l of (data || []) as { period_start: string; qbo_purchase_id: string | null; check_total: number | null; done_at: string | null }[]) {
        const x = m.get(l.period_start) || { period_start: l.period_start, checks: 0, total: 0, w2: 0 };
        if (l.qbo_purchase_id) { x.checks++; x.total = r2(x.total + +(l.check_total || 0)); }
        if (l.done_at) x.w2++;
        m.set(l.period_start, x);
      }
      setRows([...m.values()].filter((x) => x.checks || x.w2).map((x) => ({ ...x, closed: fin.get(x.period_start) })));
    });
  }, []);
  return (
    <section className="panel">
      <div className="panel-h"><div><h2>Past paydays</h2><span className="faint">What each payday paid through the Payroll Center</span></div></div>
      <div className="tbl-wrap pc-tbl">
        <table className="tbl">
          <thead><tr><th>Pay period starting</th><th className="r">Contractor checks</th><th className="r">Checks total</th><th className="r">W-2 entered</th><th>Finished</th></tr></thead>
          <tbody>{!rows ? <tr><td colSpan={5} className="faint">Loading…</td></tr> : !rows.length ? <tr><td colSpan={5} className="faint">Nothing yet. This fills in as paydays are run here.</td></tr> : rows.map((r) => (
            <tr key={r.period_start}><td>{dayLabel(r.period_start)}</td><td className="r">{r.checks}</td><td className="r">{$(r.total)}</td><td className="r">{r.w2}</td><td>{r.closed ? <span className="pc-ok">Closed {r.closed}</span> : <span className="faint">Open</span>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
