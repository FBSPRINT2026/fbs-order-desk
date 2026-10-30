import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Qbo, qboConnected } from "@/lib/qbo/client";

/**
 * The business's real numbers from QuickBooks (Oct 30, Nick: "use these real numbers now for the statistics on My Day"):
 * the Profit and Loss by month, last year and this year, read-only. Income is QuickBooks' Total Income (sales less
 * discounts), on the company's own basis (accrual). Kept an hour in qbo_report_cache so pages don't ask Intuit each time.
 */
export type FinMonth = { month: string; income: number; cogs: number; gross: number; expenses: number; net: number };
export type Fin = {
  months: FinMonth[]; fetchedAt: string; basis: string;
  /** last year by month only up to the same day (Jan 1 – Oct 30 last year on Oct 30): the fair comparison for "this month"
   *  and "this year" (Oct 30, 2026: last year's month-end payroll and rent on Oct 31 made this year look 299% up, not 222%) */
  lyToDate?: FinMonth[];
};

type Col = { ColTitle?: string; MetaData?: { Name: string; Value: string }[] };
type Cell = { value?: string };
type Row = { type?: string; group?: string; Rows?: { Row?: Row[] }; Summary?: { ColData?: Cell[] } };
type Report = { Header?: { ReportBasis?: string }; Columns?: { Column?: Col[] }; Rows?: { Row?: Row[] } };

/** read the monthly totals of each P&L section out of QuickBooks' report layout */
export function parseMonthlyPnl(r: Report): FinMonth[] {
  const cols = r.Columns?.Column || [];
  // each month column carries its start date; the first column is the account names and the last the total
  const months = cols.map((c) => c.MetaData?.find((m) => m.Name === "StartDate")?.Value || "").map((d) => (d ? d.slice(0, 7) : ""));
  const sums: Record<string, number[]> = {};
  const walk = (rows: Row[] = []) => {
    for (const x of rows) {
      if (x.group && x.Summary?.ColData) sums[x.group] = x.Summary.ColData.map((c) => parseFloat(c.value || "") || 0);
      if (x.Rows?.Row) walk(x.Rows.Row);
    }
  };
  walk(r.Rows?.Row);
  const at = (g: string, i: number) => sums[g]?.[i] || 0;
  const out: FinMonth[] = [];
  months.forEach((mo, i) => {
    if (!mo || cols[i].ColTitle === "Total") return;
    out.push({ month: mo, income: at("Income", i), cogs: at("COGS", i), gross: at("GrossProfit", i), expenses: at("Expenses", i), net: at("NetIncome", i) });
  });
  return out;
}

/** last year and this year by month (from QuickBooks, or the copy kept within the hour); null when not connected */
export async function monthlyPnl(admin: SupabaseClient, year: number, maxAgeMin = 60): Promise<Fin | null> {
  const key = `pnl-monthly-v2-${year - 1}-${year}`;
  const { data: c } = await admin.from("qbo_report_cache").select("data, fetched_at").eq("key", key).maybeSingle();
  if (c && Date.now() - Date.parse(c.fetched_at) < maxAgeMin * 60000) return c.data as Fin;
  if (!(await qboConnected(admin))) return (c?.data as Fin) || null;
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const q = new Qbo(admin, { entity: "Report" });
    const pnl = (start: string, end: string) => q.request<Report>("GET", "reports/ProfitAndLoss", { params: { start_date: start, end_date: end, summarize_column_by: "Month" }, label: `report ProfitAndLoss by month ${start}..${end}` });
    // the same day last year (Feb 29 → Feb 28)
    const ly = `${year - 1}${today.slice(4)}`, sameDay = Number.isNaN(Date.parse(ly)) || new Date(ly + "T12:00:00Z").toISOString().slice(0, 10) !== ly ? `${year - 1}-02-28` : ly;
    const [r, l] = await Promise.all([pnl(`${year - 1}-01-01`, today), pnl(`${year - 1}-01-01`, sameDay)]);
    const fin: Fin = { months: parseMonthlyPnl(r), lyToDate: parseMonthlyPnl(l), fetchedAt: new Date().toISOString(), basis: r.Header?.ReportBasis || "Accrual" };
    await admin.from("qbo_report_cache").upsert({ key, data: fin, fetched_at: fin.fetchedAt });
    return fin;
  } catch {
    return (c?.data as Fin) || null; // QuickBooks didn't answer: the last copy, if any
  }
}
