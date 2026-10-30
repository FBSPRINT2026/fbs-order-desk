import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, localToIso, mergeTime, payFor, periodOf, r2, timecard, type Employee, type PayLine, type Punch, type TimeOff, type TimeSettings } from "@/lib/timeclock";

/**
 * Payroll Center (Oct 30, Nick): one payday, worked out once. The page shows it and the server builds the QuickBooks
 * checks from the same function, so what Nick sees is what gets written.
 *
 * - W-2 people (paid_by "payroll") go into QuickBooks Payroll: regular and overtime hours, a bonus, and the advance to
 *   take out (Employee deductions). Salaried W-2 pay is filled by QuickBooks itself.
 * - Contractors (paid_by "contract") get a Print-later check from Bank Of America, laid out like Nick's own:
 *   Subcontractors - COS "REGULAR PAY", "OVERTIME" (1.5×), "BONUS", and Repayment:Check Advance as a minus line.
 *   A salaried contractor's check is the salary's share of the period (salary ÷ 26), every payday the same.
 * - Paycheck advances come out of each check by their plan ("$250 a check", or "over 2 checks") until paid off.
 * - Anyone marked "Leave out of the Payroll Center" (payday_skip) isn't listed.
 */
export const PAY_ACCOUNTS = { bank: "Bank Of America", labor: "Subcontractors - COS", advance: "Repayment:Check Advance" } as const;

export type Advance = { id: string; employee_id: string; amount: number; given_on: string; per_check: number | null; checks: number | null; note: string; closed_at: string | null; qbo_purchase_id?: string | null; created_at?: string };
export type AdvancePayment = { id?: string; advance_id: string; period_start: string; amount: number };
export type PaydayLine = { period_start: string; employee_id: string; bonus: number | null; advance_amount: number | null; qbo_purchase_id: string | null; check_total: number | null; check_made_at: string | null; check_made_by?: string | null; done_at: string | null; keyed?: Keyed | null };
export type PayEmployee = Employee & { payday_skip?: boolean; qbo_vendor_id?: string | null; qbo_vendor_name?: string | null; qbo_payee_type?: string | null; check_setup?: CheckSetup | null };
/** a line on a check: Subcontractors - COS (labor), Repayment:Check Advance (advance), or a QuickBooks account by name */
export type CheckLine = { account: "labor" | "advance" | "named"; acct?: string; desc: string; amount: number };
/**
 * A person's own check layout (Oct 30, Nick on Linda McCoy: "key in her hours… her miles on her truck and on her car, and
 * then tolls… on the gas reimbursement, I should be able to key in the miles or the dollar amount"): hours typed in on
 * payday instead of the time clock, the QuickBooks account their pay goes on, and extra lines. An extra with `per` is
 * mileage ("Gas Reimbursement Car - 406 @ $0.15"), typed as miles or as dollars; without, a dollar amount ("Tolls").
 */
export type CheckSetup = { keyedHours?: boolean; payAccount?: string; payDesc?: string; extras?: { key: string; label: string; per?: number | null; account: string }[] };
/** what was typed for one payday: the hours, and each extra as miles or dollars */
/** what was typed for one payday: the hours, and each extra as miles (at its rate, or a rate typed for this check) or dollars */
export type Keyed = { hours?: number | null; extras?: Record<string, { mode?: "miles" | "dollars"; miles?: number | null; amount?: number | null; per?: number | null }> };
const money2 = (n: number) => `$${n.toFixed(2)}`;
/** an extra line's description and amount, the way Nick writes them ("Gas Reimbursement Truck - 0 @ $0.20" for a dollar amount) */
export function extraLine(x: NonNullable<CheckSetup["extras"]>[number], v: NonNullable<Keyed["extras"]>[string] | undefined): CheckLine {
  if (x.per == null) return { account: "named", acct: x.account, desc: x.label, amount: r2(+(v?.amount || 0)) };
  // the rate per mile: their usual, or one typed for this check (Oct 30, Nick: "edit the cost per mile… 25 cents or 40 cents")
  const per = v?.per != null && +v.per > 0 ? +v.per : x.per;
  const miles = v?.mode === "dollars" ? 0 : Math.max(0, Math.round(+(v?.miles || 0) * 10) / 10);
  const amount = v?.mode === "dollars" ? r2(+(v?.amount || 0)) : r2(miles * per);
  return { account: "named", acct: x.account, desc: `${x.label} - ${miles} @ ${money2(per)}`, amount };
}
export type AdvanceDue = { advance: Advance; left: number; take: number };
export type PaydayRow = {
  e: PayEmployee; kind: "payroll" | "contract"; pay: PayLine; issues: number;
  bonus: number; line: PaydayLine | null;
  /** the advances coming out of this check, oldest first; `take` sums to `advance` */
  advances: AdvanceDue[]; advance: number; planned: number;
  /** a contractor's check, line by line (empty for W-2) */
  check: CheckLine[]; total: number;
  /** hours keyed in, with their own check layout (employees.check_setup) */
  keyed: boolean;
};

/** a payday closed out in the Payroll Center (Payroll finished): who, when, what it paid */
export type Payday = { period_start: string; pay_date: string; closed_at: string | null; closed_by: string; w2_count: number; checks: number; checks_total: number; advances_total: number; note: string;
  /** read back from QuickBooks after the W-2 payroll is submitted (Oct 30): its paychecks, gross, the taxes withheld, other
   *  deductions, the net, and FBS's own (employer) taxes */
  w2_paychecks?: number | null; w2_gross?: number | null; w2_employee_taxes?: number | null; w2_deductions?: number | null; w2_net?: number | null; w2_employer_taxes?: number | null; qbo_pulled_at?: string | null };

/** the pay date: the day after the period ends (Oct 16 – Oct 29 → Fri Oct 30) */
export const payDateOf = (periodEnd: string) => addDays(periodEnd, 1);

/** what's left on an advance before this payday (payments from other paydays) */
export function advanceLeft(a: Advance, pays: AdvancePayment[], periodStart: string) {
  return r2(+a.amount - pays.filter((p) => p.advance_id === a.id && p.period_start !== periodStart).reduce((s, p) => s + +p.amount, 0));
}
/** the plan's amount per check */
export const perCheck = (a: Advance) => (a.per_check && +a.per_check > 0 ? +a.per_check : a.checks && a.checks > 0 ? Math.ceil((+a.amount / a.checks) * 100) / 100 : +a.amount);
export const planLabel = (a: Advance) => (a.per_check && +a.per_check > 0 ? `$${(+a.per_check).toFixed(2).replace(/\.00$/, "")} a check` : a.checks && a.checks > 0 ? `Over ${a.checks} check${a.checks === 1 ? "" : "s"}` : "All on the next check");

/** the advances one person repays this payday: the plan, or the amount typed in (spread oldest first) */
export function advancesFor(employeeId: string, advances: Advance[], pays: AdvancePayment[], periodStart: string, payDate: string, override: number | null): { due: AdvanceDue[]; planned: number; take: number } {
  // an advance comes out starting with the first payday after it's given (one given on payday waits for the next);
  // one already repaid on this payday stays listed
  const mine = advances
    .filter((a) => a.employee_id === employeeId && a.given_on < payDate && (!a.closed_at || pays.some((p) => p.advance_id === a.id && p.period_start === periodStart)))
    .sort((a, b) => a.given_on.localeCompare(b.given_on) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const due = mine.map((a) => { const left = advanceLeft(a, pays, periodStart); return { advance: a, left, take: Math.max(0, Math.min(left, perCheck(a))) }; }).filter((d) => d.left > 0.004);
  const planned = r2(due.reduce((s, d) => s + d.take, 0));
  if (override != null) {
    let rest = Math.max(0, override);
    for (const d of due) { d.take = r2(Math.min(d.left, rest)); rest = r2(rest - d.take); }
  }
  return { due, planned, take: r2(due.reduce((s, d) => s + d.take, 0)) };
}

/** a contractor's check, laid out like Nick's (Oct 30): REGULAR PAY, OVERTIME, BONUS, then the advance as a minus line */
export function checkLines(pay: PayLine, bonus: number, advance: number): CheckLine[] {
  const out: CheckLine[] = [];
  const reg = r2((pay.regPay || 0) + (pay.offPay || 0));
  if (reg > 0) out.push({ account: "labor", desc: "REGULAR PAY", amount: reg });
  if ((pay.otPay || 0) > 0) out.push({ account: "labor", desc: "OVERTIME", amount: r2(pay.otPay || 0) });
  if (bonus > 0) out.push({ account: "labor", desc: "BONUS", amount: r2(bonus) });
  if (advance > 0) out.push({ account: "advance", desc: "PAYCHECK ADVANCE REPAYMENT", amount: -r2(advance) });
  return out;
}

/** a check in a person's own layout: their pay on their account (no description, as Nick writes it), each extra line, a bonus,
 *  and an advance repayment as a minus line */
export function setupLines(setup: CheckSetup, pay: PayLine, bonus: number, advance: number, keyed: Keyed | null): CheckLine[] {
  const out: CheckLine[] = [];
  const acct = setup.payAccount || "";
  out.push(acct ? { account: "named", acct, desc: setup.payDesc || "", amount: r2(pay.regPay || 0) } : { account: "labor", desc: "REGULAR PAY", amount: r2(pay.regPay || 0) });
  for (const x of setup.extras || []) out.push(extraLine(x, keyed?.extras?.[x.key]));
  if (bonus > 0) out.push(acct ? { account: "named", acct, desc: "BONUS", amount: r2(bonus) } : { account: "labor", desc: "BONUS", amount: r2(bonus) });
  if (advance > 0) out.push({ account: "advance", desc: "PAYCHECK ADVANCE REPAYMENT", amount: -r2(advance) });
  return out;
}

/** everyone on this payday, W-2 in QuickBooks' list order (last name), then contractors */
export function paydayRows(x: {
  settings: TimeSettings; start: string; end: string; employees: PayEmployee[]; punches: Punch[]; offs: TimeOff[];
  rates: Record<string, { rate: number | null; salary: number | null }>; lines: PaydayLine[]; advances: Advance[]; pays: AdvancePayment[];
}): PaydayRow[] {
  const payDate = payDateOf(x.end);
  const worked = new Set([...x.punches.filter((p) => !p.voided).map((p) => p.employee_id), ...x.offs.filter((o) => o.status === "approved").map((o) => o.employee_id)]);
  const owes = new Set(x.advances.filter((a) => !a.closed_at).map((a) => a.employee_id));
  const lineOf = new Map(x.lines.map((l) => [l.employee_id, l]));
  return x.employees
    // anyone whose hours are keyed in (their own check layout) is on every payday while active
    .filter((e) => !e.payday_skip && (worked.has(e.id) || lineOf.has(e.id) || (e.active && (e.pay_type === "salary" || owes.has(e.id) || !!e.check_setup?.keyedHours))))
    .map((e) => {
      const setup = e.check_setup?.keyedHours ? e.check_setup : null;
      const line = lineOf.get(e.id) || null;
      const c = timecard(x.settings, e.id, x.punches, x.offs, x.start, x.end);
      const rate = x.rates[e.id]?.rate != null ? +x.rates[e.id].rate! : null;
      // keyed hours: what was typed, at their rate; no overtime, and the time clock doesn't apply
      const hrs = setup ? Math.max(0, r2(+(line?.keyed?.hours || 0))) : 0;
      const pay: PayLine = setup ? { regHours: hrs, otHours: 0, offHours: 0, rate, salary: null, regPay: rate != null ? r2(hrs * rate) : null, otPay: 0, offPay: 0, total: rate != null ? r2(hrs * rate) : null } : payFor(x.settings, c, x.rates[e.id], e.pay_type);
      const bonus = line?.bonus ? +line.bonus : 0;
      const a = advancesFor(e.id, x.advances, x.pays, x.start, payDate, line?.advance_amount != null ? +line.advance_amount : null);
      const kind = (e.paid_by || "payroll") as PaydayRow["kind"];
      const check = kind !== "contract" ? [] : setup ? setupLines(setup, pay, bonus, a.take, line?.keyed || null) : checkLines(pay, bonus, a.take);
      return { e, kind, pay, issues: setup ? 0 : c.issues.length, bonus, line, advances: a.due, advance: a.take, planned: a.planned, check, total: r2(check.reduce((s, l) => s + l.amount, 0)), keyed: !!setup };
    })
    .filter((r) => r.keyed || r.pay.regHours + r.pay.otHours + r.pay.offHours > 0 || r.e.pay_type === "salary" || r.advance > 0 || r.line)
    // contractors with their own check layout come last (Oct 30, Nick: "make her the last one")
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "payroll" ? -1 : 1) || +a.keyed - +b.keyed || (a.e.last_name || a.e.first_name).localeCompare(b.e.last_name || b.e.first_name) || a.e.first_name.localeCompare(b.e.first_name));
}

/** a QuickBooks payee picked by name: every part of the person's first and last name appears in it ("Jose Garcia" → "Jose Isidro Garcia Gamez") */
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
export function guessPayee<T extends { name: string }>(e: Pick<Employee, "first_name" | "last_name">, payees: T[]): T | null {
  const want = [...words(e.first_name).slice(0, 1), ...words(e.last_name)];
  if (!want.length) return null;
  const hits = payees.filter((p) => { const have = new Set(words(p.name)); return want.every((w) => have.has(w)); });
  if (hits.length === 1) return hits[0];
  // several: the one whose name is exactly theirs
  const exact = hits.filter((p) => words(p.name).join(" ") === [...words(e.first_name), ...words(e.last_name)].join(" "));
  return exact.length === 1 ? exact[0] : null;
}

/** one payday's data, read the same way by the page (signed-in client) and the server (before it writes a check) */
export async function loadPayday(sb: SupabaseClient, start: string) {
  const { data: s } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeTime((s?.data as { time?: unknown } | null)?.time);
  const p = periodOf(settings, start);
  const punches: Punch[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from("time_punches").select("*").gte("at", localToIso(addDays(p.start, -1), 0)).lt("at", localToIso(addDays(p.end, 2), 0)).order("at").order("id").range(i, i + 999);
    if (error) throw new Error(error.message);
    punches.push(...((data || []) as Punch[]));
    if (!data || data.length < 1000) break;
  }
  const [{ data: emps }, { data: offs }, { data: rates }, { data: lines }, { data: advs }, { data: pays }, { data: closed }] = await Promise.all([
    sb.from("employees").select("*").order("last_name").order("first_name"),
    sb.from("time_off").select("*").lte("starts_on", p.end).gte("ends_on", p.start),
    sb.from("employee_pay").select("employee_id, rate, salary"),
    sb.from("payday_lines").select("*").eq("period_start", p.start),
    sb.from("pay_advances").select("*").order("given_on", { ascending: false }),
    sb.from("pay_advance_payments").select("*"),
    // closed out (Payroll finished, Oct 30): who and when
    sb.from("paydays").select("*").eq("period_start", p.start).maybeSingle(),
  ]);
  const employees = (emps || []) as PayEmployee[], advances = (advs || []) as Advance[], payments = (pays || []) as AdvancePayment[];
  const rows = paydayRows({
    settings, start: p.start, end: p.end, employees, punches, offs: (offs || []) as TimeOff[],
    rates: Object.fromEntries(((rates || []) as { employee_id: string; rate: number | null; salary: number | null }[]).map((x) => [x.employee_id, x])),
    lines: (lines || []) as PaydayLine[], advances, pays: payments,
  });
  return { settings, p, payDate: payDateOf(p.end), rows, employees, advances, payments, closed: (closed as Payday | null)?.closed_at ? (closed as Payday) : null, record: (closed as Payday | null) || null };
}
