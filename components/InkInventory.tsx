"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { mergeProduction, needsForPrintavo } from "@/lib/production";
import {
  DEFAULT_INK_PLAN, densityOf, fmtVol, gramsFrom, inkStatus, jobsFromOrders, jobsFromPrintavo, mergeInkPlan, planUsage,
  type CountLite, type FormulaLite, type GarmentFabric, type InkPlanSettings, type InkStatus, type Job, type StockLite,
} from "@/lib/inkPlan";

/**
 * Ink Room → Inventory: what's on the shelf (the last count, less the ink of screen jobs finished since), what the
 * scheduled jobs will use, the day each ink runs short, and what to order. "Take inventory" is the Monday-morning count;
 * "Adjust" fixes one ink any time. Estimates: lib/inkPlan.ts.
 */
type Unit = "gal" | "qt" | "lb" | "g";
const SECTION_TITLE: Record<string, string> = { rfu: "Wilflex Rio RFU", color: "Other stock colors", base: "Whites, bases & additives", mixing: "Ink mixing system (Rio Mix)" };
const ORDER = ["rfu", "color", "base", "mixing"];
const localDay = (d = new Date()) => d.toLocaleDateString("en-CA");
const dayName = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const when = (t: string) => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function InkInventory({ stock, formulas, canStock }: { stock: StockLite[]; formulas: FormulaLite[]; canStock: boolean }) {
  const [counts, setCounts] = useState<CountLite[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [plan, setPlan] = useState<InkPlanSettings>(DEFAULT_INK_PLAN);
  const [err, setErr] = useState(""), [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "count" | "settings">("view");
  const [draft, setDraft] = useState<Record<string, { amt: string; unit: Unit }>>({});
  const [adj, setAdj] = useState<{ id: string; amt: string; unit: Unit } | null>(null);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState("");
  const [show, setShow] = useSticky<"all" | "needed">("inks.inv.show", "all");
  const today = localDay();

  async function loadCounts() {
    const { data, error } = await createClient().from("ink_counts").select("stock_ink_id, grams, counted_at, counted_by, kind").order("counted_at", { ascending: false }).limit(3000);
    if (error) setErr(error.message); else setCounts((data || []) as CountLite[]);
  }
  useEffect(() => { loadCounts(); }, []);

  // the schedule: screen jobs from a month back (finished ones count against the last inventory) to the planning horizon
  useEffect(() => {
    if (!counts) return;
    (async () => {
      const sb = createClient();
      const { data: st } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
      const d = (st?.data || {}) as { inkPlan?: unknown; production?: unknown };
      const s = mergeInkPlan(d.inkPlan); setPlan(s);
      const last = counts.reduce((a, c) => (c.counted_at < a ? c.counted_at : a), today);
      const from = new Date(Math.min(new Date(last).getTime(), Date.now() - 30 * 864e5)).toLocaleDateString("en-CA");
      const end = new Date(); end.setDate(end.getDate() + s.horizonDays + 14);
      const { data: slots, error } = await sb.from("production_slots").select("order_id, archived_order_id, day, status, finished_at, locations, label").eq("kind", "screen").gte("day", from).lte("day", localDay(end));
      if (error) { setErr(error.message); return; }
      const sl = (slots || []) as Parameters<typeof jobsFromOrders>[0];
      const oIds = [...new Set(sl.map((x) => x.order_id).filter(Boolean))] as string[];
      const aIds = [...new Set(sl.map((x) => x.archived_order_id).filter(Boolean))] as string[];
      const [o, sp, ar] = await Promise.all([
        oIds.length ? sb.from("orders").select("id, number, nickname, groups").in("id", oIds) : Promise.resolve({ data: [] }),
        oIds.length ? sb.from("separations").select("order_id, imprint_id, garment_color, location, design_id, status, settings, channels").in("order_id", oIds) : Promise.resolve({ data: [] }),
        aIds.length ? sb.from("archived_orders").select("id, visual_id, nickname, qty, status_name, data").in("id", aIds) : Promise.resolve({ data: [] }),
      ]);
      const orders = (o.data || []) as Parameters<typeof jobsFromOrders>[1];
      const imDesigns = [...new Set(orders.flatMap((x) => (x.groups || []).flatMap((g) => (g.imprints || []).map((i) => i.design_id))).filter(Boolean))] as string[];
      // the same art's separations on other orders give the coverage until a job's own are made
      const { data: same } = imDesigns.length ? await sb.from("separations").select("order_id, imprint_id, garment_color, location, design_id, status, settings, channels").in("design_id", imDesigns).neq("status", "cancelled").order("updated_at", { ascending: false }).limit(300) : { data: [] };
      const seps = [...(sp.data || []), ...(same || [])] as Parameters<typeof jobsFromOrders>[2];
      const dIds = [...new Set([...seps.map((x) => x.design_id), ...orders.flatMap((x) => (x.groups || []).flatMap((g) => (g.imprints || []).map((i) => i.design_id)))].filter(Boolean))] as string[];
      const { data: designs } = dIds.length ? await sb.from("designs").select("id, width_px, height_px, art_box").in("id", dIds) : { data: [] };
      const styles = [...new Set(orders.flatMap((x) => (x.groups || []).flatMap((g) => (g.lines || []).map((l) => (l as { style?: string }).style || ""))).filter(Boolean))];
      const { data: gar } = styles.length ? await sb.from("garments").select("style, brand, fabric, supplier").in("style", styles) : { data: [] };
      const ps = mergeProduction(d.production);
      type Arch = Parameters<typeof jobsFromPrintavo>[1][number] & { qty: number | null; status_name: string };
      const pv = jobsFromPrintavo(sl, (ar.data || []) as Arch[], (r) => needsForPrintavo(ps, { ...(r as Arch), nickname: r.nickname || "" } as Parameters<typeof needsForPrintavo>[1]).filter((n) => n.type === "screen").flatMap((n) => n.steps), s);
      setJobs([...jobsFromOrders(sl, orders, seps, (designs || []) as Parameters<typeof jobsFromOrders>[3], s, (gar || []) as GarmentFabric[]), ...pv]);
    })();
  }, [counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useMemo(() => { const m = new Map<string, CountLite>(); for (const c of counts || []) if (!m.has(c.stock_ink_id)) m.set(c.stock_ink_id, c); return m; }, [counts]);
  const lastSession = (counts || []).find((c) => c.kind === "count");
  const rows = useMemo(() => {
    if (!jobs) return null;
    const needs = planUsage(jobs, stock, formulas, plan);
    const out: { section: string; st: InkStatus; key: string }[] = [];
    for (const x of stock.filter((x) => x.stocked)) out.push({ section: x.section, key: x.id, st: inkStatus(x, needs.get(x.id) || null, latest.get(x.id) || null, today, plan) });
    for (const [k, n] of needs) if (k.startsWith("x:") && n.uses.some((u) => !u.done && u.day >= today)) out.push({ section: "other", key: k, st: inkStatus(null, n, null, today, plan) });
    return out;
  }, [jobs, stock, formulas, plan, latest, today]);
  const alerts = (rows || []).filter((r) => r.st.stock && r.st.runsOut).sort((a, b) => a.st.runsOut!.day.localeCompare(b.st.runsOut!.day));
  const toOrder = (rows || []).filter((r) => r.st.stock && r.st.order);

  async function saveCount() {
    const entries = Object.entries(draft).filter(([, v]) => v.amt.trim() !== "" && !isNaN(+v.amt));
    if (!entries.length) { setSaved("Enter at least one amount."); return; }
    setBusy(true);
    const sb = createClient(), { data: u } = await sb.auth.getUser(), session = crypto.randomUUID();
    const byId = new Map(stock.map((x) => [x.id, x]));
    const { error } = await sb.from("ink_counts").insert(entries.map(([id, v]) => ({ stock_ink_id: id, grams: Math.max(0, gramsFrom(+v.amt, v.unit, densityOf(byId.get(id)?.name || ""))), entered: `${v.amt} ${v.unit}`, kind: "count", session, counted_by: u.user?.email || "" })));
    setBusy(false);
    if (error) { setSaved(error.message); return; }
    setDraft({}); setMode("view"); setSaved(`Inventory saved: ${entries.length} inks counted.`); setJobs(null); loadCounts();
  }
  async function saveAdjust() {
    if (!adj || adj.amt.trim() === "" || isNaN(+adj.amt)) return;
    setBusy(true);
    const sb = createClient(), { data: u } = await sb.auth.getUser();
    const name = stock.find((x) => x.id === adj.id)?.name || "";
    const { error } = await sb.from("ink_counts").insert({ stock_ink_id: adj.id, grams: Math.max(0, gramsFrom(+adj.amt, adj.unit, densityOf(name))), entered: `${adj.amt} ${adj.unit}`, kind: "adjust", counted_by: u.user?.email || "" });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setAdj(null); setJobs(null); loadCounts();
  }
  async function savePlan() {
    setBusy(true);
    const sb = createClient(), { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    const { error } = await sb.from("settings").upsert({ id: 1, data: { ...(data?.data || {}), inkPlan: plan }, updated_at: new Date().toISOString() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMode("view"); setSaved("Estimate settings saved."); setJobs(null); loadCounts();
  }

  if (err) return <div className="pv-err">{err}</div>;
  if (!rows) return <div className="faint">Reading the schedule…</div>;

  if (mode === "settings") {
    const F: [keyof InkPlanSettings, string, string, number][] = [
      ["factor", "Real-world factor", "How much heavier a print lays down than the mesh's theoretical ink volume. 4 ≈ a weighed print (6×6, half filled, 4 g a shirt over two hits); a typical full front on 156 comes to about 800 prints a gallon. Weigh a few shirts before and after printing to tune it.", 0.1],
      ["setupG", "Left in each screen (g)", "Ink left in a screen, on the squeegee and flood bar per screen per job.", 10],
      ["coverage", "Color coverage before separations (%)", "How much of the print area one color covers, until the job's separations give the real number.", 1],
      ["colorMesh", "Color mesh before separations", "", 1], ["baseMesh", "Underbase mesh before separations", "", 1],
      ["polyPct", "Poly white at polyester %", "Shirts with this much polyester or more get the poly white (reds and maroons with any polyester do too).", 5],
      ["horizonDays", "Plan orders for (days)", "How far ahead the order list covers.", 1], ["bufferPct", "Extra when ordering (%)", "", 5],
    ];
    return (
      <div className="stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>Estimate settings</h3>
        {F.map(([k, label, tip, step]) => (
          <label key={k} className="inv-set"><span><b>{label}</b>{tip && <small className="faint">{tip}</small>}</span>
            <input type="number" step={step} value={plan[k]} onChange={(e) => setPlan({ ...plan, [k]: +e.target.value })} /></label>
        ))}
        <div className="row" style={{ gap: 8 }}><button type="button" className="btn primary" onClick={savePlan} disabled={busy}>Save settings</button><button type="button" className="btn" onClick={() => { setPlan(DEFAULT_INK_PLAN); }}>Back to defaults</button><button type="button" className="btn ghost" onClick={() => setMode("view")}>Cancel</button></div>
      </div>
    );
  }

  if (mode === "count") {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Take inventory</h3>
          <div className="row" style={{ gap: 8 }}><button type="button" className="btn primary" onClick={saveCount} disabled={busy}>{busy ? "Saving…" : "Save inventory"}</button><button type="button" className="btn ghost" onClick={() => { setMode("view"); setDraft({}); }}>Cancel</button></div>
        </div>
        <div className="faint" style={{ fontSize: 13 }}>Weigh or eyeball each container and enter what&apos;s there. A partly full gallon can be 0.5 gal, or switch to quarts or pounds. Leave an ink blank to keep its last count.</div>
        {saved && <div className="faint">{saved}</div>}
        {ORDER.map((sec) => {
          const xs = stock.filter((x) => x.stocked && x.section === sec); if (!xs.length) return null;
          return (
            <div key={sec} className={"inv-sec" + (sec === "mixing" ? " ink-mixsys" : "")}>
              <h4>{SECTION_TITLE[sec]}</h4>
              <div className="inv-count">{xs.map((x) => { const c = latest.get(x.id), d = draft[x.id] || { amt: "", unit: "gal" as Unit }; return (
                <label key={x.id} className="inv-count-row"><span><b>{x.name}</b><small className="faint">{c ? `Last: ${fmtVol(c.grams, densityOf(x.name))}, ${new Date(c.counted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Not counted yet"}</small></span>
                  <input inputMode="decimal" value={d.amt} onChange={(e) => setDraft({ ...draft, [x.id]: { ...d, amt: e.target.value.replace(/[^\d.]/g, "") } })} aria-label={`${x.name} amount`} placeholder="–" />
                  <select value={d.unit} onChange={(e) => setDraft({ ...draft, [x.id]: { ...d, unit: e.target.value as Unit } })} aria-label={`${x.name} unit`}><option value="gal">gal</option><option value="qt">qt</option><option value="lb">lb</option><option value="g">g</option></select>
                </label>); })}</div>
            </div>
          );
        })}
        <div className="row" style={{ gap: 8 }}><button type="button" className="btn primary" onClick={saveCount} disabled={busy}>{busy ? "Saving…" : "Save inventory"}</button></div>
      </div>
    );
  }

  const shown = show === "needed" ? rows.filter((r) => r.st.ahead > 0 || r.st.runsOut) : rows;
  const groups = [...ORDER, "other"].map((sec) => ({ sec, rs: shown.filter((r) => r.section === sec) })).filter((g) => g.rs.length);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div className="faint" style={{ fontSize: 13 }}>{lastSession ? `Last inventory ${when(lastSession.counted_at)}${lastSession.counted_by ? ` by ${lastSession.counted_by.split("@")[0]}` : ""}.` : "No inventory taken yet."} Planning {plan.horizonDays} days ahead from the production schedule.</div>
        {canStock && <div className="row" style={{ gap: 8 }}><button type="button" className="btn primary" onClick={() => { setMode("count"); setSaved(""); }}>Take inventory</button><button type="button" className="btn" onClick={() => setMode("settings")}>Estimate settings</button></div>}
      </div>
      {saved && <div className="faint">{saved}</div>}
      {!lastSession && <div className="ink-none"><b>Start with a count.</b><span>Take inventory once (Monday morning works well) and the Ink Room keeps it current: it subtracts each screen job&apos;s ink when the job is finished and tells you what runs out next.</span></div>}
      {alerts.length > 0 && (
        <div className="inv-alerts">{alerts.map((r) => (
          <button key={r.key} type="button" className="inv-alert" onClick={() => setOpen(r.key)}>
            <i style={{ background: "var(--danger, #c0392b)" }} /><span><b>{r.st.name}: need more by {dayName(r.st.runsOut!.day)}</b>{r.st.runsOut!.uses.map((u) => `${u.order} ${u.location}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}. On hand {r.st.onHand == null ? "not counted" : fmtVol(r.st.onHand, r.st.density)}, next {plan.horizonDays} days need {fmtVol(r.st.ahead, r.st.density)}.</span>
          </button>
        ))}</div>
      )}
      {toOrder.length > 0 && (
        <div className="inv-order"><b>To order for the next {plan.horizonDays} days</b><span>{toOrder.map((r) => `${r.st.name} ${r.st.order!.n} ${r.st.order!.unit}`).join(" · ")}</span></div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={"chip" + (show === "all" ? " on" : "")} onClick={() => setShow("all")}>All stock inks</button>
        <button type="button" className={"chip" + (show === "needed" ? " on" : "")} onClick={() => setShow("needed")}>Needed on the schedule ({rows.filter((r) => r.st.ahead > 0).length})</button>
      </div>
      <table className="inv-tbl">
        <thead><tr><th>Ink</th><th className="r">On hand</th><th className="r">Next {plan.horizonDays} days</th><th>Runs short</th><th className="r">Order</th></tr></thead>
        <tbody>{groups.map(({ sec, rs }) => (
          <Fragment key={sec}>
            <tr className="inv-head"><td colSpan={5}>{sec === "other" ? "Needed but not on the shelf (mix by hand, or a PMS without a formula yet)" : SECTION_TITLE[sec]}</td></tr>
            {rs.map(({ key, st }) => (
              <Fragment key={key}>
                <tr className={"inv-row" + (open === key ? " on" : "") + (st.runsOut && st.stock ? " short" : "")} onClick={() => setOpen(open === key ? null : key)}>
                  <td><b>{st.name}</b>{st.stock?.pms ? <small className="faint"> PMS {st.stock.pms}</small> : null}</td>
                  <td className="r">{st.onHand == null ? <span className="faint">{st.stock ? "not counted" : "none"}</span> : fmtVol(st.onHand, st.density)}{st.usedSince > 0 && <small className="faint inv-sub">{fmtVol(st.usedSince, st.density)} used since count</small>}</td>
                  <td className="r">{st.ahead > 0 ? fmtVol(st.ahead, st.density) : <span className="faint">–</span>}</td>
                  <td>{!st.stock ? (st.runsOut ? <span>Mix by {dayName(st.runsOut.day)}</span> : <span className="faint">–</span>) : st.runsOut ? <b className="inv-warn">{dayName(st.runsOut.day)}</b> : <span className="faint">–</span>}</td>
                  <td className="r">{st.stock && st.order ? <b>{st.order.n} {st.order.unit}</b> : <span className="faint">–</span>}</td>
                </tr>
                {open === key && (
                  <tr className="inv-detail"><td colSpan={5}>
                    {st.stock && canStock && (adj?.id === st.stock.id ? (
                      <div className="row inv-adj" style={{ gap: 6, alignItems: "center" }}>
                        <span>On hand now:</span>
                        <input inputMode="decimal" value={adj.amt} onChange={(e) => setAdj({ ...adj, amt: e.target.value.replace(/[^\d.]/g, "") })} autoFocus aria-label="Amount on hand" />
                        <select value={adj.unit} onChange={(e) => setAdj({ ...adj, unit: e.target.value as Unit })} aria-label="Unit"><option value="gal">gal</option><option value="qt">qt</option><option value="lb">lb</option><option value="g">g</option></select>
                        <button type="button" className="btn sm primary" onClick={saveAdjust} disabled={busy}>Save</button><button type="button" className="btn sm ghost" onClick={() => setAdj(null)}>Cancel</button>
                      </div>
                    ) : <button type="button" className="btn sm" onClick={() => setAdj({ id: st.stock!.id, amt: "", unit: "gal" })}>Adjust on hand</button>)}
                    {st.count && <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>{st.count.kind === "adjust" ? "Adjusted" : "Counted"} {when(st.count.counted_at)}: {fmtVol(st.count.grams, st.density)}.</div>}
                    {(st.need?.uses || []).filter((u) => (!u.done && u.day >= today) || (u.done && st.count && (u.finishedAt || u.day) > st.count.counted_at)).sort((a, b) => a.day.localeCompare(b.day)).map((u, i) => (
                      <div key={i} className={"inv-use" + (u.done ? " done" : "")}>
                        <span className="inv-day">{u.done ? "Used" : dayName(u.day)}</span>
                        <span><Link href={u.href}>{u.order}</Link> · {u.location} · {u.ink || "color"} · {u.pieces.toLocaleString()} pcs<small className="faint">{u.via}</small></span>
                        <b>{fmtVol(u.grams, st.density)}</b>
                      </div>
                    ))}
                    {!(st.need?.uses || []).some((u) => !u.done && u.day >= today) && <div className="faint" style={{ fontSize: 13, marginTop: 6 }}>Nothing on the schedule uses it.</div>}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </Fragment>
        ))}</tbody>
      </table>
      <div className="faint" style={{ fontSize: 12 }}>Estimates: print area × coverage × the mesh&apos;s ink volume × {plan.factor}, plus {plan.setupG} g left in each screen. Coverage and mesh come from the separations once they&apos;re made. Underbases go under the whole design in poly white on blends (≥{plan.polyPct}% polyester, or any polyester in reds), otherwise Amazing Bright Tiger.</div>
    </div>
  );
}
