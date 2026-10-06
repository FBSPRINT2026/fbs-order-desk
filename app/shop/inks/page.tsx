"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { RIO_RFU, rfuForPms } from "@/lib/rioRfu";

/**
 * Ink Room: every Epic Rio coated PMS color from Avient IMS 3.0, and a mixing calculator. Pick a color, say how much
 * (quarts, gallons, grams, kilos, pounds), get the grams of each Rio mixing ink to weigh out. Formulas are read from
 * IMS at 1 quart; any amount scales from the percentages (quarts use that formula's own weight per quart).
 */
/** pct: as IMS shows it (2 decimals); g: grams for 1 quart (IMS shows them to 0.01 g, so scaling from them is exact) */
type Line = { type: string; code: string; desc: string; pct: number; g?: number };
type Ink = { copies?: number; id: string; code: string; name: string; base: string; hex: string; rec_type: string; ing_count: number | null; lines: Line[] | null; grams_per_qt: number | null; captured_at: string | null; captured_note: string };
type Unit = "qt" | "gal" | "g" | "kg" | "lb" | "oz";
const UNITS: { k: Unit; label: string }[] = [{ k: "qt", label: "Quarts" }, { k: "gal", label: "Gallons" }, { k: "g", label: "Grams" }, { k: "kg", label: "Kilograms" }, { k: "lb", label: "Pounds" }, { k: "oz", label: "Ounces" }];
const PER_G: Record<Exclude<Unit, "qt" | "gal">, number> = { g: 1, kg: 1000, lb: 453.592, oz: 28.3495 };
const QUICK: { label: string; amt: number; unit: Unit }[] = [{ label: "½ qt", amt: 0.5, unit: "qt" }, { label: "1 qt", amt: 1, unit: "qt" }, { label: "2 qt", amt: 2, unit: "qt" }, { label: "1 gal", amt: 1, unit: "gal" }, { label: "500 g", amt: 500, unit: "g" }, { label: "1 kg", amt: 1, unit: "kg" }];
const nice = (s: string) => s.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
const fmtG = (g: number) => g.toFixed(2);
/** grams of one ingredient for the whole batch: from its grams per quart when we have them (exact, like IMS), else
 *  from the percent (IMS rounds those to 2 decimals, so small ingredients can be a little off) */
const gramsOf = (l: Line, perQt: number, totalG: number) => (l.g != null && perQt ? (l.g / perQt) * totalG : (l.pct / 100) * totalG);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export default function InkRoom() {
  const [inks, setInks] = useState<Ink[] | null>(null), [err, setErr] = useState("");
  const [q, setQ] = useState(""), [only, setOnly] = useSticky<"ready" | "all">("inks.only", "all");
  const [tab, setTab] = useSticky<"pms" | "stock">("inks.tab", "pms");
  const [sel, setSel] = useState<Ink | null>(null);
  const [amt, setAmt] = useSticky<string>("inks.amt", "1"), [unit, setUnit] = useSticky<Unit>("inks.unit", "qt");

  useEffect(() => {
    (async () => {
      const sb = createClient(), all: Ink[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("ink_formulas").select("id, code, name, base, hex, rec_type, ing_count, lines, grams_per_qt, captured_at, captured_note").eq("system", "RX").order("code").range(from, from + 999);
        if (error) { setErr(error.message); return; }
        all.push(...((data || []) as Ink[]));
        if (!data || data.length < 1000) break;
      }
      // natural order: 100 C, 101 C … 1795 C … Cool Gray 1 C
      const key = (c: string) => { const m = c.match(/^(\d+)/); return m ? [0, +m[1], c] as const : [1, 0, c] as const; };
      all.sort((a, b) => { const x = key(a.code), y = key(b.code); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]); });
      // IMS keeps some codes more than once (two "186 C", six "7586 C RM"): one tile per code, the one with a formula
      const one = new Map<string, Ink & { copies: number }>();
      for (const i of all) {
        const k = `${i.rec_type}|${norm(i.code)}`, cur = one.get(k);
        if (!cur) one.set(k, { ...i, copies: 1 });
        else one.set(k, { ...(!cur.lines?.length && i.lines?.length ? i : cur), copies: cur.copies + 1 });
      }
      setInks([...one.values()]);
    })();
  }, []);

  const ready = useMemo(() => (inks || []).filter((i) => i.lines?.length).length, [inks]);
  const list = useMemo(() => {
    const t = norm(q).replace(/^(pms|pantone)\s*/, "");
    let xs = (inks || []).filter((i) => (only === "ready" ? !!i.lines?.length : true));
    if (t) {
      const exact = xs.filter((i) => norm(i.code) === t || norm(i.code) === `${t} c`);
      const starts = xs.filter((i) => !exact.includes(i) && norm(i.code).startsWith(t));
      const has = xs.filter((i) => !exact.includes(i) && !starts.includes(i) && (norm(i.code).includes(t) || norm(i.name).includes(t)));
      xs = [...exact, ...starts, ...has];
    }
    return xs.slice(0, 240);
  }, [inks, q, only]);

  // total grams for the amount asked for
  const n = Math.max(0, parseFloat(amt) || 0);
  const totalG = !sel?.grams_per_qt ? 0 : unit === "qt" ? n * sel.grams_per_qt : unit === "gal" ? n * 4 * sel.grams_per_qt : n * PER_G[unit];
  const qts = sel?.grams_per_qt ? totalG / sel.grams_per_qt : 0;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Production</div><h1>Ink Room</h1></div>
        <div className="faint" style={{ fontSize: 13 }}>{inks ? `${inks.length.toLocaleString()} Epic Rio coated colors · ${ready} with formulas` : "Loading colors…"}</div>
      </div>
      {err && <div className="pv-err">{err}</div>}
      <div className="ink-wrap">
        <section className="panel ink-list">
          <div className="panel-b stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6 }} role="tablist">
              <button type="button" role="tab" aria-selected={tab === "pms"} className={"chip" + (tab === "pms" ? " on" : "")} onClick={() => setTab("pms")}>PMS formulas</button>
              <button type="button" role="tab" aria-selected={tab === "stock"} className={"chip" + (tab === "stock" ? " on" : "")} onClick={() => setTab("stock")}>Rio RFU stock colors ({RIO_RFU.length})</button>
            </div>
            {tab === "stock" ? (
              <>
                <div className="faint" style={{ fontSize: 13 }}>Ready-for-use inks, no mixing. The PMS is Avient&apos;s approximate match from the Rio RFU color card.</div>
                <div className="ink-grid">{RIO_RFU.map((r) => {
                  const f = (inks || []).find((i) => i.rec_type === "S" && norm(i.code) === norm(r.pms));
                  return (
                    <button key={r.name} type="button" className={"ink-tile stock" + (sel && f && sel.id === f.id ? " on" : "")} onClick={() => f && setSel(f)} disabled={!f} title={`${r.name}${r.product ? ` (${r.product})` : ""} ≈ PMS ${r.pms}`}>
                      <i style={{ background: r.hex }} />
                      <b>{r.name}</b>
                      <small data-notranslate>{r.product ? `${r.product} · ` : ""}≈ PMS {r.pms}</small>
                    </button>
                  );
                })}</div>
              </>
            ) : (<>
            <input className="ink-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a color: 186, 7527, Cool Gray 7, Warm Red…" aria-label="Find a color" autoFocus />
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button type="button" className={"chip" + (only === "all" ? " on" : "")} onClick={() => setOnly("all")}>All colors</button>
              <button type="button" className={"chip" + (only === "ready" ? " on" : "")} onClick={() => setOnly("ready")}>With formulas ({ready})</button>
            </div>
            {!inks ? <div className="faint">Loading…</div> : !list.length ? <div className="faint">No color matches “{q}”.</div> : (
              <div className="ink-grid">{list.map((i) => (
                <button key={i.id} type="button" className={"ink-tile" + (sel?.id === i.id ? " on" : "") + (i.lines?.length ? " has" : "")} onClick={() => setSel(i)} title={i.name}>
                  <i style={{ background: i.hex || "#ddd" }} />
                  <b data-notranslate>{i.code}</b>
                  <small>{i.rec_type === "U" ? (i.lines?.length ? "Shop mix ✓" : "Shop mix · not read") : i.lines?.length ? "Formula ✓" : "Not read yet"}</small>
                  {i.rec_type === "S" && rfuForPms(i.code) && <small className="ink-instock">Stock: {rfuForPms(i.code)!.name}</small>}
                </button>
              ))}</div>
            )}
            {inks && list.length === 240 && <div className="faint" style={{ fontSize: 12.5 }}>Showing the first 240. Type more of the number to narrow it down.</div>}
            </>)}
          </div>
        </section>

        <section className="panel ink-calc" aria-live="polite">
          {!sel ? <div className="panel-b faint">Pick a color to see its formula and how much of each ink to weigh out.</div> : (
            <div className="panel-b stack" style={{ gap: 14 }}>
              <div className="ink-head">
                <i style={{ background: sel.hex || "#ddd" }} />
                <div><h2 data-notranslate>{sel.code}</h2><div className="faint" data-notranslate>{sel.name}{sel.rec_type === "U" ? " · our own mix (IMS user formula)" : " · Epic Rio"}{(sel.copies || 1) > 1 ? ` · IMS has ${sel.copies} formulas with this code` : ""}</div></div>
              </div>
              {(() => { const r = sel.rec_type === "S" ? rfuForPms(sel.code) : null; return r ? (
                <div className="ink-stock"><i style={{ background: r.hex }} /><span><b>In stock: Rio RFU {r.name}{r.product ? ` (${r.product})` : ""}</b>Avient&apos;s ready-for-use {r.name} is about PMS {r.pms}. Use it straight from the can, or mix below for an exact match.</span></div>
              ) : null; })()}
              {!sel.lines?.length ? (
                <div className="ink-none">
                  <b>This formula hasn’t been read from IMS yet.</b>
                  <span>It has {sel.ing_count || "a few"} ingredients in IMS. Look it up there for now (Standard Formulas → type the code). It’ll show here once it’s read.</span>
                </div>
              ) : (
                <>
                  <div className="ink-amt">
                    <label>How much?<input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount" /></label>
                    <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit">{UNITS.map((u) => <option key={u.k} value={u.k}>{u.label}</option>)}</select>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{QUICK.map((x) => <button key={x.label} type="button" className={"chip" + (+amt === x.amt && unit === x.unit ? " on" : "")} onClick={() => { setAmt(String(x.amt)); setUnit(x.unit); }}>{x.label}</button>)}</div>
                  <table className="ink-tbl">
                    <thead><tr><th>Weigh out</th><th className="r">Grams</th><th className="r">%</th></tr></thead>
                    <tbody>{sel.lines.map((l, k) => (
                      <tr key={k}>
                        <td><b data-notranslate>{l.type === "RM" ? l.desc : nice(l.desc)}</b><small data-notranslate>{l.code}{l.type === "RM" ? " · recycled ink" : l.type === "ADD" ? " · additive" : ""}</small></td>
                        <td className="r ink-g">{fmtG(gramsOf(l, sel.grams_per_qt!, totalG))}</td>
                        <td className="r faint">{l.pct.toFixed(2)}%</td>
                      </tr>
                    ))}</tbody>
                    <tfoot><tr><td>Total</td><td className="r ink-g">{fmtG(totalG)} g</td><td className="r faint">{qts ? `${qts.toFixed(2)} qt` : ""}</td></tr></tfoot>
                  </table>
                  <div className="faint" style={{ fontSize: 12.5 }}>{sel.grams_per_qt} g per quart for this color. {sel.captured_note}{sel.captured_at ? ` (${new Date(sel.captured_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})` : ""}.</div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
