import { imprintLabel, lineQty, newGLine, SIZES, type GLine, type Order, type OrderCalc, type Size } from "@/lib/pricing";

/**
 * What changed in Printavo on a 40,000-series order (the read-back snapshot in orders.printavo_state.pv) compared
 * with our order: each change says what it is and can be accepted onto our order. Used by the order page and the
 * Printavo Sync page.
 */
export type PvSnap = {
  at: string; visualId: string; status: string; total: number; productionNote?: string;
  customerNote?: string; nickname?: string; po?: string; customerDue?: string; productionDue?: string; discount?: number; discountPct?: boolean; salesTax?: number;
  imprints?: string[][]; payments?: { id: string; kind: string; amount: number; category: string; date: string; processing: boolean }[];
  groups: { lines: { itemNumber: string; color: string; description: string; sizes: Record<string, number>; price: number; mockups?: number }[] }[];
  fees: { description: string; amount: number; quantity: number | null; unitPrice: number | null; pct: boolean }[];
};
// the fees Send to Printavo makes from our setup (screens, digitizing, PMS, ink changes, minimum, 2XL+)
const SETUP_FEE = /^(new screen fee|repeat screen fee|digitize file|pms match|color change|minimum order charge|sizes above xl)$/i;
export const ADJUST = "Setup adjustment (from Printavo)";
// the card surcharge is always worked out in Printavo: taken as it is, without asking
export const CARD = /credit card processing surcharge/i;
const norm = (x: string) => (x || "").replace(/\s+/g, " ").trim().toLowerCase();
export type Change = { key: string; what: "Quantities" | "Price" | "Setup fees" | "New fee" | "Fee amount" | "Fee removed" | "Production note"
  | "Nickname" | "Due date" | "Production date" | "PO" | "Customer note" | "Discount" | "Sales tax" | "Garment" | "New line" | "Line removed" | "Print details"; text: string; apply?: (d: Order) => void;
  /** a production note change: the text to save as the order's production notes (kept outside the order row) */ note?: string };
// Send to Printavo adds this line to the production note; it isn't a change
const SENT_LINE = /\s*Entered in the new FBS system as order #\d+\.\s*$/;
const noteText = (x: string) => (x || "").replace(/\r\n?/g, "\n").replace(SENT_LINE, "").trim();

export const snapOf = (o: Order) => (o as Order & { printavo_state?: { pv?: PvSnap } | null }).printavo_state?.pv || null;

/** `prodNote`: our production notes (order_internal); left out, notes aren't compared. */
export function printavoChanges(o: Order, calc: OrderCalc, snap: PvSnap | null, prodNote?: string) {
  const changes: Change[] = [];
  const info: string[] = [];
  if (snap) {
    const groups = o.groups || [];
    groups.forEach((g, gi) => {
      const ours = g.lines.filter((l) => lineQty(l) > 0), theirs = snap.groups[gi]?.lines || [];
      ours.forEach((l, li) => {
        const t = theirs[li]; if (!t) return;
        const name = `${[l.style, l.color].filter(Boolean).join(" ")}`;
        const keys = [...new Set([...Object.keys(l.sizes || {}), ...Object.keys(t.sizes)])].filter((z) => (SIZES as readonly string[]).includes(z));
        const diff = keys.filter((z) => (+(l.sizes?.[z as Size] || 0)) !== (+(t.sizes[z] || 0)));
        if (diff.length) changes.push({ what: "Quantities", key: `q${gi}.${li}`, text: `${name}: ${diff.map((z) => `${z} ${+(l.sizes?.[z as Size] || 0)} → ${+(t.sizes[z] || 0)}`).join(", ")}`,
          apply: (d) => { const x = d.groups[gi].lines.find((y) => y.id === l.id); if (x) x.sizes = Object.fromEntries(keys.filter((z) => +(t.sizes[z] || 0) > 0).map((z) => [z, +t.sizes[z]])) as GLine["sizes"]; } });
        const each = calc.groups[gi]?.lines.find((y) => y.id === l.id)?.each ?? 0;
        if (Math.abs(each - t.price) > 0.005) changes.push({ what: "Price", key: `p${gi}.${li}`, text: `${name}: price $${each.toFixed(2)} → $${t.price.toFixed(2)} each`,
          apply: (d) => { const x = d.groups[gi].lines.find((y) => y.id === l.id); if (x) x.priceOverride = t.price; } });
      });
    });
    snap.groups.slice(groups.length).forEach(() => info.push("Printavo has a line item group this order doesn't. Add it here by hand."));
    // fees: the setup ones are compared as a total, the rest one by one
    const pvSetup = snap.fees.filter((f) => SETUP_FEE.test(norm(f.description))).reduce((a, f) => a + f.amount, 0);
    const ourSetup = calc.groups.reduce((a, c) => a + c.setup + c.materials, 0);
    const adj = (o.fees || []).find((f) => f.label === ADJUST);
    const wantAdj = Math.round((pvSetup - ourSetup) * 100) / 100;
    if (Math.abs(wantAdj - (+(adj?.amount || 0))) > 0.005) changes.push({ what: "Setup fees", key: "setup", text: `Setup fees in Printavo $${pvSetup.toFixed(2)}, ours $${ourSetup.toFixed(2)}${adj ? ` (+ $${(+(adj.amount || 0)).toFixed(2)} adjustment)` : ""}`,
      apply: (d) => { d.fees = (d.fees || []).filter((f) => f.label !== ADJUST); if (Math.abs(wantAdj) > 0.005) d.fees.push({ label: ADJUST, amount: wantAdj }); } });
    // their own fees one by one, the card surcharge included (Printavo's amount, so both invoices show the same total)
    const theirFees = snap.fees.filter((f) => !SETUP_FEE.test(norm(f.description)) && !CARD.test(f.description));
    for (const f of theirFees) {
      const mine = (o.fees || []).find((x) => norm(x.label) === norm(f.description));
      if (!mine) changes.push({ what: "New fee", key: `f+${f.description}`, text: `New fee in Printavo: ${f.description.trim()} $${f.amount.toFixed(2)}`, apply: (d) => { d.fees = [...(d.fees || []), { label: f.description.trim(), amount: f.amount }]; } });
      else if (Math.abs(+(mine.amount || 0) - f.amount) > 0.005) changes.push({ what: "Fee amount", key: `f=${f.description}`, text: `${f.description.trim()}: $${(+(mine.amount || 0)).toFixed(2)} → $${f.amount.toFixed(2)}`, apply: (d) => { const x = (d.fees || []).find((y) => norm(y.label) === norm(f.description)); if (x) x.amount = f.amount; } });
    }
    for (const mine of (o.fees || []).filter((x) => x.label !== ADJUST && !CARD.test(x.label) && +(x.amount || 0) && !theirFees.some((f) => norm(f.description) === norm(x.label))))
      changes.push({ what: "Fee removed", key: `f-${mine.label}`, text: `Fee removed in Printavo: ${mine.label} $${(+(mine.amount || 0)).toFixed(2)}`, apply: (d) => { d.fees = (d.fees || []).filter((y) => y.label !== mine.label); } });
  }
  if (snap) {
    const fmtDay = (d: string) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "none");
    const same = (a: unknown, b: unknown) => String(a ?? "").replace(/\r\n?/g, "\n").trim() === String(b ?? "").replace(/\r\n?/g, "\n").trim();
    if (snap.nickname !== undefined && !same(o.nickname, snap.nickname)) changes.push({ what: "Nickname", key: "nick", text: `"${o.nickname || ""}" → "${snap.nickname}"`, apply: (d) => { d.nickname = snap.nickname || ""; } });
    if (snap.customerDue !== undefined && snap.customerDue && !same(o.due_date, snap.customerDue)) changes.push({ what: "Due date", key: "due", text: `${fmtDay(o.due_date || "")} → ${fmtDay(snap.customerDue)}`, apply: (d) => { d.due_date = snap.customerDue || null; } });
    const od = o as Order & { production_date?: string | null; po_number?: string | null };
    if (snap.productionDue !== undefined && snap.productionDue && !same(od.production_date, snap.productionDue)) changes.push({ what: "Production date", key: "prod", text: `${fmtDay(od.production_date || "")} → ${fmtDay(snap.productionDue)}`, apply: (d) => { (d as typeof od).production_date = snap.productionDue || null; } });
    if (snap.po !== undefined && !same(od.po_number, snap.po)) changes.push({ what: "PO", key: "po", text: `"${od.po_number || ""}" → "${snap.po}"`, apply: (d) => { (d as typeof od).po_number = snap.po || ""; } });
    if (snap.customerNote !== undefined && !same(o.notes, snap.customerNote)) changes.push({ what: "Customer note", key: "cnote", text: snap.customerNote ? `"${snap.customerNote.slice(0, 240)}${snap.customerNote.length > 240 ? "…" : ""}"` : "(cleared in Printavo)", apply: (d) => { d.notes = snap.customerNote || ""; } });
    if (snap.discount !== undefined) {
      const ours = o.discount_type === "amt" ? +(o.discount_amt || 0) : +(o.discount_pct || 0), oursPct = o.discount_type !== "amt";
      const theirs = +snap.discount || 0, theirsPct = !!snap.discountPct;
      if ((ours || theirs) && (Math.abs(ours - theirs) > 0.005 || (theirs && oursPct !== theirsPct)))
        changes.push({ what: "Discount", key: "disc", text: `${ours ? (oursPct ? `${ours}%` : `$${ours.toFixed(2)}`) : "none"} → ${theirs ? (theirsPct ? `${theirs}%` : `$${theirs.toFixed(2)}`) : "none"}`,
          apply: (d) => { if (theirsPct) { d.discount_type = "pct"; d.discount_pct = theirs; d.discount_amt = 0; } else { d.discount_type = "amt"; d.discount_amt = theirs; d.discount_pct = 0; } } });
    }
    if (snap.salesTax !== undefined) {
      const oursRate = o.tax_exempt ? 0 : calc.rate, theirs = +snap.salesTax || 0;
      if (Math.abs(oursRate - theirs) > 0.001) changes.push({ what: "Sales tax", key: "tax", text: `${o.tax_exempt ? "exempt" : `${oursRate}%`} → ${theirs ? `${theirs}%` : "exempt"}`, apply: (d) => { if (theirs) { d.tax_exempt = false; d.tax_rate = theirs; } else d.tax_exempt = true; } });
    }
    // garments: style / color changed, lines added or taken out, print details
    (o.groups || []).forEach((g, gi) => {
      const ours = g.lines.filter((l) => lineQty(l) > 0), theirs = snap.groups[gi]?.lines || [];
      if (!snap.groups[gi]) return;
      ours.forEach((l, li) => {
        const t = theirs[li]; if (!t) { changes.push({ what: "Line removed", key: `lr${gi}.${li}`, text: `${[l.style, l.color].filter(Boolean).join(" ")} isn't on the Printavo order any more`, apply: (d) => { d.groups[gi].lines = d.groups[gi].lines.filter((y) => y.id !== l.id); } }); return; }
        if ((t.itemNumber && !same(l.style, t.itemNumber)) || (t.color && !same(l.color, t.color)))
          changes.push({ what: "Garment", key: `g${gi}.${li}`, text: `${[l.style, l.color].filter(Boolean).join(" ")} → ${[t.itemNumber, t.color].filter(Boolean).join(" ")}`, apply: (d) => { const x = d.groups[gi].lines.find((y) => y.id === l.id); if (x) { if (t.itemNumber) x.style = t.itemNumber; if (t.color) x.color = t.color; } } });
      });
      theirs.slice(ours.length).forEach((t, k) => changes.push({ what: "New line", key: `ln${gi}.${k}`, text: `${[t.itemNumber, t.color].filter(Boolean).join(" ")} ${Object.entries(t.sizes).map(([z, q]) => `${z} ${q}`).join(", ")} at $${t.price.toFixed(2)}`,
        apply: (d) => { d.groups[gi].lines.push({ ...newGLine(), style: t.itemNumber, color: t.color, garment: t.description.replace(/\s*\([^)]*\)\s*$/, ""), sizes: Object.fromEntries(Object.entries(t.sizes).filter(([z]) => (SIZES as readonly string[]).includes(z))) as GLine["sizes"], priceOverride: t.price }); } }));
      // print details: the first line is ours (location, colors, inks, size); what's under it is the notes
      (snap.imprints?.[gi] || []).forEach((det, ii) => {
        const im = g.imprints[ii]; if (!im) return;
        const [head, ...rest] = det.replace(/\r\n?/g, "\n").split("\n");
        const notes = rest.join("\n").trim();
        if (!same(head, imprintLabel(im))) info.push(`Print ${ii + 1} reads "${head}" in Printavo (ours: "${imprintLabel(im)}"). Change the print here by hand if that's right.`);
        if (!same(im.notes, notes)) changes.push({ what: "Print details", key: `im${gi}.${ii}`, text: `${im.location}: ${notes ? `"${notes.slice(0, 200)}"` : "(notes cleared in Printavo)"}`, apply: (d) => { const x = d.groups[gi].imprints[ii]; if (x) x.notes = notes; } });
      });
    });
    // new line item groups are added by hand (their prints need setting up)
  }
  if (snap && prodNote !== undefined && snap.productionNote !== undefined) {
    const theirs = noteText(snap.productionNote), ours = noteText(prodNote);
    if (theirs !== ours) changes.push({ what: "Production note", key: "note", text: theirs ? `"${theirs.length > 240 ? theirs.slice(0, 240) + "…" : theirs}"` : "(cleared in Printavo)", note: theirs });
  }
  // changes staff chose to ignore stay ignored until Printavo changes that thing again (the text differs then)
  const ignored = new Set(((o as Order & { printavo_state?: { ignored?: string[] } | null }).printavo_state?.ignored) || []);
  return { changes: changes.filter((c) => !ignored.has(sigOf(c))), info };
}
export const sigOf = (c: Change) => `${c.key}|${c.text}`;

/** Printavo's card surcharge vs ours: the fees to set when they differ (null when they already match). */
export function cardFix(o: Order, snap: PvSnap | null) {
  if (!snap) return null;
  const pvCard = snap.fees.find((f) => CARD.test(f.description)), ourCard = (o.fees || []).find((f) => CARD.test(f.label));
  const off = pvCard ? !ourCard || Math.abs(+(ourCard.amount || 0) - pvCard.amount) > 0.005 : !!ourCard;
  return off ? { amount: pvCard?.amount ?? 0, apply: (d: Order) => { d.fees = [...(d.fees || []).filter((f) => !CARD.test(f.label)), ...(pvCard ? [{ label: pvCard.description.trim(), amount: pvCard.amount }] : [])]; } } : null;
}
