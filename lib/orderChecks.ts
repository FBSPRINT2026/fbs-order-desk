// Quick, rule-based checks on an order in the editor: the things that most often cause a
// redo or a missed date. The AI review (when on) adds judgment on top of these.

import { FULL_COLOR, ST, type Customer, type Order, type OrderCalc, type Proof } from "@/lib/pricing";
import { daysUntil, fmtDateLong } from "@/lib/format";

export type Check = { level: "high" | "medium" | "low"; text: string };

const inkCount = (s: string) => (s || "").split(/[,;/+]|\s&\s/).map((x) => x.trim()).filter(Boolean).length;
const LATE_STAGE = ["art", "blanks", "production", "ready", "completed"];

export function checkOrder(o: Order, c: OrderCalc, cust: Customer | undefined, proofs: Pick<Proof, "status">[]): Check[] {
  const out: Check[] = [];
  const add = (level: Check["level"], text: string) => out.push({ level, text });
  const open = o.status !== "completed";

  if (!o.customer_id) add("high", "No customer picked yet.");
  else if (cust && !cust.email) add("high", `${cust.company || cust.name || "This customer"} has no email, so they can't get the quote or use their portal.`);

  if (!c.qty) add("high", "No pieces entered yet.");
  if (open && !o.due_date) add("medium", "No in-hands date.");
  const due = daysUntil(o.due_date);
  if (open && due !== null && due < 0 && o.status !== "ready") add("high", `In-hands date (${fmtDateLong(o.due_date)}) has passed.`);
  if (o.production_date && o.due_date && o.production_date > o.due_date) add("high", "Production date is after the in-hands date.");
  if (open && due !== null && due >= 0 && due <= 7 && (o.type === "quote") && !o.rush) add("medium", `Due in ${due} day${due === 1 ? "" : "s"} and not approved yet. Mark it Rush or confirm the date.`);

  o.groups.forEach((g, gi) => {
    const name = g.name || `Group ${gi + 1}`;
    const gc = c.groups[gi];
    if (gc?.belowMin) add("medium", `${name}: ${gc.qty} pieces is under your ${gc.tierMin}-piece minimum price break.`);
    g.lines.forEach((l) => {
      const q = Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0);
      if (!q) return;
      if (!(l.style || l.garment)) add("medium", `${name}: a garment with ${q} pieces has no style.`);
      if (!l.color) add("medium", `${name}: ${l.style || "a garment"} has no color.`);
    });
    if (!g.imprints.length && g.lines.some((l) => Object.keys(l.sizes || {}).length)) add("medium", `${name}: no imprints.`);
    g.imprints.forEach((d) => {
      const where = `${name} ${d.location || "imprint"}`;
      if (!d.design_id && LATE_STAGE.includes(o.status)) add("medium", `${where}: no logo attached.`);
      if ((d.method === "screen" && d.colors < FULL_COLOR) || d.method === "embroidery") {
        const n = inkCount(d.inks);
        if (!n && LATE_STAGE.includes(o.status)) add("medium", `${where}: no ${d.method === "embroidery" ? "thread" : "ink"} colors listed.`);
        else if (n && n !== d.colors) add("high", `${where}: ${n} ${d.method === "embroidery" ? "thread" : "ink"}${n > 1 ? "s" : ""} listed for ${d.colors} color${d.colors > 1 ? "s" : ""}.`);
      }
      if (!(d.size || "").trim() && LATE_STAGE.includes(o.status)) add("low", `${where}: no print size.`);
    });
    gc?.lines.forEach((lc, li) => { if (lc.qty && lc.each <= 0) add("high", `${name}: ${g.lines[li]?.style || "a garment"} is priced at $0.`); });
  });

  if (o.delivery_method === "ship") {
    if (!(o.ship_to || "").trim()) add("high", "Shipping, but there's no ship-to address.");
    if (!(o.ship_method || "").trim()) add("medium", "Shipping, but no ship method picked.");
  }
  if (cust?.tax_exempt && !o.tax_exempt) add("medium", "Customer is tax exempt, but this order is being taxed.");
  if (o.status === "production" && proofs.some((p) => p.status !== "approved")) add("high", "In production, but not every proof is approved.");
  if (o.status === "art" && proofs.length === 0) add("low", "Art & Proofs stage, but no proof uploaded yet.");
  if (["production", "ready", "completed"].includes(o.status) && c.paid < 0.005 && c.total > 0 && cust?.payment_terms === "prepay") add("high", "Pre-pay customer and nothing has been paid.");
  if (o.status === "ready" && o.delivery_method === "ship" && !(o.tracking || "").trim()) add("low", "Ready to ship: add the tracking number when it goes out.");

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Portal/stage label for messages ("Artwork", "Printing", …). */
export const stageLabel = (k: string) => ST[k]?.portal || k;
