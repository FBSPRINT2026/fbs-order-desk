"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { GoodsRow } from "@/lib/ssMatch";
import { createClient } from "@/lib/supabase/client";
import type { EODraft } from "@/lib/emailOrderShared";
import type { Group } from "@/lib/pricing";
import { money } from "@/lib/format";
import { sizeRank } from "@/lib/sizeOrder";
import GoodsAsk, { type GoodsItem, type GoodsPick } from "@/components/GoodsAsk";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";
import type { PreferredGood } from "@/lib/preferredGoods";
import { goodsFromGroups, placeGoods } from "@/app/shop/order-goods/actions";

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
  const [goodsAsk, setGoodsAsk] = useState<{ items: GoodsItem[]; prefs: PreferredGood[]; company: string; done: (a: Record<string, GoodsPick> | null) => void } | null>(null);
  const [colorAsk, setColorAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null), [skipped, setSkipped] = useState<string[]>([]);
  const [ship, setShip] = useState("40"), [busy, setBusy] = useState(""), [check, setCheck] = useState<{ total: number; expected: string | null; from: string } | null>(null), [sure, setSure] = useState(false);
  const [placed, setPlaced] = useState<string>(""), [min, setMin] = useState(false);
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
        // 2. which blank, when the email doesn't say
        const blank = groups.flatMap((x) => x.lines).filter((l) => !String(l.style || "").trim() && (l.color || Object.values(l.sizes || {}).some((n) => +(n || 0) > 0)));
        const usual: Record<string, string[]> = {};
        if (blank.length) {
          step("Finding the garment…");
          const { data: cu } = g.customer?.id ? await createClient().from("customers").select("preferred_goods, company, name").eq("id", g.customer.id).maybeSingle() : { data: null };
          const prefs = (((cu as { preferred_goods?: PreferredGood[] } | null)?.preferred_goods) || []).filter((x) => x && x.style);
          const company = String((cu as { company?: string } | null)?.company || (cu as { name?: string } | null)?.name || "This customer");
          const byKey = new Map<string, GoodsItem>();
          for (const l of blank) {
            const k = (l.called || "").toLowerCase().trim() || `line:${l.id}`;
            const e = byKey.get(k) || { key: k, called: l.called || l.garment || "", colors: [], pcs: 0 };
            if (l.color && !e.colors.includes(l.color)) e.colors.push(l.color);
            e.pcs += Object.values(l.sizes || {}).reduce((a, n) => a + (+(n || 0)), 0);
            byKey.set(k, e);
          }
          const items = [...byKey.values()];
          const ans = (await waitFor<Record<string, GoodsPick> | null>((resolve) => setGoodsAsk({ items, prefs, company, done: resolve }))) || {};
          setGoodsAsk(null);
          const left: string[] = [], remember: PreferredGood[] = [];
          groups = groups.map((x) => ({ ...x, lines: x.lines.map((l) => {
            if (String(l.style || "").trim()) return l;
            const p = ans[(l.called || "").toLowerCase().trim() || `line:${l.id}`];
            return p ? { ...l, style: p.style, brand: p.brand || l.brand, garment: l.garment || p.name, called: undefined } : l;
          }) }));
          for (const it of items) {
            const p = ans[it.key];
            if (!p) { left.push(it.called || "a garment"); continue; }
            const pref = prefs.find((x) => x.style.toUpperCase() === p.style.toUpperCase());
            if (pref?.colors?.length) usual[p.style.toUpperCase()] = pref.colors;
            if (p.remember && !pref) remember.push({ id: Math.random().toString(36).slice(2, 10), kind: it.called || "garment", rank: prefs.filter((x) => x.kind.toLowerCase() === (it.called || "garment").toLowerCase()).length + 1, style: p.style, brand: p.brand, name: p.name, colors: it.colors, notes: "" });
          }
          if (remember.length && g.customer?.id) await createClient().from("customers").update({ preferred_goods: [...prefs, ...remember] }).eq("id", g.customer.id);
          setSkipped(left);
        }
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
  const status = err ? "Stopped: " + err.slice(0, 60) : goodsAsk ? "Waiting for you: which blank?" : colorAsk ? "Waiting for you: which color?" : placed ? `Ordered: ${placed}` : rows ? `Ready: ${rows.reduce((a, x) => a + x.qty, 0).toLocaleString()} pcs to check and order` : steps.find((s) => s.state === "doing")?.label || "Working…";

  const lines = rows || [];
  const blanks = [...new Map(lines.map((x) => [`${x.brand}|${x.style}|${x.color}`, x])).keys()];
  const total = lines.reduce((a, x) => a + (x.found ? x.qty * (x.price || 0) : 0), 0), pcs = lines.reduce((a, x) => a + x.qty, 0);
  const ready = lines.filter((x) => x.found && x.qty > 0);
  const label = `${who || "Goods"}`.slice(0, 50);
  async function run(test: boolean) {
    setBusy(test ? "check" : "place"); setErr("");
    const r = await placeGoods({ lines: ready.map((x) => ({ sku: x.sku, qty: x.qty, label: `${x.brand} ${x.style} ${x.color} ${x.size}`, price: x.price })), shippingMethod: ship, test, label, customerId: cust?.id || null, activityId });
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    const res = (r as { results?: { orderNumber: string; warehouse: string; total: number; expected: string | null }[] }).results || [];
    if (test) { setCheck({ total: res.reduce((a, x) => a + (x.total || 0), 0), expected: res.map((x) => x.expected).filter(Boolean).sort().pop() || null, from: [...new Set(res.map((x) => x.warehouse))].join(", ") }); setSure(false); }
    else setPlaced(res.map((x) => x.orderNumber).join(", ") || "placed");
  }

  // tucked away, the panel stays as it was (a question half answered stays half answered) and only a bar shows
  return (<>
    {min && <button type="button" className="og-mini" onClick={() => setMin(false)} {...swipe("up")} aria-label="Order goods: open it again">
      <span className="og-grab" aria-hidden />
      <span className={"og-dot" + (goodsAsk || colorAsk ? " ask" : rows ? " ok" : "")} aria-hidden />
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
        {goodsAsk && <GoodsAsk items={goodsAsk.items} prefs={goodsAsk.prefs} company={goodsAsk.company} onDone={(a) => goodsAsk.done(a)} onCancel={cancel} />}
        {colorAsk && <ColorCheck inline rows={colorAsk.rows} onDone={(r) => colorAsk.done(r)} onCancel={cancel} />}
        {rows && <div className="og-list">
          {!lines.length ? <p className="faint">Nothing to order: no garment with a style and sizes.{skipped.length ? ` Left for now: ${skipped.join(", ")}.` : ""}</p> : <>
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
            {skipped.length > 0 && <p className="faint og-note">Left for now (no blank picked): {skipped.join(", ")}.</p>}
            <div className="og-tot"><span>{pcs.toLocaleString()} pcs</span><b>{money(total)}</b></div>
            <div className="field"><label htmlFor="og-ship">Shipping</label><select id="og-ship" value={ship} onChange={(e) => { setShip(e.target.value); setCheck(null); }}>{SHIP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            {check && <div className="og-check">Checked with S&amp;S: {money(check.total)}{check.from ? ` · ships from ${check.from}` : ""}{check.expected ? ` · arrives ${new Date(check.expected).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}` : ""}. Nothing bought yet.</div>}
            {placed && <div className="og-done">Ordered with S&amp;S: <b>{placed}</b>. It&apos;s on <Link href="/shop/order-goods">Order goods</Link> to link to its order.</div>}
          </>}
        </div>}
        <div className="dla-acts og-foot">
          <button type="button" className="btn og-view" onClick={() => setMin(true)}>
            <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>View email
          </button>
          {rows && lines.length > 0 && !placed && (!check
            ? <button type="button" className="btn primary" disabled={!!busy || !ready.length} onClick={() => void run(true)}>{busy === "check" ? "Checking…" : "Check with S&S"}</button>
            : !sure ? <button type="button" className="btn primary" disabled={!!busy} onClick={() => setSure(true)}>Place order</button>
              : <button type="button" className="btn primary og-sure" disabled={!!busy} onClick={() => void run(false)}>{busy === "place" ? "Ordering…" : `Yes, buy it (${money(check.total)})`}</button>)}
          {placed && <button type="button" className="btn primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  </>);
}
