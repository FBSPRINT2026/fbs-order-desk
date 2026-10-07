"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { useCan } from "@/components/RoleContext";
import InkInventory from "@/components/InkInventory";

/**
 * Ink Room: every Epic Rio coated PMS color from Avient IMS 3.0, and a mixing calculator. Pick a color, say how much
 * (quarts, gallons, grams, kilos, pounds), get the grams of each Rio mixing ink to weigh out. Formulas are read from
 * IMS at 1 quart; any amount scales from the percentages (quarts use that formula's own weight per quart).
 * Stock colors: the ready-to-use inks on the shelf (Wilflex Rio RFU, Monarch Color, any brand), from stock_inks, each
 * with its nearest PMS so a PMS formula can say "we have this in stock". A maker's whole line can be on file; managers
 * (the inkStock permission) switch on the colors actually on our shelf, and everyone else sees only those. Added,
 * edited and archived here (never deleted).
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
/** where a stock ink shows on the Stock colors tab, top to bottom */
type Section = "rfu" | "color" | "base" | "mixing";
const SECTIONS: { k: Section; title: string; pick: string }[] = [
  { k: "rfu", title: "Wilflex Rio RFU", pick: "Wilflex Rio RFU" },
  { k: "color", title: "Other stock colors", pick: "Other stock colors (InkTek, Monarch, shimmers…)" },
  { k: "base", title: "Whites, bases & additives", pick: "Whites, bases & additives" },
  { k: "mixing", title: "Ink mixing system", pick: "Ink mixing system (Rio Mix)" },
];
type Stock = { id: string; brand: string; line: string; name: string; product: string; pms: string; hex: string; notes: string; sort: number; stocked: boolean; section: Section };
type Draft = Omit<Stock, "id" | "sort"> & { id?: string };
const BLANK: Draft = { brand: "", line: "", name: "", product: "", pms: "", hex: "#cccccc", notes: "", stocked: true, section: "color" };
/** "186" / "186c" / "186 c" → "186 C"; anything else (Cool Gray 7 C, 072 C Blue) is kept, with spaces tidied */
const tidyPms = (s: string) => { const t = s.replace(/^(pms|pantone)\s*/i, "").replace(/\s+/g, " ").trim(); const m = t.match(/^(\d{3,4})\s*c?$/i); return m ? `${m[1]} C` : t; };
const stockLabel = (x: Stock) => [x.brand, x.line].filter(Boolean).join(" ");


export default function InkRoom() {
  const [inks, setInks] = useState<Ink[] | null>(null), [err, setErr] = useState("");
  const [stock, setStock] = useState<Stock[] | null>(null);
  const [q, setQ] = useState("");
  const [sq, setSq] = useState(""), [choosing, setChoosing] = useState(false);
  const canStock = useCan("inkStock");
  const [tab, setTab] = useSticky<"pms" | "stock" | "inventory">("inks.tab", "pms");
  const [sel, setSel] = useState<Ink | null>(null), [selStock, setSelStock] = useState<Stock | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [formErr, setFormErr] = useState("");
  const [amt, setAmt] = useSticky<string>("inks.amt", "1"), [unit, setUnit] = useSticky<Unit>("inks.unit", "qt");

  useEffect(() => {
    (async () => {
      const sb = createClient(), all: Ink[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("ink_formulas").select("id, code, name, base, hex, rec_type, ing_count, lines, grams_per_qt, captured_at, captured_note").eq("system", "RX").is("archived_at", null).order("code").range(from, from + 999);
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
    loadStock();
  }, []);

  async function loadStock() {
    const { data, error } = await createClient().from("stock_inks").select("id, brand, line, name, product, pms, hex, notes, sort, stocked, section").is("archived_at", null).order("brand").order("sort").order("name");
    if (error) setErr(error.message); else setStock((data || []) as Stock[]);
  }

  /** Epic Rio standard formula for a PMS code */
  const formulaFor = (pms: string) => (pms ? (inks || []).find((i) => i.rec_type === "S" && !!i.lines?.length && norm(i.code) === norm(pms)) || null : null);
  /** stock inks that are about this PMS */
  const stockFor = (code: string) => (stock || []).filter((x) => x.stocked && x.pms && norm(x.pms) === norm(code));

  const ready = useMemo(() => (inks || []).filter((i) => i.rec_type === "S" && i.lines?.length).length, [inks]);
  const list = useMemo(() => {
    const t = norm(q).replace(/^(pms|pantone)\s*/, "");
    // the chart shows only Epic Rio standard formulas that have been read from IMS (and checked); the rest of the IMS
    // list and the shop's own IMS mixes stay in the table, out of sight, until a read fills them in
    let xs = (inks || []).filter((i) => i.rec_type === "S" && !!i.lines?.length);
    if (t) {
      const exact = xs.filter((i) => norm(i.code) === t || norm(i.code) === `${t} c`);
      const starts = xs.filter((i) => !exact.includes(i) && norm(i.code).startsWith(t));
      const has = xs.filter((i) => !exact.includes(i) && !starts.includes(i) && (norm(i.code).includes(t) || norm(i.name).includes(t)));
      xs = [...exact, ...starts, ...has];
    }
    return xs;
  }, [inks, q]);
  // the chart in three parts: the regular PMS formulas, then IMS's High Opacity ("… C HO") formulas, then the ones
  // adjusted for printing over an underbase ("… C UB"); the regular part shows at most 240 at a time
  const parts = useMemo(() => {
    const kind = (c: string) => (/(^|[^a-z])ho([^a-z]|$)/i.test(c) ? "ho" : /(^|[^a-z])ub([^a-z]|$)/i.test(c) ? "ub" : "std");
    const std = list.filter((i) => kind(i.code) === "std");
    return [
      { k: "std", title: "", xs: std.slice(0, 240), more: std.length > 240 },
      { k: "ho", title: "High Opacity", xs: list.filter((i) => kind(i.code) === "ho"), more: false },
      { k: "ub", title: "Adjusted for Underbase", xs: list.filter((i) => kind(i.code) === "ub"), more: false },
    ].filter((x) => x.xs.length);
  }, [list]);

  // stock colors, grouped by brand and line, filtered by the search
  const groups = useMemo(() => {
    const t = norm(sq).replace(/^(pms|pantone)\s*/, "");
    const order = (x: Stock) => SECTIONS.findIndex((s) => s.k === x.section);
    // whites, then bases, then additives in their section; every other section by maker
    const sub = (x: Stock) => (x.section !== "base" ? 0 : /white/i.test(x.name + " " + x.line) ? 0 : /base/i.test(x.name + " " + x.line) ? 1 : 2);
    const all = [...(stock || [])].sort((a, b) => order(a) - order(b) || sub(a) - sub(b) || a.brand.localeCompare(b.brand) || a.sort - b.sort || a.name.localeCompare(b.name));
    // on the shelf: one group per section (Rio RFU, every other color together, whites/bases/additives, the Rio Mix
    // mixing system); while choosing: one group per maker's line, so a whole line can be gone through at once
    const m = new Map<string, { section: Section; xs: Stock[] }>();
    for (const x of all) {
      const k = choosing ? stockLabel(x) || "Other" : SECTIONS.find((s) => s.k === x.section)?.title || "Other";
      const g = m.get(k) || { section: x.section, xs: [] }; g.xs.push(x); m.set(k, g);
    }
    // each group: the colors to show (all of them while choosing, else only what's on the shelf), and how many are stocked
    return [...m.entries()].map(([g, { section, xs }]) => ({ g, section, on: xs.filter((x) => x.stocked).length, total: xs.length, xs: xs.filter((x) => (choosing || x.stocked) && (!t || [x.name, x.brand, x.line, x.product, x.pms].some((v) => norm(v).includes(t)))) })).filter((x) => x.xs.length);
  }, [stock, sq, choosing]);
  const stockedN = (stock || []).filter((x) => x.stocked).length;
  const brands = useMemo(() => [...new Set((stock || []).map((x) => x.brand).filter(Boolean))].sort(), [stock]);
  const lines = useMemo(() => [...new Set((stock || []).filter((x) => !edit?.brand || x.brand === edit.brand).map((x) => x.line).filter(Boolean))].sort(), [stock, edit?.brand]);

  function pickStock(x: Stock) { setSelStock(x); setSel(formulaFor(x.pms)); setEdit(null); }
  function pickInk(i: Ink) { setSel(i); setSelStock(null); setEdit(null); }
  function startAdd() { setFormErr(""); setEdit({ ...BLANK, brand: selStock?.brand || "", line: selStock?.line || "" }); }
  function startEdit(x: Stock) { setFormErr(""); setEdit({ id: x.id, brand: x.brand, line: x.line, name: x.name, product: x.product, pms: x.pms, hex: x.hex || "#cccccc", notes: x.notes, stocked: x.stocked, section: x.section }); }

  async function save() {
    if (!edit) return;
    const row = { brand: edit.brand.trim(), line: edit.line.trim(), name: edit.name.trim(), product: edit.product.trim(), pms: tidyPms(edit.pms), hex: /^#[0-9a-f]{6}$/i.test(edit.hex) ? edit.hex.toUpperCase() : "", notes: edit.notes.trim(), stocked: edit.stocked, section: edit.section };
    if (!row.name) { setFormErr("Give the color a name."); return; }
    setBusy(true); setFormErr("");
    const sb = createClient();
    let res;
    if (edit.id) res = await sb.from("stock_inks").update({ ...row, updated_at: new Date().toISOString() }).eq("id", edit.id).select("id, brand, line, name, product, pms, hex, notes, sort, stocked, section").single();
    else {
      const { data: u } = await sb.auth.getUser();
      const sort = Math.max(0, ...(stock || []).filter((x) => x.brand === row.brand && x.line === row.line).map((x) => x.sort)) + 1;
      res = await sb.from("stock_inks").insert({ ...row, sort, created_by: u.user?.email || "" }).select("id, brand, line, name, product, pms, hex, notes, sort, stocked, section").single();
    }
    setBusy(false);
    if (res.error) { setFormErr(res.error.message); return; }
    await loadStock();
    const x = res.data as Stock;
    setEdit(null); setTab("stock"); setSelStock(x); setSel(formulaFor(x.pms));
  }

  /** switch a color on or off the shelf (managers, while choosing) */
  async function toggleStocked(x: Stock) {
    const stocked = !x.stocked;
    setStock((cur) => (cur || []).map((y) => (y.id === x.id ? { ...y, stocked } : y)));
    const { error } = await createClient().from("stock_inks").update({ stocked, updated_at: new Date().toISOString() }).eq("id", x.id);
    if (error) { setErr(error.message); setStock((cur) => (cur || []).map((y) => (y.id === x.id ? { ...y, stocked: !stocked } : y))); }
  }

  async function archive() {
    if (!edit?.id) return;
    setBusy(true);
    const { error } = await createClient().from("stock_inks").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", edit.id);
    setBusy(false);
    if (error) { setFormErr(error.message); return; }
    setEdit(null); setSelStock(null); setSel(null); loadStock();
  }

  // total grams for the amount asked for
  const n = Math.max(0, parseFloat(amt) || 0);
  const totalG = !sel?.grams_per_qt ? 0 : unit === "qt" ? n * sel.grams_per_qt : unit === "gal" ? n * 4 * sel.grams_per_qt : n * PER_G[unit];
  const qts = sel?.grams_per_qt ? totalG / sel.grams_per_qt : 0;
  const draftPms = edit ? tidyPms(edit.pms) : "", draftF = edit && draftPms ? formulaFor(draftPms) : null;

  const tabs = (
    <div className="row" style={{ gap: 6 }} role="tablist">
      <button type="button" role="tab" aria-selected={tab === "pms"} className={"chip" + (tab === "pms" ? " on" : "")} onClick={() => setTab("pms")}>PMS formulas</button>
      <button type="button" role="tab" aria-selected={tab === "stock"} className={"chip" + (tab === "stock" ? " on" : "")} onClick={() => setTab("stock")}>Stock colors{stock ? ` (${stockedN})` : ""}</button>
      <button type="button" role="tab" aria-selected={tab === "inventory"} className={"chip" + (tab === "inventory" ? " on" : "")} onClick={() => setTab("inventory")}>Inventory</button>
    </div>
  );
  const head = (
    <div className="page-head">
      <div><div className="eyebrow">Production</div><h1>Ink Room</h1></div>
      <div className="faint" style={{ fontSize: 13 }}>{inks ? `${ready} Epic Rio PMS formulas` : "Loading colors…"}{stock ? ` · ${stockedN} stock colors on the shelf` : ""}</div>
    </div>
  );
  if (tab === "inventory") return (
    <>
      {head}
      {err && <div className="pv-err">{err}</div>}
      <section className="panel"><div className="panel-b stack" style={{ gap: 12 }}>
        {tabs}
        {!inks || !stock ? <div className="faint">Loading…</div> : <InkInventory stock={stock} formulas={inks} canStock={canStock} />}
      </div></section>
    </>
  );

  return (
    <>
      {head}
      {err && <div className="pv-err">{err}</div>}
      <div className="ink-wrap">
        <section className="panel ink-list">
          <div className="panel-b stack" style={{ gap: 10 }}>
            {tabs}
            {tab === "stock" ? (
              <>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input className="ink-q" type="search" value={sq} onChange={(e) => setSq(e.target.value)} placeholder="Find a stock color: Bora Bora, Monarch, 186…" aria-label="Find a stock color" style={{ flex: 1 }} />
                  {canStock && <button type="button" className={"btn" + (choosing ? " primary" : "")} onClick={() => { setChoosing(!choosing); setEdit(null); }} aria-pressed={choosing}>{choosing ? "Done choosing" : "Choose what we stock"}</button>}
                  {canStock && !choosing && <button type="button" className="btn" onClick={startAdd}>+ Add stock color</button>}
                </div>
                <div className="faint" style={{ fontSize: 13 }}>{choosing ? "Every color on file from each maker. Tap a color to switch it on or off the shelf; only the ones switched on show for everyone else and in the PMS formulas." : "Ready-to-use inks on our shelf, no mixing. The PMS is the maker's nearest match from their color chart."}</div>
                {!stock ? <div className="faint">Loading…</div> : !groups.length ? <div className="faint">{sq ? `No stock color matches “${sq}”.` : canStock ? "Nothing is switched on yet. Use “Choose what we stock”." : "No stock colors yet."}</div> : groups.map(({ g, section, xs, on, total }) => (
                  <div key={g} className={"ink-group" + (section === "mixing" && !choosing ? " ink-mixsys" : "")}>
                    <h3>{g} <span className="faint">{choosing ? `${on} of ${total} stocked` : on}</span></h3>
                    {section === "mixing" && !choosing && <div className="ink-mixsys-sub">Wilflex Epic Rio Mix. These are the inks the PMS formulas weigh out.</div>}
                    <div className="ink-grid">{xs.map((x) => choosing ? (
                      <button key={x.id} type="button" role="switch" aria-checked={x.stocked} className={"ink-tile stock pick" + (x.stocked ? " in" : "")} onClick={() => toggleStocked(x)} title={x.stocked ? `${x.name}: on the shelf (tap to switch off)` : `${x.name}: not stocked (tap to switch on)`}>
                        <i style={{ background: x.hex || "#ddd" }}><span className="ink-check" aria-hidden>{x.stocked ? "✓" : ""}</span></i>
                        <b>{x.name}</b>
                        <small>{x.stocked ? "We stock this" : "Not stocked"}</small>
                      </button>
                    ) : (
                      <button key={x.id} type="button" className={"ink-tile stock" + (selStock?.id === x.id ? " on" : "")} onClick={() => pickStock(x)} title={`${x.name}${x.pms ? ` · PMS ${x.pms}` : ""}`}>
                        <i style={{ background: x.hex || "#ddd" }} />
                        <b>{x.name}</b>
                        {x.pms && <small data-notranslate>PMS {x.pms}</small>}
                      </button>
                    ))}</div>
                  </div>
                ))}
              </>
            ) : (<>
            <input className="ink-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a color: 186, 7527, Cool Gray 7, Warm Red…" aria-label="Find a color" autoFocus />
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="faint" style={{ fontSize: 13 }}>{ready} colors read from IMS so far. More are added as they're read.</span>
            </div>
            {!inks ? <div className="faint">Loading…</div> : !list.length ? <div className="faint">{q ? `No formula for “${q}” yet. It hasn't been read from IMS; look it up there for now.` : "No formulas read yet."}</div> : (
              <>{parts.map((p) => (
              <div key={p.k} className="ink-group">
                {p.title && <h3>{p.title} <span className="faint">{p.xs.length}</span></h3>}
              <div className="ink-grid">{p.xs.map((i) => { const st = i.rec_type === "S" ? stockFor(i.code) : []; return (
                <button key={i.id} type="button" className={"ink-tile" + (sel?.id === i.id ? " on" : "") + (i.lines?.length ? " has" : "")} onClick={() => pickInk(i)} title={i.name}>
                  <i style={{ background: i.hex || "#ddd" }} />
                  <b data-notranslate>{i.code}</b>
                  <small>{i.rec_type === "U" ? (i.lines?.length ? "Shop mix ✓" : "Shop mix · not read") : i.lines?.length ? "Formula ✓" : "Not read yet"}</small>
                  {st.length > 0 && <small className="ink-instock">Stock: {st[0].name}{st.length > 1 ? ` +${st.length - 1}` : ""}</small>}
                </button>
              ); })}</div>
                {p.more && <div className="faint" style={{ fontSize: 12.5 }}>Showing the first 240. Type more of the number to narrow it down.</div>}
              </div>
              ))}</>
            )}
            </>)}
          </div>
        </section>

        <section className="panel ink-calc" aria-live="polite">
          {edit ? (
            <form className="panel-b stack ink-form" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
              <h2 style={{ margin: 0 }}>{edit.id ? "Edit stock color" : "Add a stock color"}</h2>
              <label>Color name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Bora Bora Sand" autoFocus required /></label>
              <div className="ink-form-2">
                <label>Brand<input value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} list="ink-brands" placeholder="Monarch Color" /></label>
                <label>Line<input value={edit.line} onChange={(e) => setEdit({ ...edit, line: e.target.value })} list="ink-lines" placeholder="Standard & Athletic" /></label>
              </div>
              <datalist id="ink-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
              <datalist id="ink-lines">{lines.map((b) => <option key={b} value={b} />)}</datalist>
              <div className="ink-form-2">
                <label>Product #<input value={edit.product} onChange={(e) => setEdit({ ...edit, product: e.target.value })} placeholder="Optional" data-notranslate /></label>
                <label>Nearest PMS<input value={edit.pms} onChange={(e) => setEdit({ ...edit, pms: e.target.value })} placeholder="9224 C" data-notranslate /></label>
              </div>
              {draftPms && <div className={"faint ink-pmsnote" + (draftF ? " ok" : "")} style={{ fontSize: 12.5 }}>{draftF ? `PMS ${draftF.code} is in the Epic Rio library${draftF.lines?.length ? " with a formula" : ""}.` : `No Epic Rio formula for “${draftPms}”. That's fine; it just won't link to a mix.`}</div>}
              <label>Color
                <span className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(edit.hex) ? edit.hex : "#cccccc"} onChange={(e) => setEdit({ ...edit, hex: e.target.value })} aria-label="Pick the color" className="ink-colorpick" />
                  <input value={edit.hex} onChange={(e) => setEdit({ ...edit, hex: e.target.value })} aria-label="Hex color" style={{ width: 110 }} data-notranslate />
                  {draftF?.hex && <button type="button" className="btn sm" onClick={() => setEdit({ ...edit, hex: draftF.hex })}>Use the PMS color</button>}
                </span>
              </label>
              <label>Shows under
                <select value={edit.section} onChange={(e) => setEdit({ ...edit, section: e.target.value as Section })}>{SECTIONS.map((x) => <option key={x.k} value={x.k}>{x.pick}</option>)}</select>
              </label>
              <label className="ink-check-row"><input type="checkbox" checked={edit.stocked} onChange={(e) => setEdit({ ...edit, stocked: e.target.checked })} /> We stock this color (shows for everyone and in the PMS formulas)</label>
              <label>Notes<textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={2} placeholder="Where it's kept, what it's good for…" /></label>
              {formErr && <div className="pv-err">{formErr}</div>}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : edit.id ? "Save changes" : "Add color"}</button>
                <button type="button" className="btn" onClick={() => setEdit(null)} disabled={busy}>Cancel</button>
                {edit.id && <button type="button" className="btn ghost" style={{ marginLeft: "auto" }} onClick={archive} disabled={busy}>Archive (no longer stocked)</button>}
              </div>
            </form>
          ) : !sel && !selStock ? <div className="panel-b faint">Pick a color to see its formula and how much of each ink to weigh out.</div> : (
            <div className="panel-b stack" style={{ gap: 14 }}>
              {selStock && (
                <div className="stack" style={{ gap: 8 }}>
                  <div className="ink-head">
                    <i style={{ background: selStock.hex || "#ddd" }} />
                    <div style={{ flex: 1 }}><h2>{selStock.name}</h2><div className="faint" data-notranslate>{stockLabel(selStock) || "Stock ink"}{selStock.product ? ` · ${selStock.product}` : ""}{selStock.pms ? ` · ≈ PMS ${selStock.pms}` : ""}</div></div>
                    {canStock && <button type="button" className="btn sm" onClick={() => startEdit(selStock)}>Edit</button>}
                  </div>
                  {selStock.notes && <div className="faint" style={{ fontSize: 13 }}>{selStock.notes}</div>}
                  <div className="ink-stock"><i style={{ background: selStock.hex || "#ddd" }} /><span><b>{selStock.stocked ? "Stock ink, use it straight from the can" : "On file but not stocked"}</b>{!selStock.pms ? "No PMS on file. Edit it to add the nearest PMS so it links to a Rio mix." : sel ? `To match PMS ${sel.code} exactly, mix it from the Rio formula below.` : `There's no Epic Rio formula for PMS ${selStock.pms}.`}</span></div>
                </div>
              )}
              {sel && (<>
              {!selStock && (
                <div className="ink-head">
                  <i style={{ background: sel.hex || "#ddd" }} />
                  <div><h2 data-notranslate>{sel.code}</h2><div className="faint" data-notranslate>{sel.name}{sel.rec_type === "U" ? " · our own mix (IMS user formula)" : " · Epic Rio"}{(sel.copies || 1) > 1 ? ` · IMS has ${sel.copies} formulas with this code` : ""}</div></div>
                </div>
              )}
              {selStock && <h3 className="ink-sub" data-notranslate>Mix PMS {sel.code} from Epic Rio</h3>}
              {!selStock && sel.rec_type === "S" && stockFor(sel.code).map((r) => (
                <button key={r.id} type="button" className="ink-stock as-btn" onClick={() => pickStock(r)}><i style={{ background: r.hex }} /><span><b>In stock: {stockLabel(r)} {r.name}{r.product ? ` (${r.product})` : ""}</b>Ready to use and about PMS {r.pms}. Use it straight from the can, or mix below for an exact match.</span></button>
              ))}
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
              </>)}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
