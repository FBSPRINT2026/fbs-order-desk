import "server-only";
import type { PvAddress, PvFile, PvGroup, PvLine, PvMessage, PvOrder, PvTransaction } from "@/lib/archive";

/**
 * Printavo API v2 (GraphQL). Read-only (see assertReadOnly), with one exception decided on Oct 7, 2026 for the move off
 * Printavo: a 40,000-series order can be sent into Printavo by a staff click (transitionWrite: creates the quote and
 * sets its status, nothing else, never on anything that came from Printavo).
 * Limits: 10 requests per 5 seconds per account. We send at most one every 0.8 seconds and back off when Printavo says slow down.
 */
const PV_URL = "https://www.printavo.com/api/v2";
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PrintavoError extends Error {}
/** Printavo asked us to slow down and kept asking: callers stop and try again later. */
export class PrintavoThrottled extends PrintavoError {}

/**
 * Staying well inside Printavo's limit (10 requests per 5 seconds): one request every 0.8 seconds is 6 per 5 seconds.
 * The background sync is the only thing that runs continuously, and only one copy of it talks to Printavo at a time.
 */
const SPACING_MS = 800;

export function printavoConfigured() {
  return !!(process.env.PRINTAVO_EMAIL?.trim() && process.env.PRINTAVO_TOKEN?.trim());
}

/**
 * READ-ONLY, ALWAYS. Our portal never changes anything in Printavo: every request is checked here and anything that
 * isn't a plain read (a GraphQL "mutation" or "subscription") is refused before it leaves our server.
 */
export function assertReadOnly(query: string) {
  const body = query.replace(/#[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""').trim();
  if (!/^(query\b|\{)/.test(body) || /\b(mutation|subscription)\b/i.test(body))
    throw new PrintavoError("Blocked: the portal only reads from Printavo and never changes anything there.");
}

export async function pv<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  assertReadOnly(query);
  return request<T>(query, variables, true);
}

/** The only Printavo changes the portal makes: what "Send to Printavo" needs for a 40,000-series order. */
const TRANSITION_WRITES = new Set(["quoteCreate", "statusUpdate", "quoteUpdate", "invoiceUpdate"]);
/**
 * Sends one change to Printavo for a 40,000-series order (40,000-49,999: entered here during the move, produced from
 * Printavo until Nov 2). Anything else is refused before it leaves our server. Not retried: a write that may have
 * happened is never sent twice.
 */
export async function transitionWrite<T = Record<string, unknown>>(query: string, variables: Record<string, unknown>, orderNumber: number): Promise<T> {
  if (!(orderNumber >= 40000 && orderNumber < 50000)) throw new PrintavoError("Blocked: only orders #40000-#49999 can be sent to Printavo.");
  const body = query.replace(/#[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""').trim();
  const m = body.match(/^mutation\b[^{]*\{\s*(\w+)\s*[(:{]/);
  const fields = [...body.matchAll(/(?:^|[{\s])(\w+)\s*\(/g)].map((x) => x[1]);
  if (!m || !TRANSITION_WRITES.has(m[1]) || (body.match(/\bmutation\b/g) || []).length !== 1 || /\bsubscription\b/.test(body) || fields.some((f) => /(Create|Update|Delete|Duplicate|Creates|Updates|Deletes)$/.test(f) && !TRANSITION_WRITES.has(f)))
    throw new PrintavoError("Blocked: the portal only creates the quote and sets its status and number in Printavo.");
  // an update may only set the order's number (to match ours), nothing else
  if (/^(quote|invoice)Update$/.test(m[1]) && Object.keys((variables.input || {}) as object).some((k) => k !== "visualId"))
    throw new PrintavoError("Blocked: only the order number can be changed in Printavo.");
  return request<T>(query, variables, false);
}

async function request<T>(query: string, variables: Record<string, unknown>, retry: boolean): Promise<T> {
  const email = process.env.PRINTAVO_EMAIL?.trim(), token = process.env.PRINTAVO_TOKEN?.trim();
  if (!email || !token) throw new PrintavoError("Printavo isn't connected (PRINTAVO_EMAIL / PRINTAVO_TOKEN missing in Vercel).");
  for (let attempt = 0; ; attempt++) {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let r: Response;
    try {
      r = await fetch(PV_URL, { method: "POST", headers: { "Content-Type": "application/json", email, token }, body: JSON.stringify({ query, variables }), cache: "no-store" });
    } catch (e) {
      if (retry && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
      throw new PrintavoError("Couldn't reach Printavo: " + (e instanceof Error ? e.message : String(e)));
    }
    const j = await r.json().catch(() => null) as { data?: T; errors?: { message: string }[] } | null;
    const msg = j?.errors?.map((e) => e.message).join("; ") || "";
    if (r.status === 429 || /rate limit|throttl|too many requests/i.test(msg)) {
      // back off: as long as Printavo says (at least 10 seconds); after 3 tries give up for now
      if (retry && attempt < 3) { const ra = +(r.headers.get("retry-after") || 0); await sleep(Math.max(10000, Math.min(ra * 1000, 60000)) * (attempt + 1)); continue; }
      throw new PrintavoThrottled("Printavo asked us to slow down. The sync pauses for a few minutes and then carries on.");
    }
    if (retry && r.status >= 500 && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
    if (!r.ok && !j?.data) throw new PrintavoError(`Printavo answered HTTP ${r.status}${msg ? ": " + msg : ""}`);
    // a change that partly worked (the quote made, a mockup refused) comes back with its warnings: never sent twice
    if (msg && !retry) { const d = (j?.data || {}) as Record<string, unknown>; if (Object.values(d).every((v) => v == null)) throw new PrintavoError("Printavo: " + msg); return { ...d, __warnings: msg } as T; }
    if (msg && !j?.data) throw new PrintavoError("Printavo: " + msg);
    if (msg) console.warn("[printavo] partial errors:", msg);
    return (j?.data || {}) as T;
  }
}

/* ---------- customers ---------- */

export type PvCustomerHit = { id: string; companyName: string; contact: string; email: string; phone: string; orderCount: number };

/** Search Printavo customers by company, contact name or email. */
export async function searchCustomers(q: string): Promise<PvCustomerHit[]> {
  const d = await pv<{ contacts: { nodes: { fullName: string | null; email: string | null; phone: string | null; customer: { id: string; companyName: string | null; orderCount: number; primaryContact: { fullName: string | null; email: string | null; phone: string | null } | null } | null }[] } }>(
    Q.search, { q });
  const out = new Map<string, PvCustomerHit>();
  for (const c of d.contacts?.nodes || []) {
    if (!c.customer || out.has(c.customer.id)) continue;
    const p = c.customer.primaryContact;
    out.set(c.customer.id, { id: c.customer.id, companyName: c.customer.companyName || "", contact: p?.fullName || c.fullName || "", email: p?.email || c.email || "", phone: p?.phone || c.phone || "", orderCount: c.customer.orderCount || 0 });
  }
  return [...out.values()];
}

const ADDR = "address1 address2 city state zipCode country";
export type PvCustomer = {
  id: string; companyName: string | null; internalNote: string | null; resaleNumber: string | null; salesTax: number | null; taxExempt: boolean; orderCount: number;
  defaultPaymentTerm: { name: string; days: number } | null;
  billingAddress: PvAddress; shippingAddress: PvAddress;
  primaryContact: { id: string; fullName: string | null; email: string | null; phone: string | null } | null;
  contacts: { id: string; fullName: string | null; email: string | null; phone: string | null }[];
};
export async function getCustomer(id: string): Promise<PvCustomer> {
  const d = await pv<{ customer: (Omit<PvCustomer, "contacts"> & { contacts: { nodes: PvCustomer["contacts"] } }) | null }>(
    Q.customer, { id });
  if (!d.customer) throw new PrintavoError("That customer wasn't found in Printavo.");
  return { ...d.customer, contacts: d.customer.contacts?.nodes || [] };
}

/** All of a customer's Printavo invoices and quotes (ids and numbers), oldest first. */
export async function customerOrderIds(id: string): Promise<{ id: string; visualId: string; kind: "invoice" | "quote" }[]> {
  const out: { id: string; visualId: string; kind: "invoice" | "quote" }[] = [];
  let after: string | null = null;
  for (let page = 0; page < 200; page++) {
    const d: { customer: { orders: { nodes: { __typename: string; id: string; visualId: string | null }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null } = await pv(
      Q.orders, { id, after });
    const c = d.customer?.orders;
    if (!c) break;
    for (const n of c.nodes || []) if (n?.id) out.push({ id: n.id, visualId: String(n.visualId || ""), kind: n.__typename === "Quote" ? "quote" : "invoice" });
    if (!c.pageInfo?.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return out.sort((a, b) => (+a.visualId || 0) - (+b.visualId || 0));
}

/* ---------- one order, everything on it ---------- */

const MOCK = "id fullImageUrl thumbnailUrl mimeType";
const TX = "id amount category description transactionDate processing";
const ORDER_FIELDS = `id visualId nickname createdAt startAt dueAt customerDueAt paymentDueAt invoiceAt
  subtotal total totalUntaxed discount discountAmount discountAsPercentage salesTax salesTaxAmount amountPaid amountOutstanding paidInFull totalQuantity
  customerNote productionNote visualPoNumber tags merch url publicUrl publicPdf workorderUrl packingSlipUrl
  status{ name color } contact{ fullName email phone customer{ id companyName } } owner{ name email }
  deliveryMethod{ name } paymentTerm{ name }
  billingAddress{ companyName customerName ${ADDR} } shippingAddress{ companyName customerName ${ADDR} }
  fees(first:50){ nodes{ id description quantity unitPrice unitPriceAsPercentage amount taxable } }
  lineItemGroups(first:50){ nodes{ id position } pageInfo{ hasNextPage endCursor } }
  threadSummary{ id }`;
const EXTRA_FIELDS = `transactions(first:50){ nodes{ __typename ... on Payment{ ${TX} source } ... on Refund{ ${TX} } ... on Void{ ${TX} } ... on Return{ ${TX} } ... on PaymentDispute{ ${TX} status } } }
  productionFiles(first:50){ nodes{ id name fileUrl mimeType } }
  tasks(first:50){ nodes{ id name completed completedAt dueAt assignedTo{ name } } }
  approvalRequests(first:25){ nodes{ id name status requester{ name } retractor{ name } response{ name email reason respondedAt } timestamps{ createdAt updatedAt } } }
  expenses(first:50){ nodes{ id name amount transactionAt } }`;
const GROUP_FIELDS = `id position enabledColumns{ category color itemNumber markupPercentage sizes }
  imprints(first:25){ nodes{ id details typeOfWork{ name } pricingMatrixColumn{ columnName } mockups(first:20){ nodes{ ${MOCK} } } } }`;
const LINE_FIELDS = `id position category{ name } itemNumber color description items price markupPercentage taxed productStatus
  product{ brand } sizes{ size count } personalizations{ name personalization } mockups(first:10){ nodes{ ${MOCK} } }`;

const MSG_EXTRA = "sender{ __typename ... on User{ name } ... on Contact{ fullName } } attachments(first:25){ nodes{ filename url } }";
const typed = (f: string) => `... on Invoice{ ${f} } ... on Quote{ ${f} }`;
/** Every query the importer sends. */
export const Q = {
  search: `query($q:String){ contacts(query:$q, first:25){ nodes{ fullName email phone customer{ id companyName orderCount primaryContact{ fullName email phone } } } } }`,
  customer: `query($id:ID!){ customer(id:$id){ id companyName internalNote resaleNumber salesTax taxExempt orderCount
      defaultPaymentTerm{ name days } billingAddress{ ${ADDR} } shippingAddress{ ${ADDR} }
      primaryContact{ id fullName email phone } contacts(first:25){ nodes{ id fullName email phone } } } }`,
  orders: `query($id:ID!,$after:String){ customer(id:$id){ orders(first:50, after:$after){ nodes{ __typename ... on Invoice{ id visualId } ... on Quote{ id visualId } } pageInfo{ hasNextPage endCursor } } } }`,
  order: `query($id:ID!){ order(id:$id){ __typename ${typed(ORDER_FIELDS)} } }`,
  extra: `query($id:ID!){ order(id:$id){ ${typed(EXTRA_FIELDS)} } }`,
  moreGroups: `query($id:ID!,$after:String){ order(id:$id){ ${typed("lineItemGroups(first:50, after:$after){ nodes{ id position } pageInfo{ hasNextPage endCursor } }")} } }`,
  group: `query($id:ID!){ lineItemGroup(id:$id){ ${GROUP_FIELDS} lineItems(first:100){ nodes{ ${LINE_FIELDS} } pageInfo{ hasNextPage endCursor } } } }`,
  moreLines: `query($id:ID!,$after:String){ lineItemGroup(id:$id){ lineItems(first:100, after:$after){ nodes{ ${LINE_FIELDS} } pageInfo{ hasNextPage endCursor } } } }`,
  thread: `query($id:ID!,$after:String){ thread(id:$id){ messages(first:100, after:$after){ nodes{ __typename
          ... on EmailMessage{ id from to cc bcc subject text incoming status timestamps{ createdAt } ${MSG_EXTRA} }
          ... on TextMessage{ id from to text incoming status timestamps{ createdAt } ${MSG_EXTRA} } } pageInfo{ hasNextPage endCursor } } } }`,
  allCustomers: `query($after:String){ customers(first:25, after:$after){ nodes{ id companyName orderCount primaryContact{ fullName email } } pageInfo{ hasNextPage endCursor } } }`,
  // every order in the account (25 at a time, oldest first) with what changes when an order changes, and just the file links on one order
  list: `query($after:String){ orders(first:25, after:$after){ nodes{ __typename ${typed("id visualId createdAt total amountOutstanding customerDueAt status{ name } timestamps{ updatedAt } contact{ customer{ id companyName } }")} } pageInfo{ hasNextPage endCursor } } }`,
  // the orders with the latest due dates first: that is where the active jobs are
  // one customer's orders, with the same fields as the full list (Printavo's all-orders list stops at 10,000, so the full pass goes customer by customer)
  listByCustomer: `query($id:ID!,$after:String){ customer(id:$id){ orders(first:25, after:$after){ nodes{ __typename ${typed("id visualId createdAt total amountOutstanding customerDueAt status{ name } timestamps{ updatedAt } contact{ customer{ id companyName } }")} } pageInfo{ hasNextPage endCursor } } } }`,
  listActive: `query($after:String){ orders(first:25, after:$after, sortOn:CUSTOMER_DUE_AT, sortDescending:true){ nodes{ __typename ${typed("id visualId createdAt total amountOutstanding customerDueAt status{ name } timestamps{ updatedAt } contact{ customer{ id companyName } }")} } pageInfo{ hasNextPage endCursor } } }`,
  fileList: `query($id:ID!){ order(id:$id){ ${typed("productionFiles(first:50){ nodes{ fileUrl } } lineItemGroups(first:50){ nodes{ id } }")} } }`,
  groupFiles: `query($id:ID!){ lineItemGroup(id:$id){ imprints(first:25){ nodes{ mockups(first:20){ nodes{ fullImageUrl } } } } lineItems(first:100){ nodes{ mockups(first:10){ nodes{ fullImageUrl } } } } } }`,
};

/** One page (25) of every customer in the Printavo account. */
export async function listCustomers(after: string | null): Promise<{ customers: { id: string; companyName: string; contact: string; orderCount: number }[]; next: string | null }> {
  const d = await pv<{ customers: { nodes: Raw[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } | null }>(Q.allCustomers, { after });
  const c = d.customers;
  if (!c) throw new PrintavoError("Printavo didn't return the customer list.");
  return {
    customers: (c.nodes || []).filter((x) => x?.id).map((x) => ({ id: s(x.id), companyName: s(x.companyName), contact: s(x.primaryContact?.fullName || x.primaryContact?.email), orderCount: n(x.orderCount) })),
    next: c.pageInfo?.hasNextPage ? c.pageInfo.endCursor : null,
  };
}

/* ---------- census (sizes only, nothing copied) ---------- */

export type PvListed = { id: string; visualId: string; kind: "invoice" | "quote"; createdAt: string; total: number; customerId: string; company: string; updatedAt: string; fingerprint: string };
/** One page (25, Printavo's most) of every order in the Printavo account. */
export async function listOrders(after: string | null, active = false): Promise<{ orders: PvListed[]; next: string | null; totalNodes: number | null }> {
  const d = await pv<{ orders: { nodes: Raw[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(active ? Q.listActive : Q.list, { after });
  const c = d.orders;
  if (!c) throw new PrintavoError("Printavo didn't return the order list.");
  return listed(c);
}
/** One page (25) of one customer's orders. null = Printavo doesn't know the customer anymore. */
export async function listCustomerOrders(customerId: string, after: string | null): Promise<{ orders: PvListed[]; next: string | null; totalNodes: number | null } | null> {
  const d = await pv<{ customer: { orders: { nodes: Raw[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } | null } | null }>(Q.listByCustomer, { id: customerId, after });
  if (!d.customer) return null;
  return listed(d.customer.orders || { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } });
}
function listed(c: { nodes: Raw[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }): { orders: PvListed[]; next: string | null; totalNodes: number | null } {
  return {
    orders: (c?.nodes || []).filter((o) => o?.id).map((o) => ({
      id: s(o.id), visualId: s(o.visualId), kind: o.__typename === "Quote" ? "quote" : "invoice", createdAt: s(o.createdAt), total: n(o.total),
      customerId: s(o.contact?.customer?.id), company: s(o.contact?.customer?.companyName), updatedAt: s(o.timestamps?.updatedAt),
      // anything here changing means the order changed in Printavo
      // (Printavo writes the same moment in different time zones from one request to the next, so times are compared as instants)
      fingerprint: [instant(o.timestamps?.updatedAt), n(o.total).toFixed(2), n(o.amountOutstanding).toFixed(2), s(o.status?.name), instant(o.customerDueAt), s(o.contact?.customer?.id)].join("|"),
    })),
    next: c?.pageInfo?.hasNextPage ? c.pageInfo.endCursor : null,
    totalNodes: null,
  };
}
/** The full-size file links on one order (mockups on imprints and line items, and production files), no duplicates. */
export async function orderFileLinks(id: string): Promise<string[]> {
  const o = (await pv<{ order: Raw | null }>(Q.fileList, { id })).order;
  if (!o) throw new PrintavoError("Order not found in Printavo.");
  const urls = new Set<string>((o.productionFiles?.nodes || []).map((f: Raw) => s(f.fileUrl)));
  for (const g of o.lineItemGroups?.nodes || []) {
    const lg = (await pv<{ lineItemGroup: Raw | null }>(Q.groupFiles, { id: g.id })).lineItemGroup;
    for (const i of lg?.imprints?.nodes || []) for (const m of i.mockups?.nodes || []) urls.add(s(m.fullImageUrl));
    for (const l of lg?.lineItems?.nodes || []) for (const m of l.mockups?.nodes || []) urls.add(s(m.fullImageUrl));
  }
  return [...urls].filter((u) => /^https?:\/\//.test(u));
}
/** A file's size in bytes without downloading it (HEAD, or a 1-byte ranged GET); null if the server won't say. */
export async function remoteSize(url: string): Promise<number | null> {
  try {
    const h = await fetch(url, { method: "HEAD", cache: "no-store", redirect: "follow" });
    const len = +(h.headers.get("content-length") || 0);
    if (h.ok && len > 0) return len;
  } catch { /* fall through */ }
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store", redirect: "follow" });
    const cr = r.headers.get("content-range"), tot = cr ? +(cr.split("/")[1] || 0) : 0;
    await r.body?.cancel().catch(() => {});
    if (tot > 0) return tot;
    const len = +(r.headers.get("content-length") || 0);
    if (r.status === 200 && len > 1) return len;
  } catch { /* unknown */ }
  return null;
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (x: unknown) => (x == null ? "" : String(x));
const n = (x: unknown) => (typeof x === "number" && isFinite(x) ? x : +s(x) || 0);
const instant = (x: unknown) => { const t = Date.parse(s(x)); return isNaN(t) ? s(x) : new Date(t).toISOString(); };
const file = (m: Raw): PvFile => ({ id: s(m.id), full: s(m.fullImageUrl || m.fileUrl), thumb: s(m.thumbnailUrl), mime: s(m.mimeType), name: m.name ? s(m.name) : undefined });

/** Reads one invoice or quote with everything on it. Parts that fail are listed in `warnings` instead of stopping the import. */
export async function getOrder(id: string): Promise<PvOrder> {
  const warnings: string[] = [];
  const d = await pv<{ order: Raw | null }>(Q.order, { id });
  const o = d.order;
  if (!o) throw new PrintavoError("Order not found in Printavo.");

  let extra: Raw = {};
  try { extra = (await pv<{ order: Raw | null }>(Q.extra, { id })).order || {}; }
  catch (e) {
    if (e instanceof PrintavoThrottled) throw e;
    warnings.push("payments/files/tasks: " + (e instanceof Error ? e.message : String(e)));
    // try the parts one at a time so one bad part doesn't lose the others
    for (const part of EXTRA_FIELDS.split(/\n\s*/)) {
      try { Object.assign(extra, (await pv<{ order: Raw | null }>(`query($id:ID!){ order(id:$id){ ${typed(part)} } }`, { id })).order || {}); }
      catch (e2) { if (e2 instanceof PrintavoThrottled) throw e2; warnings.push(part.split("(")[0] + ": " + (e2 instanceof Error ? e2.message : String(e2))); }
    }
  }

  // line item groups, one at a time (keeps each request small)
  const groupIds: { id: string; position: number }[] = [...(o.lineItemGroups?.nodes || [])];
  let gp = o.lineItemGroups?.pageInfo;
  while (gp?.hasNextPage) {
    const more = await pv<{ order: Raw }>(Q.moreGroups, { id, after: gp.endCursor });
    groupIds.push(...(more.order?.lineItemGroups?.nodes || []));
    gp = more.order?.lineItemGroups?.pageInfo;
  }
  const groups: PvGroup[] = [];
  for (const gid of groupIds) {
    try {
      const g = (await pv<{ lineItemGroup: Raw }>(Q.group, { id: gid.id })).lineItemGroup;
      const lines: Raw[] = [...(g.lineItems?.nodes || [])];
      let lp = g.lineItems?.pageInfo;
      while (lp?.hasNextPage) {
        const more = (await pv<{ lineItemGroup: Raw }>(Q.moreLines, { id: gid.id, after: lp.endCursor })).lineItemGroup;
        lines.push(...(more.lineItems?.nodes || []));
        lp = more.lineItems?.pageInfo;
      }
      const ec = g.enabledColumns;
      groups.push({
        id: s(g.id), position: n(g.position),
        columns: ec ? { category: !!ec.category, color: !!ec.color, itemNumber: !!ec.itemNumber, markup: !!ec.markupPercentage, sizes: (ec.sizes || []).map(s) } : null,
        lines: lines.map((l): PvLine => ({
          id: s(l.id), position: n(l.position), category: s(l.category?.name), itemNumber: s(l.itemNumber), color: s(l.color), description: s(l.description),
          brand: s(l.product?.brand), sizes: Object.fromEntries((l.sizes || []).filter((z: Raw) => n(z.count) > 0).map((z: Raw) => [s(z.size), n(z.count)])),
          items: n(l.items), price: n(l.price), markup: l.markupPercentage == null ? null : n(l.markupPercentage), taxed: !!l.taxed, status: s(l.productStatus),
          personalizations: (l.personalizations || []).map((p: Raw) => ({ name: s(p.name), value: s(p.personalization) })),
          mockups: (l.mockups?.nodes || []).map(file),
        })).sort((a, b) => a.position - b.position),
        imprints: (g.imprints?.nodes || []).map((i: Raw) => ({ id: s(i.id), typeOfWork: s(i.typeOfWork?.name), details: s(i.details), column: s(i.pricingMatrixColumn?.columnName), mockups: (i.mockups?.nodes || []).map(file) })),
      });
    } catch (e) { if (e instanceof PrintavoThrottled) throw e; warnings.push(`line item group ${gid.id}: ` + (e instanceof Error ? e.message : String(e))); }
  }
  groups.sort((a, b) => a.position - b.position);

  // the email / text conversation about this order
  let messages: PvMessage[] = [];
  if (o.threadSummary?.id) {
    try {
      const nodes: Raw[] = [];
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        const t: Raw | null = (await pv<{ thread: Raw }>(Q.thread, { id: o.threadSummary.id, after })).thread;
        nodes.push(...(t?.messages?.nodes || []));
        if (!t?.messages?.pageInfo?.hasNextPage) break;
        after = t.messages.pageInfo.endCursor;
      }
      messages = nodes.filter(Boolean).map((m: Raw): PvMessage => ({
        id: s(m.id), kind: m.__typename === "TextMessage" ? "text" : "email", incoming: !!m.incoming, from: s(m.from), to: s(m.to), cc: s(m.cc), bcc: s(m.bcc),
        subject: s(m.subject), text: s(m.text), at: s(m.timestamps?.createdAt), status: s(m.status),
        sender: s(m.sender?.name || m.sender?.fullName),
        attachments: (m.attachments?.nodes || []).filter((a: Raw) => a?.url).map((a: Raw) => ({ name: s(a.filename), url: s(a.url) })),
      })).sort((a: PvMessage, b: PvMessage) => a.at.localeCompare(b.at));
    } catch (e) { if (e instanceof PrintavoThrottled) throw e; warnings.push("messages: " + (e instanceof Error ? e.message : String(e))); }
  }

  const addr = (a: Raw | null): PvAddress => a ? { companyName: a.companyName ?? null, customerName: a.customerName ?? null, address1: a.address1 ?? null, address2: a.address2 ?? null, city: a.city ?? null, state: a.state ?? null, zipCode: a.zipCode ?? null, country: a.country ?? null } : null;
  return {
    v: 1, kind: o.__typename === "Quote" ? "quote" : "invoice", id: s(o.id), visualId: s(o.visualId), nickname: s(o.nickname),
    status: { name: s(o.status?.name), color: s(o.status?.color) },
    createdAt: s(o.createdAt), startAt: o.startAt || null, dueAt: o.dueAt || null, customerDueAt: o.customerDueAt || null, paymentDueAt: o.paymentDueAt || null, invoiceAt: o.invoiceAt || null,
    customer: { id: s(o.contact?.customer?.id), companyName: s(o.contact?.customer?.companyName) },
    contact: { fullName: s(o.contact?.fullName), email: s(o.contact?.email), phone: s(o.contact?.phone) },
    owner: s(o.owner?.name || o.owner?.email), deliveryMethod: s(o.deliveryMethod?.name), paymentTerm: s(o.paymentTerm?.name), poNumber: s(o.visualPoNumber), tags: (o.tags || []).map(s), merch: !!o.merch,
    billingAddress: addr(o.billingAddress), shippingAddress: addr(o.shippingAddress),
    customerNote: s(o.customerNote), productionNote: s(o.productionNote),
    subtotal: n(o.subtotal), discount: n(o.discount), discountAmount: n(o.discountAmount), discountAsPercentage: !!o.discountAsPercentage, salesTax: n(o.salesTax), salesTaxAmount: n(o.salesTaxAmount),
    total: n(o.total), totalUntaxed: n(o.totalUntaxed), amountPaid: n(o.amountPaid), amountOutstanding: n(o.amountOutstanding), paidInFull: !!o.paidInFull, totalQuantity: n(o.totalQuantity),
    groups,
    fees: (o.fees?.nodes || []).map((f: Raw) => ({ id: s(f.id), description: s(f.description), quantity: f.quantity == null ? null : n(f.quantity), unitPrice: f.unitPrice == null ? null : n(f.unitPrice), pct: !!f.unitPriceAsPercentage, amount: n(f.amount), taxable: !!f.taxable })),
    transactions: (extra.transactions?.nodes || []).filter(Boolean).map((t: Raw): PvTransaction => ({ id: s(t.id), kind: s(t.__typename), amount: n(t.amount), category: s(t.category), description: s(t.description), date: s(t.transactionDate), source: s(t.source), processing: !!t.processing, status: t.status ? s(t.status) : undefined }))
      .sort((a: PvTransaction, b: PvTransaction) => a.date.localeCompare(b.date)),
    files: (extra.productionFiles?.nodes || []).map(file),
    tasks: (extra.tasks?.nodes || []).map((t: Raw) => ({ id: s(t.id), name: s(t.name), completed: !!t.completed, completedAt: t.completedAt || null, dueAt: t.dueAt || null, assignee: s(t.assignedTo?.name) })),
    approvals: (extra.approvalRequests?.nodes || []).map((a: Raw) => ({ id: s(a.id), name: s(a.name), status: s(a.status), requester: s(a.requester?.name), response: a.response ? { name: s(a.response.name), email: s(a.response.email), reason: s(a.response.reason), at: s(a.response.respondedAt) } : null, at: s(a.timestamps?.createdAt), retractor: s(a.retractor?.name), updatedAt: s(a.timestamps?.updatedAt) })),
    expenses: (extra.expenses?.nodes || []).map((x: Raw) => ({ id: s(x.id), name: s(x.name), amount: n(x.amount), at: s(x.transactionAt) })),
    messages,
    urls: { url: s(o.url), publicUrl: s(o.publicUrl), publicPdf: s(o.publicPdf), workorderUrl: s(o.workorderUrl), packingSlipUrl: s(o.packingSlipUrl) },
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * Checks every importer query against Printavo's live schema using ids that don't exist, so no shop data is read.
 * Returns only schema problems (unknown fields, wrong arguments); "not found" answers mean the query is fine.
 */
export async function checkQueries(): Promise<Record<string, string>> {
  const email = process.env.PRINTAVO_EMAIL?.trim(), token = process.env.PRINTAVO_TOKEN?.trim();
  const out: Record<string, string> = {};
  for (const [name, query] of Object.entries(Q)) {
    if (name === "search") continue; // would return real customers
    assertReadOnly(query);
    await sleep(600);
    const r = await fetch(PV_URL, { method: "POST", headers: { "Content-Type": "application/json", email: email || "", token: token || "" }, body: JSON.stringify({ query: name === "list" ? query.replace("first:25", "first:1") : query, variables: query.includes("$id") ? { id: "0", after: null } : { after: null } }), cache: "no-store" });
    const j = await r.json().catch(() => null) as { errors?: { message: string; path?: unknown }[] } | null;
    const schema = (j?.errors || []).filter((e) => !e.path).map((e) => e.message);
    const other = (j?.errors || []).filter((e) => e.path).map((e) => e.message);
    out[name] = schema.length ? "SCHEMA: " + schema.join(" | ") : `ok (HTTP ${r.status}${other.length ? "; " + other.join(" | ").slice(0, 120) : ""})`;
  }
  // the search query, checked only for validity: an empty result set is requested
  const r = await fetch(PV_URL, { method: "POST", headers: { "Content-Type": "application/json", email: email || "", token: token || "" }, body: JSON.stringify({ query: Q.search.replace("first:25", "first:0"), variables: { q: "zzzz-no-such-customer-zzzz" } }), cache: "no-store" });
  const j = await r.json().catch(() => null) as { errors?: { message: string; path?: unknown }[] } | null;
  const schema = (j?.errors || []).filter((e) => !e.path).map((e) => e.message);
  out.search = schema.length ? "SCHEMA: " + schema.join(" | ") : `ok (HTTP ${r.status})`;
  return out;
}
