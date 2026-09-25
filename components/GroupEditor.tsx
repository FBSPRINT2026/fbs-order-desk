"use client";
import { LOCATIONS, METHODS, SIZES, newGLine, newImprint, uid, type GLine, type Garment, type Group, type GroupCalc, type Method, type Settings } from "@/lib/pricing";
import { money } from "@/lib/format";

type Props = {
  gi: number;
  g: Group;
  gc: GroupCalc;
  settings: Settings;
  catalog: Garment[];
  canRemove: boolean;
  armed: string;
  arm: (k: string) => void;
  update: (fn: (g: Group) => void) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onSaveToCatalog: (l: GLine) => void;
};

const numOr = (v: string): number | "" => (v === "" ? "" : isNaN(+v) ? "" : +v);

/** Printavo-style line item group: garment rows sharing a set of imprints. */
export default function GroupEditor({ gi, g, gc, settings, catalog, canRemove, armed, arm, update, onDuplicate, onRemove, onSaveToCatalog }: Props) {
  const findStyle = (style: string) => catalog.find((x) => x.style.toLowerCase() === style.trim().toLowerCase());

  function onStyle(li: number, style: string) {
    update((x) => {
      const l = x.lines[li];
      l.style = style;
      const hit = findStyle(style);
      if (hit) {
        if (!l.garment) l.garment = hit.description;
        if (!l.brand) l.brand = hit.brand;
        if (l.cost === "" || l.cost === 0) l.cost = +hit.cost || "";
      }
    });
  }

  const listId = `styles-${g.id}`;
  return (
    <section className="line">
      <div className="line-h">
        <span className="idx">GROUP {gi + 1}</span>
        <b className="num">{gc.qty} pcs</b>
        <span className="faint" style={{ fontSize: 12 }}>{gc.qty ? `${gc.tierMin}+ price break` : ""}</span>
        <span className="spacer" />
        <button className="btn sm ghost" type="button" onClick={onDuplicate}>Duplicate group</button>
        {canRemove && <button className={"btn sm ghost danger" + (armed === "grp" + g.id ? " armed" : "")} type="button" onClick={() => (armed === "grp" + g.id ? onRemove() : arm("grp" + g.id))}>{armed === "grp" + g.id ? "Remove group?" : "Remove"}</button>}
      </div>
      <div className="line-b">
        <datalist id={listId}>{catalog.map((c) => <option key={c.id} value={c.style}>{[c.brand, c.description].filter(Boolean).join(" ")}</option>)}</datalist>
        <div className="sizes-wrap">
          <table className="pv-grid">
            <thead>
              <tr>
                <th style={{ minWidth: 110 }}>Style #</th>
                <th style={{ minWidth: 120 }}>Color</th>
                <th style={{ minWidth: 170 }}>Description</th>
                <th style={{ minWidth: 70 }}>Cost</th>
                {SIZES.map((s) => <th key={s} className="c">{s}{settings.upcharges[s] ? <small>+{settings.upcharges[s]}</small> : null}</th>)}
                <th className="c">Qty</th>
                <th className="r" style={{ minWidth: 84 }}>Each</th>
                <th className="r" style={{ minWidth: 84 }}>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {g.lines.map((l, li) => {
                const lc = gc.lines[li];
                const hit = findStyle(l.style);
                const colorsId = `colors-${l.id}`;
                return (
                  <tr key={l.id}>
                    <td>
                      <input type="text" list={listId} aria-label="Style number" placeholder="G5000" value={l.style} onChange={(e) => onStyle(li, e.target.value)} />
                      {!hit && l.style && l.garment && l.cost !== "" && <button className="linkbtn" type="button" onClick={() => onSaveToCatalog(l)}>Save to catalog</button>}
                    </td>
                    <td>
                      <input type="text" list={colorsId} aria-label="Color" placeholder="Black" value={l.color} onChange={(e) => update((x) => { x.lines[li].color = e.target.value; })} />
                      {hit && <datalist id={colorsId}>{hit.colors.map((c) => <option key={c} value={c} />)}</datalist>}
                    </td>
                    <td><input type="text" aria-label="Description" placeholder="Unisex tee" value={l.garment} onChange={(e) => update((x) => { x.lines[li].garment = e.target.value; })} /></td>
                    <td><input type="number" step="0.01" min="0" aria-label="Blank cost" placeholder="0.00" value={l.cost} onChange={(e) => update((x) => { x.lines[li].cost = numOr(e.target.value); })} /></td>
                    {SIZES.map((s) => (
                      <td key={s} className="c">
                        <input type="number" min="0" step="1" inputMode="numeric" className={"sz" + (l.sizes?.[s] ? " has" : "")} aria-label={`${s} quantity`} value={l.sizes?.[s] || ""}
                          onChange={(e) => update((x) => { const v = Math.max(0, Math.floor(+e.target.value || 0)); if (v) x.lines[li].sizes[s] = v; else delete x.lines[li].sizes[s]; })} />
                      </td>
                    ))}
                    <td className="c tot">{lc?.qty ?? 0}</td>
                    <td className="r"><input type="number" step="0.01" min="0" aria-label="Price each" className={lc?.hasOv ? "ov" : ""} placeholder={lc ? lc.calcEach.toFixed(2) : ""} value={l.priceOverride ?? ""} onChange={(e) => update((x) => { x.lines[li].priceOverride = e.target.value === "" ? null : +e.target.value; })} /></td>
                    <td className="r num"><b>{money(lc?.sub)}</b></td>
                    <td>{g.lines.length > 1 && <button className="btn icon ghost" type="button" aria-label="Remove garment" onClick={() => update((x) => { x.lines.splice(li, 1); })}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="btn sm" type="button" onClick={() => update((x) => { x.lines.push(newGLine()); })}>+ Add garment</button>
          <button className="btn sm ghost" type="button" onClick={() => update((x) => { const last = x.lines[x.lines.length - 1]; x.lines.push({ ...last, id: uid(), color: "", sizes: {}, priceOverride: null }); })}>+ Same style, new color</button>
        </div>

        <div className="imprints">
          <div className="lbl" style={{ marginBottom: 6 }}>IMPRINTS</div>
          <div className="sizes-wrap">
            <table className="pv-grid">
              <thead><tr><th style={{ minWidth: 130 }}>Method</th><th style={{ minWidth: 120 }}>Location</th><th style={{ minWidth: 90 }}>Colors</th><th style={{ minWidth: 170 }}>Ink colors / PMS</th><th style={{ minWidth: 110 }}>Print size</th><th style={{ minWidth: 170 }}>Notes</th><th className="r">Each</th><th /></tr></thead>
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
                    <td className="r num">{money(gc.imprints[di]?.each)}</td>
                    <td><button className="btn icon ghost" type="button" aria-label="Remove imprint" onClick={() => update((x) => { x.imprints.splice(di, 1); })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn sm" type="button" onClick={() => update((x) => { const used = x.imprints.map((d) => d.location); x.imprints.push(newImprint(LOCATIONS.find((z) => !used.includes(z)) || "")); })}>+ Add imprint</button>
        </div>

        {gc.belowMin && <div className="warnline">{gc.qty} pcs is under your {settings.tiers[0]}-piece minimum. Priced at the {settings.tiers[0]}+ break.</div>}
        <div className="price-strip">
          <div className="calc">Print <b>{money(gc.printEach)}</b>/pc · {gc.qty} pcs at the {gc.tierMin}+ break{gc.setup ? ` · setup ${money(gc.setup)}` : ""}</div>
          <div className="lt"><div className="sub">Group total</div><b>{money(gc.sub + gc.setup)}</b></div>
        </div>
      </div>
    </section>
  );
}

