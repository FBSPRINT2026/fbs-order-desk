import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches } from "@/lib/qbo/config";
import { Qbo } from "@/lib/qbo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * How Printavo has been filing invoices in QuickBooks (Oct 24, Nick: "I have it set right in Printavo… see what
 * Printavo does and then change that to be your settings"). READ ONLY: queries only, nothing is written to QuickBooks.
 * Counts and names, no customer details: which products / services the invoice lines use (with a few line
 * descriptions), terms, sales tax, custom fields, classes and locations; for payments, the deposit account and
 * payment methods. Same token as the runner (x-sync-token).
 */
type Ref = { value?: string; name?: string } | undefined;
const nm = (r: Ref) => (r ? `${r.name || "?"} [${r.value || ""}]` : "(none)");
function tally<T>(rows: T[], key: (r: T) => string | string[]) {
  const m: Record<string, number> = {};
  for (const r of rows) for (const k of ([] as string[]).concat(key(r))) m[k] = (m[k] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("qbo_settings").select("token").eq("id", 1).maybeSingle();
  if (!s || !tokenMatches(req.headers.get("x-sync-token"), String(s.token))) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const since = new URL(req.url).searchParams.get("since") || new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
  try {
    const q = new Qbo(admin, { entity: "look" });
    type Line = { DetailType?: string; Description?: string; Amount?: number; SalesItemLineDetail?: { ItemRef?: Ref; TaxCodeRef?: Ref; ClassRef?: Ref } };
    type Inv = { DocNumber?: string; TxnDate?: string; Line?: Line[]; SalesTermRef?: Ref; TxnTaxDetail?: { TotalTax?: number; TxnTaxCodeRef?: Ref }; CustomField?: { DefinitionId?: string; Name?: string; StringValue?: string }[]; ClassRef?: Ref; DepartmentRef?: Ref; PrivateNote?: string; CustomerMemo?: { value?: string }; ApplyTaxAfterDiscount?: boolean; GlobalTaxCalculation?: string };
    type Pay = { DepositToAccountRef?: Ref; PaymentMethodRef?: Ref; PrivateNote?: string; Line?: { LinkedTxn?: { TxnType?: string }[] }[] };
    const [taxCodes, taxRates] = await Promise.all([
      q.query<{ Id: string; Name: string; Active: boolean; Taxable?: boolean; TaxGroup?: boolean; SalesTaxRateList?: { TaxRateDetail?: { TaxRateRef?: Ref }[] } }>("TaxCode"),
      q.query<{ Id: string; Name: string; Active: boolean; RateValue?: number; AgencyRef?: Ref }>("TaxRate"),
    ]);
    const [invs, pays, items, terms, methods, prefs, classes, deps, accts, deposits] = await Promise.all([
      q.query<Inv>("Invoice", `WHERE TxnDate >= '${since}'`, 600),
      q.query<Pay>("Payment", `WHERE TxnDate >= '${since}'`, 600),
      q.query<{ Id: string; Name: string; Type: string; Active: boolean; IncomeAccountRef?: Ref; ParentRef?: Ref }>("Item"),
      q.query<{ Id: string; Name: string; DueDays?: number; Active: boolean }>("Term"),
      q.query<{ Id: string; Name: string; Active: boolean }>("PaymentMethod"),
      q.request<{ Preferences?: { SalesFormsPrefs?: { CustomField?: unknown }; TaxPrefs?: unknown; AccountingInfoPrefs?: { ClassTrackingPerTxn?: boolean; TrackDepartments?: boolean } } }>("GET", "preferences"),
      q.query<{ Id: string; Name: string; Active: boolean }>("Class"),
      q.query<{ Id: string; Name: string; Active: boolean }>("Department"),
      q.query<{ Id: string; Name: string; AccountType: string; AccountSubType?: string; Active: boolean }>("Account", "WHERE AccountType IN ('Bank', 'Other Current Asset', 'Expense', 'Other Expense', 'Income')"),
      q.query<{ DepositToAccountRef?: Ref; Line?: { DepositLineDetail?: { AccountRef?: Ref }; Amount?: number }[] }>("Deposit", `WHERE TxnDate >= '${since}'`, 300),
    ]);
    const lines = invs.flatMap((i) => (i.Line || []).filter((l) => l.DetailType === "SalesItemLineDetail"));
    const samples: Record<string, string[]> = {};
    for (const l of lines) {
      const k = nm(l.SalesItemLineDetail?.ItemRef);
      const d = (l.Description || "").replace(/\s+/g, " ").slice(0, 70);
      if (d && (samples[k] = samples[k] || []).length < 4 && !samples[k].includes(d)) samples[k].push(d);
    }
    return NextResponse.json({
      since,
      invoices: invs.length,
      docNumbers: invs.slice(0, 8).map((i) => i.DocNumber),
      lineItems: tally(lines, (l) => nm(l.SalesItemLineDetail?.ItemRef)),
      lineSamples: samples,
      lineTaxCodes: tally(lines, (l) => nm(l.SalesItemLineDetail?.TaxCodeRef)),
      otherLineTypes: tally(invs.flatMap((i) => (i.Line || []).filter((l) => l.DetailType !== "SalesItemLineDetail")), (l) => l.DetailType || "?"),
      terms: tally(invs, (i) => nm(i.SalesTermRef)),
      tax: { withTax: invs.filter((i) => (i.TxnTaxDetail?.TotalTax || 0) > 0).length, taxCodes: tally(invs, (i) => nm(i.TxnTaxDetail?.TxnTaxCodeRef)), globalCalc: tally(invs, (i) => i.GlobalTaxCalculation || "(unset)") },
      customFields: tally(invs, (i) => (i.CustomField || []).filter((f) => f.StringValue).map((f) => `${f.Name || "?"} [${f.DefinitionId}]`)),
      privateNoteUsed: invs.filter((i) => i.PrivateNote).length,
      privateNoteSamples: invs.filter((i) => i.PrivateNote).slice(0, 3).map((i) => (i.PrivateNote || "").replace(/\s+/g, " ").slice(0, 80)),
      classes: tally(invs, (i) => nm(i.ClassRef)),
      departments: tally(invs, (i) => nm(i.DepartmentRef)),
      payments: pays.length,
      depositTo: tally(pays, (p) => nm(p.DepositToAccountRef)),
      paymentMethods: tally(pays, (p) => nm(p.PaymentMethodRef)),
      paymentNoteSamples: pays.filter((p) => p.PrivateNote).slice(0, 4).map((p) => (p.PrivateNote || "").replace(/\s+/g, " ").slice(0, 80)),
      deposits: deposits.length,
      depositAccounts: tally(deposits, (d) => nm(d.DepositToAccountRef)),
      depositLineAccounts: tally(deposits.flatMap((d) => d.Line || []), (l) => nm(l.DepositLineDetail?.AccountRef)),
      taxCodes: taxCodes.map((t) => `${t.Name} [${t.Id}]${t.Active ? "" : " (inactive)"}${t.TaxGroup ? " group" : ""} rates: ${(t.SalesTaxRateList?.TaxRateDetail || []).map((d) => nm(d.TaxRateRef)).join(", ")}`),
      taxRates: taxRates.map((t) => `${t.Name} [${t.Id}] ${t.RateValue ?? "?"}%${t.Active ? "" : " (inactive)"} ${nm(t.AgencyRef)}`),
      items: items.filter((i) => i.Active).map((i) => `${i.Name} [${i.Id}] ${i.Type}${i.IncomeAccountRef ? ` → ${i.IncomeAccountRef.name}` : ""}`),
      terms_list: terms.filter((t) => t.Active).map((t) => `${t.Name} [${t.Id}]${t.DueDays != null ? ` ${t.DueDays}d` : ""}`),
      methods_list: methods.filter((m) => m.Active).map((m) => `${m.Name} [${m.Id}]`),
      classes_list: classes.filter((c) => c.Active).map((c) => `${c.Name} [${c.Id}]`),
      departments_list: deps.filter((c) => c.Active).map((c) => `${c.Name} [${c.Id}]`),
      accounts: accts.filter((a) => a.Active && (a.AccountType !== "Expense" || /fee|merchant|stripe|square|process/i.test(a.Name)) && (a.AccountType !== "Income" || /discount/i.test(a.Name))).map((a) => `${a.Name} [${a.Id}] ${a.AccountType}${a.AccountSubType ? `/${a.AccountSubType}` : ""}`),
      prefs: { customFields: prefs.Preferences?.SalesFormsPrefs?.CustomField, tax: prefs.Preferences?.TaxPrefs, tracking: prefs.Preferences?.AccountingInfoPrefs },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
