"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Qbo, qboConnected } from "@/lib/qbo/client";
import { dayLabel, r2 } from "@/lib/timeclock";
import { PAY_ACCOUNTS, loadPayday, type Advance, type PayEmployee } from "@/lib/payday";
import { payrollActuals } from "@/lib/qbo/payrollActuals";

/**
 * Payroll Center, the QuickBooks side (Oct 30, Nick). Reading payees and accounts changes nothing. Writing makes only
 * Print-later checks (a QuickBooks "Purchase" paid by check, PrintStatus NeedToPrint), one per contractor per payday,
 * and only when the owner presses the button. Nothing is ever deleted in QuickBooks; payroll itself is never submitted
 * from here (QuickBooks Payroll can't be run through its API anyway: the W-2 side is typed in and Saved for later).
 */
type R<T = undefined> = { ok: true; data?: T; msg?: string } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });
async function owner() {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") throw new Error("Only the owner can write checks in QuickBooks.");
  return { admin: createAdminClient(), email: v.email };
}

export type Payee = { id: string; name: string; type: "Vendor" | "Employee" };
type Acct = { Id: string; Name: string; FullyQualifiedName?: string; AccountType?: string; Active?: boolean };

/** the three accounts a pay check uses, found by name (Bank Of America, Subcontractors - COS, Repayment:Check Advance) */
async function accounts(q: Qbo) {
  const all = await q.query<Acct>("Account", "WHERE Active = true", 5000, "Id, Name, FullyQualifiedName, AccountType");
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/\s*([:-])\s*/g, "$1").trim();
  const find = (want: string) => all.find((a) => norm(a.FullyQualifiedName || a.Name) === norm(want)) || all.find((a) => norm(a.Name) === norm(want.split(":").pop() || want));
  const out = { bank: find(PAY_ACCOUNTS.bank), labor: find(PAY_ACCOUNTS.labor), advance: find(PAY_ACCOUNTS.advance) };
  const missing = (Object.keys(out) as (keyof typeof out)[]).filter((k) => !out[k]).map((k) => PAY_ACCOUNTS[k]);
  if (missing.length) throw new Error(`QuickBooks has no account named ${missing.map((m) => `"${m}"`).join(" or ")}.`);
  return out as { bank: Acct; labor: Acct; advance: Acct };
}

/** QuickBooks' payees (contractors are Vendors; W-2 people are Employees) and whether the pay accounts are there */
export async function payrollQbo(): Promise<R<{ payees: Payee[]; accounts: string[] }>> {
  try {
    const { admin } = await owner();
    if (!(await qboConnected(admin))) return { ok: false, error: "QuickBooks isn't connected (Admin Tools → QuickBooks)." };
    const q = new Qbo(admin, { entity: "Payroll" });
    const [vs, es, ac] = await Promise.all([
      q.query<{ Id: string; DisplayName: string }>("Vendor", "WHERE Active = true", 5000, "Id, DisplayName"),
      q.query<{ Id: string; DisplayName: string }>("Employee", "WHERE Active = true", 5000, "Id, DisplayName"),
      accounts(q),
    ]);
    const payees: Payee[] = [...vs.map((v) => ({ id: v.Id, name: v.DisplayName, type: "Vendor" as const })), ...es.map((v) => ({ id: v.Id, name: v.DisplayName, type: "Employee" as const }))]
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: { payees, accounts: [ac.bank, ac.labor, ac.advance].map((a) => a.FullyQualifiedName || a.Name) } };
  } catch (e) { return fail(e); }
}

/**
 * A new contractor (Oct 30, Nick: "how are we going to create a new one… Terena Nino is a new person"): add them to
 * QuickBooks as a 1099 vendor under their name and save it as their payee. If QuickBooks already has a vendor by that
 * exact name, that one is used instead (never a twin). Only when the owner picks it.
 */
export async function addVendor(employeeId: string): Promise<R<Payee>> {
  try {
    const { admin } = await owner();
    if (!(await qboConnected(admin))) return { ok: false, error: "QuickBooks isn't connected (Admin Tools → QuickBooks)." };
    const { data: e } = await admin.from("employees").select("id, first_name, last_name, email, phone, qbo_vendor_id").eq("id", employeeId).maybeSingle();
    if (!e) return { ok: false, error: "That person isn't on the employee list." };
    const name = `${e.first_name} ${e.last_name}`.replace(/\s+/g, " ").trim();
    if (!name) return { ok: false, error: "They need a name first." };
    const q = new Qbo(admin, { entity: "Vendor", localId: employeeId });
    const same = await q.query<{ Id: string; DisplayName: string }>("Vendor", `WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`, 5, "Id, DisplayName");
    const v = same[0] || await q.create<{ Id: string; DisplayName: string }>("Vendor", {
      DisplayName: name, GivenName: e.first_name || undefined, FamilyName: e.last_name || undefined, PrintOnCheckName: name, Vendor1099: true,
      ...(e.email ? { PrimaryEmailAddr: { Address: e.email } } : {}), ...(e.phone ? { PrimaryPhone: { FreeFormNumber: e.phone } } : {}),
    }, `vend${employeeId.replace(/-/g, "").slice(0, 28)}`);
    await admin.from("employees").update({ qbo_vendor_id: v.Id, qbo_vendor_name: v.DisplayName, qbo_payee_type: "Vendor" }).eq("id", employeeId);
    return { ok: true, data: { id: v.Id, name: v.DisplayName, type: "Vendor" } };
  } catch (e) { return fail(e); }
}

/** the payday as the page shows it, read again here so a check is built from our numbers, not the browser's */
async function payday(admin: ReturnType<typeof createAdminClient>, start: string) {
  const d = await loadPayday(admin, start);
  if (d.p.start !== start) throw new Error("That isn't the start of a pay period.");
  return d;
}

/** record what came out toward each advance on this payday, and close the ones now paid off */
async function recordRepayments(admin: ReturnType<typeof createAdminClient>, start: string, due: { advance: Advance; left: number; take: number }[]) {
  for (const d of due) {
    if (d.take <= 0) continue;
    const { error } = await admin.from("pay_advance_payments").upsert({ advance_id: d.advance.id, period_start: start, amount: d.take }, { onConflict: "advance_id,period_start" });
    if (error) throw new Error(error.message);
    if (d.take >= d.left - 0.004) await admin.from("pay_advances").update({ closed_at: new Date().toISOString() }).eq("id", d.advance.id).is("closed_at", null);
  }
}

/**
 * Make the contractors' checks in QuickBooks: Print later, from Bank Of America, dated the pay date, paid to the payee
 * picked for each person. One check per person per payday (a second press skips anyone who already has one, and
 * QuickBooks' request id stops a retried request from making a twin).
 */
export async function makeChecks(start: string, employeeIds: string[]): Promise<R<{ made: { id: string; name: string; total: number; doc: string }[]; skipped: string[] }>> {
  try {
    const { admin, email } = await owner();
    if (!(await qboConnected(admin))) return { ok: false, error: "QuickBooks isn't connected (Admin Tools → QuickBooks)." };
    const { p, rows, payDate } = await payday(admin, start);
    const q = new Qbo(admin, { entity: "Purchase" });
    const ac = await accounts(q);
    const made: { id: string; name: string; total: number; doc: string }[] = [], skipped: string[] = [];
    for (const id of employeeIds) {
      const r = rows.find((x) => x.e.id === id);
      const name = r ? `${r.e.first_name} ${r.e.last_name}`.trim() : id;
      if (!r || r.kind !== "contract") { skipped.push(`${name}: not a contractor on this payday`); continue; }
      if (r.line?.qbo_purchase_id) { skipped.push(`${name}: check already made`); continue; }
      if (!r.e.qbo_vendor_id) { skipped.push(`${name}: pick their QuickBooks payee first`); continue; }
      if (r.issues > 0) { skipped.push(`${name}: fix their time clock problems first`); continue; }
      if (!(r.total > 0)) { skipped.push(`${name}: nothing to pay`); continue; }
      const body = {
        PaymentType: "Check",
        AccountRef: { value: ac.bank.Id },
        EntityRef: { value: r.e.qbo_vendor_id, type: r.e.qbo_payee_type === "Employee" ? "Employee" : "Vendor" },
        TxnDate: payDate,
        PrintStatus: "NeedToPrint",
        PrivateNote: `Pay period ${dayLabel(p.start)} – ${dayLabel(p.end)} (Payroll Center)`,
        Line: r.check.map((l) => ({
          DetailType: "AccountBasedExpenseLineDetail", Amount: l.amount, Description: l.desc,
          AccountBasedExpenseLineDetail: { AccountRef: { value: (l.account === "advance" ? ac.advance : ac.labor).Id } },
        })),
      };
      const got = await q.with({ localId: r.e.id }).create<{ Id: string; DocNumber?: string; TotalAmt?: number }>("Purchase", body, `pd${p.start.replace(/-/g, "")}${r.e.id.replace(/-/g, "")}`.slice(0, 50));
      const { error } = await admin.from("payday_lines").upsert({ period_start: p.start, employee_id: r.e.id, bonus: r.bonus || null, advance_amount: r.line?.advance_amount ?? null, qbo_purchase_id: got.Id, check_total: r2(got.TotalAmt ?? r.total), check_made_at: new Date().toISOString(), check_made_by: email, updated_at: new Date().toISOString() }, { onConflict: "period_start,employee_id" });
      if (error) throw new Error(`The check for ${name} was made in QuickBooks, but saving it here failed: ${error.message}`);
      await recordRepayments(admin, p.start, r.advances);
      made.push({ id: got.Id, name, total: r2(got.TotalAmt ?? r.total), doc: got.DocNumber || "" });
    }
    return { ok: true, data: { made, skipped } };
  } catch (e) { return fail(e); }
}

/**
 * What the W-2 payroll actually cost, read from QuickBooks once it's submitted (Oct 30, Nick: "when I say mark entered in
 * QuickBooks, it'll go in and figure out the actual amounts… employee taxes, matching"), saved on the payday. Read-only
 * in QuickBooks. Null when QuickBooks has no paychecks on the pay date yet (not submitted).
 */
async function saveActuals(admin: ReturnType<typeof createAdminClient>, start: string, payDate: string) {
  if (!(await qboConnected(admin))) return null;
  // people left out of the Payroll Center (payday_skip: Nick, Amanda) aren't in its totals either
  const { data: skip } = await admin.from("employees").select("first_name, last_name").eq("payday_skip", true);
  const a = await payrollActuals(admin, payDate, PAY_ACCOUNTS.bank, ((skip || []) as { first_name: string; last_name: string }[]).map((e) => ({ first: e.first_name, last: e.last_name })));
  if (!a) return null;
  const { error } = await admin.from("paydays").upsert({ period_start: start, pay_date: payDate, w2_paychecks: a.paychecks, w2_gross: a.gross, w2_employee_taxes: a.employeeTaxes, w2_deductions: a.deductions, w2_net: a.net, w2_employer_taxes: a.employerTaxes, qbo_pulled_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "period_start" });
  if (error) throw new Error(/w2_gross|paydays/.test(error.message) ? "Run supabase/migrations/237 and 238 first." : error.message);
  return a;
}
/** "Get the totals from QuickBooks" on its own (after submitting, or to read them again) */
export async function pullActuals(start: string): Promise<R<{ found: boolean }>> {
  try {
    const v = await getViewer(", sees_pay");
    if (!v.user || !(v.role === "owner" || v.role === "admin" || v.staff?.sees_pay)) throw new Error("Only payroll managers can do this.");
    const admin = createAdminClient();
    const { p, payDate } = await payday(admin, start);
    const a = await saveActuals(admin, p.start, payDate);
    return { ok: true, data: { found: !!a } };
  } catch (e) { return fail(e); }
}

/** W-2: entered in QuickBooks Payroll. Records the advance repayments taken on those checks, and reads the actual
 *  amounts back from QuickBooks when it's been submitted. */
export async function markEntered(start: string, employeeIds: string[]): Promise<R<{ found: boolean }>> {
  try {
    const v = await getViewer(", sees_pay");
    if (!v.user || !(v.role === "owner" || v.role === "admin" || v.staff?.sees_pay)) throw new Error("Only payroll managers can do this.");
    const admin = createAdminClient();
    const { p, rows, payDate } = await payday(admin, start);
    for (const id of employeeIds) {
      const r = rows.find((x) => x.e.id === id);
      if (!r || r.kind !== "payroll") continue;
      const { error } = await admin.from("payday_lines").upsert({ period_start: p.start, employee_id: r.e.id, bonus: r.bonus || null, advance_amount: r.line?.advance_amount ?? null, done_at: r.line?.done_at || new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "period_start,employee_id" });
      if (error) throw new Error(error.message);
      await recordRepayments(admin, p.start, r.advances);
    }
    const found = await saveActuals(admin, p.start, payDate).catch(() => null);
    return { ok: true, data: { found: !!found } };
  } catch (e) { return fail(e); }
}

/**
 * Payroll finished (Oct 30, Nick: "something in the payroll center that says payroll finished and we'll just close it
 * out"): checked again here (no clock problems, every contractor with pay has a check), the W-2 side recorded as entered
 * (its advance repayments too), and the payday stamped closed with who, when and what it paid. `reopen` clears the stamp.
 */
export async function closePayday(start: string, reopen = false): Promise<R<{ closedAt: string | null }>> {
  try {
    const v = await getViewer(", sees_pay, name");
    if (!v.user || !(v.role === "owner" || v.role === "admin" || v.staff?.sees_pay)) throw new Error("Only payroll managers can do this.");
    const admin = createAdminClient();
    const { p, rows, payDate } = await payday(admin, start);
    if (reopen) {
      const { error } = await admin.from("paydays").update({ closed_at: null, updated_at: new Date().toISOString() }).eq("period_start", p.start);
      if (error) throw new Error(error.message);
      return { ok: true, data: { closedAt: null } };
    }
    const clock = rows.filter((r) => r.issues > 0);
    if (clock.length) throw new Error(`Fix the time clock first: ${clock.map((r) => `${r.e.first_name} ${r.e.last_name}`).join(", ")}.`);
    const noCheck = rows.filter((r) => r.kind === "contract" && r.total > 0 && !r.line?.qbo_purchase_id);
    if (noCheck.length) throw new Error(`Contractor checks still to make: ${noCheck.map((r) => `${r.e.first_name} ${r.e.last_name}`).join(", ")}.`);
    // the W-2 side: submitted in QuickBooks, so it's entered (and its advance repayments recorded)
    const now = new Date().toISOString();
    for (const r of rows.filter((x) => x.kind === "payroll" && !x.line?.done_at)) {
      const { error } = await admin.from("payday_lines").upsert({ period_start: p.start, employee_id: r.e.id, bonus: r.bonus || null, advance_amount: r.line?.advance_amount ?? null, done_at: now, updated_at: now }, { onConflict: "period_start,employee_id" });
      if (error) throw new Error(error.message);
      await recordRepayments(admin, p.start, r.advances);
    }
    const cons = rows.filter((r) => r.kind === "contract" && r.line?.qbo_purchase_id);
    const by = String(v.staff?.name || "") || v.email.split("@")[0];
    const { error } = await admin.from("paydays").upsert({
      period_start: p.start, pay_date: payDate, closed_at: now, closed_by: by,
      w2_count: rows.filter((r) => r.kind === "payroll").length, checks: cons.length,
      checks_total: r2(cons.reduce((s, r) => s + +(r.line?.check_total || 0), 0)), advances_total: r2(rows.reduce((s, r) => s + r.advance, 0)), updated_at: now,
    }, { onConflict: "period_start" });
    if (error) throw new Error(/paydays/.test(error.message) ? "Run supabase/migrations/237_paydays_closed.sql first." : error.message);
    await saveActuals(admin, p.start, payDate).catch(() => null);
    return { ok: true, data: { closedAt: now } };
  } catch (e) { return fail(e); }
}

/**
 * A new paycheck advance. With `writeCheck`, the advance check itself is made in QuickBooks too (Print later, from
 * Bank Of America, on Repayment:Check Advance), paid to the person's QuickBooks payee.
 */
export async function issueAdvance(x: { employeeId: string; amount: number; givenOn: string; perCheck: number | null; checks: number | null; note: string; writeCheck: boolean }): Promise<R<{ doc?: string }>> {
  try {
    const v = await getViewer(", sees_pay");
    if (!v.user || !(v.role === "owner" || v.role === "admin" || v.staff?.sees_pay)) throw new Error("Only payroll managers can do this.");
    const amount = r2(+x.amount);
    if (!(amount > 0)) return { ok: false, error: "Enter the amount." };
    if (!x.perCheck && !x.checks) return { ok: false, error: "Pick how it's paid back." };
    if (x.writeCheck && v.role !== "owner") return { ok: false, error: "Only the owner can write checks in QuickBooks." };
    const admin = createAdminClient();
    const { data: e } = await admin.from("employees").select("*").eq("id", x.employeeId).maybeSingle();
    if (!e) return { ok: false, error: "Pick the person." };
    const emp = e as PayEmployee;
    if (x.writeCheck && !emp.qbo_vendor_id) return { ok: false, error: `Pick ${emp.first_name}'s QuickBooks payee first (on the Payday tab), or leave "Write the check" off.` };
    const { data: adv, error } = await admin.from("pay_advances").insert({ employee_id: x.employeeId, amount, given_on: x.givenOn, per_check: x.perCheck ? r2(x.perCheck) : null, checks: x.checks || null, note: x.note.trim().slice(0, 500), created_by: v.email }).select("*").single();
    if (error) throw new Error(error.message);
    if (!x.writeCheck) return { ok: true };
    try {
    const q = new Qbo(admin, { entity: "Purchase", localId: adv.id });
    const ac = await accounts(q);
    const got = await q.create<{ Id: string; DocNumber?: string }>("Purchase", {
      PaymentType: "Check", AccountRef: { value: ac.bank.Id }, EntityRef: { value: emp.qbo_vendor_id, type: emp.qbo_payee_type === "Employee" ? "Employee" : "Vendor" },
      TxnDate: x.givenOn, PrintStatus: "NeedToPrint", PrivateNote: `Paycheck advance (Payroll Center)${x.note.trim() ? ": " + x.note.trim().slice(0, 200) : ""}`,
      Line: [{ DetailType: "AccountBasedExpenseLineDetail", Amount: amount, Description: "PAYCHECK ADVANCE", AccountBasedExpenseLineDetail: { AccountRef: { value: ac.advance.Id } } }],
    }, `adv${String(adv.id).replace(/-/g, "")}`.slice(0, 50));
    await admin.from("pay_advances").update({ qbo_purchase_id: got.Id }).eq("id", adv.id);
    return { ok: true, data: { doc: got.DocNumber } };
    } catch (e) { return { ok: false, error: `The advance is saved, but the check wasn't made in QuickBooks: ${e instanceof Error ? e.message : String(e)}. Write it there by hand.` }; }
  } catch (e) { return fail(e); }
}
