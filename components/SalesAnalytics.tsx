"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sales at a glance (owners / admins): this month and the year so far against last year, orders and average order,
 * sales by month (this year in FBS blue, last year in light gray behind it), and the top customers over 12 months.
 * Sales = invoices by order date (Printavo) and by approval date (orders here).
 */

type M = { month: string; sales: number; orders: number };
type Top = { customer_id: string; name: string; sales: number; orders: number };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const short = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

function Delta({ now, then, label }: { now: number; then: number; label: string }) {
  const p = pct(now, then);
  if (p === null) return <span className="an-d">no {label} to compare</span>;
  return <span className={"an-d " + (p >= 0 ? "up" : "down")}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}% <span>vs {label}</span></span>;
}

/** One load shared by every sales widget on the page. */
let cache: { at: number; p: Promise<{ rows: M[]; top: Top[] }> } | null = null;
function loadSales(y: number) {
  if (cache && Date.now() - cache.at < 5 * 60000) return cache.p;
  const sb = createClient();
  const yearAgo = new Date(); yearAgo.setFullYear(y - 1);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const p = Promise.all([
    sb.rpc("shop_sales_monthly", { p_from: `${y - 1}-01-01` }),
    sb.rpc("shop_top_customers", { p_from: d(yearAgo), p_to: d(tomorrow), p_limit: 10 }),
  ]).then(([a, b]) => ({
    rows: ((a.data || []) as { month: string; sales: number; orders: number }[]).map((r) => ({ month: r.month.slice(0, 7), sales: +r.sales || 0, orders: +r.orders || 0 })),
    top: ((b.data || []) as Top[]).map((t) => ({ ...t, sales: +t.sales || 0, orders: +t.orders || 0 })),
  }));
  cache = { at: Date.now(), p };
  return p;
}

/** part: the numbers, the month chart, the top customers, or all three together. */
export default function SalesAnalytics({ part = "all" }: { part?: "all" | "kpis" | "chart" | "top" | "side" }) {
  const [rows, setRows] = useState<M[] | null>(null);
  const [top, setTop] = useState<Top[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();

  useEffect(() => { loadSales(y).then((r) => { setRows(r.rows); setTop(r.top); }); }, [y]);

  const v = useMemo(() => {
    if (!rows) return null;
    const get = (yy: number, mm: number) => rows.find((r) => r.month === `${yy}-${String(mm + 1).padStart(2, "0")}`) || { month: "", sales: 0, orders: 0 };
    const thisYear = MONTHS.map((_, i) => get(y, i)), lastYear = MONTHS.map((_, i) => get(y - 1, i));
    const sum = (a: M[], to: number) => a.slice(0, to).reduce((s, r) => s + r.sales, 0);
    const cnt = (a: M[], to: number) => a.slice(0, to).reduce((s, r) => s + r.orders, 0);
    const last12 = [...lastYear.slice(m + 1), ...thisYear.slice(0, m + 1)];
    const s12 = last12.reduce((s, r) => s + r.sales, 0), o12 = last12.reduce((s, r) => s + r.orders, 0);
    return {
      thisYear, lastYear,
      month: thisYear[m].sales, monthLY: lastYear[m].sales, ordersMonth: thisYear[m].orders, ordersMonthLY: lastYear[m].orders,
      ytd: sum(thisYear, m + 1), ytdLY: sum(lastYear, m + 1), ordersYtd: cnt(thisYear, m + 1),
      aov: o12 ? s12 / o12 : 0, s12,
      max: Math.max(1, ...thisYear.map((r) => r.sales), ...lastYear.map((r) => r.sales)),
      // gaps in last year's data (the Printavo import is still filling in older months)
      lyEmpty: lastYear.slice(0, m + 1).filter((r) => !r.orders).length,
    };
  }, [rows, y, m]);

  if (!v) return <div className="db-empty">Loading sales…</div>;
  // chart geometry
  const W = 720, H = 220, padL = 46, padB = 24, padT = 8;
  const cw = (W - padL) / 12, bw = Math.min(16, (cw - 10) / 2);
  const yv = (n: number) => padT + (H - padT - padB) * (1 - n / v.max);
  const ticks = [0, 0.5, 1].map((f) => v.max * f);
  const topMax = Math.max(1, ...top.map((t) => t.sales));

  const K = (
      <div className="an-kpis">
        <div><span>Sales this month</span><b>{money0(v.month)}</b><Delta now={v.month} then={v.monthLY} label={`${MONTHS[m]} ${y - 1}`} /></div>
        <div><span>Sales this year</span><b>{money0(v.ytd)}</b><Delta now={v.ytd} then={v.ytdLY} label={`Jan–${MONTHS[m]} ${y - 1}`} /></div>
        <div><span>Orders this month</span><b>{v.ordersMonth}</b><Delta now={v.ordersMonth} then={v.ordersMonthLY} label={`${MONTHS[m]} ${y - 1}`} /></div>
        <div><span>Average order · 12 months</span><b>{money0(v.aov)}</b><span className="an-d">{money0(v.s12)} in the last 12 months</span></div>
      </div>

  );
  const C = (
        <div className="an-chart">
          <div className="an-ch-h">
            <b>Sales by month</b>
            <span className="an-legend"><i className="k1" /> {y} <i className="k2" /> {y - 1}</span>
            <span className="spacer" />
            <button type="button" className="linkbtn" onClick={() => setTable((x) => !x)}>{table ? "Show chart" : "Show as table"}</button>
          </div>
          {table ? (
            <div style={{ overflowX: "auto" }}><table className="rv-tbl an-tbl">
              <thead><tr><th>Month</th><th className="r">{y}</th><th className="r">{y - 1}</th><th className="r">Change</th></tr></thead>
              <tbody>{MONTHS.map((mm, i) => { const p = pct(v.thisYear[i].sales, v.lastYear[i].sales); return (
                <tr key={mm}><td>{mm}</td><td className="r">{i <= m ? money0(v.thisYear[i].sales) : "—"}</td><td className="r">{money0(v.lastYear[i].sales)}</td><td className="r">{i <= m && p !== null ? `${p >= 0 ? "+" : ""}${p}%` : "—"}</td></tr>
              ); })}</tbody>
            </table></div>
          ) : (
            <div className="an-svg-wrap" onMouseLeave={() => setHover(null)}>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sales by month, ${y} compared with ${y - 1}`}>
                {ticks.map((t, i) => (
                  <g key={i}><line x1={padL} x2={W} y1={yv(t)} y2={yv(t)} className="an-grid-l" /><text x={padL - 8} y={yv(t) + 4} className="an-ax" textAnchor="end">{short(t)}</text></g>
                ))}
                {MONTHS.map((mm, i) => {
                  const x0 = padL + i * cw + (cw - (bw * 2 + 2)) / 2;
                  const ly = v.lastYear[i].sales, ty = i <= m ? v.thisYear[i].sales : 0;
                  const bar = (x: number, val: number, cls: string) => val > 0 ? <path className={cls} d={`M${x},${H - padB} V${yv(val) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - padB} Z`} /> : null;
                  return (
                    <g key={mm} onMouseEnter={() => setHover(i)}>
                      <rect x={padL + i * cw} y={padT} width={cw} height={H - padT - padB} className={"an-hit" + (hover === i ? " on" : "")} />
                      {bar(x0, ly, "an-b2")}
                      {bar(x0 + bw + 2, ty, "an-b1")}
                      <text x={padL + i * cw + cw / 2} y={H - 6} className={"an-ax" + (i === m ? " now" : "")} textAnchor="middle">{mm}</text>
                    </g>
                  );
                })}
              </svg>
              {hover !== null && (() => { const p = pct(v.thisYear[hover].sales, v.lastYear[hover].sales); return (
                <div className="an-tip" style={{ left: `${((padL + hover * cw + cw / 2) / W) * 100}%` }}>
                  <b>{MONTHS[hover]}</b>
                  <div><i className="k1" /> {y}: {hover <= m ? money0(v.thisYear[hover].sales) : "—"}{hover <= m ? ` · ${v.thisYear[hover].orders} orders` : ""}</div>
                  <div><i className="k2" /> {y - 1}: {money0(v.lastYear[hover].sales)} · {v.lastYear[hover].orders} orders</div>
                  {hover <= m && p !== null && <div className={p >= 0 ? "up" : "down"}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}%</div>}
                </div>
              ); })()}
            </div>
          )}
          {v.lyEmpty > 0 && <p className="an-note">Some of {y - 1} is still coming in from Printavo (the import is filling in older orders), so the comparison will fill in as it finishes.</p>}
        </div>

  );
  const T = (
        <div className="an-top">
          <div className="an-ch-h"><b>Top customers</b><span className="faint">last 12 months</span></div>
          {!top.length ? <div className="db-empty">No sales yet.</div> : (
            <ol className="an-toplist">{top.map((t, i) => (
              <li key={t.customer_id}>
                <span className="an-rank">{i + 1}</span>
                <span className="an-tn"><Link href={`/shop/customers/${t.customer_id}`}>{t.name}</Link><span className="an-bar"><span style={{ width: `${(t.sales / topMax) * 100}%` }} /></span></span>
                <span className="an-tv"><b>{short(t.sales)}</b><span>{t.orders} order{t.orders === 1 ? "" : "s"}</span></span>
              </li>
            ))}</ol>
          )}
        </div>
  );
  if (part === "side") return (
    <div className="an-side">
      <div className="an-side-k"><span>Sales this month</span><b>{money0(v.month)}</b><Delta now={v.month} then={v.monthLY} label={`${MONTHS[m]} ${y - 1}`} /></div>
      <div className="an-side-k"><span>Sales this year</span><b>{money0(v.ytd)}</b><Delta now={v.ytd} then={v.ytdLY} label={`Jan–${MONTHS[m]} ${y - 1}`} /></div>
      <div className="an-ch-h" style={{ marginTop: 6 }}><b>Top 10 customers</b><span className="faint">last 12 months</span></div>
      {!top.length ? <div className="db-empty">No sales yet.</div> : (
        <ol className="an-toplist an-toplist-sm">{top.slice(0, 10).map((t, i) => (
          <li key={t.customer_id}>
            <span className="an-rank">{i + 1}</span>
            <span className="an-tn"><Link href={`/shop/customers/${t.customer_id}`}>{t.name}</Link><span className="an-bar"><span style={{ width: `${(t.sales / topMax) * 100}%` }} /></span></span>
            <span className="an-tv"><b>{short(t.sales)}</b></span>
          </li>
        ))}</ol>
      )}
    </div>
  );
  if (part === "kpis") return K;
  if (part === "chart") return C;
  if (part === "top") return T;
  return (
    <section className="an">
      <div className="an-h"><h2>Sales</h2><span className="faint">invoices, by order date · Printavo + this system</span></div>
      {K}
      <div className="an-grid">{C}{T}</div>
    </section>
  );
}
