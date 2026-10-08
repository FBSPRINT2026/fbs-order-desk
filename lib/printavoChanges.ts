import { lineQty, SIZES, type GLine, type Order, type OrderCalc, type Size } from "@/lib/pricing";

/**
 * What changed in Printavo on a 40,000-series order (the read-back snapshot in orders.printavo_state.pv) compared
 * with our order: each change says what it is and can be accepted onto our order. Used by the order page and the
 * Printavo Sync page.
 */
export type PvSnap = {
  at: string; visualId: string; status: string; total: number; productionNote?: string;
  groups: { lines: { itemNumber: string; color: string; description: string; sizes: Record<string, number>; price: number; mockups?: number }[] }[];
  fees: { description: string; amount: number; quantity: number | null; unitPrice: number | null; pct: boolean }[];
};
// the fees Send to Printavo makes from our setup (screens, digitizing, PMS, ink changes, minimum, 2XL+)
const SETUP_FEE = /^(new screen fee|repeat screen fee|digitize file|pms match|color change|minimum order charge|sizes above xl)$/i;
export const ADJUST = "Setup adjustment (from Printavo)";
// the card surcharge is always worked out in Printavo: taken as it is, without asking
export const CARD = /credit card processing surcharge/i;
const norm = (x: string) => (x || "").replace(/\s+/g, " ").trim().toLowerCase();
export type Change = { key: string; what: "Quantities" | "Price" | "Setup fees" | "New fee" | "Fee amount" | "Fee removed" | "Production note"; text: string; apply?: (d: Order) => void;
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
      theirs.slice(ours.length).forEach((t) => info.push(`New line in Printavo: ${[t.itemNumber, t.color].filter(Boolean).join(" ")} ${Object.entries(t.sizes).map(([z, q]) => `${z} ${q}`).join(", ")} at $${t.price.toFixed(2)}. Add it here by hand.`));
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
  if (snap && prodNote !== undefined && snap.productionNote !== undefined) {
    const theirs = noteText(snap.productionNote), ours = noteText(prodNote);
    if (theirs !== ours) changes.push({ what: "Production note", key: "note", text: theirs ? `"${theirs.length > 240 ? theirs.slice(0, 240) + "…" : theirs}"` : "(cleared in Printavo)", note: theirs });
  }
  return { changes, info };
}

/** Printavo's card surcharge vs ours: the fees to set when they differ (null when they already match). */
export function cardFix(o: Order, snap: PvSnap | null) {
  if (!snap) return null;
  const pvCard = snap.fees.find((f) => CARD.test(f.description)), ourCard = (o.fees || []).find((f) => CARD.test(f.label));
  const off = pvCard ? !ourCard || Math.abs(+(ourCard.amount || 0) - pvCard.amount) > 0.005 : !!ourCard;
  return off ? { amount: pvCard?.amount ?? 0, apply: (d: Order) => { d.fees = [...(d.fees || []).filter((f) => !CARD.test(f.label)), ...(pvCard ? [{ label: pvCard.description.trim(), amount: pvCard.amount }] : [])]; } } : null;
}
