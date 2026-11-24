/**
 * Recipes in and out: BeerXML 1.0 (what BeerSmith, Brewfather and most apps export; metric units) and BeerSmith's own
 * .bsmx files (its XML with F_ tags, US units: ounces and fluid ounces). Read with a forgiving tag reader rather than
 * an XML parser, because .bsmx files carry HTML entities a strict parser rejects.
 */
import { lid, newRecipe } from "./defaults";
import type { FermType, HopUse, MashStep, Recipe, RFerm, RHop, RMisc, RYeast } from "./types";
import { STYLES } from "./styles";
import { readBsmx } from "./beersmith";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", deg: "°", nbsp: " " };
const unent = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)).trim();
/** every <tag>…</tag> block directly found (not nested in a same-named tag) */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[2]);
  return out;
}
const val = (xml: string, tag: string) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml); return m ? unent(m[1]) : ""; };
const num = (xml: string, tag: string, d = 0) => { const n = parseFloat(val(xml, tag)); return Number.isFinite(n) ? n : d; };

const KG_LB = 2.20462, KG_OZ = 35.274, L_GAL = 0.264172, C_F = (c: number) => c * 1.8 + 32, F_C = (f: number) => (f - 32) / 1.8;
const styleFor = (name: string, cat?: string, letter?: string) => {
  const id = cat && letter ? `${parseInt(cat)}${letter.toUpperCase()}` : "";
  return STYLES.find((s) => s.id === id)?.id || STYLES.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;
};
const fermType = (t: string): FermType => {
  const x = t.toLowerCase();
  return x.includes("dry") ? "dry_extract" : x.includes("extract") ? "extract" : x.includes("sugar") ? "sugar" : x.includes("adjunct") ? "adjunct" : x.includes("honey") ? "honey" : x.includes("fruit") ? "fruit" : x.includes("juice") ? "juice" : "grain";
};

// ---------------- BeerXML ----------------
export function fromBeerXml(xml: string): Recipe[] {
  return blocks(xml, "RECIPE").map((x) => {
    const r = newRecipe();
    r.name = val(x, "NAME") || "Imported Recipe";
    r.brewer = val(x, "BREWER") || undefined;
    const t = val(x, "TYPE").toLowerCase();
    r.type = t.includes("extract") && !t.includes("partial") ? "extract" : t.includes("partial") ? "partial_mash" : "all_grain";
    const st = blocks(x, "STYLE")[0];
    if (st) r.styleId = styleFor(val(st, "NAME"), val(st, "CATEGORY_NUMBER"), val(st, "STYLE_LETTER"));
    const eq = blocks(x, "EQUIPMENT")[0];
    r.equipment = { ...r.equipment, name: eq ? val(eq, "NAME") || "Imported Equipment" : r.equipment.name,
      batchGal: num(x, "BATCH_SIZE") * L_GAL || r.equipment.batchGal, boilMin: num(x, "BOIL_TIME", r.equipment.boilMin),
      // BeerXML's efficiency is brewhouse; it's the closest starting point for mash efficiency until a brew log corrects it
      mashEff: num(x, "EFFICIENCY", r.equipment.mashEff) };
    if (eq) {
      const boilL = num(eq, "BOIL_SIZE"), evap = num(eq, "EVAP_RATE");
      if (num(eq, "TRUB_CHILLER_LOSS")) r.equipment.trubGal = num(eq, "TRUB_CHILLER_LOSS") * L_GAL;
      if (num(eq, "LAUTER_DEADSPACE")) r.equipment.tunDeadGal = num(eq, "LAUTER_DEADSPACE") * L_GAL;
      if (evap && boilL) r.equipment.boilOffGal = (boilL * L_GAL * evap) / 100;
      if (num(eq, "HOP_UTILIZATION")) r.equipment.hopUtilPct = num(eq, "HOP_UTILIZATION");
    }
    r.ferms = blocks(x, "FERMENTABLE").map((f): RFerm => ({ lid: lid(), name: val(f, "NAME"), type: fermType(val(f, "TYPE")), lb: num(f, "AMOUNT") * KG_LB,
      potential: 1 + (num(f, "YIELD", 75) / 100) * 0.04621, color: num(f, "COLOR", 2), late: /true/i.test(val(f, "ADD_AFTER_BOIL")), maxPct: num(f, "MAX_IN_BATCH") || undefined, origin: val(f, "ORIGIN") || undefined }));
    r.hops = blocks(x, "HOP").map((h): RHop => {
      const u = val(h, "USE").toLowerCase();
      const use: HopUse = u.includes("dry") ? "dry_hop" : u.includes("first") ? "first_wort" : u.includes("mash") ? "mash" : u.includes("aroma") || u.includes("whirl") ? "whirlpool" : "boil";
      const min = num(h, "TIME");
      return { lid: lid(), name: val(h, "NAME"), alpha: num(h, "ALPHA", 5), oz: num(h, "AMOUNT") * KG_OZ, use, form: (val(h, "FORM").toLowerCase() || "pellet") as RHop["form"],
        min: use === "dry_hop" ? 0 : use === "whirlpool" && min === 0 ? 0 : min, days: use === "dry_hop" ? Math.round(min / 1440) || 4 : undefined, tempF: use === "whirlpool" ? 180 : undefined };
    });
    r.yeasts = blocks(x, "YEAST").map((y): RYeast => ({ lid: lid(), name: val(y, "NAME"), lab: val(y, "LABORATORY") || undefined, code: val(y, "PRODUCT_ID") || undefined,
      form: (/dry/i.test(val(y, "FORM")) ? "dry" : "liquid"), kind: /lager/i.test(val(y, "TYPE")) ? "lager" : "ale", attenuation: num(y, "ATTENUATION", 75),
      tempLow: num(y, "MIN_TEMPERATURE") ? Math.round(C_F(num(y, "MIN_TEMPERATURE"))) : undefined, tempHigh: num(y, "MAX_TEMPERATURE") ? Math.round(C_F(num(y, "MAX_TEMPERATURE"))) : undefined, packs: 1 }));
    r.miscs = blocks(x, "MISC").map((m): RMisc => {
      const weight = /true/i.test(val(m, "AMOUNT_IS_WEIGHT"));
      const use = val(m, "USE").toLowerCase();
      return { lid: lid(), name: val(m, "NAME"), type: "other", use: (["mash", "primary", "secondary", "bottling"].find((u) => use.includes(u)) || "boil") as RMisc["use"],
        amount: weight ? num(m, "AMOUNT") * KG_OZ : num(m, "AMOUNT") * 33.814, unit: weight ? "oz" : "fl oz", min: num(m, "TIME") || undefined };
    });
    const mash = blocks(x, "MASH")[0];
    if (mash) {
      const steps = blocks(mash, "MASH_STEP").map((s): MashStep => ({ name: val(s, "NAME") || "Rest", kind: (/decoc/i.test(val(s, "TYPE")) ? "decoction" : /temp/i.test(val(s, "TYPE")) ? "temperature" : "infusion"), tempF: Math.round(C_F(num(s, "STEP_TEMP", 67))), min: num(s, "STEP_TIME", 60) }));
      if (steps.length) r.mash = { ...r.mash, name: val(mash, "NAME") || "Imported Mash", grainTempF: Math.round(C_F(num(mash, "GRAIN_TEMP", 20))), steps };
    }
    r.notes = val(x, "NOTES") || undefined;
    r.tasteNotes = val(x, "TASTE_NOTES") || undefined;
    if (num(x, "PRIMARY_AGE")) r.ferment = [{ name: "Primary", days: num(x, "PRIMARY_AGE"), tempF: Math.round(C_F(num(x, "PRIMARY_TEMP", 19))) }];
    if (num(x, "CARBONATION")) r.carb = { ...r.carb, vols: num(x, "CARBONATION") };
    return r;
  });
}

const tag = (t: string, v: string | number | undefined | null) => (v == null || v === "" ? "" : `<${t}>${String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${t}>`);
export function toBeerXml(recipes: Recipe[]): string {
  const body = recipes.map((r) => {
    const e = r.equipment;
    const st = STYLES.find((s) => s.id === r.styleId);
    const L = (gal: number) => (gal / L_GAL).toFixed(3);
    return `<RECIPE>${tag("NAME", r.name)}${tag("VERSION", 1)}${tag("TYPE", r.type === "extract" ? "Extract" : r.type === "partial_mash" ? "Partial Mash" : "All Grain")}${tag("BREWER", r.brewer || "DraftPunk")}
${tag("BATCH_SIZE", L(e.batchGal))}${tag("BOIL_SIZE", L(e.batchGal + e.trubGal + (e.boilOffGal * e.boilMin) / 60))}${tag("BOIL_TIME", e.boilMin)}${tag("EFFICIENCY", e.mashEff)}
${st ? `<STYLE>${tag("NAME", st.name)}${tag("VERSION", 1)}${tag("CATEGORY", st.cat)}${tag("CATEGORY_NUMBER", st.id.replace(/\D.*$/, ""))}${tag("STYLE_LETTER", st.id.replace(/^\d+/, "").slice(0, 1))}${tag("STYLE_GUIDE", st.guide)}${tag("TYPE", "Ale")}${tag("OG_MIN", st.og[0])}${tag("OG_MAX", st.og[1])}${tag("FG_MIN", st.fg[0])}${tag("FG_MAX", st.fg[1])}${tag("IBU_MIN", st.ibu[0])}${tag("IBU_MAX", st.ibu[1])}${tag("COLOR_MIN", st.srm[0])}${tag("COLOR_MAX", st.srm[1])}</STYLE>` : ""}
<EQUIPMENT>${tag("NAME", e.name)}${tag("VERSION", 1)}${tag("BATCH_SIZE", L(e.batchGal))}${tag("BOIL_TIME", e.boilMin)}${tag("TRUB_CHILLER_LOSS", L(e.trubGal))}${tag("LAUTER_DEADSPACE", L(e.tunDeadGal))}${tag("HOP_UTILIZATION", e.hopUtilPct)}</EQUIPMENT>
<FERMENTABLES>${r.ferms.map((f) => `<FERMENTABLE>${tag("NAME", f.name)}${tag("VERSION", 1)}${tag("TYPE", { grain: "Grain", adjunct: "Adjunct", extract: "Extract", dry_extract: "Dry Extract", sugar: "Sugar", honey: "Sugar", fruit: "Adjunct", juice: "Adjunct" }[f.type])}${tag("AMOUNT", (f.lb / KG_LB).toFixed(4))}${tag("YIELD", (((f.potential - 1) / 0.04621) * 100).toFixed(1))}${tag("COLOR", f.color)}${tag("ADD_AFTER_BOIL", f.late ? "TRUE" : "FALSE")}</FERMENTABLE>`).join("")}</FERMENTABLES>
<HOPS>${r.hops.map((h) => `<HOP>${tag("NAME", h.name)}${tag("VERSION", 1)}${tag("ALPHA", h.alpha)}${tag("AMOUNT", (h.oz / KG_OZ).toFixed(5))}${tag("USE", { boil: "Boil", first_wort: "First Wort", whirlpool: "Aroma", dry_hop: "Dry Hop", mash: "Mash" }[h.use])}${tag("TIME", h.use === "dry_hop" ? (h.days || 4) * 1440 : h.min)}${tag("FORM", (h.form || "pellet").replace(/^./, (c) => c.toUpperCase()))}</HOP>`).join("")}</HOPS>
<YEASTS>${r.yeasts.map((y) => `<YEAST>${tag("NAME", y.name)}${tag("VERSION", 1)}${tag("TYPE", y.kind === "lager" ? "Lager" : "Ale")}${tag("FORM", y.form === "dry" ? "Dry" : "Liquid")}${tag("AMOUNT", y.form === "dry" ? 0.0115 * y.packs : 0.125 * y.packs)}${tag("AMOUNT_IS_WEIGHT", y.form === "dry" ? "TRUE" : "FALSE")}${tag("LABORATORY", y.lab)}${tag("PRODUCT_ID", y.code)}${tag("ATTENUATION", y.attenuation)}</YEAST>`).join("")}</YEASTS>
<MISCS>${r.miscs.map((m) => `<MISC>${tag("NAME", m.name)}${tag("VERSION", 1)}${tag("TYPE", "Other")}${tag("USE", m.use.replace(/^./, (c) => c.toUpperCase()))}${tag("TIME", m.min || 0)}${tag("AMOUNT", (m.amount / KG_OZ).toFixed(4))}${tag("AMOUNT_IS_WEIGHT", "TRUE")}</MISC>`).join("")}</MISCS>
<WATERS/>
<MASH>${tag("NAME", r.mash.name)}${tag("VERSION", 1)}${tag("GRAIN_TEMP", F_C(r.mash.grainTempF).toFixed(1))}<MASH_STEPS>${r.mash.steps.map((s) => `<MASH_STEP>${tag("NAME", s.name)}${tag("VERSION", 1)}${tag("TYPE", s.kind === "decoction" ? "Decoction" : s.kind === "temperature" ? "Temperature" : "Infusion")}${tag("STEP_TEMP", F_C(s.tempF).toFixed(1))}${tag("STEP_TIME", s.min)}</MASH_STEP>`).join("")}</MASH_STEPS></MASH>
${tag("NOTES", r.notes)}${tag("TASTE_NOTES", r.tasteNotes)}${tag("PRIMARY_AGE", r.ferment[0]?.days)}${tag("PRIMARY_TEMP", r.ferment[0] ? F_C(r.ferment[0].tempF).toFixed(1) : "")}${tag("CARBONATION", r.carb.vols)}</RECIPE>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported by DraftPunk -->\n<RECIPES>\n${body}\n</RECIPES>\n`;
}

// ---------------- BeerSmith ----------------
/** BeerSmith's own .bsmx: read by the one BeerSmith reader (lib/draftpunk/beersmith.ts), which also reads its backups */
export const fromBsmx = (xml: string): Recipe[] => readBsmx(xml).recipes;

/** read either kind of file */
export function parseRecipes(text: string, fileName = ""): Recipe[] {
  if (/\.bsmx$/i.test(fileName) || /<F_R_NAME>/i.test(text)) return fromBsmx(text);
  return fromBeerXml(text);
}
