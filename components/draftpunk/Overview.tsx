"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { atSize, calcRecipe, isAid, r1, scaleRecipe, sgFmt } from "@/lib/draftpunk/calc";
import { fmtDate } from "@/lib/draftpunk/defaults";
import type { Equipment, Recipe, RHop, RMisc } from "@/lib/draftpunk/types";
import { Win } from "./ui";

export type PlannedBrew = { id: string; brewed_on: string; plan: { label?: string; sizeLabel?: string } };

const HOP_USE: Record<string, string> = { boil: "Boil", first_wort: "First wort", whirlpool: "Whirlpool", dry_hop: "Dry hop", mash: "Mash" };
const hopWhen = (h: RHop) => h.use === "dry_hop" ? `Dry hop${h.days ? ` · ${h.days} days` : ""}` : h.use === "whirlpool" ? `Whirlpool ${h.min} min${h.tempF ? ` @ ${h.tempF}°F` : ""}` : `${HOP_USE[h.use] || h.use} ${h.min} min`;
const miscWhen = (m: RMisc) => (m.use === "boil" ? `Boil ${m.min ?? 0} min` : m.use[0].toUpperCase() + m.use.slice(1));
const SALT: Record<string, string> = { gypsum: "Gypsum", cacl2: "Calcium chloride", epsom: "Epsom salt", nacl: "Table salt", bakingSoda: "Baking soda", chalk: "Chalk", smb: "Metabisulfite" };

/**
 * The first tab of a recipe (Nick, Nov 24 2026: "the first thing I wanna see… an overview just like the whole recipe…
 * you see the grains… you can scale it quickly… you can see the mash profile, the water… everything on one nice page,
 * and then you say make it"). Read only: the size switch shows it at another batch size without changing the recipe;
 * Brew it opens the planner at that size.
 */
export default function Overview({ r, equip, planned, onBrew, canBrew }: { r: Recipe; equip: { e: Equipment }[]; planned: PlannedBrew[]; onBrew: (gal: number) => void; canBrew: boolean }) {
  const sys = equip.find((q) => q.e.name === r.equipment.name && q.e.sizes?.length) || equip.find((q) => q.e.sizes?.length);
  const [gal, setGal] = useState(r.equipment.batchGal);
  const shown = useMemo(() => {
    if (!sys || Math.abs(gal - r.equipment.batchGal) < 0.05 && r.equipment.name === sys.e.name) return r;
    return scaleRecipe(r, atSize(sys.e, gal));
  }, [r, gal, sys]);
  const c = useMemo(() => calcRecipe(shown), [shown]);
  const grains = shown.ferms.filter((f) => !isAid(f)), aids = shown.ferms.filter((f) => isAid(f));
  const salts = Object.entries(shown.water.salts).filter(([k, v]) => SALT[k] && (v || 0) > 0.05);
  const acid = (shown.water.salts.lacticMl || 0) + (shown.water.salts.phosphoricMl || 0);

  return (
    <div className="dp-ov">
      {!!planned.length && (
        <div className="dp-ov-plans">
          {planned.map((p) => <Link key={p.id} href={`/draftpunk/brews/${p.id}`} className="dp-chip dp-beer">Planned {fmtDate(p.brewed_on)} · {[p.plan.label, p.plan.sizeLabel].filter(Boolean).join(" · ")}</Link>)}
        </div>
      )}
      <div className="dp-ov-top">
        {sys?.e.sizes ? (
          <span className="dp-seg" role="group" aria-label="View at size">
            {sys.e.sizes.map((s) => <button key={s.label} type="button" className={Math.abs(gal - s.batchGal) < 0.05 ? "on" : ""} onClick={() => setGal(s.batchGal)}>{s.label}</button>)}
          </span>
        ) : <span className="dp-chip">{r1(r.equipment.batchGal, 2)} gal</span>}
        <span className="dp-dim">{sgFmt(c.og)} OG · {r1(c.ibu, 0)} IBU · {r1(c.abv, 1)}% · SRM {r1(c.srm, 1)}</span>
        {canBrew && <button type="button" className="dp-btn dp-go dp-ov-brew" onClick={() => onBrew(shown.equipment.batchGal)}>Brew it</button>}
      </div>

      <div className="dp-grid">
        <Win title="Grains" note={`${r1(grains.reduce((a, f) => a + f.lb, 0), 2)} lb`}>
          <table className="dp-tbl"><tbody>
            {grains.map((f) => <tr key={f.lid}><td>{f.name}{f.supplier ? <span className="dp-dim"> · {f.supplier}</span> : null}</td><td className="dp-num dp-dim">{r1(c.fermPct[f.lid] || 0, 1)}%</td><td className="dp-num"><b>{r1(f.lb, 2)} lb</b></td></tr>)}
            {aids.map((f) => <tr key={f.lid} className="dp-dim"><td>{f.name} (aid)</td><td /><td className="dp-num">{r1(f.lb, 2)} lb</td></tr>)}
          </tbody></table>
        </Win>
        <Win title="Hops and additions">
          <table className="dp-tbl"><tbody>
            {shown.hops.map((h) => <tr key={h.lid}><td>{h.name} <span className="dp-dim">{h.alpha}%</span><div className="dp-dim dp-ov-sub">{hopWhen(h)}</div></td><td className="dp-num dp-dim">{c.hopIbus[h.lid] ? `${r1(c.hopIbus[h.lid], 1)} IBU` : ""}</td><td className="dp-num"><b>{r1(h.oz, 2)} oz</b></td></tr>)}
            {shown.miscs.map((m) => <tr key={m.lid}><td>{m.name}<div className="dp-dim dp-ov-sub">{miscWhen(m)}</div></td><td /><td className="dp-num"><b>{r1(m.amount, 2)} {m.unit}</b></td></tr>)}
            {!shown.hops.length && !shown.miscs.length && <tr><td className="dp-dim">None</td></tr>}
          </tbody></table>
        </Win>
        <Win title="Mash" note={`${shown.mash.name} · ${r1(c.mashWaterGal, 2)} gal at ${r1(c.strikeTempF, 0)}°F`}>
          <table className="dp-tbl"><tbody>
            {shown.mash.steps.map((s, i) => <tr key={i}><td>{s.name}</td><td className="dp-num">{s.tempF}°F</td><td className="dp-num">{s.min} min</td></tr>)}
            <tr className="dp-dim"><td>Sparge</td><td className="dp-num" colSpan={2}>{shown.mash.sparge === "none" ? "No sparge" : `${r1(c.spargeWaterGal, 2)} gal at ${shown.mash.spargeTempF}°F`}</td></tr>
          </tbody></table>
        </Win>
        <Win title="Water" note={shown.water.target?.name || shown.water.source.name}>
          <div className="dp-dim" style={{ marginBottom: 6 }}>Ca {r1(c.water.ca, 0)} · Mg {r1(c.water.mg, 0)} · Na {r1(c.water.na, 0)} · SO₄ {r1(c.water.so4, 0)} · Cl {r1(c.water.cl, 0)} · mash pH {c.mashPh ? r1(c.mashPh, 2).toFixed(2) : "-"}</div>
          <table className="dp-tbl"><tbody>
            {salts.map(([k, v]) => <tr key={k}><td>{SALT[k]}</td><td className="dp-num"><b>{r1(v as number, 1)} g</b></td></tr>)}
            {acid > 0 && <tr><td>Acid in the mash</td><td className="dp-num"><b>{r1(acid, 1)} ml</b></td></tr>}
            {!salts.length && !acid && <tr><td className="dp-dim">No salts</td></tr>}
          </tbody></table>
        </Win>
        <Win title="Yeast and fermentation">
          <table className="dp-tbl"><tbody>
            {shown.yeasts.map((y) => <tr key={y.lid}><td><b>{y.name}</b>{y.lab || y.code ? <span className="dp-dim"> · {[y.lab, y.code].filter(Boolean).join(" ")}</span> : null}</td><td className="dp-num dp-dim">{y.attenuation}%</td></tr>)}
            {shown.ferment.map((s, i) => <tr key={i}><td>{s.name}</td><td className="dp-num">{s.tempF}°F · {s.days} d{s.psi ? ` · ${s.psi} psi` : ""}</td></tr>)}
            <tr className="dp-dim"><td>Carbonation</td><td className="dp-num">{shown.carb.vols} vols · {shown.carb.method === "keg" ? "keg" : shown.carb.method === "spund" ? "spund" : "bottle"}</td></tr>
          </tbody></table>
        </Win>
        {(shown.notes || shown.tasteNotes) && <Win title="Notes"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{[shown.notes, shown.tasteNotes].filter(Boolean).join("\n\n")}</p></Win>}
      </div>
    </div>
  );
}
