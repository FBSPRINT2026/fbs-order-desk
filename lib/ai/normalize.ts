// Turns what the AI proposes into the app's own order shapes, defensively.
// The AI's answer is treated as untrusted input: unknown sizes are dropped, numbers are clamped,
// methods and locations are mapped onto the shop's lists. No prices or costs ever come from the AI.

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
    garments?: { style?: string; brand?: string; description?: string; color?: string; sizes?: Record<string, number> }[];
    prints?: { method?: string; location?: string; colors?: number | "full"; inks?: string; size?: string; notes?: string }[];
  }[];
  questions?: string[];
  confidence?: "high" | "medium" | "low";
};

const SIZE_ALIASES: Record<string, Size> = {
  XXL: "2XL", XXXL: "3XL", "2X": "2XL", "3X": "3XL", "4X": "4XL", "5X": "5XL",
  SMALL: "S", MEDIUM: "M", LARGE: "L", "X-LARGE": "XL", XLARGE: "XL", "EXTRA LARGE": "XL", "X-SMALL": "XS",
  YOUTH_S: "YS", YOUTH_M: "YM", YOUTH_L: "YL", YOUTH_XL: "YXL", YOUTH_XS: "YXS", "Y-S": "YS", "Y-M": "YM", "Y-L": "YL", "Y-XL": "YXL",
  OSFA: "OS", "ONE SIZE": "OS", QTY: "OS",
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

/** Proposed groups → real order groups (no costs, no price overrides). */
export function proposalToGroups(p: ProposedOrder): Group[] {
  const groups: Group[] = [];
  for (const pg of (p.groups || []).slice(0, 12)) {
    const lines = (pg.garments || []).slice(0, 20).map((g) => {
      const l = newGLine();
      l.style = (g.style || "").trim().slice(0, 40);
      l.brand = (g.brand || "").trim().slice(0, 40);
      l.garment = (g.description || "").trim().slice(0, 120);
      l.color = (g.color || "").trim().slice(0, 60);
      for (const [raw, q] of Object.entries(g.sizes || {})) {
        const z = normSize(raw);
        const n = Math.max(0, Math.min(100000, Math.floor(+q || 0)));
        if (z && n) l.sizes[z] = (l.sizes[z] || 0) + n;
      }
      if (Object.keys(l.sizes).length === 1 && l.sizes.OS) l.oneSize = true;
      return l;
    }).filter((l) => l.style || l.garment || l.color || Object.keys(l.sizes).length);
    const imprints = (pg.prints || []).slice(0, 10).map((d) => {
      const im = newImprint(normLocation(d.location));
      im.method = normMethod(d.method);
      const full = d.colors === "full" || (typeof d.colors === "number" && d.colors >= FULL_COLOR);
      im.colors = im.method === "dtf" ? 1 : full && im.method === "screen" ? FULL_COLOR : Math.max(1, Math.min(im.method === "embroidery" ? 15 : 10, Math.round(+(d.colors || 1)) || 1));
      im.inks = (d.inks || "").slice(0, 200);
      im.size = (d.size || "").slice(0, 40);
      im.notes = (d.notes || "").slice(0, 300);
      return im;
    });
    if (!lines.length && !imprints.length) continue;
    groups.push({ id: uid(), name: (pg.name || "").slice(0, 60) || undefined, lines: lines.length ? lines : [newGLine()], imprints });
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
