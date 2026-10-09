import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Qbo, QboError } from "@/lib/qbo/client";
import { matchPayment, ownedFromOurs, type OurCustomer, type OurPayment } from "@/lib/qbo/map";
import { HIGH_CONFIDENCE, proposeMatches, type OrderRef, type OurCustomerLite, type QboCustomerLite, type QboInvoiceLite } from "@/lib/qbo/match";
import { loadQboSettings } from "@/lib/qbo/runner";

/**
 * Customer matching, run by the owner after connecting (and again whenever wanted): reads every QuickBooks customer
 * and invoice, gathers ours (with the Printavo customers merged into each and the archived Printavo orders), and
 * saves proposals for review. Nothing is linked until the owner confirms.
 */

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const PAGE = 1000;

async function all<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if ((data || []).length < PAGE) break;
  }
  return out;
}

/** Ours, with everything known about each: contacts and the Printavo customers merged into it (names, emails, phones). */
export async function ourCustomersForMatching(admin: SupabaseClient): Promise<OurCustomerLite[]> {
  const [cs, contacts, pcs] = await Promise.all([
    all<Record<string, unknown>>((a, b) => admin.from("customers").select("id, company, name, email, phone, contact2_name, contact2_email, contact2_phone, is_test").order("id").range(a, b)),
    all<Record<string, unknown>>((a, b) => admin.from("customer_contacts").select("customer_id, name, email, phone").order("id").range(a, b)),
    all<Record<string, unknown>>((a, b) => admin.from("printavo_customers").select("customer_id, data").order("printavo_id").range(a, b)),
  ]);
  const extra = new Map<string, { emails: string[]; names: string[]; phones: string[] }>();
  const get = (id: string) => { let x = extra.get(id); if (!x) { x = { emails: [], names: [], phones: [] }; extra.set(id, x); } return x; };
  for (const c of contacts) { const x = get(String(c.customer_id)); if (c.email) x.emails.push(String(c.email)); if (c.phone) x.phones.push(String(c.phone)); }
  for (const p of pcs) {
    if (!p.customer_id) continue;
    const x = get(String(p.customer_id)), d = (p.data || {}) as Record<string, unknown>;
    if (d.companyName) x.names.push(String(d.companyName));
    const people = [d.primaryContact, ...((d.contacts as unknown[]) || []), ...((d.extraContacts as unknown[]) || [])].filter(Boolean) as { email?: string; phone?: string; fullName?: string }[];
    for (const c of people) { if (c.email) x.emails.push(c.email); if (c.phone) x.phones.push(c.phone); if (c.fullName && !d.companyName) x.names.push(c.fullName); }
  }
  return cs.map((c) => {
    const x = extra.get(String(c.id)) || { emails: [], names: [], phones: [] };
    return {
      id: String(c.id), company: c.company as string, name: c.name as string, email: c.email as string, phone: c.phone as string, is_test: !!c.is_test,
      emails: [...x.emails, String(c.contact2_email || "")].filter(Boolean), names: x.names, phones: [...x.phones, String(c.contact2_phone || "")].filter(Boolean),
    };
  });
}

/** Invoice numbers we know the customer of: archived Printavo orders, and ours (number and the Printavo number). */
export async function orderRefsForMatching(admin: SupabaseClient): Promise<OrderRef[]> {
  const [arch, ours] = await Promise.all([
    all<Record<string, unknown>>((a, b) => admin.from("archived_orders").select("visual_id, customer_id, total").eq("kind", "invoice").order("id").range(a, b)),
    all<Record<string, unknown>>((a, b) => admin.from("orders").select("number, printavo_visual_id, customer_id, total").not("customer_id", "is", null).order("id").range(a, b)),
  ]);
  const out: OrderRef[] = [];
  for (const a of arch) if (a.visual_id && a.customer_id) out.push({ number: String(a.visual_id), customer_id: String(a.customer_id), total: a.total == null ? null : +(a.total as number) });
  for (const o of ours) {
    out.push({ number: String(o.number), customer_id: String(o.customer_id), total: null });
    if (o.printavo_visual_id && String(o.printavo_visual_id) !== String(o.number)) out.push({ number: String(o.printavo_visual_id), customer_id: String(o.customer_id), total: null });
  }
  return out;
}

/** A QuickBooks query with only some fields; QuickBooks answers with all of them when it won't take the list. */
async function slim<T>(qbo: Qbo, entity: string, fields: string, where = ""): Promise<T[]> {
  try { return await qbo.query<T>(entity, where, 200000, fields); }
  catch (e) { if (e instanceof QboError && e.validation) return qbo.query<T>(entity, where); throw e; }
}

export async function runMatching(admin: SupabaseClient, by: string) {
  const qbo = new Qbo(admin, { entity: "match" });
  const realm = await qbo.realm();
  const qboCustomers = await slim<QboCustomerLite>(qbo, "Customer", "Id, SyncToken, DisplayName, CompanyName, GivenName, FamilyName, FullyQualifiedName, PrimaryEmailAddr, PrimaryPhone, Mobile, Active, Job, ParentRef", "WHERE Active IN (true, false)");
  const qboInvoices = await slim<QboInvoiceLite>(qbo, "Invoice", "Id, DocNumber, CustomerRef, TotalAmt, Balance, TxnDate");
  const [ours, orders, linkRows] = await Promise.all([
    ourCustomersForMatching(admin), orderRefsForMatching(admin),
    all<Record<string, unknown>>((a, b) => admin.from("qbo_links").select("qbo_id").eq("realm_id", realm).eq("entity", "customer").order("id").range(a, b)),
  ]);
  const res = proposeMatches({ qboCustomers, qboInvoices, ours, orders, linkedQbo: new Set(linkRows.map((l) => String(l.qbo_id))) });
  const runAt = new Date().toISOString();
  await admin.from("qbo_match_proposals").update({ status: "stale" }).eq("realm_id", realm).in("status", ["proposed", "unmatched"]);
  const rows = [
    ...res.proposals.map((p) => ({ run_at: runAt, realm_id: realm, qbo_id: p.qboId, qbo_name: p.qboName, qbo_active: p.qboActive, local_id: p.localId, local_name: p.localName, method: p.method, confidence: p.confidence, evidence: p.evidence, is_primary: p.isPrimary, last_invoice_date: p.lastInvoiceDate, status: "proposed" })),
    ...res.unmatchedQbo.map((u) => ({ run_at: runAt, realm_id: realm, qbo_id: u.qboId, qbo_name: u.qboName, qbo_active: u.active, local_id: null, local_name: "", method: "", confidence: 0, evidence: { invoices: u.invoices }, is_primary: false, last_invoice_date: u.lastInvoiceDate, status: "unmatched" })),
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("qbo_match_proposals").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Couldn't save the proposals: ${error.message}`);
  }
  await admin.from("qbo_settings").update({ matched_at: runAt, updated_by: by }).eq("id", 1);
  return { runAt, stats: res.stats, unmatched: res.unmatchedQbo.length };
}

/** Link the confirmed proposals (by id, or every proposal at or above `minConfidence`). One primary per customer. */
export async function confirmProposals(admin: SupabaseClient, by: string, sel: { ids?: number[]; minConfidence?: number }) {
  const qs = await loadQboSettings(admin);
  let q = admin.from("qbo_match_proposals").select("*").eq("status", "proposed").eq("realm_id", qs.realm_id);
  q = sel.ids?.length ? q.in("id", sel.ids) : q.gte("confidence", sel.minConfidence ?? HIGH_CONFIDENCE);
  const { data } = await q.limit(5000);
  const props = (data || []) as { id: number; qbo_id: string; local_id: string; method: string; confidence: number; is_primary: boolean; qbo_name: string }[];
  let linked = 0;
  const skipped: string[] = [];
  const locals = new Set<string>();
  // our side's baseline: our values right now. Only what changes here after linking is sent; the accountant's
  // QuickBooks data isn't overwritten by our clean-up (the owner can opt in under Differences)
  const ids = [...new Set(props.map((p) => p.local_id))];
  const ourNow = new Map<string, OurCustomer>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: cs } = await admin.from("customers").select("id, company, name, email, phone, address, ship_address, tax_exempt, payment_terms").in("id", ids.slice(i, i + 300));
    for (const c of (cs || []) as OurCustomer[]) ourNow.set(c.id, c);
  }
  for (const p of props) {
    const { data: ex } = await admin.from("qbo_links").select("id, local_id").eq("realm_id", qs.realm_id).eq("entity", "customer").eq("qbo_id", p.qbo_id).maybeSingle();
    if (ex && ex.local_id !== p.local_id) { skipped.push(`${p.qbo_name} is already linked to another customer`); continue; }
    if (!ex) {
      const c = ourNow.get(p.local_id);
      const { error } = await admin.from("qbo_links").insert({ realm_id: qs.realm_id, entity: "customer", local_id: p.local_id, qbo_id: p.qbo_id, source: `matched_${p.method === "invoices" ? "invoice" : p.method}`, confidence: p.confidence, is_primary: false, created_by: by, ours_base: c ? ownedFromOurs(c, qs) : null });
      if (error) { skipped.push(`${p.qbo_name}: ${error.message}`); continue; }
    }
    linked++;
    locals.add(p.local_id);
    await admin.from("qbo_match_proposals").update({ status: "confirmed", decided_by: by, decided_at: new Date().toISOString() }).eq("id", p.id);
  }
  // primaries: a customer that has none gets the proposed primary (the QuickBooks customer with the latest invoice)
  for (const local of locals) {
    const { data: links } = await admin.from("qbo_links").select("id, qbo_id, is_primary").eq("realm_id", qs.realm_id).eq("entity", "customer").eq("local_id", local);
    if ((links || []).some((l) => l.is_primary)) continue;
    const want = props.find((p) => p.local_id === local && p.is_primary) || props.find((p) => p.local_id === local);
    const l = (links || []).find((x) => x.qbo_id === want?.qbo_id) || (links || [])[0];
    if (l) await admin.from("qbo_links").update({ is_primary: true, updated_at: new Date().toISOString() }).eq("id", l.id);
  }
  return { linked, skipped };
}

/** Make another linked QuickBooks customer the primary one (new invoices go to it). */
export async function setPrimary(admin: SupabaseClient, linkId: number) {
  const { data: l } = await admin.from("qbo_links").select("*").eq("id", linkId).maybeSingle();
  if (!l) throw new Error("Link not found.");
  await admin.from("qbo_links").update({ is_primary: false }).eq("realm_id", l.realm_id).eq("entity", l.entity).eq("local_id", l.local_id);
  const { error } = await admin.from("qbo_links").update({ is_primary: true, updated_at: new Date().toISOString() }).eq("id", linkId);
  if (error) throw new Error(error.message);
}

/**
 * Adopt what Printavo already put in QuickBooks: our orders from #adopt_from_number up are linked to the QuickBooks
 * invoice with the same number (or the Printavo number), and their payments to the QuickBooks payments already on
 * those invoices (same amount within 3 days), so nothing Printavo sent is made twice.
 */
export async function adoptExisting(admin: SupabaseClient) {
  const qs = await loadQboSettings(admin);
  const qbo = new Qbo(admin, { entity: "adopt" });
  const realm = await qbo.realm();
  const orders = await all<Record<string, unknown>>((a, b) => admin.from("orders").select("id, number, printavo_visual_id, customer_id").gte("number", qs.adopt_from_number).order("number").range(a, b));
  const { data: haveInv } = await admin.from("qbo_links").select("local_id, qbo_id").eq("realm_id", realm).eq("entity", "invoice").limit(100000);
  const linked = new Map<string, string>((haveInv || []).map((l: Record<string, unknown>) => [String(l.local_id), String(l.qbo_id)] as [string, string]));
  const want = new Map<string, Record<string, unknown>>();
  for (const o of orders) if (!linked.has(String(o.id))) { want.set(String(o.number), o); if (o.printavo_visual_id) want.set(String(o.printavo_visual_id), o); }
  let invoices = 0, payments = 0;
  const nums = [...want.keys()];
  type Inv = { Id: string; DocNumber?: string; SyncToken: string; TotalAmt?: number; CustomerRef?: { value: string }; LinkedTxn?: { TxnId: string; TxnType: string }[] };
  for (let i = 0; i < nums.length; i += 50) {
    const found = await qbo.query<Inv>("Invoice", `WHERE DocNumber IN (${nums.slice(i, i + 50).map((n) => `'${esc(n)}'`).join(", ")})`);
    for (const inv of found) {
      const o = want.get(String(inv.DocNumber || "")); if (!o || linked.has(String(o.id))) continue;
      const { error } = await admin.from("qbo_links").insert({ realm_id: realm, entity: "invoice", local_id: String(o.id), qbo_id: inv.Id, source: "adopted_docnumber", is_primary: true, sync_token: inv.SyncToken, last_seen_qbo: inv, last_seen_at: new Date().toISOString(), created_by: "adopt" });
      if (!error) { invoices++; linked.set(String(o.id), inv.Id); }
    }
  }
  // payments already on those invoices
  const ids = [...linked.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: pays } = await admin.from("payments").select("*").in("order_id", ids.slice(i, i + 100));
    if (!pays?.length) continue;
    const { data: payLinks } = await admin.from("qbo_links").select("local_id, qbo_id").eq("realm_id", realm).eq("entity", "payment").in("local_id", pays.map((p) => String(p.id)));
    const done = new Set<string>((payLinks || []).map((l: Record<string, unknown>) => String(l.local_id)));
    const taken = new Set<string>((payLinks || []).map((l: Record<string, unknown>) => String(l.qbo_id)));
    const byOrder = new Map<string, OurPayment[]>();
    for (const p of pays as OurPayment[]) if (!done.has(p.id)) byOrder.set(p.order_id, [...(byOrder.get(p.order_id) || []), p]);
    for (const [orderId, list] of byOrder) {
      const inv = await qbo.read<Inv>("Invoice", linked.get(orderId)!);
      const pids = (inv?.LinkedTxn || []).filter((t) => t.TxnType === "Payment").map((t) => t.TxnId);
      if (!pids.length) continue;
      const cands = await qbo.query<{ Id: string; TotalAmt?: number; TxnDate?: string; SyncToken: string }>("Payment", `WHERE Id IN (${pids.map((x) => `'${esc(x)}'`).join(", ")})`);
      for (const p of list) {
        const m = matchPayment(p, cands, taken);
        if (!m) continue;
        const { error } = await admin.from("qbo_links").insert({ realm_id: realm, entity: "payment", local_id: p.id, qbo_id: m.Id, source: "matched_payment", is_primary: true, sync_token: m.SyncToken, last_seen_qbo: m, last_seen_at: new Date().toISOString(), created_by: "adopt" });
        if (!error) { payments++; taken.add(m.Id); }
      }
    }
  }
  return { invoices, payments, looked: nums.length };
}
