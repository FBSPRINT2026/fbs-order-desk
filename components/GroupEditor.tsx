"use client";
import { ADULT_SIZES, LOCATIONS, METHODS, ONE_SIZE, SIZES, YOUTH_SIZES, newGLine, newImprint, uid, type GLine, type Garment, type Group, type GroupCalc, type Method, type PriceList, type Settings } from "@/lib/pricing";
import { money } from "@/lib/format";

type Props = {
  gi: number;
  g: Group;
  gc: GroupCalc;
  settings: Settings;
  prices: PriceList;
  catalog: Garment[];
  canRemove: boolean;
  armed: string;
  arm: (k: string) => void;
  update: (fn: (g: Group) => void) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSaveToCatalog: (l: GLine) => void;
};

const lineTotal = (l: GLine) => SIZES.reduce((a, z) => a + (+(l.sizes?.[z] || 0)), 0);
const numOr =(v: string): number | "" => (v === "" ? "" : isNaN(+v) ? "" : +v);

/** Printavo-style line item group: garment rows sharing a set of imprints. */
export default function GroupEditor({ gi, g, gc, settings, prices, catalog, canRemove, armed, arm, update, onDuplicate, onRemove, onSaveToCatalog }: Props) {
  const findStyle = (style: string) => catalog.find((x) => x.style.toLowerCase() === style.trim().toLowerCase());

  function onStyle(li: number, style: string) {
    update((x) => {
      const l = x.lines[li];
      l.style = style;
      const hit = findStyle(style);
      if (hit) {
        if (!l.garment) l.garment = hit.description;
        if (!l.brand) l.brand = hit.brand;
        if (!gc.wholesale && (l.cost === "" || l.cost === 0)) l.cost = +hit.cost || "";
      }
    });
  }

  const listId = `styles-${g.id}`;
  const hasYouthQty = g.lines.some((l) => YOUTH_SIZES.some((z) => l.sizes?.[z]));
  const showYouth = !!g.youth || hasYouthQty;
  const cols: string[] = [...(showYouth ? YOUTH_SIZES : []), ...ADULT_SIZES];
  return (
    <section className="line">
      <div className="line-h">
        <span className="idx">GROUP {gi + 1}</span>
        <b className="num">{gc.qty} pcs</b>
        <span className="faint" style={{ fontSize: 12 }}>{gc.qty ? `${gc.tierMin}+ price break` : ""}</span>
        {gc.wholesale && <span className="tag i">Customer-supplied goods</span>}
        <label className="check" style={{ fontSize: 12, marginLeft: 8 }} title={hasYouthQty ? "Clear youth quantities to hide these columns" : ""}>
          <input type="checkbox" checked={showYouth} disabled={hasYouthQty} onChange={(e) => update((x) => { x.youth = e.target.checked; })} /> Youth sizes
        </label>
        <span className="spacer" />
        <button className="btn sm ghost" type="button" onClick={onDuplicate}>Duplicate group</button>
        {canRemove && <button className={"btn sm ghost danger" + (armed === "grp" + g.id ? " armed" : "")} type="button" onClick={() => (armed === "grp" + g.id ? onRemove() : arm("grp" + g.id))}>{armed === "grp" + g.id ? "Remove group?" : "Remove"}</button>}
      </div>
      <div className="line-b">
        <datalist id={listId}>{catalog.map((c) => <option key={c.id} value={c.style}>{[c.brand, c.description].filter(Boolean).join(" ")}</option>)}</datalist>
        <div className={"gl-list" + (gc.wholesale ? " ws" : "")}>
          <div className="gl-row gl-head">
            <span className="a-st">Style #</span><span className="a-co">Color</span><span className="a-de">Description</span>
            {!gc.wholesale && <span className="a-cs">Cost</span>}
            <span className="a-qt c">Qty</span><span className="a-ea r">Each</span><span className="a-to r">Total</span>
          </div>
          {g.lines.map((l, li) => {
            const lc = gc.lines[li];
            const hit = findStyle(l.style);
            const colorsId = `colors-${l.id}`;
            const setQty = (s: keyof GLine["sizes"], raw: string) => update((x) => { const v = Math.max(0, Math.floor(+raw || 0)); if (v) x.lines[li].sizes[s] = v; else delete x.lines[li].sizes[s]; });
            return (
              <div key={l.id} className="gl">
                <div className="gl-row">
                  <div className="a-st">
                    <input type="text" list={listId} aria-label="Style number" placeholder="Style # (G5000)" value={l.style} onChange={(e) => onStyle(li, e.target.value)} />
                    {!hit && l.style && l.garment && (gc.wholesale || l.cost !== "") && <button className="linkbtn" type="button" onClick={() => onSaveToCatalog(l)}>Save to catalog</button>}
                  </div>
                  <div className="a-co">
                    <input type="text" list={colorsId} aria-label="Color" placeholder="Color" value={l.color} onChange={(e) => update((x) => { x.lines[li].color = e.target.value; })} />
                    {hit && <datalist id={colorsId}>{hit.colors.map((c) => <option key={c} value={c} />)}</datalist>}
                  </div>
                  <div className="a-de"><input type="text" aria-label="Description" placeholder={l.oneSize ? "Description (hat, koozie…)" : "Description (unisex tee)"} value={l.garment} onChange={(e) => update((x) => { x.lines[li].garment = e.target.value; })} /></div>
                  {!gc.wholesale && <div className="a-cs"><input type="number" step="0.01" min="0" aria-label="Blank cost" placeholder="0.00" value={l.cost} onChange={(e) => update((x) => { x.lines[li].cost = numOr(e.target.value); })} /></div>}
                  <div className="a-qt c tot">{lc?.qty ?? 0}</div>
                  <div className="a-ea r"><input type="number" step="0.01" min="0" aria-label="Price each" className={lc?.hasOv ? "ov" : ""} placeholder={lc ? lc.calcEach.toFixed(2) : ""} value={l.priceOverride ?? ""} onChange={(e) => update((x) => { x.lines[li].priceOverride = e.target.value === "" ? null : +e.target.value; })} /></div>
                  <div className="a-to r num"><b>{money(lc?.sub)}</b></div>
                  <div className="a-x">{g.lines.length > 1 && <button className="btn icon ghost" type="button" aria-label="Remove garment" onClick={() => update((x) => { x.lines.splice(li, 1); })}>✕</button>}</div>
                </div>
                <div className="szrow">
                  {l.oneSize ? (
                    <label className="szc os">
                      <span>One size qty</span>
                      <input type="number" min="0" step="1" inputMode="numeric" className={"sz" + (l.sizes?.OS ? " has" : "")} value={l.sizes?.OS || ""}
                        onChange={(e) => update((x) => { const v = Math.max(0, Math.floor(+e.target.value || 0)); x.lines[li].sizes = v ? { OS: v } : {}; })} />
                    </label>
                  ) : (cols as (keyof GLine["sizes"])[]).map((s) => {
                    const up = prices.upcharges[s as keyof typeof prices.upcharges];
                    return (
                      <label key={s} className={"szc" + (s === "YXL" ? " ysep" : "")}>
                        <span>{s}{up ? <small>+{up}</small> : null}</span>
                        <input type="number" min="0" step="1" inputMode="numeric" className={"sz" + (l.sizes?.[s] ? " has" : "")} value={l.sizes?.[s] || ""} onChange={(e) => setQty(s, e.target.value)} />
                      </label>
                    );
                  })}
                  <button className="linkbtn szmode" type="button" title={l.oneSize ? "Switch back to a size run" : "Hats, koozies, bags: one quantity, no sizes"} onClick={() => update((x) => { const r = x.lines[li]; const q = lineTotal(r); r.oneSize = !r.oneSize; r.sizes = r.oneSize && q ? { [ONE_SIZE]: q } : {}; })}>{l.oneSize ? "Use sizes" : "One size item"}</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="btn sm" type="button" onClick={() => update((x) => { x.lines.push(newGLine()); })}>+ Add garment</button>
          <button className="btn sm" type="button" onClick={() => update((x) => { x.lines.push({ ...newGLine(), oneSize: true }); })}>+ One-size item</button>
          <button className="btn sm ghost" type="button" onClick={() => update((x) => { const last = x.lines[x.lines.length - 1]; x.lines.push({ ...last, id: uid(), color: "", sizes: {}, priceOverride: null }); })}>+ Same style, new color</button>
        </div>

        <div className="imprints">
          <div className="lbl" style={{ marginBottom: 6 }}>IMPRINTS</div>
          <div>
            <table className="pv-grid imp-table">
              <colgroup><col style={{ width: "15%" }} /><col style={{ width: "13%" }} /><col style={{ width: 64 }} /><col /><col style={{ width: "11%" }} /><col /><col style={{ width: 56 }} /><col style={{ width: 64 }} /><col style={{ width: 34 }} /></colgroup>
              <thead><tr><th>Method</th><th>Location</th><th>Colors</th><th>Ink colors / PMS</th><th>Print size</th><th>Notes</th><th className="c" title="Ink changes during the run">Ink chg</th><th className="r">Each</th><th /></tr></thead>
              <tbody>
                {g.imprints.map((d, di) => (
                  <tr key={d.id}>
                    <td><select aria-label="Method" value={d.method} onChange={(e) => update((x) => { x.imprints[di].method = e.target.value as Method; })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                    <td><input type="text" list="locs" aria-label="Location" value={d.location} onChange={(e) => update((x) => { x.imprints[di].location = e.target.value; })} /></td>
                    <td>{d.method === "screen"
                      ? <select aria-label="Number of colors" value={d.colors} onChange={(e) => update((x) => { x.imprints[di].colors = +e.target.value; })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                      : <span className="faint" style={{ fontSize: 12 }}>{d.method === "embroidery" ? "Thread" : "Full color"}</span>}</td>
                    <td><input type="text" aria-label="Ink colors" placeholder="White, PMS 186 C" value={d.inks} onChange={(e) => update((x) => { x.imprints[di].inks = e.target.value; })} /></td>
                    <td><input type="text" aria-label="Print size" placeholder='11" wide' value={d.size} onChange={(e) => update((x) => { x.imprints[di].size = e.target.value; })} /></td>
                    <td><input type="text" aria-label="Imprint notes" placeholder='3" below collar' value={d.notes} onChange={(e) => update((x) => { x.imprints[di].notes = e.target.value; })} /></td>
                    <td className="c"><input type="number" min="0" step="1" className="sz" aria-label="Ink changes" value={d.inkChanges || ""} placeholder="0" onChange={(e) => update((x) => { x.imprints[di].inkChanges = Math.max(0, Math.floor(+e.target.value || 0)); })} /></td>
                    <td className="r num">{money(gc.imprints[di]?.each)}</td>
                    <td><button className="btn icon ghost" type="button" aria-label="Remove imprint" onClick={() => update((x) => { x.imprints.splice(di, 1); })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn sm" type="button" onClick={() => update((x) => { const used = x.imprints.map((d) => d.location); x.imprints.push(newImprint(LOCATIONS.find((z) => !used.includes(z)) || "")); })}>+ Add imprint</button>
        </div>

        {settings.finishing.length > 0 && (
          <div className="row" style={{ gap: 14 }}>
            <span className="lbl">FINISHING</span>
            {settings.finishing.map((f) => (
              <label key={f.id} className="check" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={(g.finishing || []).includes(f.id)} onChange={(e) => update((x) => { const set = new Set(x.finishing || []); if (e.target.checked) set.add(f.id); else set.delete(f.id); x.finishing = [...set]; })} />
                {f.name} <span className="faint">({money(f.price)}/pc)</span>
              </label>
            ))}
          </div>
        )}
        {gc.belowMin && <div className="warnline">{gc.qty} pcs is under your {prices.tiers[0]}-piece minimum. Priced at the {prices.tiers[0]}+ break.</div>}
        <div className="price-strip">
          <div className="calc">Print <b>{money(gc.printEach)}</b>/pc{gc.finishEach ? <> + finishing <b>{money(gc.finishEach)}</b>/pc</> : null} · {gc.qty} pcs at the {gc.tierMin}+ break{gc.setup ? ` · setup ${money(gc.setup)}` : ""}{gc.inkFees ? ` (incl. ${money(gc.inkFees)} ink changes)` : ""}</div>
          <div className="lt"><div className="sub">Group total</div><b>{money(gc.sub + gc.setup)}</b></div>
        </div>
      </div>
    </section>
  );
}

