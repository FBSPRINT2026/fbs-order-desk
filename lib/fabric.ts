/**
 * How much polyester a garment has, from its style, name and color, so the Ink Room can pick the white: our cotton
 * white (Wilflex Amazing Bright Tiger) on cotton, our poly white (Rutland Super Poly) on polyester blends.
 *
 * Why it matters: polyester dye turns to gas at cure temperature and migrates up into the ink (dye migration, "bleeding"),
 * so a white or light print on a poly blend goes pink/grey. Poly (low-bleed) whites block it. The ink makers' guidance:
 * 100% cotton → a cotton white; 50/50 and up (tri-blends, 100% poly athletic) → a low-bleed/poly white. Reds and
 * maroons are the worst bleeders, so they get poly white even at lower polyester. See WHITE_RULE.
 *
 * Fabric content isn't in our garment catalog yet, so it's read from the style (common blanks below) and keywords in
 * the garment name; heathers on cotton tees are usually blends, and the table says which.
 */
export type Fabric = { polyPct: number; why: string };

/** common blanks: [style, poly % of the solid colors, poly % of the heathers, note] */
const STYLES: [RegExp, number, number, string][] = [
  [/^(G?5000|G?5400|G?2000|G?2400|5000B|2000B|G500|G540|G200|G240|H000)$/i, 0, 50, "Gildan Heavy/Ultra Cotton: 100% cotton; heathers 50/50"],
  [/^(G?64000|64000B|G640|6400L|64400)$/i, 0, 65, "Gildan Softstyle: 100% cotton; heathers 65/35 poly/cotton"],
  [/^(G?8000|8000B|G800|G?8800|G?12000|G?12500|G?18000|G?18500|G?18600|18500B|G180|G185|G186)$/i, 50, 50, "Gildan DryBlend / Heavy Blend: 50/50"],
  [/^(3001|3001C|3001Y|3001Y?B|3005|3480|3501|6004|8800)$/i, 0, 48, "Bella+Canvas Airlume: 100% cotton; Heather CVC 52/48"],
  [/^(3413|3415|8413|3711|3719|3739)$/i, 50, 50, "Bella+Canvas tri-blend / sponge fleece: about 50% poly"],
  [/^(3600|3602|3633|3310|6210|6010)$/i, 0, 40, "Next Level: 100% cotton; CVC 60/40"],
  [/^(1717|1566|6014|1467|C1717)$/i, 0, 0, "Comfort Colors: 100% cotton"],
  [/^(PC54|PC55|PC61|PC90H|PC78H|PC850)$/i, 0, 10, "Port & Co core cotton; heathers 90/10"],
  [/^(ST350|ST340|ST640|ST650|ST700|ST450|K540|LST350|YST350|ST360)$/i, 100, 100, "Sport-Tek performance: 100% polyester"],
  [/^(5250|5280|5180|5170|P170|P160)$/i, 0, 50, "Hanes Beefy/ComfortSoft: cotton; heathers blend"],
  [/^(29M|29MR|996M|995M|562M|437M|4997M)$/i, 50, 50, "Jerzees Dri-Power / NuBlend: 50/50"],
  [/^(SS4500|SS3000|IND4000|SS1000)$/i, 30, 30, "Independent: about 70/30 cotton/poly"],
];
const HEATHER = /heather|heathered|marble|tri|melange|sport\s*gr[ae]y|athletic\s*gr[ae]y|graphite|oxford|charcoal\s*h/i;
const KEYWORDS: [RegExp, number, string][] = [
  [/100\s*%\s*poly|polyester|performance|dri[- ]?fit|dry\s*fit|posi[- ]?charge|competitor|moisture|wicking|athletic\s*tee|jersey|mesh/i, 100, "performance / polyester"],
  [/tri[- ]?blend/i, 50, "tri-blend"],
  [/50\s*\/\s*50|dryblend|dry\s*blend|nublend|heavy\s*blend|ecosmart|blend|fleece|hood|sweatshirt|crewneck\s*sweat/i, 50, "cotton/poly blend"],
  [/\bcvc\b|60\s*\/\s*40/i, 40, "CVC 60/40"],
  [/100\s*%\s*cotton|ring[- ]?spun|heavy\s*cotton|ultra\s*cotton|softstyle|garment[- ]dyed|comfort\s*colors|airlume/i, 0, "cotton"],
];

export function fabricOf(g: { style?: string; brand?: string; garment?: string; color?: string }): Fabric {
  const style = (g.style || "").trim().replace(/\s+/g, ""), color = g.color || "", name = `${g.brand || ""} ${g.garment || ""}`;
  const heather = HEATHER.test(color);
  for (const [re, solid, heath, note] of STYLES) if (re.test(style)) return { polyPct: heather ? heath : solid, why: `${note}${heather ? ` (${color} is a heather)` : ""}` };
  for (const [re, pct, why] of KEYWORDS) if (re.test(name)) return { polyPct: heather && pct === 0 ? 50 : pct, why: `${why} (from the name)${heather && pct === 0 ? `; ${color} is a heather, usually a blend` : ""}` };
  if (heather) return { polyPct: 50, why: `${color} is a heather, usually a cotton/poly blend` };
  return { polyPct: 0, why: "assumed cotton (style not known)" };
}

/** red family dyes bleed the most */
const BLEEDERS = /\b(red|maroon|cardinal|burgundy|crimson|cherry|wine|garnet|scarlet|brick)\b/i;
/** poly white when the shirt is half polyester or more, or any polyester in a red/maroon */
export function needsPolyWhite(f: Fabric, color: string, polyPct = 50): { poly: boolean; why: string } {
  if (f.polyPct >= polyPct) return { poly: true, why: `${f.polyPct}% polyester (${f.why})` };
  if (f.polyPct > 0 && BLEEDERS.test(color)) return { poly: true, why: `${f.polyPct}% polyester and ${color} dyes bleed the most` };
  return { poly: false, why: f.polyPct ? `${f.polyPct}% polyester, under ${polyPct}%` : "cotton" };
}
