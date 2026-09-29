/**
 * Sample jobs for a test account (e.g. "ABC Test Company"), so the production calendar has realistic work to show:
 * screen print (1–10 colors, front/back/sleeve, light and dark garments, tees to hoodies and totes), embroidery
 * (left chests, caps, jacket backs), DTF transfers, and mixed jobs, due over the next few weeks, at different stages.
 * Totals are left at $0 so sample jobs never count toward sales.
 */
import type { Group, GLine, Imprint, Method } from "@/lib/pricing";

type G = { garment: string; style: string; brand: string; oneSize?: boolean; heavy?: boolean };
const SCREEN: G[] = [
  { garment: "Tee", style: "5000", brand: "Gildan" }, { garment: "Softstyle Tee", style: "64000", brand: "Gildan" },
  { garment: "Garment-Dyed Tee", style: "1717", brand: "Comfort Colors" }, { garment: "Jersey Tee", style: "3001", brand: "Bella+Canvas" },
  { garment: "Hoodie", style: "18500", brand: "Gildan", heavy: true }, { garment: "Crewneck Sweatshirt", style: "18000", brand: "Gildan", heavy: true },
  { garment: "Long Sleeve Tee", style: "5400", brand: "Gildan" }, { garment: "Tote Bag", style: "8801", brand: "Liberty Bags", oneSize: true },
];
const EMB: G[] = [
  { garment: "Polo", style: "K500", brand: "Port Authority" }, { garment: "Trucker Cap", style: "112", brand: "Richardson", oneSize: true },
  { garment: "Quarter-Zip", style: "ST357", brand: "Sport-Tek", heavy: true }, { garment: "Soft Shell Jacket", style: "J317", brand: "Port Authority", heavy: true },
  { garment: "Knit Beanie", style: "CP90", brand: "Port & Co", oneSize: true }, { garment: "Dress Shirt", style: "S608", brand: "Port Authority" },
];
const DTF: G[] = [{ garment: "Performance Tee", style: "ST350", brand: "Sport-Tek" }, { garment: "Jersey Tee", style: "3001", brand: "Bella+Canvas" }, { garment: "Youth Tee", style: "5000B", brand: "Gildan" }];
const DARK = ["Black", "Navy", "Charcoal", "Forest Green", "Maroon", "Royal", "Red", "Purple"];
const LIGHT = ["White", "Ash", "Natural", "Sport Grey", "Light Pink", "Sand", "Yellow"];
const NAMES = ["Spring Fling 5K", "Riverside Little League", "Oak Hill PTA Fun Run", "Lakeside Brewing Staff", "Summit Roofing Crew", "Bluebonnet Band Boosters", "Harvest Festival", "Eagle Scouts Troop 42", "Northside Church Retreat", "Metro Dental Team", "Coyote Coffee Merch", "Westfield Volleyball", "Family Reunion 2026", "Grand Opening Giveaway", "Robotics Club", "Varsity Soccer Warmups", "Food Truck Staff", "Real Estate Team", "Marathon Volunteers", "Golf Tournament", "Cheer Camp", "Holiday Party", "Chamber Of Commerce", "Hospital Nurses Week", "Fire Dept Duty Shirts", "Youth Basketball League", "Senior Class Shirts", "Craft Fair Vendors", "Plumbing Co Uniforms", "Charity Walk"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const between = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function sizes(qty: number, oneSize?: boolean): GLine["sizes"] {
  if (oneSize) return { OS: qty } as GLine["sizes"];
  const split: [string, number][] = [["S", 0.12], ["M", 0.28], ["L", 0.3], ["XL", 0.2], ["2XL", 0.1]];
  const out: Record<string, number> = {}; let left = qty;
  split.forEach(([k, f], i) => { const n = i === split.length - 1 ? left : Math.max(0, Math.round(qty * f)); out[k] = Math.min(n, left); left -= out[k]; });
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out as GLine["sizes"];
}
const line = (g: G, color: string, qty: number): GLine => ({ id: uid(), style: g.style, brand: g.brand, garment: g.garment, color, cost: "", sizes: sizes(qty, g.oneSize), priceOverride: null, ...(g.oneSize ? { oneSize: true } : {}) });
const imp = (method: Method, location: string, colors: number): Imprint => ({ id: uid(), method, location, colors, inks: "", size: "", notes: "" });

/** One group of garments with its decorations; returns the group and its piece count. */
function screenGroup(): Group {
  const g = pick(SCREEN), dark = Math.random() < 0.55, qty = g.oneSize ? between(50, 300) : pick([24, 36, 48, 72, 96, 120, 144, 200, 250, 300, 450, 600]);
  const colorsF = Math.random() < 0.15 ? between(6, 10) : between(1, 4);
  const imps = [imp("screen", g.garment === "Tote Bag" ? "Front" : pick(["Full Front", "Full Front", "Left Chest"]), colorsF)];
  if (g.garment !== "Tote Bag" && Math.random() < 0.5) imps.push(imp("screen", "Full Back", between(1, 4)));
  if (g.garment !== "Tote Bag" && Math.random() < 0.15) imps.push(imp("screen", "Left Sleeve", 1));
  return { id: uid(), lines: [line(g, dark ? pick(DARK) : pick(LIGHT), qty)], imprints: imps };
}
function embGroup(): Group {
  const g = pick(EMB), qty = pick([12, 18, 24, 36, 48, 72, 100, 144]);
  const loc = /cap|beanie/i.test(g.garment) ? "Cap Front" : Math.random() < 0.15 ? "Full Back" : "Left Chest";
  const imps = [imp("embroidery", loc, between(1, 6))];
  if (loc === "Left Chest" && Math.random() < 0.2) imps.push(imp("embroidery", "Right Sleeve", 1));
  return { id: uid(), lines: [line(g, pick([...DARK, "White", "Stone"]), qty)], imprints: imps };
}
function dtfGroup(): Group {
  const g = pick(DTF), qty = pick([12, 18, 24, 36, 48, 60, 96]);
  const imps = [imp("dtf", pick(["Full Front", "Left Chest"]), between(4, 12))];
  if (Math.random() < 0.4) imps.push(imp("dtf", "Full Back", between(4, 12)));
  return { id: uid(), lines: [line(g, pick([...DARK, ...LIGHT]), qty)], imprints: imps };
}

/** Business days from a date (Mon–Fri). */
function plusWorkdays(d: string, n: number) { const x = new Date(d + "T12:00:00Z"); let k = n; while (k > 0) { x.setUTCDate(x.getUTCDate() + 1); const w = x.getUTCDay(); if (w !== 0 && w !== 6) k--; } return x.toISOString().slice(0, 10); }

export type SampleOrder = { customer_id: string; nickname: string; status: string; type: string; due_date: string; qty: number; total: number; groups: Group[]; lines: never[]; po_number: string; notes: string; source: string; approved_at: string | null; approved_name: string | null; delivery_method: string; price_type: string };

export function sampleOrders(customerId: string, today: string, n = 25): SampleOrder[] {
  const out: SampleOrder[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    const groups = r < 0.55 ? [screenGroup()] : r < 0.8 ? [embGroup()] : r < 0.92 ? [dtfGroup()] : [screenGroup(), embGroup()];
    const qty = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes).reduce((c, x) => c + (x || 0), 0), 0), 0);
    // stages: most ready to run (goods here, art approved), the rest still waiting on art or blanks
    const f = i / n, status = f < 0.6 ? "production" : f < 0.73 ? "blanks" : f < 0.87 ? "art" : "approved";
    const due = plusWorkdays(today, f < 0.08 ? between(1, 2) : between(3, 15));
    const what = groups.map((g) => g.lines[0].garment).join(" + ");
    out.push({
      customer_id: customerId, nickname: `${pick(NAMES)} · ${what}`, status, type: "invoice", due_date: due, qty, total: 0, groups, lines: [],
      po_number: "PO-" + between(1000, 9999), notes: "Sample job for testing (test account). Safe to clear.", source: "sample",
      approved_at: new Date().toISOString(), approved_name: "Sample", delivery_method: Math.random() < 0.5 ? "pickup" : "ship", price_type: "retail",
    });
  }
  return out;
}
