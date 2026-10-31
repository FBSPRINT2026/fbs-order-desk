/**
 * Every row a query matches, read 1,000 at a time (Oct 31). The database hands back at most 1,000 rows per request,
 * whatever `.limit()` says, so a list read in one go quietly stopped at 1,000: the Time page's pay period (over 1,000
 * punches), a mail folder over 1,000 emails (the rest fetched again every run), 2,500 Printavo jobs on the dashboard,
 * SanMar's 3,000 styles. Use this for any list that can grow past 1,000.
 *
 * The query must have a fixed order (end it with `.order("id")` when nothing else makes the order unique), or a row can
 * land on two pages or none.
 *
 *   const punches = await readAll<Punch>((a, b) => sb.from("time_punches").select("*").gte("at", from).order("at").order("id").range(a, b));
 */
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, max = 100000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < max; i += 1000) {
    const { data, error } = await page(i, i + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** readAll in the `{ data, error }` shape a single query answers with, to drop into a Promise.all in place of one */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows come back untyped, as from the query it replaces
export function allRows<T = any>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, max?: number): Promise<{ data: T[] | null; error: { message: string } | null }> {
  return readAll<T>(page, max).then((data) => ({ data, error: null }), (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }));
}
