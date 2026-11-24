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
      <h1 className="dp-h1">C:\DRAFTPUNK\TOOLS&gt;<span className="dp-blink">_</span></h1>
      <div className="dp-grid">
        <Win title="HYDROMETER TEMP CORRECTION">
          <div className="dp-row">
            <F label="READING"><Num className="dp-nw" value={h.sg} onChange={(n) => setH({ ...h, sg: n })} /></F>
            <F label="SAMPLE °F"><Num value={h.t} onChange={(n) => setH({ ...h, t: n })} /></F>
            <F label="CALIBRATED °F"><Num value={h.cal} onChange={(n) => setH({ ...h, cal: n })} /></F>
          </div>
          <p className="dp-v">= {sgFmt(hydroCorrect(h.sg, h.t, h.cal))}</p>
        </Win>
        <Win title="REFRACTOMETER">
          <div className="dp-row">
            <F label="START °BX"><Num value={rf.bi} onChange={(n) => setRf({ ...rf, bi: n })} /></F>
            <F label="NOW °BX"><Num value={rf.bf} onChange={(n) => setRf({ ...rf, bf: n })} /></F>
            <F label="WORT FACTOR"><Num value={rf.wcf} onChange={(n) => setRf({ ...rf, wcf: n })} /></F>
          </div>
          <p>OG {sgFmt(refracOg(rf.bi, rf.wcf))} · NOW {sgFmt(refracFg(rf.bi, rf.bf, rf.wcf))} · {r1(abvOf(refracOg(rf.bi, rf.wcf), refracFg(rf.bi, rf.bf, rf.wcf)), 1)}% ABV</p>
          <p className="dp-dim">AFTER FERMENTATION STARTS, ALCOHOL THROWS THE READING OFF; THIS CORRECTS IT (TERRILL).</p>
        </Win>
        <Win title="ALCOHOL AND ATTENUATION">
          <div className="dp-row">
            <F label="OG"><Num className="dp-nw" value={ab.og} onChange={(n) => setAb({ ...ab, og: n })} /></F>
            <F label="FG"><Num className="dp-nw" value={ab.fg} onChange={(n) => setAb({ ...ab, fg: n })} /></F>
          </div>
          <p>{r1(abvOf(ab.og, ab.fg), 2)}% ABV · {r1(abvAlt(ab.og, ab.fg), 2)}% (BIG-BEER FORMULA) · {r1(((ab.og - ab.fg) / (ab.og - 1)) * 100, 1)}% APPARENT ATTENUATION</p>
        </Win>
        <Win title="DILUTION AND BOIL-DOWN">
          <div className="dp-row">
            <F label="GAL NOW"><Num value={dl.gal} onChange={(n) => setDl({ ...dl, gal: n })} /></F>
            <F label="SG NOW"><Num className="dp-nw" value={dl.sg} onChange={(n) => setDl({ ...dl, sg: n })} /></F>
            <F label="WANT SG"><Num className="dp-nw" value={dl.target} onChange={(n) => setDl({ ...dl, target: n })} /></F>
            <F label="BOIL TO GAL"><Num value={dl.newGal} onChange={(n) => setDl({ ...dl, newGal: n })} /></F>
          </div>
          <p>{dl.target < dl.sg ? `ADD ${r1(dilute(dl.gal, dl.sg, dl.target), 2)} GAL WATER` : `BOIL OFF ${r1(dl.gal - (dl.gal * (dl.sg - 1)) / (dl.target - 1), 2)} GAL`} TO HIT {sgFmt(dl.target)} · BOILED TO {dl.newGal} GAL = {sgFmt(afterBoil(dl.gal, dl.sg, dl.newGal))}</p>
        </Win>
        <Win title="STRIKE WATER">
          <div className="dp-row">
            <F label="GRAIN LB"><Num value={st.lb} onChange={(n) => setSt({ ...st, lb: n })} /></F>
            <F label="WATER GAL"><Num value={st.gal} onChange={(n) => setSt({ ...st, gal: n })} /></F>
            <F label="GRAIN °F"><Num value={st.grain} onChange={(n) => setSt({ ...st, grain: n })} /></F>
            <F label="MASH °F"><Num value={st.target} onChange={(n) => setSt({ ...st, target: n })} /></F>
          </div>
          <p>HEAT TO {r1(strikeTemp(ratio, st.grain, st.target), 1)}°F ({r1(ratio, 2)} QT/LB)</p>
        </Win>
        <Win title="CARBONATION">
          <div className="dp-row">
            <F label="CO2 VOLS"><Num value={cb.vols} onChange={(n) => setCb({ ...cb, vols: n })} /></F>
            <F label="GAL"><Num value={cb.gal} onChange={(n) => setCb({ ...cb, gal: n })} /></F>
            <F label="WARMEST FERM °F"><Num value={cb.beerF} onChange={(n) => setCb({ ...cb, beerF: n })} /></F>
            <F label="KEG °F"><Num value={cb.kegF} onChange={(n) => setCb({ ...cb, kegF: n })} /></F>
          </div>
          <p>KEG: {r1(kegPsi(cb.vols, cb.kegF), 1)} PSI · CORN SUGAR {r1(primingOz(cb.gal, cb.vols, cb.beerF), 2)} OZ · TABLE SUGAR {r1(primingOz(cb.gal, cb.vols, cb.beerF, "table_sugar"), 2)} OZ · DME {r1(primingOz(cb.gal, cb.vols, cb.beerF, "dme"), 2)} OZ</p>
          <p className="dp-dim">ALREADY IN THE BEER: {r1(residualCo2(cb.beerF), 2)} VOLS</p>
        </Win>
        <Win title="YEAST PITCH AND STARTER">
          <div className="dp-row">
            <F label="OG"><Num className="dp-nw" value={ys.og} onChange={(n) => setYs({ ...ys, og: n })} /></F>
            <F label="GAL"><Num value={ys.gal} onChange={(n) => setYs({ ...ys, gal: n })} /></F>
            <F label="CELLS YOU HAVE (B)"><Num value={ys.have} onChange={(n) => setYs({ ...ys, have: n })} /></F>
            <F label="STARTER L"><Num value={ys.liters} onChange={(n) => setYs({ ...ys, liters: n })} /></F>
          </div>
          <div className="dp-row"><label className="dp-row"><input type="checkbox" checked={ys.lager} onChange={(e) => setYs({ ...ys, lager: e.target.checked })} /> LAGER</label><label className="dp-row"><input type="checkbox" checked={ys.stir} onChange={(e) => setYs({ ...ys, stir: e.target.checked })} /> STIR PLATE</label></div>
          <p>NEED {r1(need, 0)} B · STARTER MAKES {r1(grow.endB, 0)} B · {grow.endB >= need ? <span className="dp-grn">ENOUGH</span> : <span className="dp-red">NOT ENOUGH</span>}</p>
        </Win>
        <Win title="SG ↔ PLATO / BRIX">
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
