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
  [/^(3001|3001C|3001Y|3001Y?B|3001T|3005|3480|3501|6004|8800|100B|134B|3001B)$/i, 0, 48, "Bella+Canvas Airlume: 100% cotton; Heather CVC 52/48"],
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
  // ("jersey" alone is the knit of most cotton tees: only sports jerseys count)
  [/100\s*%\s*poly|polyester|performance|dri[- ]?fit|dry\s*fit|posi[- ]?charge|competitor|moisture|wicking|athletic\s*tee|(?:athletic|sports?|basketball|football|baseball|hockey|soccer|replica|practice)\s*jersey|mesh/i, 100, "performance / polyester"],
  [/tri[- ]?blend/i, 50, "tri-blend"],
  [/50\s*\/\s*50|dryblend|dry\s*blend|nublend|heavy\s*blend|ecosmart|blend|fleece|hood|sweatshirt|crewneck\s*sweat/i, 50, "cotton/poly blend"],
  [/\bcvc\b|60\s*\/\s*40/i, 40, "CVC 60/40"],
  [/100\s*%\s*cotton|ring[- ]?spun|heavy\s*cotton|ultra\s*cotton|softstyle|garment[- ]dyed|comfort\s*colors|airlume/i, 0, "cotton"],
];

// ---------- the supplier's own words (S&S style description, SanMar product description) ----------
const FIBER = "cotton|polyester|poly|rayon|viscose|spandex|elastane|lycra|nylon|acrylic|modal|linen|tencel|bamboo|hemp|wool";
const FIBER_RE = new RegExp(`\\b(${FIBER})\\b`, "i");

/** the lines of a supplier description that state fiber content ("100% cotton", "Heather colors are 50/50 cotton/polyester") */
export function fabricLines(html: string): string {
  const text = (html || "").replace(/<\/(li|p|div|br)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#174;|®|™/g, "");
  const parts = text.split(/\n|•|;|(?<=\.)\s+(?=[A-Z])/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const keep = parts.filter((x) => FIBER_RE.test(x) && /\d\s*%|\d{2,3}\s*\/\s*\d{1,2}\b|\btri[- ]?blend\b/i.test(x) && !/\bthread|label|tear|tape|drawcord|cord\b/i.test(x));
  return [...new Set(keep)].slice(0, 8).join("\n").slice(0, 2000);
}

/** percent of each fiber in one statement: "60% cotton, 40% polyester", "50/50 cotton/polyester", "100% ring spun cotton" */
function fibersIn(s: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  const slash = s.match(new RegExp(`(\\d{1,3})\\s*\\/\\s*(\\d{1,3})(?:\\s*\\/\\s*(\\d{1,3}))?\\s*%?\\s*(?:[a-z\\- ]{0,30}?)\\b(${FIBER})\\b\\s*\\/\\s*(?:[a-z\\- ]{0,20}?)\\b(${FIBER})\\b(?:\\s*\\/\\s*(?:[a-z\\- ]{0,20}?)\\b(${FIBER})\\b)?`, "i"));
  if (slash) {
    const nums = [slash[1], slash[2], slash[3]].filter(Boolean).map(Number), fib = [slash[4], slash[5], slash[6]].filter(Boolean);
    fib.forEach((f, i) => { const k = /^poly/i.test(f) ? "polyester" : f.toLowerCase(); out[k] = (out[k] || 0) + (nums[i] || 0); });
    return out;
  }
  const re = new RegExp(`(\\d{1,3}(?:\\.\\d)?)\\s*%\\s*(?:[a-z.\\-®™ ]{0,40}?)\\b(${FIBER})\\b`, "gi");
  let m: RegExpExecArray | null, any = false;
  while ((m = re.exec(s))) { const k = /^poly/i.test(m[2]) ? "polyester" : m[2].toLowerCase(); out[k] = (out[k] || 0) + +m[1]; any = true; }
  if (any) return out;
  if (/\btri[- ]?blend\b/i.test(s)) return { polyester: 50, cotton: 25, rayon: 25 };
  return null;
}

/**
 * Is a statement about some colors only ("Sport Grey and Antique colors are 90/10…", "Heather colors: 52/48…"), and
 * how well does it name this color: 2 = by name, 1 = as "heather colors", 0 = not this color. null = the base fabric.
 */
function colorScope(s: string, color: string): number | null {
  const m = s.match(/^(.*?)\b(?:is|are)\b\s*(?:\d|made|a\b)/i) || s.match(/^([A-Za-z][A-Za-z ,&\/]+?):\s*\d/);
  if (!m) return null;
  const names = m[1].replace(/[.:;()\-–—]+/g, ",").split(/,|\band\b|&|\//i).map((x) => x.replace(/\bcolou?rs?\b|\ball\b|\bthe\b/gi, " ").replace(/\s+/g, " ").trim().toLowerCase()).filter((x) => x.length > 1);
  if (!names.length) return null;
  const c = ` ${color.toLowerCase().replace(/\s+/g, " ").trim()} `;
  let best = 0;
  for (const n of names) {
    if (n === "heather" || n === "heathers") { if (/heather/.test(c)) best = Math.max(best, 1); continue; }
    // the color contains the listed name ("Heather Navy" ⊃ "heather navy"; "Safety Orange" ⊃ "safety"),
    // or the listed name is the color plus grey ("Ash Grey" for "Ash")
    if (c.includes(` ${n} `) || c.includes(` ${n}`) && c.trim().startsWith(n) || n.replace(/\s+gr[ae]y$/, "") === c.trim()) best = 2;
  }
  return best;
}

/** polyester % for this color from the supplier's fabric lines; null when they don't say */
export function fabricFromText(text: string, color: string, supplier = "supplier"): Fabric | null {
  if (!text) return null;
  let base: Fabric | null = null, hit: { f: Fabric; score: number } | null = null;
  // SanMar writes color exceptions after the blend in parentheses: "98/2 cotton/poly (Ash) 50/50 cotton/poly (Black
  // Heather, Heather Navy…)"; turn each into its own "<colors> are <blend>" statement, and keep what's left as the base
  const lines = text.split("\n").flatMap((line) => {
    const out: string[] = [];
    const re = /(\d{1,3}\s*\/\s*\d{1,3}(?:\s*\/\s*\d{1,3})?\s*%?\s*[a-z][a-z\/\- ]*?)\s*\(([^)]*)\)?/gi;
    const rest = line.replace(re, (_m, blend: string, colors: string) => { out.push(`${colors.replace(/[,.]\s*[A-Z]\.?$/, "")} are ${blend.trim()}`); return " "; });
    return out.length ? [rest, ...out] : [line];
  });
  for (const line of lines) {
    const f = fibersIn(line); if (!f) continue;
    const scope = colorScope(line, color), fab = { polyPct: Math.round(f.polyester || 0), why: `${supplier}: “${line}”` };
    if (scope == null) { if (!base) base = fab; }
    else if (scope > 0 && (!hit || scope > hit.score)) hit = { f: fab, score: scope };
  }
  return hit?.f || base;
}

export function fabricOf(g: { style?: string; brand?: string; garment?: string; color?: string; fabric?: string; supplier?: string }): Fabric {
  const fromSupplier = g.fabric ? fabricFromText(g.fabric, g.color || "", g.supplier === "sanmar" ? "SanMar" : "S&S") : null;
  if (fromSupplier) return fromSupplier;
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

/**
 * Does a garment need specialty (low-bleed) ink on the contract price list: mostly polyester (over half: Sport-Tek
 * ST350, performance tees), nylon, or a dyed garment (tie-dye, dip-dye). 100% cotton and cotton-rich blends don't
 * (a Bella+Canvas Heather CVC at 48% poly doesn't; a 50/50 doesn't either: staff can tick it).
 */
export function specialtyGarment(g: { style?: string; brand?: string; garment?: string; color?: string; fabric?: string; supplier?: string }): { yes: boolean; why: string } {
  const label = [g.brand, g.style].filter(Boolean).join(" ").trim() || g.garment || "Garment";
  const words = `${g.garment || ""} ${g.color || ""}`;
  if (/\b(tie|dip|ice)[- ]?dye/i.test(words)) return { yes: true, why: `${label}: dyed garment` };
  if (/\bnylon\b/i.test(`${g.fabric || ""} ${g.garment || ""}`)) return { yes: true, why: `${label}: nylon` };
  const f = fabricOf(g);
  if (f.polyPct > 50) return { yes: true, why: `${label}: ${f.polyPct}% polyester` };
  return { yes: false, why: `${label}: ${f.polyPct ? `${f.polyPct}% polyester` : "cotton"}` };
}
