"use client";
import { uid, type Finishing, type PriceList } from "@/lib/pricing";
import { FBS_CONTRACT_2024 } from "@/lib/contractPricing";

/**
 * Settings → Price lists → Wholesale, laid out like the FBS contract sheet: screen printing (prices, then its fees),
 * embroidery (prices, then its fees and extras), finishing, and DTF (not on the sheet). Edits the draft settings;
 * nothing is kept until Save changes.
 */
const n = (v: string) => (v === "" || isNaN(+v) ? 0 : +v);
const money = (v: number) => `$${(+v || 0).toFixed(2)}`;

function ExtrasList({ list, onChange, placeholder }: { list: Finishing[]; onChange: (fn: (l: Finishing[]) => Finishing[]) => void; placeholder: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {list.map((f, i) => (
        <div key={f.id} className="fee-row">
          <input type="text" aria-label="Name" placeholder={placeholder} value={f.name} onChange={(e) => onChange((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input type="number" step="0.05" aria-label="Price per piece" value={f.price} onChange={(e) => onChange((l) => l.map((x, j) => (j === i ? { ...x, price: n(e.target.value) } : x)))} />
          <button className="btn icon ghost" type="button" aria-label="Remove" onClick={() => onChange((l) => l.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="btn sm" type="button" style={{ alignSelf: "flex-start" }} onClick={() => onChange((l) => [...l, { id: uid(), name: "", price: 0 }])}>+ Add</button>
    </div>
  );
}

export default function WholesalePricing({ pl, upd }: { pl: PriceList; upd: (fn: (d: PriceList) => void) => void }) {
  const cols = Math.max(8, ...pl.screen.map((r) => r.length));
  const at500 = pl.tiers.findIndex((t) => t >= 500);
  const inkBase = pl.specialtyInk?.[0] ?? 0, ink500 = at500 >= 0 ? pl.specialtyInk?.[at500] ?? inkBase : inkBase;
  const setInk = (base: number, big: number) => upd((d) => { d.specialtyInk = d.tiers.map((t) => (t >= 500 ? big : base)); });
  return (
    <div className="ws">
      <div className="row ws-load">
        <button type="button" className="btn sm" onClick={() => upd((d) => { Object.assign(d, JSON.parse(JSON.stringify(FBS_CONTRACT_2024))); })}>Load the FBS contract price list (2024v1r1)</button>
        <span className="faint">Fills this tab from the contract sheet. Check it, then Save changes at the top.</span>
      </div>

      <section className="ws-sec">
        <h3>Screen printing</h3>
        <div className="grid g4">
          <div className="field"><label htmlFor="ws-min">Minimum order (pieces)</label><input id="ws-min" type="number" step="1" value={pl.minQty ?? 12} onChange={(e) => upd((d) => { d.minQty = n(e.target.value) || undefined; })} /><small className="faint">A smaller job is billed as this many.</small></div>
        </div>
        <div className="lbl">PRICE PER PIECE, PER LOCATION</div>
        <div className="matrix-wrap"><table className="matrix">
          <thead><tr><th>Qty from</th>{Array.from({ length: cols }, (_, c) => <th key={c}>{c + 1} color{c ? "s" : ""}</th>)}</tr></thead>
          <tbody>{pl.tiers.map((t, i) => (
            <tr key={"s" + i}>
              <td className="tier"><input type="number" min="1" aria-label={`Break ${i + 1}: from`} value={t} onChange={(e) => upd((d) => { d.tiers[i] = n(e.target.value); })} /></td>
              {Array.from({ length: cols }, (_, j) => <td key={j}><input type="number" step="0.01" aria-label={`${t}+ pieces, ${j + 1} colors`} value={pl.screen[i]?.[j] ?? 0} onChange={(e) => upd((d) => { (d.screen[i] ||= [])[j] = n(e.target.value); })} /></td>)}
            </tr>
          ))}</tbody>
        </table></div>
        <label className="check"><input type="checkbox" checked={!!pl.darkAddsColor} onChange={(e) => upd((d) => { d.darkAddsColor = e.target.checked; })} /> Add one color to dark garments for the underbase</label>
        <div className="field"><label htmlFor="ws-light">Garment colors that print without an underbase</label><input id="ws-light" type="text" value={(pl.lightColors || []).join(", ")} onChange={(e) => upd((d) => { d.lightColors = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); })} /></div>
        <div className="lbl">SCREEN PRINTING FEES</div>
        <div className="ws-fees">
          <div className="field"><label htmlFor="ws-scr">Screen setup, per color</label><input id="ws-scr" type="number" step="0.5" value={pl.screenFee} onChange={(e) => upd((d) => { d.screenFee = n(e.target.value); })} /></div>
          <div className="field"><label htmlFor="ws-remake">Screen remake, per color</label><input id="ws-remake" type="number" step="0.5" value={pl.remakeFee ?? 0} onChange={(e) => upd((d) => { d.remakeFee = n(e.target.value); })} /><small className="faint">When the screens are on file (ticked on the group).</small></div>
          <div className="field"><label htmlFor="ws-chg">Color change, per color</label><input id="ws-chg" type="number" step="0.5" value={pl.inkChangeFee} onChange={(e) => upd((d) => { d.inkChangeFee = n(e.target.value); })} /></div>
          <div className="field"><label htmlFor="ws-pms">PMS matching (non-standard ink), per color</label><input id="ws-pms" type="number" step="0.5" value={pl.pmsFee ?? 0} onChange={(e) => upd((d) => { d.pmsFee = n(e.target.value); })} /></div>
          <div className="field"><label htmlFor="ws-ink">Specialty ink (polyester, nylon, dyed), per location</label>
            <div className="row" style={{ gap: 6 }}><input id="ws-ink" type="number" step="0.05" value={inkBase} onChange={(e) => setInk(n(e.target.value), ink500)} /><span className="faint">500+</span><input type="number" step="0.05" aria-label="Specialty ink at 500 pieces and up" value={ink500} onChange={(e) => setInk(inkBase, n(e.target.value))} /></div></div>
          <div className="field"><label htmlFor="ws-sp">Special imprint (sleeve, pocket, side), per location</label><input id="ws-sp" type="number" step="0.05" value={pl.specialLocPrice ?? 0} onChange={(e) => upd((d) => { d.specialLocPrice = n(e.target.value); })} /></div>
        </div>
        <div className="field"><label htmlFor="ws-sploc">Special imprint locations</label><input id="ws-sploc" type="text" value={(pl.specialLocations || []).join(", ")} onChange={(e) => upd((d) => { d.specialLocations = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); })} /></div>
      </section>

      <section className="ws-sec">
        <h3>Embroidery</h3>
        <div className="lbl">PRICE PER PIECE, PER LOCATION</div>
        <div className="matrix-wrap"><table className="matrix">
          <thead><tr><th>Qty from</th><th>0-{(pl.embStitches ?? 6000) / 1000}K stitches</th><th title="Fleece, hats, beanies, bags, backpacks: any non-standard flat garment">Specialty items +</th></tr></thead>
          <tbody>{(pl.embTiers || pl.tiers).map((t, i) => (
            <tr key={"e" + i}>
              <td className="tier"><input type="number" min="1" aria-label={`Embroidery break ${i + 1}: from`} value={t} onChange={(e) => upd((d) => { if (!d.embTiers) d.embTiers = [...d.tiers]; d.embTiers[i] = n(e.target.value); })} /></td>
              <td><input type="number" step="0.05" aria-label={`${t}+ embroidery`} value={pl.embroidery[i] ?? 0} onChange={(e) => upd((d) => { d.embroidery[i] = n(e.target.value); })} /></td>
              <td><input type="number" step="0.05" aria-label={`${t}+ specialty items`} value={pl.embSpecialty?.[i] ?? 0} onChange={(e) => upd((d) => { (d.embSpecialty ||= [])[i] = n(e.target.value); })} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="lbl">EMBROIDERY FEES</div>
        <div className="ws-fees">
          <div className="field"><label htmlFor="ws-st">Stitches included</label><input id="ws-st" type="number" step="500" value={pl.embStitches ?? 6000} onChange={(e) => upd((d) => { d.embStitches = n(e.target.value); })} /></div>
          <div className="field"><label htmlFor="ws-1k">Each extra 1,000 stitches</label><input id="ws-1k" type="number" step="0.05" value={pl.embPer1k ?? 0} onChange={(e) => upd((d) => { d.embPer1k = n(e.target.value); })} /></div>
          <div className="field"><label htmlFor="ws-dig">Digitizing, per design</label><input id="ws-dig" type="number" step="1" value={pl.digitizing} onChange={(e) => upd((d) => { d.digitizing = n(e.target.value); })} /><small className="faint">Basic $40-$60; complex / puff $80+ (set on the job).</small></div>
        </div>
        <div className="lbl">EMBROIDERY EXTRAS, PER PIECE</div>
        <ExtrasList list={pl.embExtras || []} placeholder="Specialty thread" onChange={(fn) => upd((d) => { d.embExtras = fn(d.embExtras || []); })} />
      </section>

      <section className="ws-sec">
        <h3>Finishing</h3>
        <div className="faint" style={{ fontSize: 12.5 }}>Per piece, ticked on a group. Wholesale jobs use this list.</div>
        <ExtrasList list={pl.finishing || []} placeholder="Fold" onChange={(fn) => upd((d) => { d.finishing = fn(d.finishing || []); })} />
      </section>

      <section className="ws-sec">
        <h3>DTF</h3>
        <div className="faint" style={{ fontSize: 12.5 }}>Not on the contract sheet: per piece, per location.</div>
        <div className="matrix-wrap"><table className="matrix">
          <thead><tr><th>Qty from</th><th>DTF</th></tr></thead>
          <tbody>{pl.tiers.map((t, i) => (
            <tr key={"d" + i}><td className="tier">{t}+</td><td><input type="number" step="0.05" aria-label={`${t}+ DTF`} value={pl.dtf[i] ?? 0} onChange={(e) => upd((d) => { d.dtf[i] = n(e.target.value); })} /></td></tr>
          ))}</tbody>
        </table></div>
      </section>

      {pl.contractNotes && <div className="muted ws-notes">{pl.contractNotes}</div>}
      <div className="faint" style={{ fontSize: 12 }}>Example: 100 pieces, 1 color on a dark shirt = {money((pl.screen[pl.tiers.reduce((a, t, i) => (100 >= t ? i : a), 0)]?.[pl.darkAddsColor ? 1 : 0]) || 0)} each per location.</div>
    </div>
  );
}
