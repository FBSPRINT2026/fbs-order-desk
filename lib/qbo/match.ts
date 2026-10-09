import { cleanEmail, phoneDigits } from "@/lib/qbo/map";

/**
 * Matching our customers to the customers Printavo made in QuickBooks. Pure (no database, no network): the server
 * gathers both sides and calls proposeMatches(); the owner reviews the proposals before anything is linked.
 *
 * Why not by name: our customers came over from Printavo and were merged ("one company = one customer") and cleaned
 * up, so names no longer agree with QuickBooks. Evidence, strongest first:
 *   1. invoices: a QuickBooks invoice's number is the Printavo invoice number of one of our archived orders, so the
 *      QuickBooks customer on it is that order's customer (votes, checked against the totals);
 *   2. email (ours, our contacts', and the emails on the Printavo customers merged into ours);
 *   3. company / person name, normalized ("Inc", "LLC", punctuation, case), including the Printavo-era names;
 *   4. phone.
 * Once linked, everything goes by QuickBooks' Id, which never changes when either side renames.
 */

export type QboCustomerLite = {
  Id: string; DisplayName?: string; CompanyName?: string; GivenName?: string; FamilyName?: string; FullyQualifiedName?: string;
  PrimaryEmailAddr?: { Address?: string }; PrimaryPhone?: { FreeFormNumber?: string }; Mobile?: { FreeFormNumber?: string };
  Active?: boolean; Job?: boolean; ParentRef?: { value?: string }; SyncToken?: string;
};
export type QboInvoiceLite = { Id: string; DocNumber?: string; CustomerRef?: { value?: string; name?: string }; TotalAmt?: number; Balance?: number; TxnDate?: string };
export type OurCustomerLite = {
  id: string; company?: string | null; name?: string | null; email?: string | null; phone?: string | null;
  /** contacts' and Printavo customers' emails / names / phones, merged into this customer */
  emails?: string[]; names?: string[]; phones?: string[]; is_test?: boolean | null;
};
/** an order number → our customer: archived Printavo orders (visual id) and our own orders (number, Printavo number) */
export type OrderRef = { number: string; customer_id: string; total?: number | null };

export type Proposal = {
  qboId: string; qboName: string; qboActive: boolean; localId: string; localName: string;
  method: "invoices" | "email" | "name" | "phone"; confidence: number; isPrimary: boolean; lastInvoiceDate: string | null;
  evidence: { invoices?: number; totalsMatched?: number; ofInvoices?: number; sample?: string[]; split?: { localId: string; invoices: number }[]; email?: string; name?: string; phone?: string; ambiguous?: string[] };
};
export type MatchResult = {
  proposals: Proposal[];
  unmatchedQbo: { qboId: string; qboName: string; active: boolean; invoices: number; lastInvoiceDate: string | null }[];
  stats: { qboCustomers: number; qboInvoices: number; invoicesOnFile: number; proposals: number; high: number; localsMatched: number };
};

const SUFFIX = /\b(inc|incorporated|llc|l\s*l\s*c|ltd|co|corp|corporation|company|pllc|lp|llp|the)\b/g;
/** "The Shag Carpet, LLC." → "shag carpet" */
export function normName(v: unknown): string {
  return String(v || "").toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}
const allEmails = (v: unknown) => String(v || "").split(/[,;\s]+/).map(cleanEmail).filter(Boolean);

export const HIGH_CONFIDENCE = 0.9;

export function proposeMatches(inp: {
  qboCustomers: QboCustomerLite[]; qboInvoices: QboInvoiceLite[]; ours: OurCustomerLite[]; orders: OrderRef[];
  /** QuickBooks customers already linked (they're left as they are) */ linkedQbo?: Set<string>;
}): MatchResult {
  const ours = inp.ours.filter((c) => !c.is_test);
  const byId = new Map(ours.map((c) => [c.id, c]));
  const label = (c?: OurCustomerLite) => (c ? (c.company || c.name || c.email || c.id) as string : "");
  const orderBy = new Map<string, OrderRef>();
  for (const o of inp.orders) if (o.number && byId.has(o.customer_id) && !orderBy.has(String(o.number).trim())) orderBy.set(String(o.number).trim(), o);

  // 1. votes from invoices
  const votes = new Map<string, Map<string, { n: number; totals: number; sample: string[] }>>();
  const invCount = new Map<string, number>(), lastDate = new Map<string, string>();
  let onFile = 0;
  for (const inv of inp.qboInvoices) {
    const q = inv.CustomerRef?.value; if (!q) continue;
    invCount.set(q, (invCount.get(q) || 0) + 1);
    if (inv.TxnDate && (!lastDate.get(q) || inv.TxnDate > lastDate.get(q)!)) lastDate.set(q, inv.TxnDate);
    const o = orderBy.get(String(inv.DocNumber || "").trim()); if (!o) continue;
    onFile++;
    const m = votes.get(q) || new Map(); votes.set(q, m);
    const v = m.get(o.customer_id) || { n: 0, totals: 0, sample: [] }; m.set(o.customer_id, v);
    v.n++;
    if (o.total != null && Math.abs(+o.total - +(inv.TotalAmt || 0)) < 0.011) v.totals++;
    if (v.sample.length < 5) v.sample.push(`#${inv.DocNumber}`);
  }

  // indexes for the weaker evidence
  const idx = (pairs: [string, string][]) => { const m = new Map<string, Set<string>>(); for (const [k, id] of pairs) if (k) { const s = m.get(k) || new Set(); s.add(id); m.set(k, s); } return m; };
  const emailIx = idx(ours.flatMap((c) => [...allEmails(c.email), ...(c.emails || []).flatMap(allEmails)].map((e) => [e, c.id] as [string, string])));
  const companyIx = idx(ours.flatMap((c) => [c.company, ...(c.names || [])].map((n) => [normName(n), c.id] as [string, string])));
  const personIx = idx(ours.map((c) => [normName(c.name), c.id] as [string, string]));
  const phoneIx = idx(ours.flatMap((c) => [c.phone, ...(c.phones || [])].map((p) => [phoneDigits(p), c.id] as [string, string]).filter(([p]) => p.length === 10)));

  const proposals: Proposal[] = [], unmatched: MatchResult["unmatchedQbo"] = [];
  for (const q of inp.qboCustomers) {
    if (inp.linkedQbo?.has(q.Id)) continue;
    const base = { qboId: q.Id, qboName: q.DisplayName || q.FullyQualifiedName || q.CompanyName || q.Id, qboActive: q.Active !== false, isPrimary: false, lastInvoiceDate: lastDate.get(q.Id) || null };
    const vm = votes.get(q.Id);
    if (vm && vm.size) {
      const ranked = [...vm.entries()].sort((a, b) => b[1].n - a[1].n);
      const [localId, top] = ranked[0];
      const all = ranked.reduce((a, [, v]) => a + v.n, 0);
      const share = top.n / all;
      // one shared invoice number is strong; three or more with the totals agreeing is as sure as it gets
      let conf = 0.84 + 0.05 * Math.min(top.n, 3) + (top.totals / top.n >= 0.8 ? 0.03 : 0);
      if (share < 1) conf = Math.min(conf, 0.5 + 0.4 * share);
      proposals.push({ ...base, localId, localName: label(byId.get(localId)), method: "invoices", confidence: round2(Math.min(conf, 0.99)),
        evidence: { invoices: top.n, totalsMatched: top.totals, ofInvoices: invCount.get(q.Id) || 0, sample: top.sample, ...(ranked.length > 1 ? { split: ranked.map(([id, v]) => ({ localId: id, invoices: v.n })) } : {}) } });
      continue;
    }
    const pick = (hits: Set<string> | undefined) => (hits ? [...hits] : []);
    const emails = allEmails(q.PrimaryEmailAddr?.Address);
    const eHits = [...new Set(emails.flatMap((e) => pick(emailIx.get(e))))];
    if (eHits.length) {
      proposals.push({ ...base, localId: eHits[0], localName: label(byId.get(eHits[0])), method: "email", confidence: eHits.length === 1 ? 0.85 : 0.45, evidence: { email: emails.join(", "), ...(eHits.length > 1 ? { ambiguous: eHits.map((id) => label(byId.get(id))) } : {}) } });
      continue;
    }
    const cn = [normName(q.CompanyName), normName(q.DisplayName), normName(q.FullyQualifiedName)].filter(Boolean);
    const nHits = [...new Set(cn.flatMap((n) => pick(companyIx.get(n))))];
    const person = normName([q.GivenName, q.FamilyName].filter(Boolean).join(" "));
    const pHits = nHits.length ? [] : [...new Set([...cn, person].filter(Boolean).flatMap((n) => pick(personIx.get(n))))];
    const hits = nHits.length ? nHits : pHits;
    if (hits.length) {
      proposals.push({ ...base, localId: hits[0], localName: label(byId.get(hits[0])), method: "name", confidence: hits.length === 1 ? (nHits.length ? 0.75 : 0.6) : 0.35, evidence: { name: q.DisplayName || q.CompanyName || person, ...(hits.length > 1 ? { ambiguous: hits.map((id) => label(byId.get(id))) } : {}) } });
      continue;
    }
    const ph = [phoneDigits(q.PrimaryPhone?.FreeFormNumber), phoneDigits(q.Mobile?.FreeFormNumber)].filter((p) => p.length === 10);
    const phHits = [...new Set(ph.flatMap((p) => pick(phoneIx.get(p))))];
    if (phHits.length) {
      proposals.push({ ...base, localId: phHits[0], localName: label(byId.get(phHits[0])), method: "phone", confidence: phHits.length === 1 ? 0.6 : 0.3, evidence: { phone: ph.join(", "), ...(phHits.length > 1 ? { ambiguous: phHits.map((id) => label(byId.get(id))) } : {}) } });
      continue;
    }
    unmatched.push({ qboId: q.Id, qboName: base.qboName, active: base.qboActive, invoices: invCount.get(q.Id) || 0, lastInvoiceDate: base.lastInvoiceDate });
  }

  // several QuickBooks customers on one of ours (merged Printavo customers): the one with the latest invoice is primary
  const byLocal = new Map<string, Proposal[]>();
  for (const p of proposals) { const a = byLocal.get(p.localId) || []; a.push(p); byLocal.set(p.localId, a); }
  for (const list of byLocal.values()) {
    list.sort((a, b) => (b.lastInvoiceDate || "").localeCompare(a.lastInvoiceDate || "") || (b.evidence.invoices || 0) - (a.evidence.invoices || 0) || Number(b.qboActive) - Number(a.qboActive) || b.confidence - a.confidence);
    list[0].isPrimary = true;
  }
  proposals.sort((a, b) => a.localName.localeCompare(b.localName) || Number(b.isPrimary) - Number(a.isPrimary));
  return {
    proposals, unmatchedQbo: unmatched,
    stats: { qboCustomers: inp.qboCustomers.length, qboInvoices: inp.qboInvoices.length, invoicesOnFile: onFile, proposals: proposals.length, high: proposals.filter((p) => p.confidence >= HIGH_CONFIDENCE).length, localsMatched: byLocal.size },
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
