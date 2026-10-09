/**
 * QuickBooks self-test from the command line (no QuickBooks, no database): `npx tsx scripts/qbo-selftest.ts [fixture.json]`.
 * Without a fixture it builds a synthetic shop the way Printavo left it (customers renamed and merged here, Printavo's
 * names and invoice numbers in QuickBooks) and checks matching, invoices, payments and the rename story.
 * With a fixture (the SelfTestInput shape) it runs on that. On the real data, call the deployed /api/qbo/selftest
 * with the runner's token.
 */
import { readFileSync } from "fs";
import { selfTest, type SelfTestInput, type ArchivedRef } from "../lib/qbo/selftest";
import type { OrderRow } from "../lib/qbo/map";

function synthetic(): SelfTestInput {
  const companies = ["Freedom Church", "Shag Carpet", "Cedar Promo", "Little Groupies", "Visible Dialogue", "Lake Highlands Band", "Peticolas Brewing", "Dallas Rugby Club", "Oak Cliff Swim", "Texas Roofing Co", "Bluebonnet PTA", "Richardson Robotics"];
  const ours = companies.map((c, i) => ({ id: `c${i}`, company: i % 3 === 0 ? `${c} (renamed)` : c, name: `Person ${i}`, email: `p${i}@example.com`, phone: `21455501${String(i).padStart(2, "0")}`, emails: [`p${i}@example.com`], names: [c], phones: [] as string[] }));
  const archived: ArchivedRef[] = [];
  let v = 20000;
  companies.forEach((c, i) => {
    const pids = i % 4 === 1 ? [`p${i}a`, `p${i}b`] : [`p${i}`]; // every 4th customer was merged from two Printavo customers
    pids.forEach((pid, k) => { for (let j = 0; j < 4 + i; j++) archived.push({ visual_id: String(++v), customer_id: `c${i}`, pid, pname: k ? `${c} - Old` : c, total: 100 + j * 13.37 + i, date: `202${4 + k}-0${1 + (j % 9)}-1${j % 9}` }); });
  });
  const order = {
    id: "o1", number: 50001, customer_id: "c1", nickname: "Spring tees", status: "approved", type: "invoice", due_date: "2026-11-20", lines: [], fees: [{ label: "Shipping", amount: 18 }], discount_pct: 0, tax_exempt: false, tax_rate: null, waive_setup: false, total: 0, qty: 60,
    created_at: "2026-11-03T15:00:00Z", approved_at: "2026-11-03T16:00:00Z", po_number: "PO-77", delivery_method: "ship", ship_to: "Shag Carpet\n100 Main St\nDallas, TX 75201", price_type: "retail",
    groups: [{ id: "g1", name: "Front + back", lines: [{ id: "l1", style: "5000", brand: "Gildan", garment: "Heavy Cotton Tee", color: "Black", cost: 3.1, sizes: { S: 10, M: 20, L: 20, XL: 5, "2XL": 5 }, priceOverride: null }, { id: "l2", style: "5000", brand: "Gildan", garment: "Heavy Cotton Tee", color: "White", cost: 2.6, sizes: { M: 6, L: 6 }, priceOverride: null }], imprints: [{ id: "i1", method: "screen", location: "Full Front", colors: 3, inks: "White, PMS 186 C, Black", size: "11\" wide", notes: "" }, { id: "i2", method: "screen", location: "Full Back", colors: 1, inks: "White", size: "", notes: "" }], finishing: ["fold_bag"] }],
  } as unknown as OrderRow;
  return {
    settings: { taxRate: 8.25 }, orders: [order],
    customers: ours.map((c) => ({ id: c.id, company: c.company, name: c.name, email: c.email, phone: c.phone, address: "100 Main St\nDallas, TX 75201", tax_exempt: false, payment_terms: "receipt" })),
    payments: [{ id: "pay1", order_id: "o1", amount: 250, method: "Credit card", paid_on: "2026-11-05", fee: 7.5, processor_id: "stax:abc123", note: "" }, { id: "pay2", order_id: "o1", amount: 77.94, method: "Credit card", paid_on: "2026-10-08", fee: 0, processor_id: "printavo:19581995_b", note: "Paid in Printavo" }],
    archived, ours, pcEmails: {},
  };
}

const file = process.argv[2];
const input: SelfTestInput = file ? JSON.parse(readFileSync(file, "utf8")) : synthetic();
const r = selfTest(input);
for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail && (!c.ok || process.env.VERBOSE) ? `\n      ${c.detail}` : ""}`);
const failed = r.checks.filter((c) => !c.ok).length;
console.log(`\n${r.checks.length - failed} passed, ${failed} failed`);
if (process.env.VERBOSE) console.log(JSON.stringify(r.samples, null, 2));
process.exit(failed ? 1 : 0);
