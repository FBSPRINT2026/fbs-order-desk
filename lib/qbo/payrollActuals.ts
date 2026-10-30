import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Qbo } from "@/lib/qbo/client";

/**
 * What a W-2 payroll actually cost, read back from QuickBooks once it's submitted (Oct 30, Nick: "it imports the actual
 * check amounts… there's employee taxes, matching… W-2 employees was this amount, plus FBS taxes equals… total
 * payroll"). Read-only: QuickBooks' General Ledger on the pay date, only its "Payroll Check" transactions:
 *   - Payroll Expenses:Wages        → gross pay
 *   - Payroll Expenses:Taxes        → FBS's (employer) taxes: the Social Security / Medicare match, FUTA, Texas unemployment
 *   - Payroll Liabilities (and subs) → everything held for the agencies: employee withholding + the employer taxes, so
 *                                       employee taxes withheld = liabilities − employer taxes
 *   - the bank account               → the net paychecks
 * Anything else taken out (a Check Advance repayment, other deductions) is gross − employee taxes − net.
 */
export type PayrollActuals = { paychecks: number; gross: number; employeeTaxes: number; deductions: number; net: number; employerTaxes: number;
  people: { name: string; gross: number; net: number; employerTaxes: number }[] };

type Cell = { value?: string; id?: string };
type Row = { type?: string; Header?: { ColData?: Cell[] }; Rows?: { Row?: Row[] }; ColData?: Cell[]; Summary?: { ColData?: Cell[] } };
type Report = { Columns?: { Column?: { ColTitle?: string; ColType?: string; MetaData?: { Name: string; Value: string }[] }[] }; Rows?: { Row?: Row[] } };
type Acct = { Id: string; Name: string; FullyQualifiedName?: string; AccountType?: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/\s*:\s*/g, ":").replace(/\s+/g, " ").trim();

export async function payrollActuals(admin: SupabaseClient, payDate: string, bankName: string): Promise<PayrollActuals | null> {
  const q = new Qbo(admin, { entity: "Payroll" });
  const accts = await q.query<Acct>("Account", "WHERE Active = true", 5000, "Id, Name, FullyQualifiedName, AccountType");
  const fq = (a: Acct) => norm(a.FullyQualifiedName || a.Name);
  const wages = accts.filter((a) => fq(a) === "payroll expenses:wages").map((a) => a.Id);
  const taxes = accts.filter((a) => fq(a) === "payroll expenses:taxes").map((a) => a.Id);
  const liab = accts.filter((a) => fq(a) === "payroll liabilities" || fq(a).startsWith("payroll liabilities:")).map((a) => a.Id);
  const bank = accts.filter((a) => fq(a) === norm(bankName)).map((a) => a.Id);
  if (!wages.length) throw new Error('QuickBooks has no "Payroll Expenses:Wages" account.');
  const kind = new Map<string, "wages" | "taxes" | "liab" | "bank">([...wages.map((i) => [i, "wages"] as const), ...taxes.map((i) => [i, "taxes"] as const), ...liab.map((i) => [i, "liab"] as const), ...bank.map((i) => [i, "bank"] as const)]);

  const rep = await q.request<Report>("GET", "reports/GeneralLedger", {
    params: { start_date: payDate, end_date: payDate, account: [...kind.keys()].join(","), columns: "tx_date,txn_type,name,subt_nat_amount" },
    label: `report GeneralLedger payroll ${payDate}`,
  });
  const cols = (rep.Columns?.Column || []).map((c) => (c.MetaData?.find((m) => m.Name === "ColKey")?.Value || c.ColTitle || "").toLowerCase());
  const at = (k: RegExp) => cols.findIndex((c) => k.test(c));
  const iType = at(/txn_type|transaction type/), iName = at(/^name$/), iAmt = at(/subt_nat_amount|amount/);
  const people = new Map<string, { name: string; gross: number; net: number; employerTaxes: number }>();
  const sums = { wages: 0, taxes: 0, liab: 0, bank: 0 };
  const checks = new Set<string>();
  const walk = (rows: Row[] | undefined, acct: string | null) => {
    for (const row of rows || []) {
      const hid = row.Header?.ColData?.[0]?.id;
      const here = hid && kind.has(hid) ? hid : acct;
      if (row.Rows?.Row) walk(row.Rows.Row, here);
      const cd = row.ColData;
      if (!cd || !here) continue;
      if (!/payroll check/i.test(cd[iType]?.value || "")) continue;
      const amt = +(cd[iAmt]?.value || 0) || 0, name = (cd[iName]?.value || "").trim(), k = kind.get(here)!;
      if (cd[iType]?.id) checks.add(cd[iType].id!);
      sums[k] += amt;
      const p = people.get(name) || { name, gross: 0, net: 0, employerTaxes: 0 };
      if (k === "wages") p.gross += amt; else if (k === "taxes") p.employerTaxes += amt; else if (k === "bank") p.net += -amt;
      people.set(name, p);
    }
  };
  walk(rep.Rows?.Row, null);
  if (!checks.size || !sums.wages) return null;
  const gross = r2(sums.wages), employerTaxes = r2(sums.taxes), employeeTaxes = r2(sums.liab - sums.taxes);
  // the net from the bank when QuickBooks posts paychecks there; else what's left after the taxes
  const net = bank.length && sums.bank ? r2(-sums.bank) : r2(gross - employeeTaxes);
  return {
    paychecks: checks.size, gross, employeeTaxes, net, employerTaxes, deductions: r2(Math.max(0, gross - employeeTaxes - net)),
    people: [...people.values()].map((p) => ({ name: p.name, gross: r2(p.gross), net: r2(p.net), employerTaxes: r2(p.employerTaxes) })).sort((a, b) => b.gross - a.gross),
  };
}
