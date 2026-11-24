"use client";
import { useState } from "react";
import { abvAlt, abvOf, afterBoil, cellsNeeded, dilute, hydroCorrect, kegPsi, plato, primingOz, r1, refracFg, refracOg, residualCo2, sgFmt, sgFromPlato, starterGrowth, strikeTemp } from "@/lib/draftpunk/calc";
import { F, Num, Win } from "./ui";

/** the brewing calculators, each on its own little screen */
export default function Tools() {
  const [h, setH] = useState({ sg: 1.05, t: 100, cal: 60 });
  const [rf, setRf] = useState({ bi: 12, bf: 6.5, wcf: 1.04 });
  const [ab, setAb] = useState({ og: 1.06, fg: 1.012 });
  const [dl, setDl] = useState({ gal: 6.5, sg: 1.07, target: 1.06, newGal: 5.5 });
  const [st, setSt] = useState({ lb: 12, gal: 4.5, grain: 68, target: 152 });
  const [cb, setCb] = useState({ vols: 2.5, gal: 5, beerF: 66, kegF: 38 });
  const [ys, setYs] = useState({ og: 1.06, gal: 5.5, lager: false, have: 100, liters: 2, stir: true });
  const [pl, setPl] = useState({ sg: 1.05, p: 12 });
  const ratio = (st.gal * 4) / Math.max(st.lb, 0.1);
  const grow = starterGrowth(ys.have, ys.liters, ys.stir);
  const need = cellsNeeded(ys.og, ys.gal, ys.lager);
  return (
    <>
      <h1 className="dp-h1">Brewing tools</h1>
      <div className="dp-grid">
        <Win title="Hydrometer temp correction">
          <div className="dp-row">
            <F label="Reading"><Num className="dp-nw" value={h.sg} onChange={(n) => setH({ ...h, sg: n })} /></F>
            <F label="Sample °F"><Num value={h.t} onChange={(n) => setH({ ...h, t: n })} /></F>
            <F label="Calibrated °F"><Num value={h.cal} onChange={(n) => setH({ ...h, cal: n })} /></F>
          </div>
          <p className="dp-v">= {sgFmt(hydroCorrect(h.sg, h.t, h.cal))}</p>
        </Win>
        <Win title="Refractometer">
          <div className="dp-row">
            <F label="Start °Bx"><Num value={rf.bi} onChange={(n) => setRf({ ...rf, bi: n })} /></F>
            <F label="Now °Bx"><Num value={rf.bf} onChange={(n) => setRf({ ...rf, bf: n })} /></F>
            <F label="Wort factor"><Num value={rf.wcf} onChange={(n) => setRf({ ...rf, wcf: n })} /></F>
          </div>
          <p>OG {sgFmt(refracOg(rf.bi, rf.wcf))} · now {sgFmt(refracFg(rf.bi, rf.bf, rf.wcf))} · {r1(abvOf(refracOg(rf.bi, rf.wcf), refracFg(rf.bi, rf.bf, rf.wcf)), 1)}% ABV</p>
          <p className="dp-dim">After fermentation starts, alcohol throws the reading off; this corrects it (terrill).</p>
        </Win>
        <Win title="Alcohol and attenuation">
          <div className="dp-row">
            <F label="OG"><Num className="dp-nw" value={ab.og} onChange={(n) => setAb({ ...ab, og: n })} /></F>
            <F label="FG"><Num className="dp-nw" value={ab.fg} onChange={(n) => setAb({ ...ab, fg: n })} /></F>
          </div>
          <p>{r1(abvOf(ab.og, ab.fg), 2)}% ABV · {r1(abvAlt(ab.og, ab.fg), 2)}% (big-beer formula) · {r1(((ab.og - ab.fg) / (ab.og - 1)) * 100, 1)}% apparent attenuation</p>
        </Win>
        <Win title="Dilution and boil-down">
          <div className="dp-row">
            <F label="Gal now"><Num value={dl.gal} onChange={(n) => setDl({ ...dl, gal: n })} /></F>
            <F label="Sg now"><Num className="dp-nw" value={dl.sg} onChange={(n) => setDl({ ...dl, sg: n })} /></F>
            <F label="Want sg"><Num className="dp-nw" value={dl.target} onChange={(n) => setDl({ ...dl, target: n })} /></F>
            <F label="Boil to gal"><Num value={dl.newGal} onChange={(n) => setDl({ ...dl, newGal: n })} /></F>
          </div>
          <p>{dl.target < dl.sg ? `ADD ${r1(dilute(dl.gal, dl.sg, dl.target), 2)} gal water` : `boil off ${r1(dl.gal - (dl.gal * (dl.sg - 1)) / (dl.target - 1), 2)} GAL`} to hit {sgFmt(dl.target)} · boiled to {dl.newGal} gal = {sgFmt(afterBoil(dl.gal, dl.sg, dl.newGal))}</p>
        </Win>
        <Win title="Strike water">
          <div className="dp-row">
            <F label="Grain lb"><Num value={st.lb} onChange={(n) => setSt({ ...st, lb: n })} /></F>
            <F label="Water gal"><Num value={st.gal} onChange={(n) => setSt({ ...st, gal: n })} /></F>
            <F label="Grain °F"><Num value={st.grain} onChange={(n) => setSt({ ...st, grain: n })} /></F>
            <F label="Mash °F"><Num value={st.target} onChange={(n) => setSt({ ...st, target: n })} /></F>
          </div>
          <p>Heat to {r1(strikeTemp(ratio, st.grain, st.target), 1)}°F ({r1(ratio, 2)} QT/LB)</p>
        </Win>
        <Win title="Carbonation">
          <div className="dp-row">
            <F label="CO2 vols"><Num value={cb.vols} onChange={(n) => setCb({ ...cb, vols: n })} /></F>
            <F label="Gal"><Num value={cb.gal} onChange={(n) => setCb({ ...cb, gal: n })} /></F>
            <F label="Warmest ferm °F"><Num value={cb.beerF} onChange={(n) => setCb({ ...cb, beerF: n })} /></F>
            <F label="Keg °F"><Num value={cb.kegF} onChange={(n) => setCb({ ...cb, kegF: n })} /></F>
          </div>
          <p>Keg: {r1(kegPsi(cb.vols, cb.kegF), 1)} PSI · corn sugar {r1(primingOz(cb.gal, cb.vols, cb.beerF), 2)} oz · table sugar {r1(primingOz(cb.gal, cb.vols, cb.beerF, "table_sugar"), 2)} oz · DME {r1(primingOz(cb.gal, cb.vols, cb.beerF, "dme"), 2)} OZ</p>
          <p className="dp-dim">Already in the beer: {r1(residualCo2(cb.beerF), 2)} vols</p>
        </Win>
        <Win title="Yeast pitch and starter">
          <div className="dp-row">
            <F label="OG"><Num className="dp-nw" value={ys.og} onChange={(n) => setYs({ ...ys, og: n })} /></F>
            <F label="Gal"><Num value={ys.gal} onChange={(n) => setYs({ ...ys, gal: n })} /></F>
            <F label="Cells you have (B)"><Num value={ys.have} onChange={(n) => setYs({ ...ys, have: n })} /></F>
            <F label="Starter L"><Num value={ys.liters} onChange={(n) => setYs({ ...ys, liters: n })} /></F>
          </div>
          <div className="dp-row"><label className="dp-row"><input type="checkbox" checked={ys.lager} onChange={(e) => setYs({ ...ys, lager: e.target.checked })} /> Lager</label><label className="dp-row"><input type="checkbox" checked={ys.stir} onChange={(e) => setYs({ ...ys, stir: e.target.checked })} /> Stir plate</label></div>
          <p>Need {r1(need, 0)} B · starter makes {r1(grow.endB, 0)} B · {grow.endB >= need ? <span className="dp-grn">Enough</span> : <span className="dp-red">Not enough</span>}</p>
        </Win>
        <Win title="Sg ↔ plato / brix">
          <div className="dp-row">
            <F label="SG"><Num className="dp-nw" value={pl.sg} onChange={(n) => setPl({ ...pl, sg: n })} /></F>
            <span>= {r1(plato(pl.sg), 2)} °P</span>
            <F label="°P / °BX"><Num value={pl.p} onChange={(n) => setPl({ ...pl, p: n })} /></F>
            <span>= {sgFmt(sgFromPlato(pl.p))}</span>
          </div>
        </Win>
      </div>
    </>
  );
}
