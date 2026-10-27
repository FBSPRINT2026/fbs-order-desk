"use client";
import { useState } from "react";
import { money as $ } from "@/lib/format";
import type { Plan, Src } from "@/lib/goodsPlan";
import { setGoodsMoney, type GoodsMoney } from "@/app/shop/order-goods/actions";

/**
 * Order goods → Points decision (owners only; Oct 27, Nick: "a button that shows points… drop down that menu… so it's
 * like, oh, this is exactly the decision you're making"). The goods in the picked plan, priced at each supplier and paid
 * by card (we always pay by card): S&S has no card fee, SanMar charges ours; both earn points (2 a dollar, 1¢ a point,
 * worth a little more because the points aren't taxed). SanMar on terms is shown for reference.
 */
type Col = { id: string; label: string; sup?: "ss" | "sm"; goods: number; fee: number; card: boolean; missing: number; each: number | null };

export default function PointsDecision({ plan, items, srcs, money, onMoney }: { plan: Plan; items: { key: string; qty: number }[]; srcs: Record<string, Src[]>; money: GoodsMoney; onMoney: (m: GoodsMoney) => void }) {
  const [edit, setEdit] = useState(false), [err, setErr] = useState("");
  const want = items.filter((i) => plan.parts.some((p) => p.key === i.key));
  // the same goods all from one supplier, at its price (stock aside)
  const all = (sup: "ss" | "sm", card: boolean, id: string, label: string): Col => {
    let goods = 0, missing = 0; const prices = new Set<number>();
    for (const it of want) {
      const s = (srcs[it.key] || []).filter((x) => x.sup === sup && x.price > 0).sort((a, b) => a.price - b.price)[0];
      if (!s) { missing += it.qty; continue; }
      goods += s.price * it.qty; prices.add(s.price);
    }
    return { id, label, sup, goods, fee: card && sup === "sm" ? goods * money.fee / 100 : 0, card, missing, each: prices.size === 1 ? [...prices][0] : null };
  };
  const mixed = new Set(plan.parts.map((p) => p.sup)).size > 1;
  const thisGoods = plan.parts.reduce((a, p) => a + p.qty * (p.sup === "sm" ? p.each / (1 + money.fee / 100) : p.each), 0);
  const cols: Col[] = [
    ...(mixed ? [{ id: "plan", label: "This plan", goods: thisGoods, fee: plan.fee, card: true, missing: 0, each: null } as Col] : []),
    all("ss", true, "ss", "S&S card"), all("sm", true, "sm", "SanMar card"), all("sm", false, "smt", "SanMar terms"),
  ].filter((c) => c.goods > 0);
  const calc = (c: Col) => {
    const pay = c.goods + c.fee, pts = c.card ? Math.round(pay * money.ppd) : 0, ptd = pts * money.pointValue, tax = money.tax < 100 ? ptd * (money.tax / (100 - money.tax)) : 0;
    return { pay, pts, ptd, tax, real: pay - ptd - tax };
  };
  const v = Object.fromEntries(cols.map((c) => [c.id, calc(c)]));
  const card = cols.filter((c) => c.card && !c.missing);
  const best = card.slice().sort((a, b) => v[a.id].real - v[b.id].real)[0], next = card.filter((c) => c !== best).sort((a, b) => v[a.id].real - v[b.id].real)[0];
  const row = (label: string, f: (c: Col) => string, cls?: (c: Col) => string) => (
    <tr><td>{label}</td>{cols.map((c) => <td key={c.id} className={[c === best ? "w" : "", cls?.(c) || ""].join(" ")}>{f(c)}</td>)}</tr>
  );
  async function save(p: Partial<GoodsMoney>) {
    const r = await setGoodsMoney(p);
    if (r.ok) { onMoney(r.money); setErr(""); } else setErr(r.error);
  }
  return (
    <div className="pd">
      <div className="pd-h"><span>The same goods at each, paid by card</span><span className="faint">Only owners see this</span></div>
      <div className="tbl-wrap"><table className="pd-t">
        <thead><tr><th />{cols.map((c) => <th key={c.id} className={c === best ? "w" : ""}>{c.sup ? <span className={"pd-sup " + c.sup}>{c.sup === "ss" ? "S&S" : "SanMar"}</span> : null} {c.id === "plan" ? "This plan" : c.card ? "card" : "terms"}</th>)}</tr></thead>
        <tbody>
          {cols.some((c) => c.each != null) && row("Price each", (c) => (c.each != null ? $(c.each) : "–"))}
          {row("Goods", (c) => $(c.goods) + (c.missing ? "*" : ""))}
          {row("Card fee", (c) => (c.fee ? "+" + $(c.fee) : $(0)), (c) => (c.fee ? "bad" : ""))}
          {row("You pay", (c) => $(v[c.id].pay))}
          {row("Points", (c) => v[c.id].pts.toLocaleString("en-US"))}
          {row("Point dollars", (c) => (v[c.id].ptd ? "−" + $(v[c.id].ptd) : $(0)), (c) => (v[c.id].ptd ? "good" : ""))}
          {row(`Tax you don't pay (${money.tax}%)`, (c) => (v[c.id].tax ? "−" + $(v[c.id].tax) : $(0)), (c) => (v[c.id].tax ? "good" : ""))}
          <tr className="pd-real"><td>Real cost</td>{cols.map((c) => <td key={c.id} className={c === best ? "w" : ""}>{$(v[c.id].real)}</td>)}</tr>
        </tbody>
      </table></div>
      {best && next && <div className="pd-win">{best.label === "This plan" ? "This plan" : best.label.replace(" card", "")} by card: {$(v[next.id].real - v[best.id].real)} less than {next.label === "This plan" ? "this plan" : next.label.replace(" card", "")} by card</div>}
      {cols.some((c) => c.missing) && <p className="faint pd-note">* Not every size is sold there, so that total leaves some out.</p>}
      {err && <p className="pv-err">{err}</p>}
      <p className="faint pd-note">{edit ? <span className="pd-edit">
        <label>Points a dollar <input type="number" step="0.5" min={0} defaultValue={money.ppd} onBlur={(e) => void save({ ppd: +e.target.value })} /></label>
        <label>¢ a point <input type="number" step="0.1" min={0} defaultValue={Math.round(money.pointValue * 1000) / 10} onBlur={(e) => void save({ pointValue: +e.target.value / 100 })} /></label>
        <label>Tax % <input type="number" step="1" min={0} defaultValue={money.tax} onBlur={(e) => void save({ tax: +e.target.value })} /></label>
        <label>SanMar fee % <input type="number" step="0.05" min={0} defaultValue={money.fee} onBlur={(e) => void save({ fee: +e.target.value })} /></label>
        <button type="button" className="linkbtn" onClick={() => setEdit(false)}>Done</button></span>
        : <>{money.ppd} points a dollar · {Math.round(money.pointValue * 1000) / 10}¢ a point · {money.tax}% tax · SanMar card fee {money.fee}% · <button type="button" className="linkbtn" onClick={() => setEdit(true)}>Change</button></>}</p>
    </div>
  );
}
