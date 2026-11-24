/**
 * BeerSmith, read one way whatever it was saved as (Nick, Nov 24 2026: his BeerSmith 3 backup and its Hops / Fermentables /
 * Yeast / MISC exports). BeerSmith keeps the same F_ field names everywhere: in a .bsmx file they are XML tags
 * (<F_H_NAME>…), in BeerSmith 3's backup (a .zip of SQLite files) they are table columns, with each recipe's style,
 * equipment, mash and ingredients stored as JSON text. Both are turned into one `BsNode` (a field getter and its child
 * records), and a single reader makes recipes and library items from it, so a fix to how a field is read fixes every
 * kind of file. Units are BeerSmith's own: ounces, fluid ounces (128 to the gallon), °F.
 */
import { calcRecipe } from "./calc";
import { lid, newRecipe } from "./defaults";
import { STYLES } from "./styles";
import type { Fermentable, FermStep, FermType, Hop, HopUse, MashStep, Misc, Recipe, RecipeType, RFerm, RHop, RMisc, RYeast, Salts, WaterProfile, Yeast } from "./types";

/** one BeerSmith record: its fields, and the records inside it by kind (Grain, Hops, Yeast, Misc, Water, MashStep) */
export type BsNode = { get: (field: string) => string; kids: (kind: BsKind) => BsNode[]; sub: (field: string) => BsNode | null };
export type BsKind = "Grain" | "Hops" | "Yeast" | "Misc" | "Water" | "MashStep" | "Recipe";
/** what each kind's fields start with, so a JSON record is known by its fields (never by BeerSmith's schema number) */
const PREFIX: Record<BsKind, string> = { Grain: "F_G_", Hops: "F_H_", Yeast: "F_Y_", Misc: "F_M_", Water: "F_W_", MashStep: "F_MS_", Recipe: "F_R_" };

// ---------------- reading XML (.bsmx) ----------------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", deg: "°", nbsp: " ", reg: "®", trade: "™", copy: "©" };
const ACCENT: Record<string, string> = { acute: "\u0301", grave: "\u0300", uml: "\u0308", circ: "\u0302", tilde: "\u0303", cedil: "\u0327", ring: "\u030A" };
export const unent = (s: string) => s.replace(/&([a-z])(acute|grave|uml|circ|tilde|cedil|ring);/gi, (_m, c: string, a: string) => (c + ACCENT[a.toLowerCase()]).normalize("NFC")).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)).trim();
function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[2]);
  return out;
}
export function xmlNode(xml: string): BsNode {
  return {
    get: (f) => { const m = new RegExp(`<${f}(?:\\s[^>]*)?>([\\s\\S]*?)</${f}>`, "i").exec(xml); return m ? unent(m[1]) : ""; },
    kids: (k) => xmlBlocks(xml, k).map(xmlNode),
    sub: (f) => { const b = xmlBlocks(xml, f)[0]; return b == null ? null : xmlNode(b); },
  };
}

// ---------------- reading BeerSmith 3's database (JSON text in columns) ----------------
/** every flat {"_Schema_":…} object in BeerSmith's JSON text. Read field by field, because BeerSmith nests a mash's
 *  steps as an unescaped string (not valid JSON), and a bad record must not lose the rest. */
function jsonObjects(text: string): Record<string, string>[] {
  try {
    const v = JSON.parse(text);
    const flat: Record<string, string>[] = [];
    const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { flat.push(Object.fromEntries(Object.entries(x).map(([k, y]) => [k, typeof y === "object" ? JSON.stringify(y) : String(y)]))); } };
    walk(v);
    return flat.filter((o) => "_Schema_" in o);
  } catch {
    // innermost objects only: a mash's text holds its steps inside it
    return [...text.matchAll(/\{"_Schema_"[^{}]*\}/g)].map((m) => jsonFields(m[0]));
  }
}
function jsonFields(text: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of text.matchAll(/"(\w+)":"((?:[^"\\]|\\.)*)"/g)) o[m[1]] = m[2].replace(/\\(["\\/])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  return o;
}
/** a database row (or one object of JSON text) as a BeerSmith record */
export function rowNode(row: Record<string, unknown>): BsNode {
  const str = (f: string) => { const v = row[f]; return v == null ? "" : unent(String(v)); };
  // a recipe's lines are in its Ingredients column; a mash's steps inside its own text
  const src = typeof row.Ingredients === "string" ? row.Ingredients : typeof row._raw === "string" ? row._raw : "";
  const all = () => (src ? jsonObjects(src) : []);
  return {
    get: str,
    kids: (k) => all().filter((o) => Object.keys(o).some((f) => f.startsWith(PREFIX[k]))).map((o) => rowNode(o)),
    sub: (f) => { const v = row[f]; if (typeof v !== "string" || !v.includes("{")) return null; return rowNode({ ...jsonFields(v.replace(/"steps":"\[[\s\S]*\]"/, '"steps":""')), _raw: v }); },
  };
}

// ---------------- fields ----------------
const n = (b: BsNode, f: string, d = 0) => { const x = parseFloat(b.get(f)); return Number.isFinite(x) ? x : d; };
const s = (b: BsNode, f: string) => b.get(f) || undefined;
const FL_OZ_GAL = 128;
/** BeerSmith's lists, by the number it saves */
const FERM_TYPES: FermType[] = ["grain", "extract", "sugar", "adjunct", "dry_extract", "fruit", "juice", "honey"];
const HOP_USES: HopUse[] = ["boil", "dry_hop", "mash", "first_wort", "whirlpool"];
const HOP_FORMS = ["pellet", "plug", "leaf"] as const;
const HOP_TYPES = ["Bittering", "Aroma", "Dual"];
const YEAST_FORMS = ["liquid", "dry", "slant", "culture"] as const;
const YEAST_KINDS = ["ale", "lager", "wheat", "wine", "champagne"] as const;
const FLOCC = ["low", "medium", "high", "very high"] as const;
const MISC_TYPES: Misc["type"][] = ["spice", "fining", "herb", "flavor", "other", "water_agent"];
const MISC_USES = ["boil", "mash", "primary", "secondary", "bottling"] as const;
const MISC_UNITS = ["mg", "g", "oz", "lb", "kg", "ml", "tsp", "tbsp", "cup", "pt", "qt", "l", "gal", "each"];
const RECIPE_TYPES: RecipeType[] = ["extract", "partial_mash", "all_grain", "biab", "mead", "cider", "wine"];

/** a style by BJCP number and letter (BeerSmith saves the letter as 1 = A), else by name */
export function bsStyle(st: BsNode | null) {
  if (!st) return undefined;
  const num = parseInt(st.get("F_S_NUMBER")), let_ = st.get("F_S_LETTER");
  const letter = /^\d+$/.test(let_) ? String.fromCharCode(64 + parseInt(let_)) : let_.toUpperCase();
  const name = st.get("F_S_NAME").toLowerCase();
  const byId = num ? STYLES.find((x) => x.id === `${num}${letter}`) || STYLES.find((x) => x.id.startsWith(`${num}${letter}-`)) : undefined;
  // the guides renumber some styles between years, so a name that disagrees with the number wins
  const byName = STYLES.find((x) => x.name.toLowerCase() === name) || STYLES.find((x) => name && (x.name.toLowerCase().includes(name) || name.includes(x.name.toLowerCase())));
  return (byId && (!byName || byId.name.toLowerCase() === name) ? byId : byName || byId)?.id;
}

// ---------------- library items ----------------
export const bsFermentable = (g: BsNode): Fermentable => {
  const y = n(g, "F_G_YIELD");
  return { name: g.get("F_G_NAME"), type: FERM_TYPES[n(g, "F_G_TYPE")] || "grain", potential: y > 2 ? 1 + (y / 100) * 0.04621 : y || 1.0, color: n(g, "F_G_COLOR"),
    maxPct: n(g, "F_G_MAX_IN_BATCH") || undefined, acidPct: n(g, "F_G_ACID_PCT") || undefined, origin: s(g, "F_G_ORIGIN"), notes: s(g, "F_G_NOTES") };
};
export const bsHop = (h: BsNode): Hop => ({ name: h.get("F_H_NAME"), alpha: n(h, "F_H_ALPHA", 5), beta: n(h, "F_H_BETA") || undefined, form: HOP_FORMS[n(h, "F_H_FORM")] || "pellet",
  origin: s(h, "F_H_ORIGIN"), use: HOP_TYPES[n(h, "F_H_TYPE")], notes: s(h, "F_H_NOTES"), substitutes: s(h, "F_H_SUBSTITUTES") });
export const bsYeast = (y: BsNode): Yeast => ({ name: y.get("F_Y_NAME"), lab: s(y, "F_Y_LAB"), code: s(y, "F_Y_PRODUCT_ID"), form: YEAST_FORMS[n(y, "F_Y_FORM")] || "liquid",
  kind: YEAST_KINDS[n(y, "F_Y_TYPE")], attenuation: (n(y, "F_Y_MIN_ATTENUATION", 73) + n(y, "F_Y_MAX_ATTENUATION", 77)) / 2,
  tempLow: n(y, "F_Y_MIN_TEMP") || undefined, tempHigh: n(y, "F_Y_MAX_TEMP") || undefined, flocculation: FLOCC[n(y, "F_Y_FLOCCULATION", -1)],
  cells: n(y, "F_Y_CELLS") || undefined, notes: [s(y, "F_Y_BEST_FOR"), s(y, "F_Y_NOTES")].filter(Boolean).join("\n\n") || undefined });
export const bsMisc = (m: BsNode): Misc => ({ name: m.get("F_M_NAME"), type: MISC_TYPES[n(m, "F_M_TYPE")] || "other", use: MISC_USES[n(m, "F_M_USE")] || "boil",
  notes: [s(m, "F_M_USE_FOR"), s(m, "F_M_NOTES")].filter(Boolean).join("\n\n") || undefined });
export const bsWater = (w: BsNode): WaterProfile => ({ name: w.get("F_W_NAME"), ca: n(w, "F_W_CALCIUM"), mg: n(w, "F_W_MAGNESIUM"), na: n(w, "F_W_SODIUM"),
  so4: n(w, "F_W_SULFATE"), cl: n(w, "F_W_CHLORIDE"), hco3: n(w, "F_W_BICARB"), ph: n(w, "F_W_PH") || undefined, notes: s(w, "F_W_NOTES") });

/** a water agent's name → the recipe's salt it is (grams) */
const SALT_OF: [RegExp, keyof Salts][] = [[/gypsum|calcium sulfate/i, "gypsum"], [/calcium chloride|cacl/i, "cacl2"], [/epsom|magnesium sulfate|mgso4/i, "epsom"],
  [/baking soda|bicarbonate/i, "bakingSoda"], [/chalk|calcium carbonate/i, "chalk"], [/metabisulfite|\bsmb\b|campden/i, "smb"], [/^salt\b|sodium chloride|nacl|canning salt/i, "nacl"]];
const toGrams = (amt: number, unit: string) => (unit === "g" ? amt : unit === "mg" ? amt / 1000 : unit === "oz" ? amt * 28.3495 : unit === "kg" ? amt * 1000 : unit === "lb" ? amt * 453.592 : NaN);

// ---------------- recipes ----------------
/** a BeerSmith recipe as a DraftPunk recipe */
export function bsRecipe(x: BsNode): Recipe {
  const r = newRecipe();
  r.name = x.get("F_R_NAME").trim() || "Imported Recipe";
  r.brewer = s(x, "F_R_BREWER")?.trim();
  r.type = RECIPE_TYPES[n(x, "F_R_TYPE", 2)] || "all_grain";
  r.styleId = bsStyle(x.sub("F_R_STYLE"));
  const eq = x.sub("F_R_EQUIPMENT");
  // BeerSmith's efficiency is brewhouse efficiency (grain to fermenter); it's only used below to find the mash efficiency
  let brewhouse = 72;
  if (eq) {
    const g = (f: string) => n(eq, f) / FL_OZ_GAL;
    brewhouse = n(eq, "F_E_EFFICIENCY", 72);
    r.equipment = { ...r.equipment, name: eq.get("F_E_NAME") || r.equipment.name, batchGal: g("F_E_BATCH_VOL") || r.equipment.batchGal, boilMin: n(eq, "F_E_BOIL_TIME", r.equipment.boilMin),
      boilOffGal: g("F_E_BOIL_OFF") || r.equipment.boilOffGal, trubGal: g("F_E_TRUB_LOSS"), fermLossGal: g("F_E_FERMENTER_LOSS"), tunDeadGal: g("F_E_TUN_DEADSPACE"),
      shrinkPct: n(eq, "F_E_COOL_PCT", r.equipment.shrinkPct), hopUtilPct: n(eq, "F_E_HOP_UTIL", 100) || 100, elevationFt: n(eq, "F_E_ALTITUDE", r.equipment.elevationFt), notes: s(eq, "F_E_NOTES") };
  }
  const order = (b: BsNode) => n(b, "F_ORDER", 999);
  const inRecipe = (b: BsNode) => b.get("F_G_IN_RECIPE") !== "0" && b.get("F_H_IN_RECIPE") !== "0" && b.get("F_Y_IN_RECIPE") !== "0" && b.get("F_M_IN_RECIPE") !== "0" && b.get("F_W_IN_RECIPE") !== "0";
  const kids = (k: BsKind) => x.kids(k).filter(inRecipe).sort((a, b) => order(a) - order(b));
  r.ferms = kids("Grain").map((g): RFerm => ({ ...bsFermentable(g), notes: undefined, lid: lid(), lb: n(g, "F_G_AMOUNT") / 16, late: n(g, "F_G_ADD_AFTER_BOIL") === 1 }));
  r.hops = kids("Hops").map((h): RHop => {
    const use = HOP_USES[n(h, "F_H_USE")] || "boil";
    return { ...bsHop(h), notes: undefined, substitutes: undefined, lid: lid(), oz: n(h, "F_H_AMOUNT"), use,
      min: use === "dry_hop" ? 0 : n(h, "F_H_BOIL_TIME"), days: use === "dry_hop" ? n(h, "F_H_DRY_HOP_TIME", 4) || 4 : undefined,
      tempF: use === "whirlpool" ? Math.round(n(h, "F_H_WHIRLPOOL_TEMP", 180)) || 180 : undefined };
  });
  r.yeasts = kids("Yeast").map((y): RYeast => ({ ...bsYeast(y), notes: undefined, lid: lid(), packs: n(y, "F_Y_AMOUNT", 1) || 1, starter: n(y, "F_Y_USE_STARTER") === 1 || undefined }));
  // water agents become the recipe's salts (grams); everything else stays a misc line
  const salts = { ...r.water.salts };
  let anySalt = false;
  r.miscs = [];
  for (const m of kids("Misc")) {
    const unit = MISC_UNITS[n(m, "F_M_UNITS", 2)] || "oz", amt = n(m, "F_M_AMOUNT");
    const salt = MISC_TYPES[n(m, "F_M_TYPE")] === "water_agent" ? SALT_OF.find(([re]) => re.test(m.get("F_M_NAME")))?.[1] : undefined;
    const g = toGrams(amt, unit);
    if (salt && Number.isFinite(g)) { salts[salt] = Math.round(((salts[salt] || 0) + g) * 100) / 100; anySalt = true; continue; }
    if (/lactic/i.test(m.get("F_M_NAME")) && unit === "ml") { salts.lacticMl += amt; anySalt = true; continue; }
    r.miscs.push({ ...bsMisc(m), notes: undefined, lid: lid(), amount: amt, unit, min: n(m, "F_M_TIME") || undefined } as RMisc);
  }
  const waters = kids("Water");
  if (waters.length) r.water.source = bsWater(waters[0]);
  r.water.salts = salts;
  if (n(x, "F_R_TGT_CA") || n(x, "F_R_TGT_SO4") || n(x, "F_R_TGT_CL")) r.water.target = { name: x.get("F_R_TARGET_WATER") || "BeerSmith target", ca: n(x, "F_R_TGT_CA"), mg: n(x, "F_R_TGT_MG"), na: n(x, "F_R_TGT_NA"), so4: n(x, "F_R_TGT_SO4"), cl: n(x, "F_R_TGT_CL"), hco3: n(x, "F_R_TGT_HCO3") };
  else if (anySalt) r.water.target = undefined;
  // mash
  const mh = x.sub("F_R_MASH");
  if (mh) {
    const steps = mh.kids("MashStep").map((st): MashStep => ({ name: st.get("F_MS_NAME") || "Step", kind: (["infusion", "temperature", "decoction"] as const)[n(st, "F_MS_TYPE")] || "infusion",
      tempF: Math.round(n(st, "F_MS_STEP_TEMP", 152) * 10) / 10, min: n(st, "F_MS_STEP_TIME", 60) }));
    const grainLb = r.ferms.reduce((t, f) => t + f.lb, 0), firstQt = (n(mh.kids("MashStep")[0] || mh, "F_MS_INFUSION") || 0) / 32;
    r.mash = { name: mh.get("F_MH_NAME") || r.mash.name, grainTempF: n(mh, "F_MH_GRAIN_TEMP", 72), spargeTempF: n(mh, "F_MH_SPARGE_TEMP", 168),
      sparge: n(mh, "F_MH_BIAB") === 1 || /no.?sparge|full volume|biab/i.test(mh.get("F_MH_NAME")) ? "none" : n(mh, "F_MH_BATCH") === 1 ? "batch" : "fly",
      ratio: grainLb && firstQt ? Math.round((firstQt / grainLb) * 100) / 100 : r.mash.ratio, steps: steps.length ? steps : r.mash.steps };
  }
  // fermentation: BeerSmith's age profile (F_A_TYPE 0 = one stage … 3 = four)
  const age = x.sub("F_R_AGE");
  if (age) {
    const stages: [string, string, string][] = [["Primary", "F_A_PRIM_DAYS", "F_A_PRIM_TEMP"], ["Secondary", "F_A_SEC_DAYS", "F_A_SEC_TEMP"], ["Tertiary", "F_A_TERT_DAYS", "F_A_TERT_TEMP"], ["Bulk age", "F_A_BULK_DAYS", "F_A_BULK_TEMP"]];
    const ferm: FermStep[] = stages.slice(0, n(age, "F_A_TYPE") + 1).map(([name, d, t]) => ({ name, days: n(age, d, 7), tempF: n(age, t, 66) }));
    if (ferm.length) r.ferment = ferm;
  }
  r.carb = { ...r.carb, vols: n(x, "F_R_CARB_VOLS", r.carb.vols) || r.carb.vols };
  r.notes = [s(x, "F_R_DESCRIPTION"), s(x, "F_R_NOTES")].filter(Boolean).join("\n\n") || undefined;
  // Measured numbers BeerSmith has as recorded (their _SET flag) are kept in the notes, the brew log's job here.
  const meas = ([["OG", "F_R_OG_MEASURED"], ["FG", "F_R_FG_MEASURED"]] as const).filter(([, f]) => x.get(`${f}_SET`) === "1").map(([k, f]) => `${k} ${n(x, f).toFixed(3)}`);
  if (meas.length) r.notes = [r.notes, `Measured in BeerSmith: ${meas.join(", ")}`].filter(Boolean).join("\n\n");
  // Check against the source: BeerSmith's own OG is the grain's points × its brewhouse efficiency over the batch.
  // The mash efficiency that gives the same OG here goes on the equipment, so the recipe imports as it was designed.
  const pts = r.ferms.reduce((t, f) => t + (f.potential - 1) * 1000 * f.lb * (f.type === "grain" || f.type === "adjunct" ? brewhouse / 100 : 1), 0);
  const targetOg = 1 + pts / (r.equipment.batchGal || 5) / 1000;
  const mashed = r.ferms.some((f) => f.type === "grain" || f.type === "adjunct") && r.type !== "extract";
  r.equipment.mashEff = brewhouse;
  if (pts > 0 && mashed) { const eff = solveMashEff(r, targetOg); if (eff > 31 && eff < 99) r.equipment.mashEff = eff; }
  return r;
}

/** the mash efficiency at which this recipe reaches the OG (bisection: OG rises with efficiency) */
export function solveMashEff(r: Recipe, og: number) {
  let lo = 30, hi = 100;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (calcRecipe({ ...r, equipment: { ...r.equipment, mashEff: mid } }).og < og) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/** the same recipe saved twice (BeerSmith's cloud keeps copies) is one recipe: its name and every ingredient line */
export const recipeKey = (r: Recipe) => JSON.stringify([r.name.toLowerCase(), r.ferms.map((f) => [f.name, f.lb.toFixed(3)]), r.hops.map((h) => [h.name, h.oz.toFixed(3), h.use, h.min]), r.yeasts.map((y) => y.name), r.equipment.batchGal.toFixed(2)]);

// ---------------- whole files ----------------
export type BsLibrary = { fermentable: Fermentable[]; hop: Hop[]; yeast: Yeast[]; misc: Misc[]; water: WaterProfile[] };
export type BsRead = { recipes: (Recipe & { folder?: string; sample?: boolean })[]; library: BsLibrary };
const emptyLib = (): BsLibrary => ({ fermentable: [], hop: [], yeast: [], misc: [], water: [] });

/** a .bsmx file: recipes (<Recipe>), or one of BeerSmith's ingredient lists (<Grain>, <Hops>, <Yeast>, <Misc>, <Water>) */
export function readBsmx(xml: string): BsRead {
  const root = xmlNode(xml);
  const recipes = root.kids("Recipe").map((x) => ({ ...bsRecipe(x), folder: x.get("F_R_FOLDER_NAME") || undefined }));
  const lib = emptyLib();
  if (!recipes.length) {
    lib.fermentable = root.kids("Grain").map(bsFermentable);
    lib.hop = root.kids("Hops").map(bsHop);
    lib.yeast = root.kids("Yeast").map(bsYeast);
    lib.misc = root.kids("Misc").map(bsMisc);
    lib.water = root.kids("Water").map(bsWater);
  }
  return { recipes: recipes.filter(hasLines), library: lib };
}

/**
 * BeerSmith 3's backup: the tables of BeerSmith.sqlite as rows. Recipes are in M_RECIPE (on this computer, BeerSmith's
 * samples among them) and M_CLOUD (the brewer's cloud recipes); the ingredient lists in M_GRAIN / M_HOPS / … and their
 * M_CLOUD_ copies.
 */
export function readBsTables(tables: Record<string, Record<string, unknown>[]>): BsRead {
  const recipes: BsRead["recipes"] = [];
  for (const t of ["M_RECIPE", "M_CLOUD"]) for (const row of tables[t] || []) {
    const folder = String(row.F_R_FOLDER_NAME || "") || undefined;
    recipes.push({ ...bsRecipe(rowNode(row)), folder, sample: /beersmith \d samples/i.test(folder || "") });
  }
  const lib = emptyLib();
  const both = (a: string) => [...(tables[`M_${a}`] || []), ...(tables[`M_CLOUD_${a}`] || [])].map((row) => rowNode(row));
  lib.fermentable = both("GRAIN").map(bsFermentable);
  lib.hop = both("HOPS").map(bsHop);
  lib.yeast = both("YEAST").map(bsYeast);
  lib.misc = both("MISC").map(bsMisc);
  lib.water = both("WATER").map(bsWater);
  return { recipes: dedupe(recipes.filter(hasLines)), library: dedupeLib(lib) };
}

const hasLines = (r: Recipe) => !!(r.ferms.length || r.hops.length || r.yeasts.length);
export function dedupe<T extends Recipe>(rs: T[]): T[] {
  const seen = new Set<string>();
  return rs.filter((r) => { const k = recipeKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
}
/** one entry per name (BeerSmith's local and cloud lists overlap) */
export function dedupeLib(lib: BsLibrary): BsLibrary {
  const one = <T extends { name: string; lab?: string; code?: string }>(xs: T[]) => { const seen = new Set<string>(); return xs.filter((x) => { const k = `${x.lab || ""}|${x.code || ""}|${x.name}`.toLowerCase().trim(); if (!x.name || seen.has(k)) return false; seen.add(k); return true; }); };
  return { fermentable: one(lib.fermentable), hop: one(lib.hop), yeast: one(lib.yeast), misc: one(lib.misc), water: one(lib.water) };
}
