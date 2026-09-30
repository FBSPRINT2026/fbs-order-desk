"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent as RMouseEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";

/**
 * Sales at a glance (owners / admins): this month and the year so far against last year, orders and average order,
 * sales by month (this year in FBS blue, last year in light gray behind it), and the top customers (this year or the
 * last 30 days).
 * Sales = invoices by order date (Printavo) and by approval date (orders here); closed quotes, quotes, holders,
 * cancelled and sample jobs never count (the database's sales_lines). Charts: sales by month, year-to-date pace
 * against last year, the last 13 weeks, and sales by account owner this year.
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

type Day = { day: string; sales: number; orders: number };
type Rep = { owner: string; sales: number; orders: number };
type Sales = { rows: M[]; days: Day[]; topYear: Top[]; top30: Top[]; reps: Rep[] };
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const plusDays = (x: Date, n: number) => { const d = new Date(x); d.setDate(d.getDate() + n); return d; };

/** One load shared by every sales widget on the page. */
let cache: { at: number; p: Promise<Sales> } | null = null;
function loadSales(y: number) {
  if (cache && Date.now() - cache.at < 5 * 60000) return cache.p;
  const sb = createClient(), today = new Date(), tomorrow = ymd(plusDays(today, 1));
  const tops = (r: { data: unknown }) => ((r.data || []) as Top[]).map((t) => ({ ...t, sales: +t.sales || 0, orders: +t.orders || 0 }));
  const p = Promise.all([
    sb.rpc("shop_sales_monthly", { p_from: `${y - 1}-01-01` }),
    sb.rpc("shop_sales_daily", { p_from: `${y - 1}-01-01` }),
    sb.rpc("shop_top_customers", { p_from: `${y}-01-01`, p_to: tomorrow, p_limit: 10 }),
    sb.rpc("shop_top_customers", { p_from: ymd(plusDays(today, -29)), p_to: tomorrow, p_limit: 10 }),
    sb.rpc("shop_sales_by_owner", { p_from: `${y}-01-01`, p_to: tomorrow }),
  ]).then(([a, d, ty, t30, rp]) => ({
    rows: ((a.data || []) as { month: string; sales: number; orders: number }[]).map((r) => ({ month: r.month.slice(0, 7), sales: +r.sales || 0, orders: +r.orders || 0 })),
    days: ((d.data || []) as Day[]).map((r) => ({ day: r.day.slice(0, 10), sales: +r.sales || 0, orders: +r.orders || 0 })),
    topYear: tops(ty), top30: tops(t30),
    reps: ((rp.data || []) as Rep[]).map((r) => ({ owner: r.owner || "Unassigned", sales: +r.sales || 0, orders: +r.orders || 0 })),
  }));
  cache = { at: Date.now(), p };
  return p;
}

/** Top customers: this year or the last 30 days (remembered on this computer). */
function TopCustomers({ topYear, top30, y, compact }: { topYear: Top[]; top30: Top[]; y: number; compact?: boolean }) {
  const [range, setRange] = useSticky<"year" | "30">("sales.topRange", "year");
  const top = range === "30" ? top30 : topYear, max = Math.max(1, ...top.map((t) => t.sales));
  return (
    <div className={compact ? "" : "an-top"}>
      <div className="an-ch-h" style={compact ? { marginTop: 6 } : undefined}>
        <b>Top {compact ? "10 " : ""}customers</b><span className="spacer" />
        <span className="an-seg" role="group" aria-label="Top customers for">
          <button type="button" className={range === "year" ? "on" : ""} aria-pressed={range === "year"} onClick={() => setRange("year")}>This year</button>
          <button type="button" className={range === "30" ? "on" : ""} aria-pressed={range === "30"} onClick={() => setRange("30")}>Last 30 days</button>
        </span>
      </div>
      {!top.length ? <div className="db-empty">{range === "30" ? "No sales in the last 30 days." : `No sales in ${y} yet.`}</div> : (
        <ol className={"an-toplist" + (compact ? " an-toplist-sm" : "")}>{top.slice(0, 10).map((t, i) => (
          <li key={t.customer_id}>
            <span className="an-rank">{i + 1}</span>
            <span className="an-tn"><Link href={`/shop/customers/${t.customer_id}`}>{t.name}</Link><span className="an-bar"><span style={{ width: `${(t.sales / max) * 100}%` }} /></span></span>
            <span className="an-tv"><b>{short(t.sales)}</b>{!compact && <span>{t.orders} order{t.orders === 1 ? "" : "s"}</span>}</span>
          </li>
        ))}</ol>
      )}
    </div>
  );
}

/** part: the numbers, the month chart, the top customers, or all three together. */
export default function SalesAnalytics({ part = "all" }: { part?: "all" | "kpis" | "chart" | "top" | "side" | "charts" }) {
  const [data, setData] = useState<Sales | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useSticky("sales.table", false);
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const rows = data?.rows ?? null;

  useEffect(() => { loadSales(y).then(setData); }, [y]);

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
  const W = 560, H = 220, padL = 46, padB = 24, padT = 8;
  const cw = (W - padL) / 12, bw = Math.min(16, (cw - 10) / 2);
  const yv = (n: number) => padT + (H - padT - padB) * (1 - n / v.max);
  const ticks = [0, 0.5, 1].map((f) => v.max * f);

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
  const T = <TopCustomers topYear={data!.topYear} top30={data!.top30} y={y} />;
  if (part === "side") return (
    <div className="an-side">
      <div className="an-side-k"><span>Sales this month</span><b>{money0(v.month)}</b><Delta now={v.month} then={v.monthLY} label={`${MONTHS[m]} ${y - 1}`} /></div>
      <div className="an-side-k"><span>Sales this year</span><b>{money0(v.ytd)}</b><Delta now={v.ytd} then={v.ytdLY} label={`Jan–${MONTHS[m]} ${y - 1}`} /></div>
      <TopCustomers topYear={data!.topYear} top30={data!.top30} y={y} compact />
    </div>
  );
  if (part === "charts") return (
    <div className="an-charts">
      <div className="an-card">{C}</div>
      <div className="an-card"><Pace days={data!.days} y={y} /></div>
      <div className="an-card"><Weeks days={data!.days} /></div>
      <div className="an-card"><Reps reps={data!.reps} y={y} /></div>
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

/* ---------- more charts ---------- */

const doy = (d: string) => { const [yy, mm, dd] = d.split("-").map(Number); return Math.round((Date.UTC(yy, mm - 1, dd) - Date.UTC(yy, 0, 1)) / 86400000); };
const dayName = (y: number, i: number) => new Date(y, 0, 1 + i).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Year-to-date pace: sales added up day by day, this year against last year on the same calendar day. */
function Pace({ days, y }: { days: Day[]; y: number }) {
  const [hov, setHov] = useState<number | null>(null);
  const today = doy(ymd(new Date()));
  const cum = (yy: number) => { const a = new Array(366).fill(0); for (const d of days) if (d.day.startsWith(yy + "-")) a[Math.min(365, doy(d.day))] += d.sales; for (let i = 1; i < 366; i++) a[i] += a[i - 1]; return a; };
  const ty = cum(y), ly = cum(y - 1);
  const max = Math.max(1, ly[365], ty[today]);
  const W = 560, H = 220, padL = 46, padR = 44, padB = 22, padT = 10;
  const xv = (i: number) => padL + ((W - padL - padR) * i) / 365, yv = (n: number) => padT + (H - padT - padB) * (1 - n / max);
  const path = (a: number[], to: number) => a.slice(0, to + 1).map((n, i) => `${i ? "L" : "M"}${xv(i).toFixed(1)},${yv(n).toFixed(1)}`).join("");
  const diff = pct(ty[today], ly[today]);
  const onMove = (e: RMouseEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W; setHov(Math.max(0, Math.min(365, Math.round(((x - padL) / (W - padL - padR)) * 365)))); };
  const h = hov;
  return (
    <div className="an-chart">
      <div className="an-ch-h"><b>Year-to-date pace</b><span className="an-legend"><i className="k1" /> {y} <i className="k2" /> {y - 1}</span></div>
      <div className="an-sub">{short(ty[today])} so far{diff !== null ? <> · <span className={diff >= 0 ? "up" : "down"}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff)}%</span> vs {y - 1} on {dayName(y, today)}</> : null}</div>
      <div className="an-svg-wrap" onMouseLeave={() => setHov(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Sales added up through the year, ${y} against ${y - 1}`} onMouseMove={onMove}>
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={padL} x2={W - padR} y1={yv(max * f)} y2={yv(max * f)} className="an-grid-l" /><text x={padL - 8} y={yv(max * f) + 4} className="an-ax" textAnchor="end">{short(max * f)}</text></g>)}
          {MONTHS.map((mm, i) => <text key={mm} x={xv(doy(`${y}-${String(i + 1).padStart(2, "0")}-15`))} y={H - 5} className="an-ax" textAnchor="middle">{i % 2 ? "" : mm}</text>)}
          <path d={path(ly, 365)} className="an-l2" />
          <path d={path(ty, today)} className="an-l1" />
          <text x={xv(365) + 4} y={yv(ly[365]) + 4} className="an-ax an-lbl">{y - 1}</text>
          <text x={xv(today) + 6} y={yv(ty[today]) + 4} className="an-ax an-lbl now">{y}</text>
          {h !== null && <g><line x1={xv(h)} x2={xv(h)} y1={padT} y2={H - padB} className="an-cross" />{h <= today && <circle cx={xv(h)} cy={yv(ty[h])} r={4} className="an-dot1" />}<circle cx={xv(h)} cy={yv(ly[h])} r={4} className="an-dot2" /></g>}
        </svg>
        {h !== null && (() => { const p = h <= today ? pct(ty[h], ly[h]) : null; return (
          <div className="an-tip" style={{ left: `${(xv(h) / W) * 100}%` }}>
            <b>Through {dayName(y, h)}</b>
            {h <= today && <div><i className="k1" /> {y}: {money0(ty[h])}</div>}
            <div><i className="k2" /> {y - 1}: {money0(ly[h])}</div>
            {p !== null && <div className={p >= 0 ? "up" : "down"}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}%</div>}
          </div>
        ); })()}
      </div>
    </div>
  );
}

/** The last 13 weeks (Monday to Sunday), and the last 30 days against the 30 before. */
function Weeks({ days }: { days: Day[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const now = new Date(), mon = plusDays(now, -((now.getDay() + 6) % 7));
  const weeks = Array.from({ length: 13 }, (_, i) => { const a = plusDays(mon, -7 * (12 - i)), b = plusDays(a, 7), from = ymd(a), to = ymd(b); const ds = days.filter((d) => d.day >= from && d.day < to); return { from, a, sales: ds.reduce((t, d) => t + d.sales, 0), orders: ds.reduce((t, d) => t + d.orders, 0), current: i === 12 }; });
  const sum = (from: Date, to: Date) => { const f = ymd(from), t = ymd(to); return days.filter((d) => d.day >= f && d.day < t).reduce((s2, d) => s2 + d.sales, 0); };
  const tomorrow = plusDays(now, 1), last30 = sum(plusDays(tomorrow, -30), tomorrow), prev30 = sum(plusDays(tomorrow, -60), plusDays(tomorrow, -30)), p = pct(last30, prev30);
  const avg = weeks.slice(0, 12).reduce((t, w) => t + w.sales, 0) / 12;
  const max = Math.max(1, ...weeks.map((w) => w.sales));
  const W = 560, H = 220, padL = 46, padB = 24, padT = 10, cw = (W - padL) / 13, bw = Math.min(26, cw - 8);
  const yv = (n: number) => padT + (H - padT - padB) * (1 - n / max);
  const wk = (d: Date) => d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  return (
    <div className="an-chart">
      <div className="an-ch-h"><b>Weekly sales</b><span className="faint">last 13 weeks</span></div>
      <div className="an-sub">Last 30 days: <b>{money0(last30)}</b>{p !== null ? <> · <span className={p >= 0 ? "up" : "down"}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}%</span> vs the 30 days before</> : null} · <span className="an-avg-k" /> 12-week average {short(avg)}</div>
      <div className="an-svg-wrap" onMouseLeave={() => setHov(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales by week for the last 13 weeks">
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={padL} x2={W} y1={yv(max * f)} y2={yv(max * f)} className="an-grid-l" /><text x={padL - 8} y={yv(max * f) + 4} className="an-ax" textAnchor="end">{short(max * f)}</text></g>)}
          {weeks.map((w, i) => {
            const x = padL + i * cw + (cw - bw) / 2;
            return (
              <g key={w.from} onMouseEnter={() => setHov(i)}>
                <rect x={padL + i * cw} y={padT} width={cw} height={H - padT - padB} className={"an-hit" + (hov === i ? " on" : "")} />
                {w.sales > 0 && <path className={"an-b1" + (w.current ? " an-part" : "")} d={`M${x},${H - padB} V${yv(w.sales) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H - padB} Z`} />}
                {i % 2 === 0 && <text x={padL + i * cw + cw / 2} y={H - 7} className={"an-ax" + (w.current ? " now" : "")} textAnchor="middle">{wk(w.a)}</text>}
              </g>
            );
          })}
          <line x1={padL} x2={W} y1={yv(avg)} y2={yv(avg)} className="an-avg" />
        </svg>
        {hov !== null && (
          <div className="an-tip" style={{ left: `${((padL + hov * cw + cw / 2) / W) * 100}%` }}>
            <b>Week of {weeks[hov].a.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{weeks[hov].current ? " (so far)" : ""}</b>
            <div>{money0(weeks[hov].sales)} · {weeks[hov].orders} order{weeks[hov].orders === 1 ? "" : "s"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sales by account owner this year (the customer's owner here, else the owner on the Printavo order). */
function Reps({ reps, y }: { reps: Rep[]; y: number }) {
  const total = reps.reduce((t, r) => t + r.sales, 0), max = Math.max(1, ...reps.map((r) => r.sales));
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return (
    <div className="an-chart">
      <div className="an-ch-h"><b>Sales by account owner</b><span className="faint">{y} so far</span></div>
      {!reps.length ? <div className="db-empty">No sales yet this year.</div> : (
        <ol className="an-toplist an-reps">{reps.slice(0, 8).map((r) => (
          <li key={r.owner}>
            <span className="an-tn"><span className="an-rep">{cap(r.owner)}</span><span className="an-bar"><span style={{ width: `${(r.sales / max) * 100}%` }} /></span></span>
            <span className="an-tv"><b>{short(r.sales)}</b><span>{total ? Math.round((r.sales / total) * 100) : 0}% · {r.orders} order{r.orders === 1 ? "" : "s"}</span></span>
          </li>
        ))}</ol>
      )}
    </div>
  );
}
