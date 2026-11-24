"use client";
import { useMemo, useState } from "react";
import { cellsNeeded, clSo4, co2Harvest, kegPsi, lacticFor, primingOz, spundPlan, r1, residualAlk, SALT_LABEL, saltsFor, sgFmt, smbGrams, starterGrowth, treatWater, viability, waterSplit } from "@/lib/draftpunk/calc";
import { asFerm, asHop, asMisc, asYeast } from "@/lib/draftpunk/defaults";
import { FERMENTABLES, HOPS, MASH_PROFILES, MISCS, WATERS, YEASTS } from "@/lib/draftpunk/library";
import type { Calc, Carb, Fermentable, FermType, Hop, HopForm, HopUse, Misc, MashStep, Recipe, Salts, WaterProfile, Yeast } from "@/lib/draftpunk/types";
import { F, Num, Picker, Win } from "./ui";
import { FERMENT_PRESETS } from "@/lib/draftpunk/autopilot";

type Set = (fn: (x: Recipe) => Recipe) => void;
export type MineItem = { id: string; kind: "fermentable" | "hop" | "yeast" | "misc" | "water"; name: string; data: Record<string, unknown>; in_stock: number | null };
type Props = { r: Recipe; c: Calc; set: Set };

const FTYPES: FermType[] = ["grain", "adjunct", "extract", "dry_extract", "sugar", "honey", "fruit", "juice"];
const USES: [HopUse, string][] = [["boil", "Boil"], ["first_wort", "First Wort"], ["whirlpool", "Whirlpool"], ["dry_hop", "Dry Hop"], ["mash", "Mash"]];

// ---------------- DESIGN: fermentables, hops, yeast, misc ----------------
export function DesignTab({ r, c, set, mine }: Props & { mine: MineItem[] }) {
  const [pick, setPick] = useState<"" | "ferm" | "hop" | "yeast" | "misc">("");
  // the brewer's own ingredients (not stock entries of library items), with the numbers a recipe needs
  const needs: Record<string, string> = { fermentable: "potential", hop: "alpha", yeast: "attenuation", misc: "use" };
  const my = (kind: MineItem["kind"]) => mine.filter((m) => m.kind === kind && !(m.data as { ref?: string }).ref && (m.data as Record<string, unknown>)[needs[kind]] != null);
  const stockOf = (name: string) => mine.find((m) => m.name.toLowerCase() === name.toLowerCase() && m.in_stock != null)?.in_stock;
  const totalLb = r.ferms.reduce((a, f) => a + f.lb, 0);
  const totalHop = r.hops.reduce((a, h) => a + h.oz, 0);

  const pickers = {
    ferm: { title: "Add fermentable", head: ["PPG", "°L", "Max%"], items: [...my("fermentable").map((m) => ({ key: `m:${m.id}`, name: m.name, sub: "Mine", cols: [r1(((m.data as Fermentable).potential - 1) * 1000, 0) + "", (m.data as Fermentable).color + "", ""] })), ...FERMENTABLES.map((f) => ({ key: f.id, name: f.name, sub: f.origin, cols: [r1((f.potential - 1) * 1000, 0) + "", f.color + "", f.maxPct + ""] }))] },
    hop: { title: "Add hops", head: ["AA%", "Use"], items: [...my("hop").map((m) => ({ key: `m:${m.id}`, name: m.name, sub: "Mine", cols: [(m.data as Hop).alpha + "", ""] })), ...HOPS.map((h) => ({ key: h.id, name: h.name, sub: h.origin, cols: [h.alpha + "", h.use || ""] }))] },
    yeast: { title: "Add yeast", head: ["Atten", "Temp °F"], items: [...my("yeast").map((m) => ({ key: `m:${m.id}`, name: m.name, sub: "Mine", cols: [(m.data as Yeast).attenuation + "%", ""] })), ...YEASTS.map((y) => ({ key: y.id, name: `${y.lab} ${y.code} ${y.name}`, sub: y.form, cols: [y.attenuation + "%", `${y.tempLow}–${y.tempHigh}`] }))] },
    misc: { title: "Add misc", head: ["Use"], items: [...my("misc").map((m) => ({ key: `m:${m.id}`, name: m.name, sub: "Mine", cols: [""] })), ...MISCS.map((m) => ({ key: m.id, name: m.name, sub: m.type, cols: [m.use] }))] },
  };
  const onPick = (key: string) => {
    const m = key.startsWith("m:") ? mine.find((x) => x.id === key.slice(2)) : null;
    const dat = (lib: { id: string }[]) => (m ? ({ ...m.data, name: m.name } as never) : (lib.find((x) => x.id === key) as never));
    if (pick === "ferm") set((x) => ({ ...x, ferms: [...x.ferms, asFerm(dat(FERMENTABLES), 1)] }));
    if (pick === "hop") set((x) => ({ ...x, hops: [...x.hops, asHop(dat(HOPS), 1, "boil", x.hops.length ? 10 : 60)] }));
    if (pick === "yeast") set((x) => ({ ...x, yeasts: [...x.yeasts, asYeast(dat(YEASTS))] }));
    if (pick === "misc") set((x) => ({ ...x, miscs: [...x.miscs, asMisc(dat(MISCS))] }));
    setPick("");
  };
  const onCustom = (name: string) => {
    if (pick === "ferm") set((x) => ({ ...x, ferms: [...x.ferms, asFerm({ name, type: "grain", potential: 1.035, color: 3 }, 1)] }));
    if (pick === "hop") set((x) => ({ ...x, hops: [...x.hops, asHop({ name, alpha: 8, form: "pellet" })] }));
    if (pick === "yeast") set((x) => ({ ...x, yeasts: [...x.yeasts, asYeast({ name, form: "liquid", attenuation: 75, cells: 100 })] }));
    if (pick === "misc") set((x) => ({ ...x, miscs: [...x.miscs, asMisc({ name, type: "other", use: "boil" } as Misc)] }));
    setPick("");
  };
  const up = <K extends "ferms" | "hops" | "yeasts" | "miscs">(k: K, i: number, patch: Partial<Recipe[K][number]>) => set((x) => { (x[k] as unknown[])[i] = { ...x[k][i], ...patch }; return x; });
  const del = (k: "ferms" | "hops" | "yeasts" | "miscs", i: number) => set((x) => { (x[k] as unknown[]).splice(i, 1); return x; });
  const move = (k: "ferms" | "hops", i: number, d: -1 | 1) => set((x) => { const a = x[k] as unknown[]; const j = i + d; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return x; });
  const sortHops = () => set((x) => ({ ...x, hops: [...x.hops].sort((a, b) => USES.findIndex((u) => u[0] === a.use) - USES.findIndex((u) => u[0] === b.use) || b.min - a.min) }));

  return (
    <>
      <Win title={`Fermentables · ${r1(totalLb, 2)} lb`}>
        <table className="dp-tbl" data-nofit>
          <thead><tr><th className="dp-num">LB</th><th>Name</th><th>Type</th><th className="dp-num">PPG</th><th className="dp-num">°L</th><th className="dp-num">%</th><th>Late</th><th className="dp-num">Stock</th><th /></tr></thead>
          <tbody>
            {r.ferms.map((f, i) => (
              <tr key={f.lid}>
                <td className="dp-num"><Num value={f.lb} onChange={(n) => up("ferms", i, { lb: n })} digits={3} /></td>
                <td><input value={f.name} onChange={(e) => up("ferms", i, { name: e.target.value })} /></td>
                <td><select value={f.type} onChange={(e) => up("ferms", i, { type: e.target.value as FermType })}>{FTYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></td>
                <td className="dp-num"><Num value={r1((f.potential - 1) * 1000, 1)} onChange={(n) => up("ferms", i, { potential: 1 + n / 1000 })} /></td>
                <td className="dp-num"><Num value={f.color} onChange={(n) => up("ferms", i, { color: n })} /></td>
                <td className="dp-num">{r1(c.fermPct[f.lid] || 0, 1)}</td>
                <td><input type="checkbox" checked={!!f.late} title="Added late in the boil" onChange={(e) => up("ferms", i, { late: e.target.checked })} /></td>
                <td className="dp-num dp-dim">{stockOf(f.name) ?? ""}</td>
                <td className="dp-num"><button className="dp-btn dp-x" onClick={() => move("ferms", i, -1)}>↑</button><button className="dp-btn dp-x" onClick={() => del("ferms", i)}>X</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><button className="dp-btn" onClick={() => setPick("ferm")}>Add fermentable</button></p>
      </Win>

      <Win title={`Hops · ${r1(totalHop, 2)} oz · ${r1(c.ibu, 1)} IBU`}>
        <table className="dp-tbl" data-nofit>
          <thead><tr><th className="dp-num">OZ</th><th>Name</th><th className="dp-num">AA%</th><th>Form</th><th>Use</th><th className="dp-num">Time</th><th className="dp-num">IBU</th><th /></tr></thead>
          <tbody>
            {r.hops.map((h, i) => (
              <tr key={h.lid}>
                <td className="dp-num"><Num value={h.oz} onChange={(n) => up("hops", i, { oz: n })} digits={3} /></td>
                <td><input value={h.name} onChange={(e) => up("hops", i, { name: e.target.value })} /></td>
                <td className="dp-num"><Num value={h.alpha} onChange={(n) => up("hops", i, { alpha: n })} /></td>
                <td><select value={h.form || "pellet"} onChange={(e) => up("hops", i, { form: e.target.value as HopForm })}>{["pellet", "leaf", "plug", "extract"].map((t) => <option key={t}>{t}</option>)}</select></td>
                <td><select value={h.use} onChange={(e) => { const use = e.target.value as HopUse; up("hops", i, { use, tempF: use === "whirlpool" ? h.tempF || 180 : h.tempF, days: use === "dry_hop" ? h.days || 4 : h.days, min: use === "whirlpool" ? 20 : use === "dry_hop" ? 0 : h.min }); }}>{USES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td className="dp-num">
                  {h.use === "dry_hop" ? <><Num value={h.days} onChange={(n) => up("hops", i, { days: n })} /> D</>
                    : h.use === "whirlpool" ? <><Num value={h.min} onChange={(n) => up("hops", i, { min: n })} />M @<Num value={h.tempF} onChange={(n) => up("hops", i, { tempF: n })} />°</>
                    : h.use === "boil" ? <><Num value={h.min} onChange={(n) => up("hops", i, { min: n })} /> M</> : <span className="dp-dim">-</span>}
                </td>
                <td className="dp-num">{r1(c.hopIbus[h.lid] || 0, 1)}</td>
                <td className="dp-num"><button className="dp-btn dp-x" onClick={() => move("hops", i, -1)}>↑</button><button className="dp-btn dp-x" onClick={() => del("hops", i)}>X</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dp-row"><button className="dp-btn" onClick={() => setPick("hop")}>Add hops</button><button className="dp-btn" onClick={sortHops}>Sort by time</button></p>
      </Win>

      <div className="dp-grid">
        <Win title={`Yeast · ${r1(c.attenuation, 0)}% attenuation`}>
          <table className="dp-tbl" data-nofit>
            <thead><tr><th className="dp-num">Qty</th><th>Name</th><th className="dp-num">Atten%</th><th>Starter</th><th /></tr></thead>
            <tbody>
              {r.yeasts.map((y, i) => (
                <tr key={y.lid}>
                  <td className="dp-num"><Num value={y.packs} onChange={(n) => up("yeasts", i, { packs: n })} /></td>
                  <td>{y.lab ? `${y.lab} ${y.code || ""} ` : ""}<input value={y.name} onChange={(e) => up("yeasts", i, { name: e.target.value })} /></td>
                  <td className="dp-num"><Num value={y.attenuation} onChange={(n) => up("yeasts", i, { attenuation: n })} /></td>
                  <td><input type="checkbox" checked={!!y.starter} onChange={(e) => up("yeasts", i, { starter: e.target.checked })} /></td>
                  <td className="dp-num"><button className="dp-btn dp-x" onClick={() => del("yeasts", i)}>X</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><button className="dp-btn" onClick={() => setPick("yeast")}>Add yeast</button></p>
        </Win>
        <Win title="Misc">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th className="dp-num">Amt</th><th>Unit</th><th>Name</th><th>Use</th><th className="dp-num">Min</th><th /></tr></thead>
            <tbody>
              {r.miscs.map((m, i) => (
                <tr key={m.lid}>
                  <td className="dp-num"><Num value={m.amount} onChange={(n) => up("miscs", i, { amount: n })} /></td>
                  <td><input style={{ width: "6ch" }} value={m.unit} onChange={(e) => up("miscs", i, { unit: e.target.value })} /></td>
                  <td><input value={m.name} onChange={(e) => up("miscs", i, { name: e.target.value })} /></td>
                  <td><select value={m.use} onChange={(e) => up("miscs", i, { use: e.target.value as Misc["use"] })}>{["boil", "mash", "primary", "secondary", "bottling"].map((u) => <option key={u}>{u}</option>)}</select></td>
                  <td className="dp-num">{m.use === "boil" ? <Num value={m.min} onChange={(n) => up("miscs", i, { min: n })} /> : ""}</td>
                  <td className="dp-num"><button className="dp-btn dp-x" onClick={() => del("miscs", i)}>X</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><button className="dp-btn" onClick={() => setPick("misc")}>Add misc</button></p>
        </Win>
      </div>
      {pick && <Picker {...pickers[pick]} onPick={onPick} onCustom={onCustom} onClose={() => setPick("")} />}
    </>
  );
}

// ---------------- MASH ----------------
export function MashTab({ r, c, set }: Props) {
  const noSparge = r.mash.sparge === "none" || r.type === "biab";
  const upStep = (i: number, patch: Partial<MashStep>) => set((x) => { x.mash.steps[i] = { ...x.mash.steps[i], ...patch }; return x; });
  return (
    <>
      <Win title="Mash profile">
        <div className="dp-row">
          <F label="Load a profile" grow="2 1 280px">
            <select value="" onChange={(e) => { const m = MASH_PROFILES.find((p) => p.name === e.target.value); if (m) set((x) => ({ ...x, mash: structuredClone(m) })); }}>
              <option value="">{r.mash.name} (pick to replace)</option>
              {MASH_PROFILES.map((m) => <option key={m.name}>{m.name}</option>)}
            </select>
          </F>
          <F label="Sparge">
            <select value={r.mash.sparge} onChange={(e) => set((x) => ({ ...x, mash: { ...x.mash, sparge: e.target.value as Recipe["mash"]["sparge"] } }))}>
              <option value="none">None (full volume)</option><option value="batch">Batch</option><option value="fly">Fly</option>
            </select>
          </F>
          <F label="Grain °F"><Num value={r.mash.grainTempF} onChange={(n) => set((x) => ({ ...x, mash: { ...x.mash, grainTempF: n } }))} /></F>
          {!noSparge && <F label="QT/LB"><Num value={r.mash.ratio} onChange={(n) => set((x) => ({ ...x, mash: { ...x.mash, ratio: n } }))} /></F>}
          {!noSparge && <F label="Sparge °F"><Num value={r.mash.spargeTempF} onChange={(n) => set((x) => ({ ...x, mash: { ...x.mash, spargeTempF: n } }))} /></F>}
        </div>
        <table className="dp-tbl" data-nofit style={{ marginTop: 10 }}>
          <thead><tr><th>Step</th><th>How</th><th className="dp-num">°F</th><th className="dp-num">Min</th><th /></tr></thead>
          <tbody>
            {r.mash.steps.map((s, i) => (
              <tr key={i}>
                <td><input value={s.name} onChange={(e) => upStep(i, { name: e.target.value })} /></td>
                <td><select value={s.kind} onChange={(e) => upStep(i, { kind: e.target.value as MashStep["kind"] })}><option value="infusion">Add hot water</option><option value="temperature">Heat (RIMS/HERMS/direct)</option><option value="decoction">Decoction</option></select></td>
                <td className="dp-num"><Num value={s.tempF} onChange={(n) => upStep(i, { tempF: n })} /></td>
                <td className="dp-num"><Num value={s.min} onChange={(n) => upStep(i, { min: n })} /></td>
                <td className="dp-num"><button className="dp-btn dp-x" onClick={() => set((x) => { x.mash.steps.splice(i, 1); return x; })}>X</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><button className="dp-btn" onClick={() => set((x) => { x.mash.steps.push({ name: "Rest", kind: noSparge ? "temperature" : "infusion", tempF: 168, min: 10 }); return x; })}>Add step</button></p>
      </Win>
      <Win title="Water and volumes">
        <table className="dp-tbl" data-nofit>
          <tbody>
            <tr><td>Grain</td><td className="dp-num">{r1(c.totalGrainLb, 2)} lb</td></tr>
            <tr><td>Total water</td><td className="dp-num">{r1(c.mashWaterGal + c.spargeWaterGal, 2)} gal</td></tr>
            <tr><td>{noSparge ? "Strike water (all of it)" : "Mash water"}</td><td className="dp-num">{r1(c.mashWaterGal, 2)} gal @ {r1(c.strikeTempF, 0)}°F strike</td></tr>
            {!noSparge && <tr><td>Sparge water</td><td className="dp-num">{r1(c.spargeWaterGal, 2)} gal @ {r.mash.spargeTempF}°F</td></tr>}
            <tr><td>Water to grain</td><td className="dp-num">{c.totalGrainLb ? r1((c.mashWaterGal * 4) / c.totalGrainLb, 2) : "-"} qt/lb</td></tr>
            <tr><td>Grain absorbs + dead space</td><td className="dp-num">{r1(c.totalGrainLb * r.equipment.absorbGalPerLb + r.equipment.tunDeadGal, 2)} gal</td></tr>
            {!!r.equipment.mashEvapGalPerHr && <tr><td>Mash evaporation</td><td className="dp-num">{r1((r.equipment.mashEvapGalPerHr * r.mash.steps.reduce((a, s) => a + s.min, 0)) / 60, 2)} gal</td></tr>}
            <tr><td>Pre-boil</td><td className="dp-num">{r1(c.preBoilGal, 2)} gal @ {sgFmt(c.preBoilGravity)}</td></tr>
            <tr><td>Boil-off{r.weather ? " (today's weather)" : ""}</td><td className="dp-num">{r1(c.boilOffGal, 2)} gal/hr × {r.equipment.boilMin} min</td></tr>
            <tr><td>End of boil (cooled)</td><td className="dp-num">{r1(c.postBoilColdGal, 2)} gal @ {sgFmt(c.og)}</td></tr>
            <tr><td>Into the fermenter</td><td className="dp-num">{r1(c.intoFermGal, 2)} gal</td></tr>
          </tbody>
        </table>
        {noSparge && <p className="dp-dim">Full-volume mash: all the water goes in at the start, and the RIMS or HERMS heats each rest.</p>}
      </Win>
    </>
  );
}

// ---------------- WATER (starts from RO; Nick, Nov 23 2026) ----------------
const IONS: [keyof WaterProfile, string][] = [["ca", "Ca"], ["mg", "Mg"], ["na", "Na"], ["so4", "SO4"], ["cl", "Cl"], ["hco3", "HCO3"]];
const RANGES: Record<string, string> = { ca: "50–150", mg: "0–30", na: "0–150", so4: "0–350", cl: "0–150", hco3: "as needed" };
const SALTS = (Object.keys(SALT_LABEL) as (keyof typeof SALT_LABEL)[]).filter((k) => k !== "smb");
export function WaterTab({ r, c, set }: Props) {
  const [targetPh, setTargetPh] = useState(5.4);
  const totalGal = c.mashWaterGal + c.spargeWaterGal;
  const split = waterSplit(r, c);
  const target = r.water.target;
  const setW = (patch: Partial<Recipe["water"]>) => set((x) => ({ ...x, water: { ...x.water, ...patch } }));
  const setSalt = (k: keyof Salts, n: number) => set((x) => ({ ...x, water: { ...x.water, salts: { ...x.water.salts, [k]: n } } }));
  const saltGal = r.water.spargeSalts === false ? c.mashWaterGal : totalGal;
  const lodo = r.water.lodo;
  const smbG = lodo?.on ? smbGrams(lodo.smbMgL, saltGal) : 0;
  // the salts to reach the target, counting the sodium and sulfate the LODO metabisulfite already adds
  const autoSalts = () => {
    if (!target) return;
    const base = treatWater(r.water.source, { gypsum: 0, cacl2: 0, epsom: 0, nacl: 0, bakingSoda: 0, chalk: 0, smb: smbG, lacticMl: 0 }, saltGal);
    const s = saltsFor(target, saltGal, base);
    setW({ salts: { ...s, smb: r.water.salts.smb, lacticMl: r.water.salts.lacticMl, phosphoricMl: r.water.salts.phosphoricMl } });
  };
  // acid to bring the mash to the target pH, worked out from the pH without any acid
  const phNoAcid = useMemo(() => c.mashPh + ((r.water.salts.lacticMl || 0) * 11.8) / (40 * c.totalGrainLb * 0.4536 || 1), [c.mashPh, r.water.salts.lacticMl, c.totalGrainLb]);
  const autoAcid = () => setSalt("lacticMl", r1(lacticFor(phNoAcid, targetPh, c.totalGrainLb), 1));
  const ratio = clSo4(c.water);
  return (
    <>
      <Win title="Water">
        <div className="dp-row">
          <F label="Start with" grow="1 1 220px">
            <select value={r.water.source.name} onChange={(e) => { const w = WATERS.find((x) => x.name === e.target.value); if (w) setW({ source: { ...w } }); }}>
              {!WATERS.some((w) => w.name === r.water.source.name) && <option>{r.water.source.name}</option>}
              {WATERS.map((w) => <option key={w.id} value={w.name}>{w.name === "Distilled / RO Water" ? "RO Water (100%)" : w.name}</option>)}
            </select>
          </F>
          <F label="Aim for" grow="1 1 220px">
            <select value={target?.name || ""} onChange={(e) => { const w = WATERS.find((x) => x.name === e.target.value); setW({ target: w ? { ...w } : undefined }); }}>
              <option value="">(no target)</option>
              {target && !WATERS.some((w) => w.name === target.name) && <option>{target.name}</option>}
              {WATERS.filter((w) => !/RO|tap|Chicago/i.test(w.name)).map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
            </select>
          </F>
          <button className="dp-btn dp-go" disabled={!target} onClick={autoSalts}>Work out salts</button>
        </div>
        <div className="dp-row" style={{ marginTop: 8 }}>
          <label className="dp-row"><input type="checkbox" checked={!!lodo?.on} onChange={(e) => setW({ lodo: { on: e.target.checked, smbMgL: lodo?.smbMgL || 50 } })} /> LODO (low oxygen)</label>
          {lodo?.on && <F label="SMB mg/L"><Num value={lodo.smbMgL} onChange={(n) => setW({ lodo: { on: true, smbMgL: n } })} /></F>}
          {lodo?.on && <span className="dp-dim">{r1(smbG, 2)} g sodium metabisulfite in {r1(saltGal, 2)} gal</span>}
        </div>
        {target && (
          <div className="dp-row" style={{ marginTop: 8 }}>
            {IONS.map(([k, l]) => <F key={k} label={`${l} target`}><Num value={target[k] as number} onChange={(n) => setW({ target: { ...target, name: target.name.endsWith("*") ? target.name : `${target.name}*`, [k]: n } })} /></F>)}
          </div>
        )}
      </Win>
      <div className="dp-grid">
        <Win title={`Salts · ${r1(totalGal, 2)} gal`}>
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Add</th><th className="dp-num">Total g</th><th className="dp-num">Mash</th>{c.spargeWaterGal > 0 && <th className="dp-num">Sparge</th>}</tr></thead>
            <tbody>
              {SALTS.map((k) => (
                <tr key={k}>
                  <td>{SALT_LABEL[k]}</td>
                  <td className="dp-num"><Num value={r.water.salts[k]} onChange={(n) => setSalt(k, n)} /></td>
                  <td className="dp-num">{r1(split.mash[k] || 0, 1)}</td>
                  {c.spargeWaterGal > 0 && <td className="dp-num">{r1(split.sparge[k] || 0, 1)}</td>}
                </tr>
              ))}
              {lodo?.on && (
                <tr><td>Sodium metabisulfite (LODO)</td><td className="dp-num">{r1(smbG, 2)}</td><td className="dp-num">{r1(smbG * (saltGal ? c.mashWaterGal / saltGal : 1), 2)}</td>{c.spargeWaterGal > 0 && <td className="dp-num">{r1(smbG - smbG * (saltGal ? c.mashWaterGal / saltGal : 1), 2)}</td>}</tr>
              )}
              <tr><td>Lactic acid 88% (ml, mash)</td><td className="dp-num"><Num value={r.water.salts.lacticMl} onChange={(n) => setSalt("lacticMl", n)} /></td><td /></tr>
            </tbody>
          </table>
          {c.spargeWaterGal > 0 && (
            <label className="dp-row" style={{ marginTop: 8 }}><input type="checkbox" checked={r.water.spargeSalts !== false} onChange={(e) => setW({ spargeSalts: e.target.checked })} /> Treat the sparge water too (same ppm)</label>
          )}
        </Win>
        <Win title="Mash pH">
          <div className="dp-clock" style={{ fontSize: 30 }}>{c.mashPh ? r1(c.mashPh, 2).toFixed(2) : "-.--"}</div>
          <p className={c.mashPh && (c.mashPh < 5.2 || c.mashPh > 5.6) ? "dp-red" : "dp-dim"}>Aim: 5.2–5.6 (5.3–5.4 for pale and hoppy, 5.4–5.5 for dark)</p>
          <div className="dp-row">
            <F label="Target pH"><Num value={targetPh} onChange={setTargetPh} /></F>
            <button className="dp-btn" onClick={autoAcid}>Set lactic</button>
          </div>
          <p className="dp-dim">From the grain bill (each malt&apos;s own pH), the water&apos;s calcium and alkalinity, and any acid or acid malt.</p>
        </Win>
      </div>
      <Win title="The water you'll brew with (ppm)">
        <table className="dp-tbl" data-nofit>
          <thead><tr><th /> {IONS.map(([, l]) => <th key={l} className="dp-num">{l}</th>)}</tr></thead>
          <tbody>
            <tr><td>Start ({r.water.source.name})</td>{IONS.map(([k]) => <td key={k} className="dp-num">{r1(r.water.source[k] as number, 0)}</td>)}</tr>
            {target && <tr><td>Target</td>{IONS.map(([k]) => <td key={k} className="dp-num">{r1(target[k] as number, 0)}</td>)}</tr>}
            <tr><td className="dp-hi">Result</td>{IONS.map(([k]) => <td key={k} className="dp-num" style={{ color: "var(--dp-hi)" }}>{r1(c.water[k] as number, 0)}</td>)}</tr>
            <tr className="dp-dim"><td>Good range</td>{IONS.map(([k]) => <td key={k} className="dp-num">{RANGES[k]}</td>)}</tr>
          </tbody>
        </table>
        <div className="dp-row" style={{ marginTop: 8 }}>
          <span>Cl:SO4 {r1(ratio, 2)} · {!c.water.so4 && !c.water.cl ? "-" : ratio < 0.77 ? "Hoppy / dry" : ratio > 1.3 ? "Malty / full" : "Balanced"}</span>
          <span>Residual alkalinity {r1(residualAlk(c.water), 0)} ppm</span>
        </div>
      </Win>
    </>
  );
}

// ---------------- FERMENT, CARBONATION, YEAST STARTER ----------------
export function FermentTab({ r, c, set }: Props) {
  const lager = r.yeasts.some((y) => y.kind === "lager");
  const need = cellsNeeded(c.og, c.intoFermGal, lager);
  const y0 = r.yeasts[0];
  const st = r.starter || { liters: 2, stir: true };
  const haveB = r.yeasts.reduce((a, y) => a + (y.form === "dry" ? (y.cells || 200) : (y.cells || 100) * viability(st.packDate)) * y.packs, 0);
  const grow = starterGrowth(haveB, st.liters, st.stir);
  const warm = Math.max(...r.ferment.map((s) => s.tempF), 60);
  const setCarb = (patch: Partial<Carb>) => set((x) => ({ ...x, carb: { ...x.carb, ...patch } }));
  return (
    <>
      <Win title="Fermentation">
        <table className="dp-tbl" data-nofit>
          <thead><tr><th>Step</th><th className="dp-num">°F</th><th className="dp-num">PSI</th><th>Moves on</th><th className="dp-num">Days / value</th><th /></tr></thead>
          <tbody>
            {r.ferment.map((s, i) => (
              <tr key={i}>
                <td><input value={s.name} onChange={(e) => set((x) => { x.ferment[i].name = e.target.value; return x; })} /></td>
                <td className="dp-num"><Num value={s.tempF} onChange={(n) => set((x) => { x.ferment[i].tempF = n; return x; })} /></td>
                <td className="dp-num"><Num value={s.psi} title="Spunding valve pressure during this step (pressure fermentation); blank for none" onChange={(n) => set((x) => { x.ferment[i].psi = n || undefined; return x; })} /></td>
                <td>
                  <select value={s.until || "days"} onChange={(e) => set((x) => { const u = e.target.value as NonNullable<typeof s.until>; x.ferment[i].until = u; x.ferment[i].untilVal = u === "progress" ? 75 : u === "near_fg" ? 3 : u === "stable" ? 48 : undefined; return x; })}>
                    <option value="days">After a number of days</option>
                    <option value="progress">When it&apos;s % of the way to FG (Tilt)</option>
                    <option value="near_fg">Within points of FG (Tilt)</option>
                    <option value="stable">When gravity holds for hours (Tilt)</option>
                  </select>
                </td>
                <td className="dp-num">
                  {!s.until || s.until === "days"
                    ? <><Num value={s.days} onChange={(n) => set((x) => { x.ferment[i].days = n; return x; })} /> d</>
                    : <><Num value={s.untilVal} onChange={(n) => set((x) => { x.ferment[i].untilVal = n; return x; })} /> {s.until === "progress" ? "%" : s.until === "near_fg" ? "pts" : "h"}</>}
                </td>
                <td className="dp-num"><button className="dp-btn dp-x" aria-label="Remove step" onClick={() => set((x) => { x.ferment.splice(i, 1); return x; })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dp-row" style={{ marginTop: 12 }}>
          <button className="dp-btn" onClick={() => set((x) => { x.ferment.push({ name: "Rest", days: 3, tempF: 68, until: "days" }); return x; })}>Add step</button>
          <select style={{ width: "auto" }} value="" onChange={(e) => { const p = FERMENT_PRESETS.find((q) => q.name === e.target.value); if (p) set((x) => ({ ...x, ferment: structuredClone(p.steps) })); }}>
            <option value="">Load a schedule…</option>
            {FERMENT_PRESETS.map((p) => <option key={p.name}>{p.name}</option>)}
          </select>
          {y0 && <span className="dp-dim">{y0.name}: {y0.tempLow ?? "?"}–{y0.tempHigh ?? "?"}°F</span>}
        </p>
      </Win>
      <div className="dp-grid">
        <Win title="Carbonation">
          <div className="dp-row">
            <F label="CO2 volumes"><Num value={r.carb.vols} onChange={(n) => setCarb({ vols: n })} /></F>
            <F label="How">
              <select value={r.carb.method} onChange={(e) => setCarb({ method: e.target.value as Carb["method"] })}>
                <option value="spund">Spunding, force carb if needed</option><option value="keg">Keg (force carb)</option><option value="corn_sugar">Corn sugar</option><option value="table_sugar">Table sugar</option><option value="dme">Dry malt extract</option><option value="honey">Honey</option>
              </select>
            </F>
            {(r.carb.method === "keg" || r.carb.method === "spund") && <F label="Serve °F"><Num value={r.carb.tempF} onChange={(n) => setCarb({ tempF: n })} /></F>}
            {r.carb.method === "spund" && <F label="Cap at +pts"><Num value={r.carb.spundPts ?? spundPlan(c.fg, r.carb.vols, warm).pts} onChange={(n) => setCarb({ spundPts: n })} /></F>}
          </div>
          {r.carb.method === "spund" && (() => { const sp = spundPlan(c.fg, r.carb.vols, warm, r.carb.spundPts); return (
            <p className="dp-v" style={{ fontSize: 24 }}>Spund at {sgFmt(sp.capSg)} · valve {r1(sp.psi, 1)} PSI @ {warm}°F · top up {r1(kegPsi(r.carb.vols, r.carb.tempF), 1)} PSI @ {r.carb.tempF}°F</p>
          ); })()}
          <p className="dp-v" style={{ fontSize: 26 }} hidden={r.carb.method === "spund"}>
            {r.carb.method === "keg" ? `${r1(kegPsi(r.carb.vols, r.carb.tempF), 1)} PSI at ${r.carb.tempF}°F` : `${r1(primingOz(c.packagedGal, r.carb.vols, warm, r.carb.method as "corn_sugar"), 2)} oz ${r.carb.method.replace("_", " ")}`}
          </p>
          <label className="dp-row" style={{ marginTop: 10 }}><input type="checkbox" checked={!!r.carb.harvest} onChange={(e) => setCarb({ harvest: e.target.checked })} /> Harvest fermentation CO2 to purge kegs</label>
          {r.carb.harvest && (() => { const h = co2Harvest(c.og, c.fg, c.intoFermGal, r.carb.method === "spund" ? spundPlan(c.fg, r.carb.vols, warm, r.carb.spundPts).capSg : undefined); return (
            <p>About <b>{r1(h.usableL, 0)} L</b> of CO2 to harvest: enough to push out <b>{h.kegs}</b> sanitizer-filled 5 gal kegs.</p>
          ); })()}
          <p className="dp-dim">For {r1(c.packagedGal, 2)} gal · American ale 2.2–2.7 · Stout 1.8–2.3 · Weizen 3.3–4.5 · Belgian 2.5–3.2</p>
        </Win>
        <Win title="Yeast starter">
          <table className="dp-tbl" data-nofit>
            <tbody>
              <tr><td>Cells needed ({lager ? "lager" : "ale"})</td><td className="dp-num">{r1(need, 0)} B</td></tr>
              <tr><td>Cells you have</td><td className="dp-num">{r1(haveB, 0)} B</td></tr>
              <tr><td>After a {st.liters} L starter</td><td className="dp-num">{r1(grow.endB, 0)} B</td></tr>
            </tbody>
          </table>
          <div className="dp-row" style={{ marginTop: 8 }}>
            <F label="Starter L"><Num value={st.liters} onChange={(n) => set((x) => ({ ...x, starter: { ...st, liters: n } }))} /></F>
            <label className="dp-row"><input type="checkbox" checked={st.stir} onChange={(e) => set((x) => ({ ...x, starter: { ...st, stir: e.target.checked } }))} /> Stir plate</label>
            <F label="Pack date"><input type="date" value={st.packDate || ""} onChange={(e) => set((x) => ({ ...x, starter: { ...st, packDate: e.target.value } }))} /></F>
          </div>
          <p className={haveB >= need ? "dp-grn" : grow.endB >= need ? "" : "dp-red"}>
            {haveB >= need ? "Enough yeast, no starter needed." : grow.endB >= need ? `Make the ${st.liters} L starter.` : `Not enough: Add a pack or make a bigger starter.`}
          </p>
        </Win>
      </div>
    </>
  );
}

// ---------------- NOTES, SHARING, EXPORT ----------------
export function NotesTab({ r, set, visibility, onVisibility, onExport }: { r: Recipe; set: Set; visibility: "private" | "club"; onVisibility: (v: "private" | "club") => void; onExport: () => void }) {
  return (
    <>
      <Win title="Notes">
        <F label="Recipe notes"><textarea value={r.notes || ""} onChange={(e) => set((x) => ({ ...x, notes: e.target.value }))} /></F>
        <div style={{ height: 10 }} />
        <F label="Tasting notes"><textarea value={r.tasteNotes || ""} onChange={(e) => set((x) => ({ ...x, tasteNotes: e.target.value }))} /></F>
      </Win>
      <Win title="Share and export">
        <label className="dp-row"><input type="checkbox" checked={visibility === "club"} onChange={(e) => onVisibility(e.target.checked ? "club" : "private")} /> Share with the club (they can view and copy it)</label>
        <p className="dp-row" style={{ marginTop: 10 }}>
          <button className="dp-btn" type="button" onClick={onExport}>Export BeerXML</button>
          <button className="dp-btn" type="button" onClick={() => window.print()}>Print</button>
        </p>
      </Win>
    </>
  );
}
