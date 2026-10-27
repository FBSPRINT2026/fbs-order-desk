"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { GoodsRow } from "@/lib/ssMatch";
import type { EODraft } from "@/lib/emailOrderShared";
import type { Group } from "@/lib/pricing";
import { money } from "@/lib/format";
import { sizeRank } from "@/lib/sizeOrder";
import SizeRunsAsk, { garmentStep, type Run, type RunPick } from "@/components/SizeRunsAsk";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import type { PreferredGood } from "@/lib/preferredGoods";
import { goodsFromGroups, goodsOptions, placeGoods, placeSanmar, setSanmarFee, type SanMarRef } from "@/app/shop/order-goods/actions";
import { arriveOn, makePlan, shipKey, supName, whInfo, type Plan, type PlanMode, type Src, type Sup } from "@/lib/goodsPlan";
import { useSticky } from "@/lib/useSticky";
import { useSeesMoney } from "@/components/RoleContext";
import PointsDecision from "@/components/PointsDecision";
import type { GoodsMoney } from "@/app/shop/order-goods/actions";
import { garmentsFromRows } from "@/lib/goodsGarments";

/**
 * THE Order goods tool from an email (Oct 26, Nick: "it has to be the right side… pop-up just like you do with create an
 * order… same functionality… this one will have the order goods headline… a good mobile version for the phone"). The
 * same panel as Create order: on the right with the email still usable beside it, the whole screen on a phone.
 *   1. reads the email (the reading Create order uses; read now if it hasn't been)
 *   2. which blank, when the email doesn't say: their Brand standards' preferred goods first, or a model number
 *   3. the colors on that blank: exact ones go through; "the gray" or one it can't find is asked
 *   4. the goods by color and size, checked with S&S; staff place the order
 * "View email" tucks it into a bar at the bottom (like a draft in the iPhone's Mail app); tap or slide it up to go back.
 * Listed in lib/aiTools.ts (order-goods).
 */
export function openOrderGoods(activityId: string) { window.dispatchEvent(new CustomEvent("fbs:order-goods", { detail: { activity: activityId } })); }

/** mounted once (the shop layout): opens the panel when a button asks for it */
export function OrderGoodsDock() {
  const [st, setSt] = useState<null | { activity: string; n: number }>(null);
  useEffect(() => {
    if (window.self !== window.top) return;
    const on = (e: Event) => { const d = (e as CustomEvent<{ activity: string }>).detail; if (d?.activity) setSt({ activity: d.activity, n: Date.now() }); };
    window.addEventListener("fbs:order-goods", on);
    return () => window.removeEventListener("fbs:order-goods", on);
  }, []);
  if (!st) return null;
  return <OrderGoodsTool key={st.n} activityId={st.activity} onClose={() => setSt(null)} />;
}

type Step = { label: string; state: "doing" | "done" | "error" };
type Row = GoodsRow;

const SHIP: [string, string][] = [["40", "UPS Ground"], ["14", "FedEx Ground"], ["16", "UPS 3 Day Select"], ["3", "UPS 2nd Day Air"], ["2", "UPS Next Day Air"], ["6", "Will call (we pick up)"]];

export default function OrderGoodsTool({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]), [err, setErr] = useState("");
  const [who, setWho] = useState(""), [cust, setCust] = useState<{ id: string; name: string } | null>(null);
  const [runsAsk, setRunsAsk] = useState<{ runs: Run[]; prefs: PreferredGood[]; company: string; sender: string; done: (a: { picks: Record<string, RunPick | null>; remember: boolean } | null) => void } | null>(null);
  const [colorAsk, setColorAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null), [skipped, setSkipped] = useState<string[]>([]);
  const [ship, setShip] = useState("40"), [busy, setBusy] = useState(""), [check, setCheck] = useState<{ total: number; expected: string | null; from: string } | null>(null), [sure, setSure] = useState(false);
  const [placed, setPlaced] = useState<string>(""), [min, setMin] = useState(false);
  // where each size ships from, grouped by warehouse (Oct 26, Nick: "group by warehouse… Fort Worth and the sizes you're
  // getting from there and the colors"): asked of S&S as soon as the goods are shown, and again when a quantity changes
  // S&S and SanMar side by side (Oct 27, Nick): where each size can come from, and the plan picked (Easiest by default;
  // the last one picked is kept)
  const [opts, setOpts] = useState<null | { srcs: Record<string, Src[]>; sm: Record<string, SanMarRef>; notes: string[]; fee: number; money: GoodsMoney; sanmar: boolean; sanmarOrders: string }>(null);
  // the Points decision: owners only (Oct 27, Nick: "my employees don't need to see this")
  const owner = useSeesMoney(), [pointsOpen, setPointsOpen] = useState(false);
  const [planMode, setPlanMode] = useSticky<PlanMode>("goods.plan", "easy");
  const [ssOnly, setSsOnly] = useState(false), [feeEdit, setFeeEdit] = useState(false);
  const [editing, setEditing] = useState(false), [arrive, setArrive] = useState<Record<string, string>>({});
  const stopped = useRef(false), waiting = useRef<((e: Error) => void) | null>(null), ran = useRef(false);
  const step = (label: string) => setSteps((s) => [...s.map((x) => (x.state === "doing" ? { ...x, state: "done" as const } : x)), { label, state: "doing" }]);
  const finishSteps = () => setSteps((s) => s.map((x) => (x.state === "doing" ? { ...x, state: "done" as const } : x)));
  function waitFor<T>(open: (resolve: (v: T) => void) => void) {
    return new Promise<T>((resolve, reject) => { waiting.current = reject; open((v) => { waiting.current = null; resolve(v); }); });
  }
  const cancel = () => { stopped.current = true; waiting.current?.(new Error("Cancelled")); onClose(); };
  // the left menu folds to icons while the panel is open on the right (as with Create order); tucked away, it comes back
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: !min } }));
    return () => { window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: false } })); };
  }, [min]);

  useEffect(() => {
    if (ran.current) return; ran.current = true;
    (async () => {
      try {
        step("Reading the email…");
        const g = await fetch(`/api/inbox/order?activity=${encodeURIComponent(activityId)}`).then((r) => r.json()).catch(() => null) as { draft?: EODraft | null; customer?: { id: string; company?: string | null; name?: string | null } | null; error?: string } | null;
        if (!g || g.error) throw new Error(g?.error || "Couldn't load the email.");
        if (g.customer) { const n = String(g.customer.company || g.customer.name || ""); setCust({ id: g.customer.id, name: n }); setWho(n); }
        let d = g.draft || null;
        if (!d) {
          const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId }) }).catch(() => null);
          const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
          if (!r?.ok || !j.draft) throw new Error(j.error || "The AI couldn't read this email.");
          d = j.draft as EODraft;
        }
        if (stopped.current) return;
        let groups: Group[] = d.groups || [];
        // 2. which garment and color each size run is, when the email doesn't say (SizeRunsAsk: the same step as Create order)
        if (groups.some((x) => x.lines.some((l) => !String(l.style || "").trim()))) step("Finding the garment…");
        const gs = await garmentStep(groups, { customerId: g.customer?.id, activityId, ask: (a) => waitFor((resolve) => setRunsAsk({ ...a, done: resolve })).finally(() => setRunsAsk(null)) });
        groups = gs.groups; const usual = gs.usual;
        if (gs.asked) setSkipped(gs.skipped);
        if (stopped.current) return;
        // 3. the colors on that blank
        step("Finding the colors…");
        const cc = await checkColors(groups, usual).catch(() => ({ rows: [] as ColorRow[], ask: [] as ColorRow[] }));
        if (cc.ask.length) {
          const picked = await waitFor<ColorRow[] | null>((resolve) => setColorAsk({ rows: cc.rows, done: resolve }));
          setColorAsk(null);
          if (picked) cc.rows = picked;
        }
        if (cc.rows.length) groups = applyColors(groups, cc.rows);
        // 4. the goods, checked with S&S
        step("Checking stock and price with S&S…");
        const r = await goodsFromGroups(groups);
        if (!r.ok) throw new Error(r.error);
        setRows(r.rows);
        finishSteps();
      } catch (e) {
        if (stopped.current) return;
        setSteps((s) => s.map((x) => (x.state === "doing" ? { ...x, state: "error" as const } : x)));
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // slide the panel down to tuck it away; slide the bar up to bring it back
  const touch = useRef<number | null>(null);
  const swipe = (dir: "down" | "up") => ({
    onTouchStart: (e: React.TouchEvent) => { touch.current = e.touches[0].clientY; },
    onTouchEnd: (e: React.TouchEvent) => { const y0 = touch.current; touch.current = null; if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dir === "down" && dy > 60) setMin(true); if (dir === "up" && dy < -30) setMin(false); },
  });
  const status = err ? "Stopped: " + err.slice(0, 60) : runsAsk ? "Waiting for you: which garment?" : colorAsk ? "Waiting for you: which color?" : placed ? `Ordered: ${placed}` : rows ? `Ready: ${rows.reduce((a, x) => a + x.qty, 0).toLocaleString()} pcs to check and order` : steps.find((s) => s.state === "doing")?.label || "Working…";

  const lines = rows || [];
  const blanks = [...new Map(lines.map((x) => [`${x.brand}|${x.style}|${x.color}`, x])).keys()];
  // every line with a style and a quantity: S&S's (found there) and any SanMar has
  const wanted = lines.filter((x) => x.qty > 0 && String(x.style || "").trim());
  const label = `${who || "Goods"}`.slice(0, 50);
  const optKey = wanted.map((x) => `${x.key}:${x.sku}`).join(",");
  useEffect(() => {
    if (!wanted.length) { setOpts(null); return; }
    let live = true;
    const t = setTimeout(() => { void goodsOptions(wanted.map((x) => ({ key: x.key, brand: x.brand, style: x.style, color: x.color, size: x.size, qty: x.qty, sku: x.sku, price: x.price }))).then((r) => { if (live && r.ok) setOpts(r); else if (live && !r.ok) setErr(r.error); }); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [optKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const plans = useMemo(() => {
    if (!opts) return null;
    const items = wanted.map((x) => ({ key: x.key, qty: x.qty, srcs: (opts.srcs[x.key] || []).filter((s) => !ssOnly || s.sup === "ss") }));
    return { easy: makePlan(items, "easy", opts.fee), cheap: makePlan(items, "cheap", opts.fee), fast: makePlan(items, "fast", opts.fee) } as Record<PlanMode, Plan>;
  }, [opts, ssOnly, wanted.map((x) => `${x.key}:${x.qty}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = plans ? plans[planMode] || plans.easy : null;
  const byKey = new Map(lines.map((x) => [x.key, x]));
  const ssParts = (plan?.parts || []).filter((p) => p.sup === "ss"), smParts = (plan?.parts || []).filter((p) => p.sup === "sm");
  const smOn = !!opts?.sanmarOrders;
  const ready = wanted.filter((x) => plan?.parts.some((p) => p.key === x.key));
  const total = plan ? plan.total : 0, pcs = wanted.reduce((a, x) => a + x.qty, 0);
  const dayShort = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  async function run(test: boolean) {
    if (!plan) return;
    setBusy(test ? "check" : "place"); setErr("");
    const out: string[] = [], dates: string[] = [], froms: string[] = [];
    let sum = 0, garmentsLeft = test ? undefined : garmentsFromRows(ready);
    // S&S's part, each size from the warehouse the plan picked
    if (ssParts.length) {
      const per = new Map<string, number>();
      for (const p of ssParts) { const x = byKey.get(p.key); if (x?.sku) per.set(x.sku, (per.get(x.sku) || 0) + p.qty); }
      const r = await placeGoods({ lines: [...per].map(([sku, qty]) => { const x = wanted.find((y) => y.sku === sku)!; return { sku, qty, label: `${x.brand} ${x.style} ${x.color} ${x.size}`, price: x.price }; }),
        from: ssParts.map((p) => ({ sku: byKey.get(p.key)?.sku || "", qty: p.qty, warehouse: p.wh })), shippingMethod: ship, test, label, customerId: cust?.id || null, activityId, garments: garmentsLeft });
      if (!r.ok) { setBusy(""); setErr(r.error); return; }
      garmentsLeft = undefined;
      const res = (r as { results?: { orderNumber: string; warehouse: string; total: number; expected: string | null }[] }).results || [];
      if (test) setArrive((a) => ({ ...a, ...Object.fromEntries(res.filter((x) => x.expected).map((x) => [`ss:${x.warehouse}`, x.expected!])) }));
      sum += res.reduce((a, x) => a + (x.total || 0), 0); dates.push(...res.map((x) => x.expected || "").filter(Boolean)); froms.push(...res.map((x) => `S&S ${whInfo("ss", x.warehouse).short}`));
      if (!test) out.push(`S&S ${res.map((x) => x.orderNumber).filter(Boolean).join(", ") || "placed"}`);
      if ((r as { warn?: string }).warn) setErr((r as { warn?: string }).warn!);
    }
    // SanMar's part (once SanMar has switched ordering on for us)
    if (smParts.length && smOn) {
      const r = await placeSanmar({ lines: smParts.map((p) => { const x = byKey.get(p.key)!, ref = opts!.sm[p.key]; const src = (opts!.srcs[p.key] || []).find((s) => s.sup === "sm" && s.wh === p.wh); return { ...ref, qty: p.qty, whse: p.wh, label: `${x.brand} ${x.style} ${x.color} ${x.size}`, price: src?.price || 0 }; }),
        shippingMethod: ship, test, label, customerId: cust?.id || null, activityId, garments: garmentsLeft });
      if (!r.ok) { setBusy(""); setErr((ssParts.length && !test ? `The S&S order went through (${out.join("; ")}), but SanMar's didn't: ` : "") + r.error); if (!test && out.length) setPlaced(out.join(" · ")); return; }
      if (test) { const c = (r as { checked?: { ok: boolean; message: string } }).checked; if (c && !c.ok) setErr("SanMar: " + (c.message || "some sizes aren't in stock")); }
      sum += (r as { total?: number }).total || smParts.reduce((a, p) => a + p.qty * p.each, 0);
      froms.push("SanMar");
      if (!test) out.push(`SanMar PO ${(r as { po?: string }).po || ""}`.trim());
      if ((r as { warn?: string }).warn) setErr((r as { warn?: string }).warn!);
    }
    setBusy("");
    if (test) { setCheck({ total: Math.round(sum * 100) / 100, expected: dates.sort().pop() || null, from: [...new Set(froms)].join(", ") }); setSure(false); }
    else setPlaced(out.join(" · ") || "placed");
  }

  // tucked away, the panel stays as it was (a question half answered stays half answered) and only a bar shows
  return (<>
    {min && <button type="button" className="og-mini" onClick={() => setMin(false)} {...swipe("up")} aria-label="Order goods: open it again">
      <span className="og-grab" aria-hidden />
      <span className={"og-dot" + (runsAsk || colorAsk ? " ask" : rows ? " ok" : "")} aria-hidden />
      <span className="og-mt"><b>Order goods</b><small>{status}</small></span>
    </button>}
    <div className={"dla-bg dock og-bg" + (min ? " og-hidden" : "")} role="dialog" aria-label="Order goods" aria-hidden={min || undefined}>
      <div className="dla qo og">
        <div className="og-h" {...swipe("down")}>
          <span className="og-grab" aria-hidden />
          <div className="og-ht"><h3>Order goods</h3>{who && <span className="dla-sub" data-notranslate>{who}</span>}</div>
          <button type="button" className="qo-x" onClick={cancel} aria-label="Close: nothing is ordered">×</button>
        </div>
        <ol className="qo-steps">{steps.map((s, i) => <li key={i} className={s.state}><i aria-hidden>{s.state === "done" ? "✓" : s.state === "error" ? "!" : ""}</i><span>{s.label}</span></li>)}</ol>
        {err && <div className="err">{err}</div>}
        {runsAsk && <SizeRunsAsk runs={runsAsk.runs} prefs={runsAsk.prefs} company={runsAsk.company} sender={runsAsk.sender} onDone={(picks, remember) => runsAsk.done({ picks, remember })} onCancel={cancel} />}
        {colorAsk && <ColorCheck inline rows={colorAsk.rows} onDone={(r) => colorAsk.done(r)} onCancel={cancel} />}
        {rows && <div className="og-list">
          {!lines.length ? <p className="faint">Nothing to order: no garment with a style and sizes.{skipped.length ? ` Left for now: ${skipped.join(", ")}.` : ""}</p> : <>
            {!editing && plan && plan.parts.length > 0 ? (() => {
              // by shipment (supplier and warehouse): a small table each, a row per garment and color, the sizes across
              const ships = [...new Set(plan.parts.map(shipKey))].sort((x, y) => { const [sx, wx] = x.split(":"), [sy, wy] = y.split(":"); return whInfo(sx as Sup, wx).days - whInfo(sy as Sup, wy).days || (sx === sy ? 0 : sx === "ss" ? -1 : 1); });
              const sizes = [...new Set(ready.map((x) => x.size))].sort((a, b) => sizeRank(a) - sizeRank(b));
              const split = new Set([...new Set(plan.parts.map((p) => p.key))].filter((k) => plan.parts.filter((p) => p.key === k).length > 1));
              const none = wanted.filter((x) => !(opts?.srcs[x.key] || []).length);
              return <>
                {ships.map((sk) => {
                  const [sup, wh] = sk.split(":") as [Sup, string], w = whInfo(sup, wh);
                  const here = plan.parts.filter((p) => shipKey(p) === sk);
                  const gks = [...new Set(here.map((p) => { const x = byKey.get(p.key); return x ? `${x.brand}|${x.style}|${x.color}` : ""; }).filter(Boolean))];
                  const sub = here.reduce((n, p) => n + p.qty * p.each, 0);
                  const when = arrive[sk] ? dayShort(new Date(arrive[sk])) : `about ${dayShort(arriveOn(w.days))}`;
                  return (
                    <section key={sk} className={"og-wh " + sup} style={{ ["--wc" as string]: sup === "ss" ? "var(--fbs-blue)" : "var(--fbs-salmon)" }}>
                      <div className="og-whs" aria-hidden>{supName(sup)} {w.short}</div>
                      <div className="og-whb">
                        <div className="og-whh"><b>{supName(sup)} · {w.name}</b><span>{here.reduce((n, p) => n + p.qty, 0)} pcs · {money(sub)} · {when}</span></div>
                        {sup === "sm" && !smOn && <div className="og-off">Not ordered here yet: SanMar has to switch on ordering for us. Order these on sanmar.com, or <button type="button" className="linkbtn" onClick={() => { setSsOnly(true); setCheck(null); }}>use S&amp;S only</button>.</div>}
                        <table className="og-wt"><thead><tr><th />{sizes.map((z) => <th key={z}>{z}</th>)}<th /></tr></thead>
                          <tbody>{gks.map((k) => {
                            const xs = wanted.filter((x) => `${x.brand}|${x.style}|${x.color}` === k), f = xs[0];
                            const q = (z: string) => { const x = xs.find((y) => y.size === z); return x ? here.filter((p) => p.key === x.key).reduce((n, p) => n + p.qty, 0) : 0; };
                            return (
                              <tr key={k}>
                                <td data-notranslate><b>{sup === "sm" && opts?.sm[xs[0].key]?.style ? opts.sm[xs[0].key].style : f.style}</b> {f.color}</td>
                                {sizes.map((z) => { const x = xs.find((y) => y.size === z), n = q(z); return <td key={z} className={!n ? "z" : x && split.has(x.key) ? "p" : ""}>{n || "–"}</td>; })}
                                <td className="t">{sizes.reduce((n, z) => n + q(z), 0)}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
                {split.size > 0 && <p className="og-note og-split">{[...split].map((k) => { const x = byKey.get(k)!; return `${x.style} ${x.color} ${x.size}: ${plan.parts.filter((p) => p.key === k).map((p) => `${p.qty} from ${supName(p.sup)} ${whInfo(p.sup, p.wh).short}`).join(", ")}`; }).join(" · ")} (amber: split)</p>}
                {plan.short.length > 0 && <p className="pv-err">Not enough at {ssOnly || !opts?.sanmar ? "S&S" : "S&S or SanMar"}: {plan.short.map((s) => { const x = byKey.get(s.key); return x ? `${x.style} ${x.color} ${x.size} (${s.qty} short)` : ""; }).filter(Boolean).join("; ")}</p>}
                {none.length > 0 && <p className="pv-err">Not found: {none.map((x) => `${x.style} ${x.color} ${x.size}`).join("; ")}</p>}
                {!!opts?.notes.length && <p className="faint og-note">{opts.notes.join(" · ")}</p>}
                <button type="button" className="linkbtn og-edit" onClick={() => setEditing(true)}>Change quantities</button>
              </>;
            })() : <>
            {editing && <button type="button" className="linkbtn og-edit" onClick={() => setEditing(false)}>Done changing: show by warehouse</button>}
            {blanks.map((k) => {
              const xs = lines.filter((x) => `${x.brand}|${x.style}|${x.color}` === k).sort((a, b) => sizeRank(a.size) - sizeRank(b.size)), f = xs[0];
              return (
                <section key={k} className="og-g">
                  <div className="og-gh"><b data-notranslate>{[f.brand, f.style].filter(Boolean).join(" ")} · {f.color}</b><span>{xs.reduce((a, x) => a + x.qty, 0)}</span></div>
                  <div className="og-sz">{xs.map((x) => (
                    <label key={x.key} className={!x.found ? "bad" : x.stock < x.qty ? "low" : ""} title={x.note || (x.found ? `${x.stock} in stock at S&S` : "")}>
                      <span>{x.size}</span>
                      <input type="number" min={0} inputMode="numeric" value={x.qty} aria-label={`${f.style} ${f.color} ${x.size}`} onChange={(e) => { const v = Math.max(0, Math.round(+e.target.value || 0)); setRows((rs) => (rs || []).map((y) => (y.key === x.key ? { ...y, qty: v } : y))); setCheck(null); }} />
                      <small>{!x.found ? (x.note || "not at S&S") : x.stock < x.qty ? `${x.stock} left` : "in stock"}</small>
                    </label>
                  ))}</div>
                </section>
              );
            })}
            </>}
            {skipped.length > 0 && <p className="faint og-note">Left for now (no blank picked): {skipped.join(", ")}.</p>}
            {plans && <div className="og-plans" role="radiogroup" aria-label="How to order it">
              {([["easy", "Easiest"], ["cheap", "Cheapest"], ["fast", "Fastest"]] as [PlanMode, string][]).map(([m, l]) => { const p = plans[m]; return (
                <button key={m} type="button" role="radio" aria-checked={planMode === m} className={"og-plan" + (planMode === m ? " on" : "")} onClick={() => { setPlanMode(m); setCheck(null); setSure(false); }}
                  title={m === "easy" ? "Fewest shipments, then the cheapest of those" : m === "cheap" ? "Lowest cost for each size (SanMar with our card fee); a tie goes to S&S" : "The soonest warehouse for each size, then the cheapest"}>
                  <span className="k">{l}</span><b>{money(p.total)}</b><small>{p.parts.length ? `${dayShort(arriveOn(p.days)).replace(/,.*$/, "")} · ${p.ships} shipment${p.ships === 1 ? "" : "s"}` : "—"}</small>
                </button>); })}
            </div>}
            <div className="og-tot"><span>{pcs.toLocaleString()} pcs{plan ? ` · ${plan.ships} shipment${plan.ships === 1 ? "" : "s"}` : opts === null && wanted.length ? " · checking S&S and SanMar…" : ""}</span><b>{money(total)}</b></div>
            {owner && plan && opts && plan.parts.length > 0 && <>
              <button type="button" className="og-pts" aria-expanded={pointsOpen} onClick={() => setPointsOpen((x) => !x)}>
                <svg viewBox="0 0 24 24" aria-hidden><circle cx="9" cy="9" r="6" /><path d="M15.5 9.5a6 6 0 1 1-6 6" /></svg>Points decision<span aria-hidden>{pointsOpen ? "▴" : "▾"}</span>
              </button>
              {pointsOpen && <PointsDecision plan={plan} items={wanted} srcs={opts.srcs} money={opts.money} onMoney={(m) => setOpts((o) => (o ? { ...o, money: m, fee: m.fee } : o))} />}
            </>}
            {opts?.sanmar && <p className="faint og-note og-fee">{feeEdit
              ? <>SanMar card fee <input type="number" step="0.05" min={0} max={19} defaultValue={opts.fee} autoFocus aria-label="SanMar card fee, percent" onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={(e) => { const v = +e.target.value; setFeeEdit(false); if (isFinite(v) && v !== opts.fee) void setSanmarFee(v).then((r) => { if (r.ok) setOpts((o) => (o ? { ...o, fee: r.fee, money: r.money } : o)); }); }} />%</>
              : <>SanMar prices include our {opts.fee}% card fee; S&amp;S has none, so a tie goes to S&amp;S. <button type="button" className="linkbtn" onClick={() => setFeeEdit(true)}>Change</button>{ssOnly && <> · S&amp;S only. <button type="button" className="linkbtn" onClick={() => { setSsOnly(false); setCheck(null); }}>Show SanMar too</button></>}</>}</p>}
            <div className="field"><label htmlFor="og-ship">Shipping</label><select id="og-ship" value={ship} onChange={(e) => { setShip(e.target.value); setCheck(null); }}>{SHIP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            {check && <div className="og-check">Checked with {check.from || "S&S"}: {money(check.total)}{check.expected ? ` · arrives ${new Date(check.expected).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : ""}. Nothing bought yet.</div>}
            {placed && smParts.length > 0 && !smOn && <div className="pv-err">Still to order on sanmar.com: {smParts.map((p) => { const x = byKey.get(p.key)!, r = opts?.sm[p.key]; return `${r?.style || x.style} ${r?.color || x.color} ${r?.size || x.size} × ${p.qty}`; }).join("; ")}</div>}
            {placed && <div className="og-done">Ordered: <b>{placed}</b>. It&apos;s saved on this email with a to-do for tomorrow: when you Create order here, it uses these garments and sizes (<Link href="/shop/order-goods">Order goods</Link>).</div>}
          </>}
        </div>}
        <div className="dla-acts og-foot">
          <button type="button" className="btn og-view" onClick={() => setMin(true)}>
            <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>View email
          </button>
          {rows && lines.length > 0 && !placed && (!check
            ? <button type="button" className="btn primary" disabled={!!busy || !plan || !(ssParts.length || (smParts.length && smOn))} onClick={() => void run(true)}>{busy === "check" ? "Checking…" : ssParts.length && smParts.length && smOn ? "Check with S&S and SanMar" : ssParts.length ? "Check with S&S" : "Check with SanMar"}</button>
            : !sure ? <button type="button" className="btn primary" disabled={!!busy} onClick={() => setSure(true)}>Place order</button>
              : <button type="button" className="btn primary og-sure" disabled={!!busy} onClick={() => void run(false)}>{busy === "place" ? "Ordering…" : `Yes, buy it (${money(check.total)})`}</button>)}
          {placed && <button type="button" className="btn primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  </>);
}
