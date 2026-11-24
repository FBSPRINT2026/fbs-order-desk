/**
 * DraftPunk's brewing math: the same calculations BeerSmith does (gravity, bitterness, color, alcohol, volumes, mash,
 * water and pH, yeast, carbonation, and the brewing tools), in US units. Pure functions, no database, so the recipe
 * builder can run them on every keystroke and the server can check them.
 */
import type { Calc, Equipment, Fermentable, IbuMethod, Recipe, RFerm, RHop, Salts, WaterProfile, Weather } from "./types";
export type { Salts };

export const r1 = (n: number, d = 1) => { const p = 10 ** d; return Math.round((Number.isFinite(n) ? n : 0) * p) / p; };
export const sgFmt = (g: number) => (Number.isFinite(g) && g > 0 ? g.toFixed(3) : "-.---");
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------- gravity units ----------
/** °Plato from specific gravity */
export const plato = (sg: number) => -616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg;
/** specific gravity from °Plato */
export const sgFromPlato = (p: number) => 1 + p / (258.6 - (p / 258.2) * 227.1);
/** Brix and Plato are close enough for brewing */
export const brix = plato;

// ---------- fermentables ----------
/** fermentables that go through the mash (their sugar is limited by efficiency); the rest give all of theirs */
export const isMashed = (f: Pick<Fermentable, "type">) => f.type === "grain" || f.type === "adjunct";
/** the pH a malt gives on its own in distilled water, from what it is when the library doesn't say */
export function diPh(f: Fermentable): number {
  if (f.diPh) return f.diPh;
  const n = f.name.toLowerCase();
  if (/acid/.test(n)) return 4.2;
  if (/crystal|caramel|cara(?!fa)|special b/.test(n)) return 5.22 - 0.00504 * f.color;
  if (f.color >= 200 || /roast|black|chocolate|carafa|patent/.test(n)) return 4.7;
  if (/flaked|torrified|rice|corn|oats|unmalted|raw/.test(n) || f.type === "adjunct") return 6.0;
  if (/wheat|rye/.test(n)) return 6.04;
  if (f.color <= 3) return 5.75;
  return clamp(5.72 - 0.0066 * (f.color - 3), 5.2, 5.75);
}

// ---------- weather ----------
/**
 * How much faster or slower an outdoor kettle boils off than on a calm 70°F, 50% humidity day. Cool air pulls more heat
 * and steam off the kettle, dry air takes up more vapor, and wind does both; hot humid days slow it down. Kept gentle
 * (about ±15% across normal brewing weather) and corrected by each brewer's own logs (learnedBoilOff).
 */
export function weatherFactor(w?: Weather) {
  if (!w) return 1;
  const t = clamp(w.tempF, 0, 110), rh = clamp(w.rh, 0, 100), wind = clamp(w.windMph, 0, 40);
  return clamp(1 + 0.004 * (70 - t) + 0.0015 * (50 - rh) + 0.008 * wind, 0.7, 1.5);
}
/** the equipment's calm-day boil-off worked out from a brew day's real one and its weather */
export const calmBoilOff = (actualGalHr: number, w?: Weather) => actualGalHr / weatherFactor(w);

// ---------- volumes ----------
export function volumes(e: Equipment, w?: Weather) {
  const intoFerm = e.batchGal;
  const postBoilCold = intoFerm + e.trubGal;
  const postBoilHot = postBoilCold / (1 - (e.shrinkPct || 0) / 100);
  const boilOff = e.boilOffGal * weatherFactor(w);
  const preBoil = postBoilHot + (boilOff * e.boilMin) / 60;
  return { intoFerm, postBoilCold, postBoilHot, preBoil, boilOff, bottled: Math.max(0, intoFerm - e.fermLossGal) };
}

/** the boiling point at an elevation, °F (about 1°F lower for every 500 ft) */
export const boilPointF = (ft: number) => 212 - (ft || 0) / 500;

// ---------- hops ----------
/** how much faster or slower alpha acids turn bitter at a temperature than at 212°F (Arrhenius, Malowicki's 98.6 kJ/mol) */
export function tempFactor(tempF: number) {
  const k = (f: number) => (f - 32) * (5 / 9) + 273.15;
  return Math.exp(-(98600 / 8.314) * (1 / k(tempF) - 1 / k(212)));
}
const tinsethUtil = (g: number, min: number) => 1.65 * Math.pow(0.000125, g - 1) * ((1 - Math.exp(-0.04 * min)) / 4.15);
const ragerUtil = (min: number) => Math.max(0, (18.11 + 13.86 * Math.tanh((min - 31.32) / 18.27)) / 100);
const GARETZ: [number, number][] = [[0, 0], [10, 0], [15, 2], [20, 5], [25, 8], [30, 11], [35, 14], [40, 16], [45, 18], [50, 19], [60, 20], [70, 21], [80, 22], [90, 23], [300, 23]];
const garetzUtil = (min: number) => {
  for (let i = 1; i < GARETZ.length; i++) {
    const [t1, u1] = GARETZ[i - 1], [t2, u2] = GARETZ[i];
    if (min <= t2) return (u1 + ((u2 - u1) * (min - t1)) / (t2 - t1)) / 100;
  }
  return 0.23;
};

/** the minutes a hop addition counts for, and at what temperature */
function hopTime(h: RHop, e: Equipment): { min: number; scale: number } {
  const bp = boilPointF(e.elevationFt);
  const elev = tempFactor(bp);
  switch (h.use) {
    case "boil": return { min: Math.min(h.min, e.boilMin), scale: elev };
    case "first_wort": return { min: e.boilMin, scale: elev * 1.1 };
    case "mash": return { min: e.boilMin, scale: elev * 0.2 };
    case "whirlpool": return { min: h.min, scale: tempFactor(Math.min(h.tempF || 180, bp)) };
    default: return { min: 0, scale: 0 };
  }
}

/** IBUs from each hop addition, by the chosen formula */
export function hopIbus(hops: RHop[], e: Equipment, boilGravity: number, method: IbuMethod, w?: Weather): Record<string, number> {
  const v = volumes(e, w).postBoilCold;
  const out: Record<string, number> = {};
  const util = (e.hopUtilPct || 100) / 100;
  const formBonus = (h: RHop) => (h.form === "pellet" || !h.form ? 1.1 : h.form === "extract" ? 1.2 : 1);
  if (method === "garetz") {
    // Garetz depends on the beer's own bitterness (hopping rate): settle it by going round a few times
    let total = 0;
    for (let pass = 0; pass < 6; pass++) {
      const gf = boilGravity > 1.05 ? (boilGravity - 1.05) / 0.2 + 1 : 1;
      const hf = (volumes(e, w).postBoilHot / v) * (total / 260) + 1;
      const tf = ((e.elevationFt || 0) / 550) * 0.02 + 1;
      let sum = 0;
      for (const h of hops) {
        const t = hopTime(h, e);
        const ibu = t.min > 0 ? (garetzUtil(t.min) * t.scale * util * (h.alpha / 100) * h.oz * 7490 * formBonus(h)) / (v * gf * hf * tf) : 0;
        out[h.lid] = ibu; sum += ibu;
      }
      total = sum;
    }
    return out;
  }
  for (const h of hops) {
    const t = hopTime(h, e);
    if (t.min <= 0 || t.scale <= 0) { out[h.lid] = 0; continue; }
    let u: number;
    if (method === "rager") {
      const ga = boilGravity > 1.05 ? (boilGravity - 1.05) / 0.2 : 0;
      u = ragerUtil(t.min) / (1 + ga);
    } else u = tinsethUtil(boilGravity, t.min);
    out[h.lid] = (u * t.scale * util * formBonus(h) * (h.alpha / 100) * h.oz * 7490) / v;
  }
  return out;
}

// ---------- color ----------
/** Morey's formula: SRM from malt color units */
export const moreySrm = (mcu: number) => (mcu > 0 ? 1.4922 * Math.pow(mcu, 0.6859) : 0);
const SRM_RGB = ["#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123", "#F8A600", "#F39C00", "#EA8F00", "#E58500", "#DE7C00", "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100", "#B54C00", "#B04500", "#A63E00", "#A13700", "#9B3200", "#952D00", "#8E2900", "#882300", "#821E00", "#7B1A00", "#771900", "#701400", "#6A0E00", "#660D00", "#5E0B00", "#5A0A02", "#600903", "#520907", "#4C0505", "#470606", "#440607", "#3F0708", "#3B0607", "#3A070B", "#36080A"];
/** the beer's color on screen for an SRM */
export const srmColor = (srm: number) => (srm <= 0 ? "#FFF4C2" : SRM_RGB[clamp(Math.round(srm), 1, 40) - 1]);

// ---------- alcohol ----------
export const abvOf = (og: number, fg: number) => Math.max(0, (og - fg) * 131.25);
/** the "alternate" formula, closer for big beers */
export const abvAlt = (og: number, fg: number) => Math.max(0, ((76.08 * (og - fg)) / (1.775 - og)) * (fg / 0.794));
/** calories in 12 oz */
export function calories(og: number, fg: number) {
  const oe = plato(og), ae = plato(fg);
  const re = 0.1808 * oe + 0.8192 * ae;
  const abw = (oe - re) / (2.0665 - 0.010665 * oe);
  return Math.max(0, (6.9 * abw + 4.0 * (re - 0.1)) * fg * 3.55);
}

// ---------- water ----------
/** ppm each salt adds per gram in a gallon */
export const SALT_PPM: Record<keyof Omit<Salts, "lacticMl" | "phosphoricMl">, Partial<Record<keyof WaterProfile, number>>> = {
  gypsum: { ca: 61.5, so4: 147.4 },
  cacl2: { ca: 72.0, cl: 127.4 },
  epsom: { mg: 26.1, so4: 102.9 },
  nacl: { na: 103.9, cl: 160.3 },
  bakingSoda: { na: 72.3, hco3: 191.9 },
  chalk: { ca: 105.8, hco3: 321.8 },
  // sodium metabisulfite (LODO): sodium, and sulfate once it has scavenged the oxygen
  smb: { na: 63.9, so4: 267.0 },
};
export const SALT_LABEL: Record<keyof typeof SALT_PPM, string> = { gypsum: "Gypsum (CaSO4)", cacl2: "Calcium chloride", epsom: "Epsom salt (MgSO4)", nacl: "Table salt (NaCl)", bakingSoda: "Baking soda", chalk: "Chalk (CaCO3)", smb: "Sodium metabisulfite (SMB)" };

/** the water after salts are added to `gal` of it */
export function treatWater(src: WaterProfile, salts: Salts, gal: number): WaterProfile {
  const w = { ...src, name: `${src.name} + salts` };
  if (gal <= 0) return w;
  for (const k of Object.keys(SALT_PPM) as (keyof typeof SALT_PPM)[]) {
    const g = salts[k] || 0;
    for (const [ion, ppm] of Object.entries(SALT_PPM[k])) (w as Record<string, number | string>)[ion] = (w[ion as keyof WaterProfile] as number) + (g * (ppm as number)) / gal;
  }
  return w;
}
/** grams of sodium metabisulfite for a LODO dose (mg per liter) in `gal` of water */
export const smbGrams = (mgL: number, gal: number) => (mgL * gal * 3.785) / 1000;
/** residual alkalinity, ppm as CaCO3 (Kolbach) */
export const residualAlk = (w: WaterProfile) => w.hco3 * (50 / 61) - w.ca * 0.713 - w.mg * 0.588;
/** chloride to sulfate: below 0.77 hoppy and dry, over 1.3 malty and full */
export const clSo4 = (w: WaterProfile) => (w.so4 > 0 ? w.cl / w.so4 : 0);

const BUFFER = 40; // mEq per kg of grain per pH unit
const LACTIC_MEQ_ML = 11.8; // 88% lactic acid
const PHOSPHORIC_MEQ_ML = 1.1; // 10% phosphoric acid

/** the mash pH: each malt's own pH in distilled water, moved by the water's alkalinity and any acid */
export function mashPh(ferms: RFerm[], mashWater: WaterProfile, mashGal: number, salts: Salts): number {
  const mashed = ferms.filter((f) => isMashed(f) && !f.late && f.lb > 0);
  const lb = mashed.reduce((a, f) => a + f.lb, 0);
  if (!lb) return 0;
  const di = mashed.reduce((a, f) => a + diPh(f) * f.lb, 0) / lb;
  const kg = lb * 0.4536, liters = mashGal * 3.785;
  const alkMeq = (residualAlk(mashWater) / 50) * liters;
  const acidMalt = mashed.reduce((a, f) => a + (f.acidPct ? ((f.lb * 453.6 * f.acidPct) / 100 / 90.08) * 1000 : 0), 0);
  const acidMeq = (salts.lacticMl || 0) * LACTIC_MEQ_ML + (salts.phosphoricMl || 0) * PHOSPHORIC_MEQ_ML + acidMalt;
  return di + (alkMeq - acidMeq) / (BUFFER * kg);
}
/** ml of 88% lactic acid to bring the mash from one pH to another */
export const lacticFor = (fromPh: number, toPh: number, grainLb: number) => Math.max(0, ((fromPh - toPh) * BUFFER * grainLb * 0.4536) / LACTIC_MEQ_ML);

// ---------- mash ----------
/** strike water temperature for a first rest (Palmer: Tw = (0.2/r)(T1 − Tg) + T1) */
export const strikeTemp = (ratioQtLb: number, grainF: number, targetF: number) => (0.2 / Math.max(0.5, ratioQtLb)) * (targetF - grainF) + targetF;
/** quarts of near-boiling water to raise the mash from one rest to the next */
export const infusionQt = (fromF: number, toF: number, grainLb: number, waterQt: number, hotF = 210) => ((toF - fromF) * (0.2 * grainLb + waterQt)) / Math.max(1, hotF - toF);

export function mashWater(r: Recipe, preBoilGal: number) {
  const e = r.equipment;
  const lb = r.ferms.filter((f) => isMashed(f) && !f.late).reduce((a, f) => a + f.lb, 0);
  // recirculating mashes lose a little to evaporation over the whole mash
  const mashMin = r.mash.steps.reduce((a, s) => a + (s.min || 0), 0);
  const total = preBoilGal + lb * e.absorbGalPerLb + e.tunDeadGal + ((e.mashEvapGalPerHr || 0) * mashMin) / 60;
  const steps = r.mash.steps;
  const first = steps[0];
  let mashQt = (r.mash.ratio || 1.5) * lb;
  if (r.type === "biab" || r.mash.sparge === "none") mashQt = total * 4;
  const strike = first ? strikeTemp(mashQt / Math.max(lb, 0.01), r.mash.grainTempF, first.tempF) : 0;
  let water = mashQt;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "infusion") water += s.addQt ?? infusionQt(steps[i - 1].tempF, s.tempF, lb, water);
  }
  const mashGal = water / 4;
  return { grainLb: lb, totalGal: total, mashGal, strikeGal: mashQt / 4, spargeGal: Math.max(0, total - mashGal), strikeF: strike };
}

// ---------- yeast ----------
/** billions of cells a batch wants: 0.75 million per ml per °Plato for ales, 1.5 for lagers (doubled over 1.060 is in the rate) */
export function cellsNeeded(og: number, gal: number, lager: boolean) {
  const rate = (lager ? 1.5 : 0.75) * (og > 1.06 && !lager ? 1.33 : 1);
  return (rate * gal * 3785.4 * plato(og)) / 1000;
}
/** how much of a liquid pack is still alive (about 0.7% a day from packing) */
export const viability = (packDate?: string) => {
  if (!packDate) return 0.9;
  const days = (Date.now() - new Date(packDate).getTime()) / 86400000;
  return clamp(0.97 - 0.007 * Math.max(0, days), 0.1, 0.97);
};
/** a starter's new cells (Braukaiser's growth model on a stir plate; about 60% of that without one) */
export function starterGrowth(startB: number, liters: number, stir: boolean) {
  const extractG = liters * 100; // 1.036 starter wort is about 100 g of extract a liter
  const inoc = startB / Math.max(extractG, 1);
  const perG = inoc < 1.4 ? 1.4 : Math.max(0, 2.33 - 0.67 * inoc);
  const grown = perG * extractG * (stir ? 1 : 0.6);
  return { endB: startB + grown, grownB: grown, inoc };
}

// ---------- carbonation ----------
/** CO2 left in the beer after fermenting at its warmest temperature, volumes */
export const residualCo2 = (tempF: number) => 3.0378 - 0.050062 * tempF + 0.00026555 * tempF * tempF;
/** ounces of priming sugar for a batch */
export function primingOz(gal: number, vols: number, tempF: number, kind: "corn_sugar" | "table_sugar" | "dme" | "honey" = "corn_sugar") {
  const grams = 15.195 * gal * Math.max(0, vols - residualCo2(tempF));
  const f = { corn_sugar: 1, table_sugar: 0.91, dme: 1.47, honey: 1.25 }[kind];
  return (grams * f) / 28.35;
}
/** keg regulator PSI for a CO2 level at a serving temperature */
export const kegPsi = (vols: number, tempF: number) => Math.max(0, -16.6999 - 0.0101059 * tempF + 0.00116512 * tempF * tempF + 0.173354 * tempF * vols + 4.24267 * vols - 0.0684226 * vols * vols);

/**
 * Spunding: the gravity to cap the fermenter at (a few points above FG, so the yeast's last sugar makes the CO2) and the
 * valve's PSI to hold the CO2 target at the fermenting temperature. Each gravity point left makes about 0.5 g/L of CO2,
 * about 0.25 volumes: 3 points covers a beer that starts near 1 volume going to 2.4–2.6.
 */
export function spundPlan(fg: number, vols: number, fermF: number, pts?: number) {
  const residual = residualCo2(fermF);
  const needPts = pts ?? Math.max(2, Math.ceil((vols - residual) / 0.25));
  return { capSg: fg + needPts / 1000, psi: kegPsi(vols, fermF), pts: needPts, residual };
}

/**
 * Fermentation CO2 for purging kegs (Nick, Nov 24 2026: "I harvest CO2 for transfers"). Fermentation makes about as much
 * CO2 by weight as alcohol (0.96 g per g of ethanol); a liter of CO2 weighs about 1.84 g at room temperature. Only what
 * comes off before the spunding valve goes on can be harvested, and the first ~10% pushes the headspace air out, so it's
 * left out. A 5 gal (19 L) corny filled with sanitizer and pushed empty takes about 19 L to fill with pure CO2.
 */
export function co2Harvest(og: number, fg: number, gal: number, capSg?: number) {
  const liters = gal * 3.785;
  const ethanolG = (sg1: number, sg2: number) => (abvOf(sg1, sg2) / 100) * liters * 1000 * 0.789;
  const total = (ethanolG(og, fg) * 0.96) / 1.84;
  const before = capSg && capSg > fg ? (ethanolG(og, capSg) * 0.96) / 1.84 : total;
  const usable = before * 0.9;
  return { totalL: total, usableL: usable, kegs: Math.floor(usable / 19) };
}

// ---------- tools ----------
/** a hydrometer reading taken warm, corrected to its calibration temperature */
export function hydroCorrect(sg: number, tempF: number, calF = 60) {
  const f = (t: number) => 1.00130346 - 0.000134722124 * t + 0.00000204052596 * t * t - 0.00000000232820948 * t * t * t;
  return sg * (f(tempF) / f(calF));
}
/** refractometer before fermenting: Brix to SG (wort correction factor 1.04) */
export const refracOg = (brixReading: number, wcf = 1.04) => sgFromPlato(brixReading / wcf);
/** refractometer after fermenting (Sean Terrill's cubic), from the starting and current Brix */
export function refracFg(bi: number, bf: number, wcf = 1.04) {
  const i = bi / wcf, f = bf / wcf;
  return 1 - 0.0044993 * i + 0.011774 * f + 0.00027581 * i * i - 0.0012717 * f * f - 0.0000072800 * i * i * i + 0.000063293 * f * f * f;
}
/** water to add (gal) to bring a wort down to a gravity, or the gravity after boiling down */
export const dilute = (gal: number, sg: number, targetSg: number) => (gal * (sg - 1)) / Math.max(targetSg - 1, 0.0001) - gal;
export const afterBoil = (gal: number, sg: number, newGal: number) => 1 + (gal * (sg - 1)) / Math.max(newGal, 0.01);
/** the mash efficiency reached on brew day, from the pre-boil gravity and volume (extracts and late sugars left out) */
export function mashEffReached(r: Recipe, preBoilSg: number, preBoilGal: number) {
  let pts = 0, extractPts = 0;
  for (const f of r.ferms) { if (f.late) continue; const p = (f.potential - 1) * 1000 * f.lb; if (isMashed(f)) pts += p; else extractPts += p; }
  if (!pts) return 0;
  return clamp((((preBoilSg - 1) * 1000 * preBoilGal - extractPts) / pts) * 100, 0, 120);
}
/** the boil-off rate reached on brew day, gal per hour */
export const boilOffReached = (preBoilGal: number, postBoilGal: number, minutes: number) => Math.max(0, ((preBoilGal - postBoilGal) * 60) / Math.max(minutes, 1));
/** brewhouse efficiency on brew day, for the record */
export function brewhouseReached(r: Recipe, og: number, galIntoFerm: number) {
  let pts = 0, extractPts = 0;
  for (const f of r.ferms) { const p = (f.potential - 1) * 1000 * f.lb; if (isMashed(f)) pts += p; else extractPts += p; }
  if (!pts) return 0;
  return clamp((((og - 1) * 1000 * galIntoFerm - extractPts) / pts) * 100, 0, 120);
}

// ---------- the whole recipe ----------
export function calcRecipe(r: Recipe): Calc {
  const e = r.equipment;
  const v = volumes(e, r.weather);
  const eff = (e.mashEff || 75) / 100;
  const notes: string[] = [];
  // Sugar is followed through the brewery: the mash puts grain sugar in the kettle at the mash efficiency; extracts and
  // sugars add all of theirs; the boil only takes water away; losses (trub, dead space) take wort at the same gravity.
  let kettlePts = 0, latePts = 0, simplePts = 0, unfermPts = 0, maxGrainPts = 0, mcu = 0;
  const totalLb = r.ferms.reduce((a, f) => a + (f.lb || 0), 0);
  const fermPct: Record<string, number> = {};
  for (const f of r.ferms) {
    const ppg = (f.potential - 1) * 1000 * (f.lb || 0);
    const pts = isMashed(f) ? ppg * eff : ppg;
    if (isMashed(f)) maxGrainPts += ppg;
    if (f.late) latePts += pts; else kettlePts += pts;
    if (/lactose|maltodextrin/i.test(f.name)) unfermPts += pts;
    // sugars, honey and juice ferment out all the way
    else if (["sugar", "honey", "juice", "fruit"].includes(f.type)) simplePts += pts;
    mcu += (f.color * (f.lb || 0)) / Math.max(e.batchGal, 0.1);
    fermPct[f.lid] = totalLb ? (f.lb / totalLb) * 100 : 0;
    if (f.maxPct && fermPct[f.lid] > f.maxPct + 0.5) notes.push(`${f.name} is ${r1(fermPct[f.lid])}% of the grain bill; most recipes keep it under ${f.maxPct}%.`);
  }
  const allPts = kettlePts + latePts;
  const og = 1 + allPts / Math.max(v.postBoilCold, 0.1) / 1000;
  const preBoilGravity = 1 + kettlePts / Math.max(v.preBoil, 0.1) / 1000;
  const postBoilGravity = 1 + kettlePts / Math.max(v.postBoilCold, 0.1) / 1000;
  // how much of the possible sugar ended up in the fermenter: grain potential plus extracts and sugars
  const brewhouseEff = maxGrainPts ? (((og - 1) * 1000 * e.batchGal - (allPts - maxGrainPts * eff)) / maxGrainPts) * 100 : 0;
  const boilGravity = (preBoilGravity + postBoilGravity) / 2;

  const ibus = hopIbus(r.hops, e, boilGravity, r.ibuMethod, r.weather);
  const ibu = Object.values(ibus).reduce((a, b) => a + b, 0);

  const att = Math.max(0, ...r.yeasts.map((y) => y.attenuation || 0)) / 100 || 0.75;
  const ogPts = (og - 1) * 1000;
  const share = (p: number) => (allPts ? p / allPts : 0);
  const simpleShare = share(simplePts), unfermShare = share(unfermPts);
  // simple sugars ferment completely; the rest by the yeast's attenuation; a hotter mash leaves a little more sweetness
  // the sugar rest that sets the body: the longest rest between 140 and 162°F (mash out doesn't count)
  const rests = r.mash.steps.filter((s) => s.tempF >= 140 && s.tempF <= 162).sort((a, b) => b.min - a.min);
  const mashF = rests[0]?.tempF ?? 152;
  const mashAdj = r.type === "extract" ? 0 : clamp((mashF - 152) * 0.006, -0.05, 0.08);
  const effAtt = clamp(att - mashAdj, 0.3, 1);
  // malt sugar by the yeast's attenuation, simple sugars all the way, lactose not at all
  const fg = r.yeasts.length ? 1 + (ogPts * (1 - simpleShare - unfermShare) * (1 - effAtt) + ogPts * unfermShare) / 1000 : og;

  const srm = moreySrm(mcu);
  const mw = mashWater(r, v.preBoil);
  const waterGal = r.water.spargeSalts === false ? mw.mashGal : mw.mashGal + mw.spargeGal;
  const saltsUsed = r.water.lodo?.on ? { ...r.water.salts, smb: smbGrams(r.water.lodo.smbMgL, waterGal) } : { ...r.water.salts, smb: r.water.salts.smb || 0 };
  const treated = treatWater(r.water.source, saltsUsed, waterGal);
  const ph = mashPh(r.ferms, treated, mw.mashGal, r.water.salts);

  if (e.kettleGal && v.preBoil > e.kettleGal) notes.push(`The pre-boil volume (${r1(v.preBoil, 2)} gal) is more than the kettle holds (${e.kettleGal} gal).`);
  const maxPsi = e.fermenterMaxPsi;
  const spundPsi = r.carb.method === "spund" ? kegPsi(r.carb.vols, Math.max(...r.ferment.map((s) => s.tempF), 60)) : 0;
  const stepPsi = Math.max(0, ...r.ferment.map((s) => s.psi || 0));
  if (maxPsi && Math.max(spundPsi, stepPsi) > maxPsi * 0.85) notes.push(`${r1(Math.max(spundPsi, stepPsi), 0)} PSI is close to or over the ${e.fermenterName || "fermenter"}'s ${maxPsi} PSI rating; carbonate the rest in the keg.`);
  if (e.fermenterGal && e.batchGal > e.fermenterGal * 0.85) notes.push(`The batch leaves little headspace in a ${e.fermenterGal} gal fermenter.`);
  if (ph && (ph < 5.2 || ph > 5.6) && r.type !== "extract") notes.push(`Mash pH ${r1(ph, 2)} is outside 5.2–5.6; adjust salts or acid on the Water tab.`);
  if (r.type === "biab" || r.mash.sparge === "none") { /* full-volume mash: no sparge */ }

  return {
    og, fg, abv: abvOf(og, fg), ibu, srm, buGu: ogPts ? ibu / ogPts : 0, calories: calories(og, fg),
    preBoilGal: v.preBoil, preBoilGravity, postBoilGal: v.postBoilHot,
    totalGrainLb: mw.grainLb, mashWaterGal: mw.mashGal, spargeWaterGal: mw.spargeGal, strikeTempF: mw.strikeF,
    mashPh: ph, water: treated, color: srmColor(srm), hopIbus: ibus, fermPct, attenuation: effAtt * 100,
    brewhouseEff: clamp(brewhouseEff, 0, 100), boilOffGal: v.boilOff, intoFermGal: v.intoFerm, packagedGal: v.bottled, postBoilColdGal: v.postBoilCold, notes,
  };
}

/** the numbers kept in dp_recipes.calc (for the recipe list and the club page, without loading the whole recipe) */
export const calcSummary = (c: Calc) => ({ og: r1(c.og, 3), fg: r1(c.fg, 3), abv: r1(c.abv, 1), ibu: r1(c.ibu, 0), srm: r1(c.srm, 1), buGu: r1(c.buGu, 2), color: c.color });

// ---------- designing by percentages ----------
/**
 * The pounds for a grain bill given as percentages by weight and a target OG: the sugar the batch needs (target points
 * × the end-of-boil volume) split by each fermentable's share, mashed grain at the mash efficiency, the rest whole.
 * Percentages that don't add to 100 are taken as parts of the whole.
 */
export function fromPercents(r: Recipe): Recipe {
  if (!r.byPercent?.on) return r;
  const v = volumes(r.equipment, r.weather);
  const need = (r.byPercent.targetOg - 1) * 1000 * v.postBoilCold;
  const eff = (r.equipment.mashEff || 75) / 100;
  const total = r.ferms.reduce((a, f) => a + (f.pct || 0), 0);
  if (!total || need <= 0) return r;
  const perLbOfBill = r.ferms.reduce((a, f) => a + ((f.pct || 0) / total) * (f.potential - 1) * 1000 * (isMashed(f) ? eff : 1), 0);
  const billLb = perLbOfBill > 0 ? need / perLbOfBill : 0;
  return { ...r, ferms: r.ferms.map((f) => ({ ...f, lb: Math.round(((f.pct || 0) / total) * billLb * 100) / 100 })) };
}
/** the percentages of a bill given in pounds (to switch a recipe to designing by percentages) */
export function toPercents(r: Recipe): Recipe {
  const lb = r.ferms.reduce((a, f) => a + f.lb, 0);
  return { ...r, ferms: r.ferms.map((f) => ({ ...f, pct: lb ? Math.round((f.lb / lb) * 1000) / 10 : 0 })) };
}

// ---------- scaling ----------
/**
 * The recipe on other equipment or at another size: grain is scaled by volume and by the difference in efficiency,
 * extracts and sugars by volume, hops so the beer keeps the same bitterness, misc by volume.
 */
export function scaleRecipe(r: Recipe, to: Equipment): Recipe {
  const from = r.equipment;
  const vol = to.batchGal / Math.max(from.batchGal, 0.01);
  const effR = (from.mashEff || 75) / (to.mashEff || 75);
  const before = calcRecipe(r);
  const out: Recipe = {
    ...r, equipment: { ...to },
    ferms: r.ferms.map((f) => ({ ...f, lb: f.lb * vol * (isMashed(f) ? effR : 1) })),
    hops: r.hops.map((h) => ({ ...h, oz: h.oz * vol })),
    miscs: r.miscs.map((m) => ({ ...m, amount: m.amount * vol })),
    yeasts: r.yeasts.map((y) => ({ ...y, packs: Math.max(1, Math.round(y.packs * vol)) })),
    water: { ...r.water, salts: Object.fromEntries(Object.entries(r.water.salts).map(([k, g]) => [k, (g || 0) * vol])) as Salts },
  };
  // bitterness: the new kettle size and boil time change utilization, so match the old IBU
  const after = calcRecipe(out);
  const boilIbu = (c: Calc) => Object.entries(c.hopIbus).reduce((a, [, v]) => a + v, 0);
  if (boilIbu(after) > 0) {
    const k = boilIbu(before) / boilIbu(after);
    out.hops = out.hops.map((h) => (h.use === "dry_hop" ? h : { ...h, oz: h.oz * k }));
  }
  return out;
}

/** a style's range check: where a number sits (below, in, above) */
export function inRange(v: number, lo?: number, hi?: number): "low" | "ok" | "high" | "none" {
  if (lo == null || hi == null) return "none";
  return v < lo ? "low" : v > hi ? "high" : "ok";
}

// ---------- water plan (Nick, Nov 23 2026: water is part of the recipe; the club always starts from 100% RO) ----------
export const RO_WATER: WaterProfile = { name: "RO Water", ca: 0, mg: 0, na: 0, so4: 0, cl: 0, hco3: 0 };
const SOLVE_SALTS = ["gypsum", "cacl2", "epsom", "nacl", "bakingSoda"] as const;
/**
 * The salts (grams for `gal` of water) that bring a source water closest to a target profile. Non-negative least
 * squares by coordinate descent over gypsum, calcium chloride, Epsom, table salt and baking soda; each ion is weighed
 * by how big it is in the target so calcium and sulfate don't drown out sodium. Baking soda only when the target asks
 * for alkalinity.
 */
export function saltsFor(target: WaterProfile, gal: number, src: WaterProfile = RO_WATER): Salts {
  const ions = ["ca", "mg", "na", "so4", "cl", "hco3"] as const;
  const want = ions.map((i) => Math.max(0, target[i] - src[i]));
  const w = ions.map((i, k) => 1 / Math.max(20, want[k]));
  const use = SOLVE_SALTS.filter((s) => s !== "bakingSoda" || target.hco3 - src.hco3 > 60);
  const col = (s: (typeof SOLVE_SALTS)[number]) => ions.map((i) => (SALT_PPM[s][i] || 0) / Math.max(gal, 0.01));
  const cols = use.map(col);
  const x = use.map(() => 0);
  for (let it = 0; it < 400; it++) {
    for (let j = 0; j < use.length; j++) {
      // the best amount of salt j with the others held, kept at or above zero
      let num = 0, den = 0;
      for (let k = 0; k < ions.length; k++) {
        const others = cols.reduce((a, c, jj) => (jj === j ? a : a + c[k] * x[jj]), 0);
        num += w[k] * w[k] * cols[j][k] * (want[k] - others);
        den += w[k] * w[k] * cols[j][k] * cols[j][k];
      }
      x[j] = den ? Math.max(0, num / den) : 0;
    }
  }
  const out: Salts = { gypsum: 0, cacl2: 0, epsom: 0, nacl: 0, bakingSoda: 0, chalk: 0, lacticMl: 0 };
  use.forEach((s, j) => { out[s] = Math.round(x[j] * 10) / 10; });
  return out;
}

/** how the recipe's salts and acid split between the mash water and the sparge water */
export function waterSplit(r: Recipe, c: Calc) {
  const total = c.mashWaterGal + c.spargeWaterGal;
  const share = r.water.spargeSalts === false || !total ? 1 : c.mashWaterGal / total;
  const salts = r.water.salts;
  const part = (k: number) => Object.fromEntries(Object.entries(salts).filter(([key]) => !/Ml$/.test(key)).map(([key, g]) => [key, (g || 0) * k])) as Record<string, number>;
  return { mash: part(share), sparge: part(1 - share), mashGal: c.mashWaterGal, spargeGal: c.spargeWaterGal, lacticMl: salts.lacticMl || 0, phosphoricMl: salts.phosphoricMl || 0 };
}
