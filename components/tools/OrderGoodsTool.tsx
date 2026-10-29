"use client";
import { SS_SHIP, SM_SHIP_OPTS, OS_SHIP_OPTS, FREE_CODE, paidShipLines } from "@/lib/goodsShip";
import { PaidShipAsk } from "@/components/PaidShipAsk";
import { GOODS_PO_MAX, cleanGoodsPo, defaultGoodsPo } from "@/lib/goodsPo";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { GoodsRow } from "@/lib/ssMatch";
import { EXTRA_REASONS, shopReason, type GoodsExtra } from "@/lib/goodsExtras";
import type { EODraft } from "@/lib/emailOrderShared";
import type { Group } from "@/lib/pricing";
import { money } from "@/lib/format";
import { sizeRank } from "@/lib/sizeOrder";
import SizeRunsAsk, { garmentStep, type Run, type RunPick } from "@/components/SizeRunsAsk";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import type { PreferredGood } from "@/lib/preferredGoods";
import { addExtrasToOrder, goodsFromGroups, goodsOptions, goodsStart, placeGoods, placeOneStop, placeSanmar, setSanmarFee, type SanMarRef } from "@/app/shop/order-goods/actions";
import { arriveOn, dayOptions, pickOption, shipKey, supName, whInfo, type DayOption, type Src, type Sup } from "@/lib/goodsPlan";
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
/** the same panel from an order or invoice (Oct 27, Nick: "if you click order goods from the invoice, it should pop up on
 *  the right… we're keeping all of our AI tools the same everywhere"): its garments, already on the order */
export function openOrderGoodsForOrder(orderId: string) { window.dispatchEvent(new CustomEvent("fbs:order-goods", { detail: { order: orderId } })); }

/** mounted once (the shop layout): opens the panel when a button asks for it */
export function OrderGoodsDock() {
  const [st, setSt] = useState<null | { activity?: string; order?: string; n: number }>(null);
  useEffect(() => {
    if (window.self !== window.top) return;
    const on = (e: Event) => { const d = (e as CustomEvent<{ activity?: string; order?: string }>).detail; if (d?.activity || d?.order) setSt({ activity: d.activity, order: d.order, n: Date.now() }); };
    window.addEventListener("fbs:order-goods", on);
    return () => window.removeEventListener("fbs:order-goods", on);
  }, []);
  if (!st) return null;
  return <OrderGoodsTool key={st.n} activityId={st.activity} orderId={st.order} onClose={() => setSt(null)} />;
}

type Step = { label: string; state: "doing" | "done" | "error" };
type Row = GoodsRow;

// SanMar's own choice (Oct 29, Nick: "when we select PSST program shipping, we do not get to tell it how it goes… however
// they want to send it"): PSST (SanMar picks the carrier, free to us), will call from Dallas, or a paid rush by UPS

export default function OrderGoodsTool({ activityId, orderId, onClose }: { activityId?: string; orderId?: string; onClose: () => void }) {
  const [label0, setLabel0] = useState(""), [orderNo, setOrderNo] = useState<number | null>(null);
  // the PO name sent to S&S and SanMar: filled in (lib/goodsPo.ts), typed over when you want your own
  const [po, setPo] = useState("");
  const [steps, setSteps] = useState<Step[]>([]), [err, setErr] = useState("");
  const [who, setWho] = useState(""), [cust, setCust] = useState<{ id: string; name: string } | null>(null);
  const [runsAsk, setRunsAsk] = useState<{ runs: Run[]; prefs: PreferredGood[]; company: string; sender: string; done: (a: { picks: Record<string, RunPick | null>; remember: boolean } | null) => void } | null>(null);
  const [colorAsk, setColorAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null), [skipped, setSkipped] = useState<string[]>([]);
  const [smShip, setSmShip] = useState("psst");
  // One Stop (the third choice): its shipping, and the card's security code typed each time (never kept: One Stop asks
  // for it on every card order; Oct 29, Nick: paid with the card ending 5488)
  const [osShip, setOsShip] = useState("1"), [cvv, setCvv] = useState("");
  // paid shipping asked about before ordering (Oct 29, Nick: "S&S gives us… free UPS ground… SanMar free PSST… if you
  // select any of the other options… a pop-up… you've selected a non-free option… if you accidentally shipped 500 shirts
  // next day air, that would be like a $1,000 mistake"). Free: S&S UPS Ground (contract decorator network), SanMar PSST,
  // and will call (we pick up)
  const [paidAsk, setPaidAsk] = useState<string[] | null>(null);
  const [ship, setShip] = useState("40"), [busy, setBusy] = useState(""), [check, setCheck] = useState<{ total: number; expected: string | null; from: string; freight?: string } | null>(null), [sure, setSure] = useState(false);
  const [placed, setPlaced] = useState<string>(""), [min, setMin] = useState(false);
  // where each size ships from, grouped by warehouse (Oct 26, Nick: "group by warehouse… Fort Worth and the sizes you're
  // getting from there and the colors"): asked of S&S as soon as the goods are shown, and again when a quantity changes
  // S&S and SanMar side by side (Oct 27, Nick): where each size can come from, and the plan picked (Easiest by default;
  // the last one picked is kept)
  const [opts, setOpts] = useState<null | { srcs: Record<string, Src[]>; sm: Record<string, SanMarRef>; notes: string[]; fee: number; money: GoodsMoney; sanmar: boolean; sanmarOrders: string }>(null);
  // the Points decision: owners only (Oct 27, Nick: "my employees don't need to see this")
  const owner = useSeesMoney(), [pointsOpen, setPointsOpen] = useState(false);
  // one way picked for you by arrival day (Oct 27, Nick: "treat it by date… like UPS… arrive Thursday, this cost");
  // tap another day to switch. When the goods are needed comes from the order (the day before production)
  const [needBy, setNeedBy] = useState<string | null>(null), [prodDay, setProdDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [ssOnly, setSsOnly] = useState(false), [feeEdit, setFeeEdit] = useState(false);
  const [editing, setEditing] = useState(false), [arrive, setArrive] = useState<Record<string, string>>({});
  // extras on top of an order's goods (Oct 29, Nick: "changing quantities… kind of dangerous… if you order extra, you have
  // to indicate what it is, and then we've got to add it back to the order"): the order's own quantities are locked;
  // extras are their own rows (key + "~x"), each garment's with a reason, printed or not, charged or not
  const [xMeta, setXMeta] = useState<Record<string, GoodsExtra & { other?: string }>>({});
  const xDefault: GoodsExtra = { reason: EXTRA_REASONS[0], print: true, free: true, shop: true };
  const gkOf = (x: { brand: string; style: string; color: string }) => `${x.brand}|${x.style}|${x.color}`;
  const metaOf = (gk: string) => xMeta[gk] || xDefault;
  const reasonOf = (m: GoodsExtra & { other?: string }) => (m.reason === "Other" ? (m.other || "").trim() : m.reason);
  function setExtra(base: Row, qty: number) {
    const key = base.key + "~x", m = metaOf(gkOf(base));
    setRows((rs) => {
      const list = (rs || []).filter((y) => y.key !== key);
      if (qty > 0) { const at = list.findIndex((y) => y.key === base.key); list.splice(at + 1, 0, { ...base, key, qty, extra: { reason: reasonOf(m), print: m.print, free: m.free || !!m.shop, shop: !!m.shop } }); }
      return list;
    });
    setCheck(null);
  }
  function setMeta(gk: string, patch: Partial<GoodsExtra & { other?: string }>) {
    // a shop sample or a spare is ours: hidden from the customer, no charge; picking one of those reasons sets it
    if (patch.reason && patch.reason !== "Other") patch = { ...patch, shop: shopReason(patch.reason), ...(shopReason(patch.reason) ? { free: true } : {}) };
    const m = { ...metaOf(gk), ...patch };
    setXMeta((x) => ({ ...x, [gk]: m }));
    setRows((rs) => (rs || []).map((y) => (y.extra && gkOf(y) === gk ? { ...y, extra: { reason: reasonOf(m), print: m.print, free: m.free || !!m.shop, shop: !!m.shop } } : y)));
  }
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
        // from an order or invoice: its garments are already picked (style, color, sizes)
        if (orderId) {
          step("Loading the order's garments…");
          const r = await goodsStart({ order: orderId });
          if (!r.ok) throw new Error(r.error || "Couldn't load the order.");
          if (stopped.current) return;
          const o = "order" in r ? r.order : null, c = "customer" in r ? r.customer : null;
          if (c) { setCust({ id: c.id, name: c.name }); setWho(o ? `#${o.number} ${c.name}` : c.name); } else if (o) setWho(`#${o.number}`);
          if (o) setOrderNo(o.number);
          if ("needBy" in r) { setNeedBy((r.needBy as string | null) || null); setProdDay(((r as { production?: string | null }).production) || null); }
          if ("label" in r && r.label) setLabel0(String(r.label));
          setPo((x) => x || String(("po" in r && r.po) || defaultGoodsPo({ customer: c?.name })));
          step("Checking stock and warehouses at S&S and SanMar…");
          setRows((r.rows || []) as Row[]);
          return;
        }
        if (!activityId) throw new Error("Nothing to order goods for.");
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
        step("Checking stock and warehouses at S&S and SanMar…");
        const r = await goodsFromGroups(groups);
        if (!r.ok) throw new Error(r.error);
        setRows(r.rows);
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
  const label = `${label0 || who || "Goods"}`.slice(0, 50);
  const optKey = wanted.map((x) => `${x.key}:${x.sku}`).join(",");
  useEffect(() => {
    if (!wanted.length) { setOpts(null); return; }
    let live = true;
    const t = setTimeout(() => { void goodsOptions(wanted.map((x) => ({ key: x.key, brand: x.brand, style: x.style, color: x.color, size: x.size, qty: x.qty, sku: x.sku, price: x.price }))).then((r) => { if (live && r.ok) setOpts(r); else if (live && !r.ok) { setErr(r.error); setSteps((ss) => ss.map((x) => (x.state === "doing" ? { ...x, state: "error" as const } : x))); } }); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [optKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // the "Checking stock" step keeps spinning until both suppliers' stock and warehouses are in (Oct 29, Nick: "this
  // screen sits there for quite a while… some sort of… hey, this is what I'm doing… a spinning symbol")
  useEffect(() => { if (rows && (opts || !wanted.length)) finishSteps(); }, [rows, opts, wanted.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const optKey2 = wanted.map((x) => `${x.key}:${x.qty}`).join(",") + "|" + ssOnly + "|" + (opts ? opts.fee + ":" + opts.money.bigRun + ":" + Object.keys(opts.srcs).length : "");
  const options = useMemo(() => {
    if (!opts) return null;
    const items = wanted.map((x) => ({ key: x.key, qty: x.qty, srcs: (opts.srcs[x.key] || []).filter((s) => !ssOnly || s.sup === "ss") }));
    return dayOptions(items, opts.fee, opts.money.bigRun, opts.osFreight ? { freeAt: opts.osFreeAt, freight: opts.osFreight } : undefined);
  }, [optKey2, opts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setChosen(null); }, [optKey2]);
  const need = needBy ? new Date(needBy + "T23:59") : null;
  const pick = options && opts ? pickOption(options, need, opts.money.bigRun) : null;
  const plan: DayOption | null = options && pick ? options[chosen ?? pick.i] || pick.option : null;
  const byKey = new Map(lines.map((x) => [x.key, x]));
  const ssParts = (plan?.parts || []).filter((p) => p.sup === "ss"), smParts = (plan?.parts || []).filter((p) => p.sup === "sm");
  const smOn = !!opts?.sanmarOrders;
  const osParts = (plan?.parts || []).filter((p) => p.sup === "os"), osOn = !!opts?.onestop;
  const ready = wanted.filter((x) => plan?.parts.some((p) => p.key === x.key));
  const total = plan ? plan.total : 0, pcs = wanted.reduce((a, x) => a + x.qty, 0);
  const xRows = wanted.filter((x) => x.extra), xPcs = xRows.reduce((a, x) => a + x.qty, 0);
  const xNoReason = xRows.some((x) => !x.extra!.reason.trim());
  const extrasNote = xPcs ? <p className="og-note og-xn">{[...new Set(xRows.map(gkOf))].map((gk) => { const rs = xRows.filter((x) => gkOf(x) === gk), e = rs[0].extra!; return `${rs.reduce((a, x) => a + x.qty, 0)} extra ${rs[0].style} ${rs[0].color} (${rs.map((x) => `${x.qty} ${x.size}`).join(", ")}): ${e.reason || "say what it's for"}, ${e.print ? "printed" : "not printed"}, ${e.free ? "no charge" : "charged"}`; }).join(" · ")}. Goes on the order as Extras when it's placed.</p> : null;
  const dayShort = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  const paidLines = () => paidShipLines([...(ssParts.length ? [{ sup: "ss" as const, code: ship }] : []), ...(smParts.length && smOn ? [{ sup: "sm" as const, code: smShip }] : []), ...(osParts.length && osOn ? [{ sup: "os" as const, code: osShip, amount: osParts.reduce((a, p) => a + p.qty * p.each, 0) }] : [])]);
  async function run(test: boolean, paidOk = false) {
    if (!plan) return;
    if (!test && !paidOk) { const pl = paidLines(); if (pl.length) { setPaidAsk(pl); return; } }
    if (xNoReason) { setErr("Say what the extra is for (Other: type it) before ordering."); setEditing(true); return; }
    setBusy(test ? "check" : "place"); setErr("");
    const out: string[] = [], dates: string[] = [], froms: string[] = [];
    let sum = 0, garmentsLeft = test ? undefined : garmentsFromRows(ready), freight = "";
    if (!test && osParts.length && osOn && !/^\d{3,4}$/.test(cvv.trim())) { setBusy(""); setErr("Type the card's security code (CVV) for One Stop. It isn't saved."); return; }
    // S&S's part, each size from the warehouse the plan picked
    if (ssParts.length) {
      const per = new Map<string, number>();
      for (const p of ssParts) { const x = byKey.get(p.key); if (x?.sku) per.set(x.sku, (per.get(x.sku) || 0) + p.qty); }
      const r = await placeGoods({ lines: [...per].map(([sku, qty]) => { const x = wanted.find((y) => y.sku === sku)!; return { sku, qty, label: `${x.brand} ${x.style} ${x.color} ${x.size}`, price: x.price }; }),
        from: ssParts.map((p) => ({ sku: byKey.get(p.key)?.sku || "", qty: p.qty, warehouse: p.wh })), shippingMethod: ship, test, paidShipOk: paidOk, label, po, orderId: orderId || null, customerId: cust?.id || null, activityId: activityId || null, garments: orderId ? undefined : garmentsLeft });
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
        shippingMethod: smShip, test, paidShipOk: paidOk, label, po, orderId: orderId || null, customerId: cust?.id || null, activityId: activityId || null, garments: orderId ? undefined : garmentsLeft });
      if (!r.ok) { setBusy(""); setErr((ssParts.length && !test ? `The S&S order went through (${out.join("; ")}), but SanMar's didn't: ` : "") + r.error); if (!test && out.length) setPlaced(out.join(" · ")); return; }
      if (test) { const c = (r as { checked?: { ok: boolean; message: string } }).checked; if (c && !c.ok) setErr("SanMar: " + (c.message || "some sizes aren't in stock")); }
      sum += (r as { total?: number }).total || smParts.reduce((a, p) => a + p.qty * p.each, 0);
      froms.push("SanMar");
      if (!test) out.push(`SanMar PO ${(r as { po?: string }).po || ""}`.trim());
      if ((r as { warn?: string }).warn) setErr((r as { warn?: string }).warn!);
    }
    // One Stop's part: only what S&S and SanMar can't fill (goodsOptions offers One Stop just for those sizes)
    if (osParts.length && osOn) {
      const r = await placeOneStop({ lines: osParts.map((p) => { const x = byKey.get(p.key)!; return { code: opts!.os[p.key]?.code || "", qty: p.qty, label: `${x.brand} ${x.style} ${x.color} ${x.size}`, price: p.each }; }),
        shippingMethod: osShip, cvv, test, paidShipOk: paidOk, label, po, orderId: orderId || null, customerId: cust?.id || null, activityId: activityId || null, garments: orderId ? undefined : garmentsLeft });
      if (!test) setCvv("");
      if (!r.ok) { setBusy(""); setErr((out.length && !test ? `${out.join("; ")} went through, but One Stop's didn't: ` : "") + r.error); if (!test && out.length) setPlaced(out.join(" · ")); return; }
      const rr = r as { total?: number; freight?: number; live?: boolean; po?: string; warn?: string };
      sum += rr.total || osParts.reduce((a, p) => a + p.qty * p.each, 0);
      if (rr.freight) freight = `One Stop freight ${money(rr.freight)}`;
      froms.push("One Stop");
      if (!test) out.push(`One Stop ${rr.po || ""}${rr.live ? "" : " (their test system)"}`.trim());
      if (rr.warn) setErr(rr.warn);
    }
    setBusy("");
    if (test) { setCheck({ total: Math.round(sum * 100) / 100, expected: dates.sort().pop() || null, from: [...new Set(froms)].join(", "), freight }); setSure(false); }
    else {
      setPlaced(out.join(" · ") || "placed");
      // the extras go back on the order as Extras lines, with why (addExtrasToOrder)
      if (orderId && xRows.length) {
        const byG = new Map<string, { brand: string; style: string; color: string; sizes: Record<string, number>; reason: string; print: boolean; free: boolean; shop?: boolean }>();
        for (const x of xRows.filter((y) => ready.some((r) => r.key === y.key))) {
          type XG = { brand: string; style: string; color: string; sizes: Record<string, number>; reason: string; print: boolean; free: boolean; shop?: boolean };
          const g: XG = byG.get(gkOf(x)) || { brand: x.brand, style: x.style, color: x.color, sizes: {} as Record<string, number>, reason: x.extra!.reason, print: x.extra!.print, free: x.extra!.free, shop: x.extra!.shop };
          g.sizes[x.size] = (g.sizes[x.size] || 0) + x.qty; byG.set(gkOf(x), g);
        }
        const r = await addExtrasToOrder(orderId, [...byG.values()], out.join(" · "));
        if (!r.ok) setErr(`Ordered, but the extras couldn't be added to the order: ${r.error}. Add them by hand.`);
        else window.dispatchEvent(new CustomEvent("fbs:order-changed", { detail: { orderId } }));
      }
    }
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
            {!editing && plan && pick && options && <div className="og-rec">
              {(needBy || prodDay) && <div className="og-need"><svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>{prodDay ? <>Production <b>{dayShort(new Date(prodDay + "T12:00"))}</b> · </> : null}goods needed by <b>{needBy ? dayShort(new Date(needBy + "T12:00")) : "—"}</b></div>}
              {(() => {
                // Oct 27, Nick: the price is the cheapest (S&S, the same from every warehouse); the choice is only how it
                // ships when one warehouse can't cover it: easiest (fewest boxes) at 250 pcs or less, fastest over that
                const where = (o: DayOption) => { const ws = [...new Set(o.parts.map((p) => `${supName(p.sup)} ${whInfo(p.sup, p.wh).short}`))]; return ws.length === 1 ? `all from ${ws[0]}` : ws.join(" + "); };
                const ship = (o: DayOption) => (o.kind === "early" && o.start < o.days ? `${o.startPcs.toLocaleString()} pcs ${dayShort(arriveOn(o.start))}, the rest ${dayShort(arriveOn(o.days))}` : `Arrives ${dayShort(arriveOn(o.days))}`) + ` · ${o.ships} shipment${o.ships === 1 ? "" : "s"}`;
                const late = (o: DayOption) => !!need && arriveOn(o.kind === "early" ? o.start : o.days) > need;
                const cheap = pick.cheapest;
                // one way (or the picked one is both cheapest and soonest): no decision
                if (options.length === 1 || (pick.tone === "best" && (chosen == null || chosen === pick.i))) return (
                  <div className={"og-ok" + (late(plan) ? " late" : "")}><b>👍 {where(plan).replace(/^all from /, "All from ")}</b><span>{money(plan.total)} · {ship(plan)}</span>{late(plan) && <em>Arrives after the goods are needed.</em>}
                    {options.length > 1 && <button type="button" className="linkbtn" onClick={() => setChosen(options.findIndex((o) => o !== plan))}>Other ways</button>}</div>
                );
                const easiest = [...options].filter((o) => o.total <= cheap.total + 0.005).sort((a, b) => a.ships - b.ships || a.days - b.days)[0] || cheap;
                const sd = (o: DayOption) => (o.kind === "early" ? o.start : o.days);
                const fastest = [...options].sort((a, b) => sd(a) - sd(b) || a.total - b.total || a.ships - b.ships)[0];
                const choices: [string, DayOption][] = easiest === fastest ? [["Cheapest", easiest]] : [["Easiest", easiest], ["Fastest", fastest]];
                for (const o of options) if (!choices.some(([, c]) => c === o)) choices.push([late(o) ? "Later" : "Another way", o]);
                const cur = options[chosen ?? pick.i];
                const big = (cur?.pcs || 0) > (opts?.money.bigRun || 250);
                const reason = (o: DayOption) => (o !== pick.option ? "" : pick.late ? "Nothing gets here in time: this is the soonest." : need && options.some((x) => late(x)) && !late(o) && options.filter((x) => !late(x)).length === 1 ? `Needed by ${dayShort(need)}: this one is here in time.` : big ? `Over ${opts?.money.bigRun || 250} pcs: start running ${dayShort(arriveOn(sd(o)))}, the last box follows.` : `${opts?.money.bigRun || 250} pcs or less: one box beats a split.`);
                const allSame = options.every((o) => o.total <= cheap.total + 0.005);
                return <>
                  <div className="og-price"><b>{money(plan.total)}</b><span>{allSame ? "cheapest: the same price either way" : plan.total > cheap.total + 0.005 ? `+${money(plan.total - cheap.total)} over the cheapest way` : "the cheapest way"}</span></div>
                  <div className="og-choices" role="radiogroup" aria-label="How it ships">{choices.map(([label, o]) => {
                    const i = options.indexOf(o), on = (chosen ?? pick.i) === i, r = reason(o);
                    return (
                      <div key={i}>
                        <button type="button" role="radio" aria-checked={on} className={"og-ch" + (on ? " on" : "") + (late(o) ? " late" : "")} onClick={() => { setChosen(i); setCheck(null); setSure(false); }}>
                          <span className="og-rd" aria-hidden />
                          <span className="og-cb"><b>{label}: {where(o)}{i === pick.i && <i className="og-tag g">Picked</i>}{late(o) && <i className="og-tag l">late</i>}</b><small>{ship(o)}{o.total > cheap.total + 0.005 ? ` · +${money(o.total - cheap.total)}` : ""}</small></span>
                        </button>
                        {r && <div className="og-why">{r}</div>}
                      </div>
                    );
                  })}</div>
                </>;
              })()}
            </div>}
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
                    <section key={sk} className={"og-wh " + sup} style={{ ["--wc" as string]: sup === "ss" ? "var(--fbs-blue)" : sup === "os" ? "var(--fbs-violet)" : "var(--fbs-salmon)" }}>
                      <div className="og-whs" aria-hidden>{supName(sup)} {w.short}</div>
                      <div className="og-whb">
                        <div className="og-whh"><b>{supName(sup)} · {w.name}</b><span>{here.reduce((n, p) => n + p.qty, 0)} pcs · {money(sub)} · {when}</span></div>
                        {sup === "sm" && !smOn && <div className="og-off">Not ordered here yet: SanMar has to switch on ordering for us. Order these on sanmar.com, or <button type="button" className="linkbtn" onClick={() => { setSsOnly(true); setCheck(null); }}>use S&amp;S only</button>.</div>}
                        <table className="og-wt"><thead><tr><th />{sizes.map((z) => <th key={z}>{z}</th>)}<th /></tr></thead>
                          <tbody>{gks.map((k) => {
                            const xs = wanted.filter((x) => `${x.brand}|${x.style}|${x.color}` === k), f = xs[0];
                            const q = (z: string) => xs.filter((y) => y.size === z).reduce((n, x) => n + here.filter((p) => p.key === x.key).reduce((m, p) => m + p.qty, 0), 0);
                            const xq = (z: string) => xs.filter((y) => y.size === z && y.extra).reduce((n, x) => n + here.filter((p) => p.key === x.key).reduce((m, p) => m + p.qty, 0), 0);
                            return (
                              <tr key={k}>
                                <td data-notranslate><b>{sup === "sm" && opts?.sm[xs[0].key]?.style ? opts.sm[xs[0].key].style : f.style}</b> {f.color}</td>
                                {sizes.map((z) => { const x = xs.find((y) => y.size === z), n = q(z), e = xq(z); return <td key={z} className={!n ? "z" : x && split.has(x.key) ? "p" : ""} title={e ? `${e} extra` : undefined}>{n || "–"}{e ? <sup className="og-xs">+{e}</sup> : null}</td>; })}
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
                {extrasNote}
                <button type="button" className="linkbtn og-edit" onClick={() => setEditing(true)}>{orderId ? "+ Order extra" : "Change quantities"}</button>
              </>;
            })() : <>
            {editing && <button type="button" className="linkbtn og-edit" onClick={() => setEditing(false)}>{orderId ? "Done: show by warehouse" : "Done changing: show by warehouse"}</button>}
            {blanks.map((k) => {
              const xs = lines.filter((x) => `${x.brand}|${x.style}|${x.color}` === k && !x.extra).sort((a, b) => sizeRank(a.size) - sizeRank(b.size)), f = xs[0];
              if (!f) return null;
              const exOf = (x: Row) => lines.find((y) => y.key === x.key + "~x");
              const exN = xs.reduce((a, x) => a + (exOf(x)?.qty || 0), 0), m = metaOf(k);
              return (
                <section key={k} className="og-g">
                  <div className="og-gh"><b data-notranslate>{[f.brand, f.style].filter(Boolean).join(" ")} · {f.color}</b><span>{xs.reduce((a, x) => a + x.qty, 0)}{exN ? ` + ${exN}` : ""}</span></div>
                  <div className="og-sz">{xs.map((x) => {
                    // stock at S&S and SanMar together (Oct 29, Nick: a SanMar-only style read "isn't carried at S&S" while SanMar was still being checked)
                    const src = opts?.srcs[x.key] || [], at = (sup: Sup) => src.filter((y) => y.sup === sup).reduce((n, y) => n + y.stock, 0);
                    const have = at("ss") + at("sm"), tip = opts ? [`S&S: ${x.found ? at("ss") : x.note || "not carried"}`, opts.sanmar ? `SanMar: ${opts.sm[x.key] ? at("sm") : "not carried"}` : ""].filter(Boolean).join(" · ") : "Checking S&S and SanMar…";
                    const cls = !opts ? "" : !have ? "bad" : have < x.qty ? "low" : "", say = !opts ? "checking…" : !have ? (x.found || opts.sm[x.key] ? "out of stock" : "not carried") : have < x.qty ? `${have} left` : "in stock";
                    return (
                    <label key={x.key} className={cls} title={tip}>
                      <span>{x.size}</span>
                      <input type="number" min={0} inputMode="numeric" value={x.qty} readOnly={!!orderId} title={orderId ? "From the order: add extras below" : undefined} aria-label={`${f.style} ${f.color} ${x.size}`} onChange={(e) => { if (orderId) return; const v = Math.max(0, Math.round(+e.target.value || 0)); setRows((rs) => (rs || []).map((y) => (y.key === x.key ? { ...y, qty: v } : y))); setCheck(null); }} />
                      <small>{say}</small>
                    </label>);
                  })}</div>
                  {orderId && editing && <div className="og-x">
                    <div className="og-xh">Extra, not on the order{exN ? `: ${exN}` : ""}</div>
                    <div className="og-sz">{xs.map((x) => (
                      <label key={x.key + "~x"}>
                        <span>{x.size}</span>
                        <input type="number" min={0} inputMode="numeric" value={exOf(x)?.qty || ""} placeholder="–" aria-label={`Extra ${f.style} ${f.color} ${x.size}`} onChange={(e) => setExtra(x, Math.max(0, Math.round(+e.target.value || 0)))} />
                      </label>
                    ))}</div>
                    {exN > 0 && <div className="og-xf">
                      <select value={m.reason} aria-label="Why the extra" onChange={(e) => setMeta(k, { reason: e.target.value })}>{EXTRA_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
                      <select value={`${m.print ? "p" : "b"}${m.shop ? "s" : m.free ? "f" : "c"}`} aria-label="Printed, and who it's for" onChange={(e) => setMeta(k, { print: e.target.value[0] === "p", free: e.target.value[1] !== "c", shop: e.target.value[1] === "s" })}>
                        {(m.shop || m.reason === "Other") && <><option value="ps">Printed, ours (hidden from customer)</option><option value="bs">Not printed, ours (hidden from customer)</option></>}
                        {(!m.shop || m.reason === "Other") && <><option value="pf">Printed, no charge</option><option value="pc">Printed, charged</option><option value="bf">Not printed, no charge</option><option value="bc">Not printed, charged</option></>}
                      </select>
                      {m.reason === "Other" && <input type="text" value={m.other || ""} placeholder="What it's for" aria-label="What the extra is for" onChange={(e) => setMeta(k, { other: e.target.value })} />}
                    </div>}
                  </div>}
                </section>
              );
            })}
            </>}
            {skipped.length > 0 && <p className="faint og-note">Left for now (no blank picked): {skipped.join(", ")}.</p>}
            {(plan as { topUp?: { pcs: number; extra: number; freight: number; amount: number } } | null)?.topUp && (() => { const t = (plan as unknown as { topUp: { pcs: number; extra: number; freight: number; amount: number } }).topUp; return <p className="og-note">Moved {t.pcs} pc{t.pcs === 1 ? "" : "s"} to One Stop to reach $175 for free ground: {money(t.extra)} more in goods instead of about {money(t.freight)} freight.</p>; })()}
            <div className="og-tot"><span>{xPcs ? `${(pcs - xPcs).toLocaleString()} for the order + ${xPcs} extra` : `${pcs.toLocaleString()} pcs`}{plan ? ` · ${plan.ships} shipment${plan.ships === 1 ? "" : "s"}` : opts === null && wanted.length ? " · checking S&S and SanMar…" : ""}</span><b>{plan ? money(total) : "…"}</b></div>
            {owner && plan && opts && plan.parts.length > 0 && <>
              <button type="button" className={"og-pts" + (smParts.length ? "" : " none")} aria-expanded={pointsOpen} onClick={() => setPointsOpen((x) => !x)}>
                <svg viewBox="0 0 24 24" aria-hidden><circle cx="9" cy="9" r="6" /><path d="M15.5 9.5a6 6 0 1 1-6 6" /></svg>{(() => {
                  // nothing to decide when it's all S&S (no card fee, points either way); SanMar only wins after the fee
                  const m = opts.money, pts = (n: number) => Math.round(n * m.ppd) * m.pointValue * (m.tax < 100 ? 100 / (100 - m.tax) : 1);
                  if (!smParts.length) return `No points decision: all S&S, no card fee, +${money(pts(plan.total))} in points`;
                  // the SanMar part against S&S's price for the same sizes (with SanMar's card fee in)
                  let sm = 0, ss = 0, cmp = true;
                  for (const p of smParts) { const s2 = (opts.srcs[p.key] || []).filter((x) => x.sup === "ss").sort((a, b) => a.price - b.price)[0]; if (!s2) { cmp = false; continue; } sm += p.qty * p.each; ss += p.qty * s2.price; }
                  if (!cmp && !ss) return "Points decision: S&S doesn't carry SanMar's part";
                  return sm <= ss ? `Points decision: SanMar is ${money(ss - sm)} cheaper, even with the card fee` : `Points decision: SanMar for speed, ${money(sm - ss)} more than S&S with the fee`;
                })()}<span aria-hidden>{pointsOpen ? "▴" : "▾"}</span>
              </button>
              {pointsOpen && <PointsDecision plan={plan} items={wanted} srcs={opts.srcs} money={opts.money} onMoney={(m) => setOpts((o) => (o ? { ...o, money: m, fee: m.fee } : o))} />}
            </>}
            {opts?.sanmar && <p className="faint og-note og-fee">{feeEdit
              ? <>SanMar card fee <input type="number" step="0.05" min={0} max={19} defaultValue={opts.fee} autoFocus aria-label="SanMar card fee, percent" onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onBlur={(e) => { const v = +e.target.value; setFeeEdit(false); if (isFinite(v) && v !== opts.fee) void setSanmarFee(v).then((r) => { if (r.ok) setOpts((o) => (o ? { ...o, fee: r.fee, money: r.money } : o)); }); }} />%</>
              : <>SanMar prices include our {opts.fee}% card fee; S&amp;S has none, so a tie goes to S&amp;S. <button type="button" className="linkbtn" onClick={() => setFeeEdit(true)}>Change</button>{ssOnly && <> · S&amp;S only. <button type="button" className="linkbtn" onClick={() => { setSsOnly(false); setCheck(null); }}>Show SanMar too</button></>}</>}</p>}
            <div className="field"><label htmlFor="og-po">PO name</label><input id="og-po" type="text" value={po} maxLength={GOODS_PO_MAX} placeholder={defaultGoodsPo({ orderNo, customer: who })} onChange={(e) => { setPo(e.target.value); setCheck(null); }} onBlur={(e) => setPo(cleanGoodsPo(e.target.value))} /><small className="faint">On the S&amp;S and SanMar orders and their boxes. Keep the job number first so receiving matches it.</small></div>
            {ssParts.length > 0 && <div className="field"><label htmlFor="og-ship">S&amp;S shipping</label><select id="og-ship" value={ship} onChange={(e) => { setShip(e.target.value); setCheck(null); }}>{SS_SHIP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>}
            {smParts.length > 0 && smOn && <div className="field"><label htmlFor="og-smship">SanMar shipping</label><select id="og-smship" value={smShip} onChange={(e) => { setSmShip(e.target.value); setCheck(null); }}>{SM_SHIP_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{smShip === "psst" && <small className="faint">We&apos;re a PSST decorator: SanMar ships it its own way (usually UPS Ground), free. Ordered by 1 pm, it ships today.</small>}</div>}
            {osParts.length > 0 && osOn && <div className="og-2f">
              <div className="field"><label htmlFor="og-osship">One Stop shipping</label><select id="og-osship" value={osShip} onChange={(e) => { setOsShip(e.target.value); setCheck(null); }}>{OS_SHIP_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><small className="faint">From Grand Rapids, MI: about 3 days by ground. {osParts.reduce((a, p) => a + p.qty * p.each, 0) >= 175 ? "Ground is free (over $175)." : `Under $175 (${money(osParts.reduce((a, p) => a + p.qty * p.each, 0))}): they charge ground freight; it shows when you check.`}{opts?.onestopLive ? "" : " Orders go to One Stop's test system for now."}</small></div>
              <div className="field og-cvv"><label htmlFor="og-cvv">Card CVV</label><input id="og-cvv" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} /><small className="faint">Card ending 5488. Not saved.</small></div>
            </div>}
            {check && <div className="og-check">Checked with {check.from || "S&S"}: {money(check.total)}{check.expected ? ` · arrives ${new Date(check.expected).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : ""}{check.freight ? ` (includes ${check.freight})` : ""}. Nothing bought yet.</div>}
            {placed && smParts.length > 0 && !smOn && <div className="pv-err">Still to order on sanmar.com: {smParts.map((p) => { const x = byKey.get(p.key)!, r = opts?.sm[p.key]; return `${r?.style || x.style} ${r?.color || x.color} ${r?.size || x.size} × ${p.qty}`; }).join("; ")}</div>}
            {placed && <div className="og-done">Ordered: <b>{placed}</b>. {orderId ? <>It&apos;s linked to #{orderNo ?? ""}.</> : <>It&apos;s saved on this email with a to-do for tomorrow: when you Create order here, it uses these garments and sizes (<Link href="/shop/order-goods">Order goods</Link>).</>}</div>}
          </>}
        </div>}
        {paidAsk && <PaidShipAsk lines={paidAsk} pcs={pcs} onClose={() => setPaidAsk(null)}
          onFree={() => { setPaidAsk(null); setShip(FREE_CODE.ss); setSmShip(FREE_CODE.sm); setCheck(null); setSure(false); }}
          onPay={() => { setPaidAsk(null); void run(false, true); }} />}
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
