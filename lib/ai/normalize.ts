// Turns what the AI proposes into the app's own order shapes, defensively.
// The AI's answer is treated as untrusted input: unknown sizes are dropped, numbers are clamped,
// methods and locations are mapped onto the shop's lists. No prices or costs ever come from the AI.

import type { GarmentLook, StockKind } from "@/lib/stockGarments";
import { FULL_COLOR, LOCATIONS, METHODS, SIZES, newGLine, newImprint, uid, type Group, type Method, type Size } from "@/lib/pricing";

export type ProposedOrder = {
  nickname?: string;
  due_date?: string | null;
  notes?: string;
  delivery?: "pickup" | "ship" | "deliver" | null;
  ship_to?: string;
  po_number?: string;
  customer?: { company?: string; name?: string; email?: string; phone?: string };
  groups?: {
    name?: string;
    garments?: { style?: string; brand?: string; description?: string; color?: string; sizes?: Record<string, number>; note?: string; /** the email didn't name the style: what they called it ("tees") */ called?: string;
      /** what it looks like in the customer's photo, to draw it when it isn't in a catalog (rule 3d) */ look?: { kind?: string; hex?: string; trim?: string | null; heather?: boolean; stripes?: string | null; quilted?: boolean } | null }[];
    prints?: { method?: string; location?: string; colors?: number | "full"; inks?: string; size?: string; notes?: string; /** rule 4f: their own heat transfers */ supplied_transfers?: { by?: string; order?: string } | null }[];
  }[];
  questions?: string[];
  confidence?: "high" | "medium" | "low";
};

const SIZE_ALIASES: Record<string, Size> = {
  XXL: "2XL", XXXL: "3XL", "2X": "2XL", "3X": "3XL", "4X": "4XL", "5X": "5XL",
  SMALL: "S", MEDIUM: "M", LARGE: "L",
  // retail size labels on a product sheet (Oct 27, Embark: "SM 4 · MD 6 · LG 6")
  SM: "S", SML: "S", MD: "M", MED: "M", LG: "L", LRG: "L", XLG: "XL", "X-LARGE": "XL", XLARGE: "XL", "EXTRA LARGE": "XL", "X-SMALL": "XS",
  YOUTH_S: "YS", YOUTH_M: "YM", YOUTH_L: "YL", YOUTH_XL: "YXL", YOUTH_XS: "YXS", "Y-S": "YS", "Y-M": "YM", "Y-L": "YL", "Y-XL": "YXL",
  OSFA: "OS", "ONE SIZE": "OS", QTY: "OS",
  // headwear (Oct 26, Nick: Effing Gear's hat sheet, "M/L", "Adjustable", "One Size"): one quantity per hat line; a fitted
  // range (M/L) is kept in the line's note by the sheet reader
  ADJUSTABLE: "OS", ADJ: "OS", "ONE SIZE FITS ALL": "OS", "ONE SIZE FITS MOST": "OS", OSFM: "OS", SNAPBACK: "OS", STRAPBACK: "OS",
  "S/M": "OS", "M/L": "OS", "L/XL": "OS", "XL/2XL": "OS", "XL/XXL": "OS", "S-M": "OS", "M-L": "OS", "L-XL": "OS", "SM/MD": "OS", "LG/XL": "OS", "X/S": "OS", "XS/S": "OS",
  // baby and toddler (ranges are stored by their top month, as Printavo did)
  NEWBORN: "NB", "0-3M": "NB", "0-3 M": "NB", "3M": "6M", "3-6M": "6M", "6-12M": "12M", "12-18M": "18M", "18-24M": "24M",
  "06M": "6M", "6 MONTHS": "6M", "12 MONTHS": "12M", "18 MONTHS": "18M", "24 MONTHS": "24M", "6MO": "6M", "12MO": "12M", "18MO": "18M", "24MO": "24M",
  "2": "2T", "3": "3T", "4": "4T", "5": "5T", "5/6": "5T", "5-6T": "5T", "5/6T": "5T", "2-3T": "3T",
};
export function normSize(raw: string): Size | null {
  const k = raw.trim().toUpperCase().replace(/\s+/g, " ").replace(/^SIZE_/, "");
  if ((SIZES as readonly string[]).includes(k)) return k as Size;
  return SIZE_ALIASES[k] || SIZE_ALIASES[k.replace(/\s/g, "_")] || null;
}

function normMethod(m?: string): Method {
  const k = (m || "").toLowerCase();
  if (k.includes("embroid") || k.includes("stitch")) return "embroidery";
  if (k.includes("dtf") || k.includes("transfer") || k.includes("heat")) return "dtf";
  return "screen";
}
function normLocation(l?: string) {
  const k = (l || "").trim().toLowerCase();
  if (!k) return "Full Front";
  const exact = LOCATIONS.find((x) => x.toLowerCase() === k);
  if (exact) return exact;
  if (/left.*chest|lc\b/.test(k)) return "Left Chest";
  if (/right.*chest/.test(k)) return "Right Chest";
  if (/full.*back|^back$/.test(k)) return "Full Back";
  if (/full.*front|^front$/.test(k)) return "Full Front";
  if (/left.*sleeve/.test(k)) return "Left Sleeve";
  if (/right.*sleeve/.test(k)) return "Right Sleeve";
  if (/yoke|upper back|nape|neck/.test(k)) return "Upper Back (Yoke)";
  return (l || "").trim().slice(0, 60);
}

const BRANDS = ["Gildan", "Next Level", "Bella+Canvas", "Bella + Canvas", "Bella Canvas", "Comfort Colors", "Hanes", "Port & Company", "Port and Company", "Port Authority", "District", "Sport-Tek", "Independent Trading Co.", "Independent", "Champion", "American Apparel", "Jerzees", "Fruit of the Loom", "Augusta", "Badger", "Richardson", "Rabbit Skins", "Alternative", "LAT", "Allmade", "Tultex", "BELLA+CANVAS"];
/** "Gildan 64000" → style "64000", brand "Gildan" (the brand at the front of the style, or one we know) */
export function bareStyle(style: string, brand = ""): { style: string; brand: string } {
  const st = style.trim(), low = st.toLowerCase();
  for (const b of [brand, ...BRANDS].filter(Boolean)) {
    const bl = b.toLowerCase().trim();
    if (low.startsWith(bl + " ") || low.startsWith(bl + "-")) {
      const rest = st.slice(bl.length).replace(/^[\s-]+/, "").trim();
      if (/\d/.test(rest)) return { style: rest, brand: brand || b };
    }
  }
  return { style: st, brand };
}

/** Proposed groups → real order groups (no costs, no price overrides). */
const KINDS = ["tee", "long", "crew", "hoodie", "polo", "quarter", "vest", "puffer", "jacket", "tank", "hat", "beanie"] as const;
const hexOk = (h: unknown) => (typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h.trim()) ? (h.trim().startsWith("#") ? h.trim() : "#" + h.trim()).toLowerCase() : undefined);
/** a garment's look as the reader saw it in the customer's photo, checked (rule 3d) */
export function lookOf(x: unknown): GarmentLook | undefined {
  if (!x || typeof x !== "object") return undefined;
  const g = x as { kind?: unknown; hex?: unknown; trim?: unknown; heather?: unknown; stripes?: unknown; quilted?: unknown };
  const hex = hexOk(g.hex), kind = (KINDS as readonly string[]).includes(String(g.kind)) ? (g.kind as StockKind) : undefined;
  if (!hex || !kind) return undefined;
  const trim = hexOk(g.trim), stripes = hexOk(g.stripes);
  return { kind, hex, ...(trim ? { trim } : {}), ...(g.heather ? { heather: true } : {}), ...(stripes ? { stripes } : {}), ...(g.quilted ? { quilted: true } : {}), from: "the customer's photo" };
}

export function proposalToGroups(p: ProposedOrder): Group[] {
  const groups: Group[] = [];
  for (const pg of (p.groups || []).slice(0, 12)) {
    const lines = (pg.garments || []).slice(0, 20).map((g) => {
      const l = newGLine();
      l.style = (g.style || "").trim().slice(0, 40);
      l.brand = (g.brand || "").trim().slice(0, 40);
      // the brand written into the style ("Gildan 64000"): the style is the number, so the garment and its photos are
      // found (Oct 23, Logotology #40109: "Gildan 64000" found no garment and the mockup never got made)
      { const b = bareStyle(l.style, l.brand); l.style = b.style; if (!l.brand && b.brand) l.brand = b.brand; }
      l.garment = (g.description || "").trim().slice(0, 120);
      // no style named: what they called it, for Create order to ask about (their preferred goods first, Oct 26)
      { const c = String(g.called || "").trim().slice(0, 40); if (c && !l.style) l.called = c; }
      l.color = (g.color || "").trim().slice(0, 60);
      // what it looks like in their photo (Oct 27, Nick: Peter Millar's Ridge Vest isn't in a catalog, so it's drawn)
      { const lk = lookOf(g.look); if (lk) l.look = lk; }
      for (const [raw, q] of Object.entries(g.sizes || {})) {
        const z = normSize(raw);
        const n = Math.max(0, Math.min(100000, Math.floor(+q || 0)));
        if (z && n) l.sizes[z] = (l.sizes[z] || 0) + n;
      }
      if (Object.keys(l.sizes).length === 1 && l.sizes.OS) l.oneSize = true;
      // a note for this line from a PO: "Extras", the product name, a waist-size breakdown
      let note = String(g.note || "").trim().slice(0, 200);
      // their extras / overage: an extras line, printed free (Oct 22, McKenna #40104)
      // the word on its own or before a separator ("Extras", "Extras: 1 each"), not "Extra Large" / "Extra Soft Tee"
      if (/^\s*(extras?|overage|overs|spares?)\s*($|[:·,.(\-–])/i.test(note)) { l.extras = true; l.priceOverride = 0; note = note.replace(/^\s*(extras?|overage|overs|spares?)\s*[:·,.(\-–]*\s*/i, "").replace(/\)\s*$/, "").trim(); }
      if (note) l.note = note;
      return l;
    }).filter((l) => l.style || l.garment || l.color || Object.keys(l.sizes).length);
    const imprints = (pg.prints || []).slice(0, 10).map((d) => {
      const im = newImprint(normLocation(d.location));
      im.method = normMethod(d.method);
      const full = d.colors === "full" || (typeof d.colors === "number" && d.colors >= FULL_COLOR);
      im.colors = im.method === "dtf" ? 1 : full && im.method === "screen" ? FULL_COLOR : Math.max(1, Math.min(im.method === "embroidery" ? 15 : 10, Math.round(+(d.colors || 1)) || 1));
      im.inks = (d.inks || "").slice(0, 200);
      // the shop's way of writing it: "11 inches wide" / "11in" / "11 in. W" → 11" wide (a height stays a height)
      const sz = String(d.size || "").trim();
      const m = sz.match(/^(\d+(?:\.\d+)?)\s*(?:"|”|''|in\.?|inch(?:es)?)?\s*(w|wide|width|t|tall|h|high|height)?\.?$/i);
      im.size = (m ? `${m[1]}" ${/^(t|tall|h|high|height)$/i.test(m[2] || "") ? "tall" : "wide"}` : sz).slice(0, 40);
      im.notes = (d.notes || "").slice(0, 300);
      // the customer's own heat transfers (rule 4f): pressed where their placement reference shows, not priced
      if (d.supplied_transfers && im.method === "dtf") { im.supplied = { by: String(d.supplied_transfers.by || "").trim().slice(0, 60), ref: String(d.supplied_transfers.order || "").trim().slice(0, 60) }; im.location = ""; im.size = ""; }
      return im;
    });
    if (!lines.length && !imprints.length) continue;
    const description = String((pg as { description?: string }).description || "").trim().slice(0, 600);
    groups.push({ id: uid(), name: (pg.name || "").slice(0, 60) || undefined, ...(description ? { description } : {}), lines: lines.length ? lines : [newGLine()], imprints });
  }
  return groups;
}

/** Short plain-text description of an order for the AI to read (no costs). */
export function describeGroups(groups: Group[]) {
  return groups.map((g, i) => {
    const lines = g.lines.map((l) => `  - ${[l.brand, l.style, l.garment].filter(Boolean).join(" ") || "(no style)"}, color ${l.color || "(none)"}: ${Object.entries(l.sizes || {}).filter(([, q]) => q).map(([z, q]) => `${z} ${q}`).join(", ") || "no sizes"}`);
    const prints = g.imprints.map((d) => `  - ${METHODS[d.method] || d.method} on ${d.location || "(no location)"}, ${d.method === "dtf" ? "full color" : d.colors >= FULL_COLOR ? "full color" : `${d.colors} color(s)`}${d.inks ? `, inks ${d.inks}` : ", no inks listed"}${d.size ? `, size ${d.size}` : ", no size"}${d.design_id ? ", logo attached" : ", NO logo attached"}${d.notes ? `, notes: ${d.notes}` : ""}`);
    return [`Group ${i + 1}${g.name ? ` (${g.name})` : ""}:`, " Garments:", ...lines, " Prints:", ...(prints.length ? prints : ["  - none"])].join("\n");
  }).join("\n");
}
