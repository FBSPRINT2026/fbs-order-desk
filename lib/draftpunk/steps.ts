/**
 * The brew day sheet: a recipe turned into step-by-step instructions with the numbers filled in (water, temperatures,
 * hop times), the way BeerSmith prints them. The brew day page runs a timer on the steps that have minutes.
 */
import { calcRecipe, infusionQt, isMashed, kegPsi, primingOz, r1, sgFmt, SALT_LABEL, spundPlan, waterSplit } from "./calc";
import type { Recipe } from "./types";

export type BrewStep = { id: string; phase: "prep" | "mash" | "boil" | "chill" | "ferment" | "package"; title: string; detail?: string; min?: number; /** boil timer: minutes left in the boil when this happens */ at?: number };

const amt = (n: number, unit: string) => `${r1(n, n < 1 ? 2 : 1)} ${unit}`;

export function brewSteps(r: Recipe): BrewStep[] {
  const c = calcRecipe(r), e = r.equipment;
  const out: BrewStep[] = [];
  let n = 0;
  const add = (s: Omit<BrewStep, "id">) => out.push({ ...s, id: `s${++n}` });
  const mashed = r.ferms.filter((f) => isMashed(f) && !f.late);
  const split = waterSplit(r, c);
  const saltList = (g: Record<string, number>) => Object.entries(g).filter(([, v]) => v >= 0.05).map(([k, v]) => `${r1(v, 1)} g ${SALT_LABEL[k as keyof typeof SALT_LABEL] || k}`);

  add({ phase: "prep", title: "Gather and weigh ingredients", detail: [...r.ferms.map((f) => `${amt(f.lb, "lb")} ${f.name}`), ...r.hops.map((h) => `${amt(h.oz, "oz")} ${h.name}`), ...r.yeasts.map((y) => `${y.packs} × ${y.name}`)].join(" · ") });
  if (r.yeasts.some((y) => y.starter)) add({ phase: "prep", title: "Make the yeast starter (1–2 days ahead)", detail: r.starter ? `${r.starter.liters} L starter${r.starter.stir ? " on a stir plate" : ""}` : undefined });

  const lodo = r.water.lodo?.on;
  if (mashed.length && r.type !== "extract") {
    const first = r.mash.steps[0];
    if (lodo) add({ phase: "mash", title: "LODO: boil the strike water 5 minutes to drive out oxygen, then chill it to strike temperature", detail: "Add the metabisulfite (and salts) once it's cooled; stir gently, no splashing" });
    add({ phase: "mash", title: `Heat ${amt(r.mash.sparge === "none" || r.type === "biab" ? c.mashWaterGal : (r.mash.ratio * c.totalGrainLb) / 4, "gal")} of strike water to ${r1(c.strikeTempF, 0)}°F`,
      detail: [r.water.source.name, ...saltList(split.mash), split.lacticMl ? `${r1(split.lacticMl, 1)} ml lactic acid (88%)` : ""].filter(Boolean).join(" + ") });
    add({ phase: "mash", title: lodo ? `Underlet: pump the water up through ${amt(c.totalGrainLb, "lb")} of grain` : `Mash in ${amt(c.totalGrainLb, "lb")} of grain`, detail: `Aim for ${first ? first.tempF : 152}°F · expected mash pH ${r1(c.mashPh, 2)}${lodo ? " · mash cap on, recirculate gently below the surface" : ""}` });
    let waterQt = r.mash.ratio * c.totalGrainLb;
    r.mash.steps.forEach((s, i) => {
      if (i > 0 && s.kind === "infusion") {
        const q = s.addQt ?? infusionQt(r.mash.steps[i - 1].tempF, s.tempF, c.totalGrainLb, waterQt);
        waterQt += q;
        add({ phase: "mash", title: `Add ${amt(q, "qt")} of boiling water to reach ${s.tempF}°F` });
      } else if (i > 0 && s.kind === "decoction") add({ phase: "mash", title: `Pull a thick decoction, boil it, and return it to reach ${s.tempF}°F` });
      else if (i > 0) add({ phase: "mash", title: `Heat the mash to ${s.tempF}°F` });
      add({ phase: "mash", title: `${s.name}: hold ${s.tempF}°F`, min: s.min });
    });
    if (r.mash.sparge !== "none" && c.spargeWaterGal > 0) add({ phase: "mash", title: `${r.mash.sparge === "fly" ? "Fly" : "Batch"} sparge with ${amt(c.spargeWaterGal, "gal")} at ${r.mash.spargeTempF}°F`, detail: saltList(split.sparge).length ? [r.water.source.name, ...saltList(split.sparge)].join(" + ") : undefined });
  }
  add({ phase: "boil", title: `Collect ${amt(c.preBoilGal, "gal")} of wort`, detail: `Pre-boil gravity should be about ${sgFmt(c.preBoilGravity)}` });
  if (r.type === "extract" || r.type === "partial_mash") {
    const ext = r.ferms.filter((f) => !isMashed(f) && !f.late);
    if (ext.length) add({ phase: "boil", title: "Off the heat, stir in the extract", detail: ext.map((f) => `${amt(f.lb, "lb")} ${f.name}`).join(" · ") });
  }
  add({ phase: "boil", title: `Boil for ${e.boilMin} minutes`, min: e.boilMin, detail: `${lodo ? "Gentle boil · " : ""}boil-off about ${r1(c.boilOffGal, 2)} gal/hr${r.weather ? ` for ${r.weather.tempF}°F, ${r.weather.rh}% humidity, ${r.weather.windMph} mph wind` : ""}` });
  // boil additions by time left
  const boilAdds: { at: number; text: string }[] = [];
  for (const h of r.hops) {
    if (h.use === "first_wort") add({ phase: "boil", title: `First wort hops: ${amt(h.oz, "oz")} ${h.name} as the wort collects` });
    else if (h.use === "boil") boilAdds.push({ at: Math.min(h.min, e.boilMin), text: `${amt(h.oz, "oz")} ${h.name} (${r1(c.hopIbus[h.lid] || 0, 0)} IBU)` });
  }
  for (const m of r.miscs.filter((m) => m.use === "boil")) boilAdds.push({ at: m.min ?? 15, text: `${r1(m.amount, 2)} ${m.unit} ${m.name}` });
  for (const f of r.ferms.filter((f) => f.late)) boilAdds.push({ at: 15, text: `${amt(f.lb, "lb")} ${f.name} (late addition)` });
  for (const at of [...new Set(boilAdds.map((b) => b.at))].sort((a, b) => b - a)) add({ phase: "boil", title: at === 0 ? "At flameout, add" : `With ${at} min left, add`, detail: boilAdds.filter((b) => b.at === at).map((b) => b.text).join(" · "), at });
  const wp = r.hops.filter((h) => h.use === "whirlpool");
  if (wp.length) add({ phase: "chill", title: `Whirlpool at ${wp[0].tempF || 180}°F`, detail: wp.map((h) => `${amt(h.oz, "oz")} ${h.name} for ${h.min} min`).join(" · "), min: Math.max(...wp.map((h) => h.min)) });
  const ft = r.ferment[0]?.tempF || r.yeasts[0]?.tempLow || 66;
  add({ phase: "chill", title: `Chill to ${ft}°F and transfer ${amt(e.batchGal, "gal")} to the fermenter`, detail: `OG should be ${sgFmt(c.og)}${lodo ? " · closed transfer, no splashing" : ""}` });
  add({ phase: "chill", title: "Aerate and pitch the yeast", detail: r.yeasts.map((y) => `${y.packs} × ${y.lab ? y.lab + " " : ""}${y.name}`).join(" · ") });
  for (const s of r.ferment) add({ phase: "ferment", title: `${s.name}: ${s.days} days at ${s.tempF}°F` });
  for (const h of r.hops.filter((h) => h.use === "dry_hop")) add({ phase: "ferment", title: `Dry hop ${amt(h.oz, "oz")} ${h.name}`, detail: `${h.days || 3} days` });
  for (const m of r.miscs.filter((m) => m.use === "primary" || m.use === "secondary")) add({ phase: "ferment", title: `Add ${r1(m.amount, 2)} ${m.unit} ${m.name} (${m.use})` });
  const warm = Math.max(...r.ferment.map((s) => s.tempF), ft);
  if (r.carb.method === "spund") {
    const sp = spundPlan(c.fg, r.carb.vols, warm, r.carb.spundPts);
    add({ phase: "ferment", title: `At ${sgFmt(sp.capSg)} (${sp.pts} points above FG), put the spunding valve on at ${r1(sp.psi, 1)} PSI`, detail: `Holds ${r.carb.vols} volumes at ${warm}°F; the Tilt log warns you when it's time` });
  }
  add({ phase: "package", title: `Final gravity should be about ${sgFmt(c.fg)} (${r1(c.abv, 1)}% ABV)` });
  if (r.carb.method === "keg" || r.carb.method === "spund") add({ phase: "package", title: "Purge the keg with CO2 and closed-transfer the beer", detail: "Fermenter to keg under pressure, liquid post to liquid post; no open racking" });
  if (r.carb.method === "spund") add({ phase: "package", title: `Check the carbonation; if it's short, force carb at ${r1(kegPsi(r.carb.vols, r.carb.tempF), 1)} PSI at ${r.carb.tempF}°F`, detail: `${r.carb.vols} volumes of CO2` });
  else if (r.carb.method === "keg") add({ phase: "package", title: `Keg and carbonate at ${r1(kegPsi(r.carb.vols, r.carb.tempF), 1)} PSI at ${r.carb.tempF}°F`, detail: `${r.carb.vols} volumes of CO2` });
  else add({ phase: "package", title: `Bottle with ${r1(primingOz(c.packagedGal, r.carb.vols, warm, r.carb.method), 1)} oz of ${r.carb.method.replace("_", " ")}`, detail: `${r.carb.vols} volumes of CO2 for ${amt(c.packagedGal, "gal")}` });
  return out;
}
