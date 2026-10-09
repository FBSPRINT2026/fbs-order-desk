import { calcOrder, mergeSettings, r2 } from "@/lib/pricing";
import {
  cleanEmail, customerCreateBody, customerDiff, DEFAULT_QBO_SETTINGS, displayNameOf, fromPrintavo, invoiceFingerprint, invoicePayload, matchPayment,
  ownedFromQbo, parseAddress, paymentPayload, type OrderRow, type OurCustomer, type OurPayment, type QboSettings,
} from "@/lib/qbo/map";
import { HIGH_CONFIDENCE, proposeMatches, type OrderRef, type OurCustomerLite, type QboCustomerLite, type QboInvoiceLite } from "@/lib/qbo/match";

/**
 * QuickBooks self-test: no QuickBooks, no network, nothing written. Run on real data (the token-guarded
 * /api/qbo/selftest reads it from the database) or on fixtures (scripts/qbo-selftest.ts).
 *   - map: every order becomes an invoice whose lines add up to our total (calcOrder, as printed), with the tax and
 *     discount variants; every line has Amount = Qty x UnitPrice; payments; addresses.
 *   - match: a fake QuickBooks built from the archived Printavo orders the way Printavo made it (one QuickBooks
 *     customer per Printavo customer, under Printavo's name; invoices numbered with Printavo's numbers), with gaps,
 *     edited totals and decoys, matched against our renamed / merged customers: every link must resolve to the right
 *     customer by evidence, never by a wrong name.
 *   - rename: after linking, renaming ours renames the same QuickBooks customer (by Id); a rename made in QuickBooks
 *     is flagged, not overwritten.
 */

export type ArchivedRef = { visual_id: string; customer_id: string; pid: string; pname: string; total: number; date: string };
export type SelfTestInput = {
  settings: unknown; orders: OrderRow[]; customers: (OurCustomer & { company?: string | null })[]; payments: OurPayment[];
  archived: ArchivedRef[]; ours: OurCustomerLite[]; pcEmails?: Record<string, string>;
};
export type Check = { name: string; ok: boolean; detail: string };

const QS: QboSettings = {
  ...DEFAULT_QBO_SETTINGS, realm_id: "TEST",
  item_map: { screen: "1", embroidery: "2", dtf: "3", garments: "4", setup_screens: "5", digitize: "6", pms: "7", inkchange: "8", min: "9", materials: "10", fee: "11", shipping: "12", surcharge: "13", discount: "14", tax: "15", default: "99" },
  term_map: { prepay: "T1", receipt: "T2", net30: "T3" },
};
/** deterministic pseudo-random 0..1 from a string */
const rnd = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10000) / 10000; };

export function selfTest(inp: SelfTestInput): { checks: Check[]; samples: Record<string, unknown> } {
  const checks: Check[] = [];
  const ok = (name: string, cond: boolean, detail = "") => checks.push({ name, ok: !!cond, detail });
  const settings = mergeSettings(inp.settings);
  const samples: Record<string, unknown> = {};

  /* ---- addresses / names ---- */
  const a1 = parseAddress("2435 EAST HEBRON PARKWAY\nCarrollton, Texas 75010");
  ok("address: street / city / state / zip", a1?.Line1 === "2435 EAST HEBRON PARKWAY" && a1?.City === "Carrollton" && a1?.CountrySubDivisionCode === "TX" && a1?.PostalCode === "75010", JSON.stringify(a1));
  const a2 = parseAddress("811 Alpha Dr, STE 343, Richardson, TX 75081");
  ok("address: one line with commas", a2?.Line1 === "811 Alpha Dr" && a2?.Line2 === "STE 343" && a2?.City === "Richardson" && a2?.CountrySubDivisionCode === "TX" && a2?.PostalCode === "75081", JSON.stringify(a2));
  const a3 = parseAddress("7506 Ridgebluff ln\nSachse TX 75048");
  ok("address: no comma before the state", a3?.City === "Sachse" && a3?.CountrySubDivisionCode === "TX" && a3?.PostalCode === "75048", JSON.stringify(a3));
  ok("address: unparseable text kept as lines", parseAddress("Behind the gym\nAsk for Bob")?.Line2 === "Ask for Bob");
  ok("email: cleaned (Printavo's stray '>')", cleanEmail("Mike.Mitchell@findfreedom.church>") === "mike.mitchell@findfreedom.church");
  ok("display name: no colon (QuickBooks sub-customer mark)", displayNameOf({ company: "A: B" }) === "A - B");
  const withAddr = inp.customers.filter((c) => (c.address || "").trim());
  const parsed = withAddr.filter((c) => { const a = parseAddress(c.address); return !!(a?.City && a?.CountrySubDivisionCode && a?.PostalCode); });
  ok("address: real customer addresses split into city / state / zip", !withAddr.length || parsed.length / withAddr.length >= 0.8, `${parsed.length} of ${withAddr.length}`);
  samples.unparsedAddresses = withAddr.filter((c) => !parsed.includes(c)).slice(0, 5).map((c) => c.address);

  /* ---- invoices from real orders ---- */
  const custOf = new Map(inp.customers.map((c) => [c.id, c]));
  let n = 0, worst = 0;
  const totals: unknown[] = [];
  for (const o of inp.orders) {
    const cu = custOf.get(String(o.customer_id)) || null;
    for (const tax_mode of ["qbo_ast", "tax_line"] as const) {
      const b = invoicePayload({ order: o, customer: cu, customerRef: { value: "123" }, settings, qs: { ...QS, tax_mode } });
      const lines = (b.body.Line as { DetailType: string; Amount: number; SalesItemLineDetail?: { Qty: number; UnitPrice: number } }[]);
      const qboTotal = r2(lines.reduce((s, l) => s + (l.DetailType === "DiscountLineDetail" ? -l.Amount : l.Amount), 0) + (tax_mode === "qbo_ast" ? +((b.body.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax || 0) : 0));
      const bad = lines.filter((l) => l.SalesItemLineDetail && r2(l.SalesItemLineDetail.Qty * l.SalesItemLineDetail.UnitPrice) !== r2(l.Amount));
      const diff = Math.abs(qboTotal - b.total);
      worst = Math.max(worst, diff);
      n++;
      if (diff >= 0.005 || bad.length || b.problems.length) ok(`invoice #${o.number} (${tax_mode})`, false, `QuickBooks total ${qboTotal} vs ours ${b.total}; bad lines ${bad.length}; problems: ${b.problems.join(" ")}`);
      if (tax_mode === "qbo_ast") totals.push({ number: o.number, ours: b.total, saved: b.storedTotal, lines: lines.length, warnings: b.warnings });
    }
  }
  ok(`invoices: ${n} real order/tax-mode payloads add up to our total exactly`, worst < 0.005, `largest difference ${worst.toFixed(4)}`);
  samples.invoiceTotals = totals;

  // a real order with tax, a discount, fees and setup on it (the variants the shop's real orders don't have yet)
  const base = inp.orders.find((o) => (o.groups || []).length) || null;
  if (base) {
    for (const v of [
      { tax_exempt: false, tax_rate: 8.25, discount_pct: 10, discount_type: "pct" as const, fees: [{ label: "Shipping", amount: 18.5 }, { label: "Rush fee", amount: 25 }] },
      { tax_exempt: false, tax_rate: null, discount_amt: 12.34, discount_type: "amt" as const, fees: [{ label: "Credit Card Processing Surcharge", amount: 3.21 }], waive_setup: false },
      { tax_exempt: true, tax_rate: null, discount_pct: 0, fees: [], price_type: "retail" as const },
    ]) {
      const o = { ...base, ...v } as OrderRow;
      const calc = calcOrder(o, settings);
      for (const tax_mode of ["qbo_ast", "tax_line"] as const) {
        const b = invoicePayload({ order: o, customer: custOf.get(String(o.customer_id)) || null, customerRef: { value: "123" }, settings, qs: { ...QS, tax_mode } });
        const lines = b.body.Line as { DetailType: string; Amount: number }[];
        const sum = r2(lines.reduce((s, l) => s + (l.DetailType === "DiscountLineDetail" ? -l.Amount : l.Amount), 0) + (tax_mode === "qbo_ast" ? +((b.body.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax || 0) : 0));
        ok(`variant #${o.number} tax ${o.tax_exempt ? "exempt" : (o.tax_rate ?? settings.taxRate) + "%"}, discount ${calc.discount}, fees ${(o.fees || []).length} (${tax_mode})`, Math.abs(sum - calc.total) < 0.005 && !b.problems.length, `lines+tax ${sum} vs ours ${calc.total}${b.problems.length ? "; " + b.problems.join(" ") : ""}`);
        if (tax_mode === "qbo_ast" && !samples.invoiceExample) samples.invoiceExample = { number: o.number, total: b.total, summary: b.summary, body: b.body };
      }
    }
    const missing = invoicePayload({ order: base, customer: null, customerRef: null, settings, qs: { ...QS, item_map: {} } });
    ok("invoice: unmapped items and a missing customer stop it (needs review), not sent half-made", missing.problems.length >= 2, missing.problems.join(" "));
    const fp1 = invoiceFingerprint({ ...(invoicePayload({ order: base, customer: null, customerRef: { value: "1" }, settings, qs: QS }).body), TotalAmt: 10 });
    const fp2 = invoiceFingerprint({ ...(invoicePayload({ order: base, customer: null, customerRef: { value: "1" }, settings, qs: QS }).body), TotalAmt: 10, Balance: 0, SyncToken: "9", LinkedTxn: [{ TxnId: "5", TxnType: "Payment" }] });
    ok("invoice fingerprint ignores payments (balance, sync token), so a payment isn't mistaken for an edit", fp1 === fp2);
  }

  /* ---- payments ---- */
  for (const p of inp.payments.slice(0, 20)) {
    const b = paymentPayload({ payment: p, orderNumber: 1, invoiceId: "77", customerRef: "123", qs: { ...QS, payment_method_map: { "Credit card": "PM1" } } });
    ok(`payment ${p.id.slice(0, 8)}: ${fromPrintavo(p) ? "from Printavo (never made by us)" : "ours"}; applied to the invoice; card fee not on it`, (b.body.Line as { LinkedTxn: { TxnId: string }[] }[])[0].LinkedTxn[0].TxnId === "77" && b.body.TotalAmt === r2(+p.amount), JSON.stringify(b.body));
  }
  const pm = matchPayment({ id: "x", order_id: "o", amount: 77.94, paid_on: "2026-10-08" }, [{ Id: "9", TotalAmt: 77.94, TxnDate: "2026-10-09" }, { Id: "8", TotalAmt: 77.94, TxnDate: "2026-09-01" }], new Set());
  ok("payment matching: same amount within 3 days, the nearest date", pm?.Id === "9");
  ok("payment matching: one already linked isn't used twice", matchPayment({ id: "x", order_id: "o", amount: 77.94, paid_on: "2026-10-08" }, [{ Id: "9", TotalAmt: 77.94, TxnDate: "2026-10-09" }], new Set(["9"])) === null);
  ok("refunds go to review", paymentPayload({ payment: { id: "r", order_id: "o", amount: -20 }, orderNumber: 1, invoiceId: "1", customerRef: "1", qs: QS }).problems.length === 1);

  /* ---- matching: a fake QuickBooks built the way Printavo built it ---- */
  if (inp.archived.length) {
    const pidName = new Map<string, string>(), pidLocal = new Map<string, Set<string>>();
    for (const a of inp.archived) {
      if (!pidName.has(a.pid)) pidName.set(a.pid, a.pname || `Printavo customer ${a.pid}`);
      const s = pidLocal.get(a.pid) || new Set(); s.add(a.customer_id); pidLocal.set(a.pid, s);
    }
    // one QuickBooks customer per Printavo customer, Printavo's name (made unique like QuickBooks requires)
    const used = new Map<string, number>(), qboOf = new Map<string, string>();
    const qboCustomers: QboCustomerLite[] = [];
    let id = 1000;
    for (const [pid, name] of pidName) {
      const k = name.toLowerCase(), c = (used.get(k) || 0) + 1; used.set(k, c);
      const q = String(++id); qboOf.set(pid, q);
      qboCustomers.push({ Id: q, DisplayName: c > 1 ? `${name} (${c})` : name, CompanyName: name, Active: true, ...(rnd("e" + pid) < 0.5 && inp.pcEmails?.[pid] ? { PrimaryEmailAddr: { Address: inp.pcEmails[pid] } } : {}) });
    }
    // invoices with Printavo's numbers; ~10% never made it to QuickBooks, ~5% had their total edited there
    const qboInvoices: QboInvoiceLite[] = [];
    let iid = 500000;
    for (const a of inp.archived) {
      if (rnd("gap" + a.visual_id) < 0.1) continue;
      qboInvoices.push({ Id: String(++iid), DocNumber: a.visual_id, CustomerRef: { value: qboOf.get(a.pid)! }, TotalAmt: rnd("t" + a.visual_id) < 0.05 ? r2(a.total * 1.03) : a.total, TxnDate: a.date });
    }
    // decoys: an old duplicate with no invoices named like one of ours (name evidence), and a QuickBooks-only customer
    const oursWithCo = inp.ours.filter((c) => (c.company || "").trim());
    const decoyNamed = oursWithCo.slice(0, 5).map((c) => ({ Id: String(++id), DisplayName: `${c.company}`.toUpperCase() + " LLC", CompanyName: `${c.company}`, Active: false } as QboCustomerLite));
    // a trap: a QuickBooks customer named exactly like customer A whose invoices are customer B's: invoices must win
    const pids = [...pidLocal.entries()].filter(([, s]) => s.size === 1);
    const [trapPid] = pids[pids.length - 1] || [];
    const trapLocalB = trapPid ? [...pidLocal.get(trapPid)!][0] : "";
    const localA = inp.ours.find((c) => c.id !== trapLocalB && (c.company || "").trim());
    if (trapPid && localA) { const q = qboCustomers.find((x) => x.Id === qboOf.get(trapPid))!; q.DisplayName = String(localA.company); q.CompanyName = String(localA.company); }
    const others: QboCustomerLite[] = [{ Id: String(++id), DisplayName: "Walk-in Cash Sales", Active: true }, { Id: String(++id), DisplayName: "Zzz Old Vendor Refund", Active: false }];
    const orders: OrderRef[] = inp.archived.map((a) => ({ number: a.visual_id, customer_id: a.customer_id, total: a.total }));
    const t0 = Date.now();
    const res = proposeMatches({ qboCustomers: [...qboCustomers, ...decoyNamed, ...others], qboInvoices, ours: inp.ours, orders });
    const ms = Date.now() - t0;
    const byQ = new Map(res.proposals.map((p) => [p.qboId, p]));
    let total = 0, right = 0, highWrong = 0, high = 0, renamedTotal = 0, renamedRight = 0;
    const wrong: unknown[] = [];
    const oursById = new Map(inp.ours.map((c) => [c.id, c]));
    const invoicedPids = new Set(qboInvoices.map((i) => [...qboOf.entries()].find(([, q]) => q === i.CustomerRef?.value)?.[0]));
    const qToPid = new Map([...qboOf.entries()].map(([p, q]) => [q, p]));
    const hasInv = new Set(qboInvoices.map((i) => i.CustomerRef?.value));
    for (const q of qboCustomers) {
      const pid = qToPid.get(q.Id)!;
      const locals = pidLocal.get(pid)!;
      if (locals.size !== 1 || !hasInv.has(q.Id)) continue; // a Printavo customer split across two of ours: no single right answer
      const want = [...locals][0];
      total++;
      const p = byQ.get(q.Id);
      const good = p?.localId === want;
      if (good) right++; else if (wrong.length < 8) wrong.push({ qbo: q.DisplayName, want: oursById.get(want)?.company || want, got: p?.localName || null, how: p?.method, conf: p?.confidence });
      if (p && p.confidence >= HIGH_CONFIDENCE) { high++; if (!good) highWrong++; }
      const ourName = (oursById.get(want)?.company || oursById.get(want)?.name || "").toLowerCase().trim();
      if (ourName && ourName !== (pidName.get(pid) || "").toLowerCase().trim()) { renamedTotal++; if (good) renamedRight++; }
    }
    void invoicedPids;
    samples.match = { qboCustomers: qboCustomers.length + decoyNamed.length + others.length, qboInvoices: qboInvoices.length, ourCustomers: inp.ours.length, ms, stats: res.stats, wrong };
    ok(`match: QuickBooks customers with invoices resolved to the right customer of ours`, total > 0 && right / total >= 0.98, `${right} of ${total} (${(100 * right / Math.max(1, total)).toFixed(1)}%)`);
    ok(`match: no wrong answer marked high confidence`, highWrong === 0, `${high} high-confidence proposals, ${highWrong} wrong`);
    ok(`match: customers renamed here since Printavo still resolve (by invoices, not names)`, renamedTotal === 0 || renamedRight / renamedTotal >= 0.98, `${renamedRight} of ${renamedTotal}`);
    if (trapPid && localA) { const p = byQ.get(qboOf.get(trapPid)!); ok("match: a QuickBooks name that's another customer's goes by its invoices", p?.localId === trapLocalB && p.method === "invoices", `named "${localA.company}", invoices are ${oursById.get(trapLocalB)?.company}; got ${p?.localName} by ${p?.method}`); }
    const dn = decoyNamed.map((d) => byQ.get(d.Id)).filter(Boolean);
    ok("match: an old QuickBooks duplicate with no invoices is proposed by name, below high confidence", dn.length >= 1 && dn.every((p) => p!.method === "name" && p!.confidence < HIGH_CONFIDENCE), `${dn.length} of ${decoyNamed.length}`);
    ok("match: QuickBooks-only customers stay unmatched", others.every((o) => !byQ.has(o.Id)));
    // merged here (several Printavo customers -> one of ours): all proposed to it, exactly one primary, the latest invoice
    const merged = [...new Set(inp.archived.map((a) => a.customer_id))].filter((cid) => [...pidLocal.entries()].filter(([, s]) => s.has(cid) && s.size === 1).length > 1);
    let mergedOk = 0;
    const mergedSample: unknown[] = [];
    for (const cid of merged) {
      const qs = [...pidLocal.entries()].filter(([, s]) => s.has(cid) && s.size === 1).map(([p]) => qboOf.get(p)!).filter((q) => hasInv.has(q));
      const props = qs.map((q) => byQ.get(q)).filter((p) => p?.localId === cid);
      const prim = props.filter((p) => p!.isPrimary);
      const latest = qs.map((q) => ({ q, d: qboInvoices.filter((i) => i.CustomerRef?.value === q).reduce((m, i) => (i.TxnDate! > m ? i.TxnDate! : m), "") })).sort((a, b) => b.d.localeCompare(a.d))[0];
      const good = qs.length > 1 && props.length === qs.length && prim.length === 1 && prim[0]!.qboId === latest.q;
      if (good) mergedOk++;
      if (mergedSample.length < 5) mergedSample.push({ ours: oursById.get(cid)?.company || oursById.get(cid)?.name, qbo: props.map((p) => `${p!.qboName}${p!.isPrimary ? " (primary)" : ""} last ${p!.lastInvoiceDate}`) });
    }
    samples.merged = mergedSample;
    if (merged.length) ok("match: merged customers get all their QuickBooks customers, one primary (latest invoice)", mergedOk === merged.filter((cid) => [...pidLocal.entries()].filter(([, s]) => s.has(cid) && s.size === 1).map(([p]) => qboOf.get(p)!).filter((q) => hasInv.has(q)).length > 1).length, `${mergedOk} of ${merged.length} merged customers`);

    /* ---- the rename story, on a real merged / renamed customer ---- */
    const pick = res.proposals.find((p) => p.isPrimary && p.method === "invoices" && (oursById.get(p.localId)?.company || "").toLowerCase() !== p.qboName.toLowerCase()) || res.proposals.find((p) => p.isPrimary);
    if (pick) {
      const ours = inp.customers.find((c) => c.id === pick.localId) || ({ id: pick.localId, company: oursById.get(pick.localId)?.company, name: oursById.get(pick.localId)?.name } as OurCustomer);
      const qboRec = { Id: pick.qboId, SyncToken: "3", DisplayName: pick.qboName, CompanyName: pick.qboName } as Record<string, unknown> & { Id: string; SyncToken: string };
      const d1 = customerDiff(ours, qboRec, null, QS);
      ok("rename: linked by Id, our current name is sent to that same QuickBooks customer", d1.conflicts.length === 0 && (!d1.rename || (d1.body?.DisplayName === displayNameOf(ours))), `QuickBooks #${pick.qboId} "${pick.qboName}" → "${displayNameOf(ours)}" (changes: ${d1.change.join(", ") || "none"})`);
      const after = { ...qboRec, ...(d1.body || {}), SyncToken: "4" };
      const sent = ownedFromQbo(after);
      const renamed = { ...ours, company: `${ours.company || ours.name} Renamed` };
      const d2 = customerDiff(renamed, after, sent, QS);
      ok("rename: renamed here later → the same QuickBooks customer (same Id) is renamed", d2.change.includes("DisplayName") && !d2.conflicts.length && d2.body?.DisplayName === displayNameOf(renamed), JSON.stringify(d2.body));
      const theirs = { ...after, DisplayName: "Renamed By The Accountant" };
      const d3 = customerDiff(ours, theirs, sent, QS);
      ok("rename: renamed in QuickBooks → flagged for the owner, not overwritten", d3.conflicts.some((c) => c.field === "DisplayName") && !d3.change.includes("DisplayName"), JSON.stringify(d3.conflicts));
      const d4 = customerDiff(ours, theirs, sent, QS, ["DisplayName"]);
      ok("rename: after 'Keep QuickBooks', the name is left alone for good", !d4.conflicts.length && !d4.change.includes("DisplayName"));
      const d5 = customerDiff(ours, theirs, sent, QS, [], ["DisplayName"]);
      ok("rename: after 'Ours wins', our name is sent", d5.change.includes("DisplayName") && d5.body?.DisplayName === displayNameOf(ours));
      const blank = customerDiff({ ...ours, email: "", phone: "" }, { ...after, PrimaryEmailAddr: { Address: "ap@theirs.com" }, PrimaryPhone: { FreeFormNumber: "555" } }, sent, QS);
      ok("customer: a field we have blank never blanks QuickBooks", !blank.change.includes("PrimaryEmailAddr") && !blank.change.includes("PrimaryPhone"));
      samples.rename = { qboId: pick.qboId, printavoName: pick.qboName, ourName: displayNameOf(ours), firstPush: d1.body, evidence: pick.evidence };
      samples.customerCreate = customerCreateBody(ours, QS);
    }
  }
  return { checks, samples };
}
