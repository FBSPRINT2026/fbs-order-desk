import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrder, pv, transitionWrite, PrintavoError } from "@/lib/printavo";
import { CARD, htmlText } from "@/lib/printavoChanges";
import { calcOrder, FULL_COLOR, imprintLabel, mergeSettings, orderGroups, SIZES, ST, type Group, type Imprint, type Order, type StatusKey } from "@/lib/pricing";
import { SITE_URL } from "@/lib/config";
import { parseAddress } from "@/lib/qbo/map";

/**
 * "Send to Printavo" (the move off Printavo, Oct 7 - Nov 1, 2026): an order entered here in the 40,000 series is made
 * as a quote in Printavo (customer, garments, sizes, prices, imprints, mockups, production files, fees), set to the
 * status staff pick, and linked back to our order. Production keeps running from Printavo and the customer sees
 * Printavo's invoice, as before. The Printavo copy is never imported back as a separate order (see the sync).
 */

export type PvStatus = { id: string; name: string; color: string; position: number; type: "QUOTE" | "INVOICE" };
export type SendPreview = {
  number: number; nickname: string; po: string; customerDue: string; productionDue: string; productionNote: string;
  contact: { id: string; name: string; email: string; company: string } | null; problem: string;
  statuses: PvStatus[]; defaultStatus: string; total: number;
  files: number; mockups: number; sent: { printavoId: string; visualId: string; publicUrl: string; url: string; status: string; at: string } | null;
};

const PV_SIZE: Record<string, string> = {
  "6M": "size_6m", "12M": "size_12m", "18M": "size_18m", "24M": "size_24m", "2T": "size_2t", "3T": "size_3t", "4T": "size_4t", "5T": "size_5t",
  YXS: "size_yxs", YS: "size_ys", YM: "size_ym", YL: "size_yl", YXL: "size_yxl", XS: "size_xs", S: "size_s", M: "size_m", L: "size_l", XL: "size_xl",
  "2XL": "size_2xl", "3XL": "size_3xl", "4XL": "size_4xl", "5XL": "size_5xl", "6XL": "size_6xl",
};
/** Printavo's card surcharge fee: Printavo-only (customers pay there during the move), never brought back to our order */
export const CARD_FEE = "Credit Card Processing Surcharge - ACH Available on Request";

/**
 * Our free-text address as Printavo's parts. A first line that isn't a street (no number: "Tera Murphy") is the
 * name on it; the company is the customer's. Null when there's nothing to send.
 */
function pvAddress(text: string, company: string, person: string) {
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return null;
  let name = person;
  if (lines.length >= 2 && company && lines[0].toLowerCase() === company.toLowerCase()) lines.shift();
  if (lines.length >= 3 && !/\d/.test(lines[0])) name = lines.shift() as string;
  const a = parseAddress(lines.join("\n"));
  if (!a) return null;
  return { companyName: company || undefined, customerName: name || undefined, address1: a.Line1 || undefined,
    address2: [a.Line2, a.Line3, a.Line4].filter(Boolean).join(", ") || undefined, city: a.City || undefined,
    stateIso: a.CountrySubDivisionCode || undefined, zipCode: a.PostalCode || undefined, countryIso: "US" };
}

/** A print as the customer reads it: location, colors, inks, size (no method: the line's category says that). */
const printLine = (d: Imprint) => [d.location,
  d.method === "screen" || d.method === "embroidery" ? (d.method === "screen" && d.colors >= FULL_COLOR ? "full color" : `${d.colors} color${d.colors > 1 ? "s" : ""}`) : "full color",
  d.method === "screen" && d.printStyle === "fashion" ? (d.softHand ? "fashion print (soft, no underbase)" : "fashion print (no underbase)") : d.method === "screen" && d.softHand ? "soft hand" : "",
  d.inks, d.size].filter(Boolean).join(" · ");
/** A Printavo line's description: the garment, and on a group's last line its prints, one per line (Oct 16, Nick). */
const lineDescription = (g: Group, l: { brand?: string; garment?: string }, last: boolean) =>
  [[l.brand, l.garment].filter(Boolean).join(" ") + (g.name ? ` (${g.name})` : ""), ...(last ? g.imprints.map(printLine) : [])].join("\n");
/** A production file in Printavo that opens the order here (Oct 16, Nick): app/pv/[n]/[file]/route.ts */
const orderLink = (number: number) => `${SITE_URL}/pv/${number}/Open-in-FBS-Order-Desk-${number}.html`;
/** The lines of a group that go to Printavo (any size has a quantity). */
const sentLines = (g: Group) => g.lines.filter((l) => SIZES.some((z) => +(l.sizes?.[z] || 0) > 0));
/** The billing and shipping addresses sent with an order. */
function orderAddresses(o: Record<string, unknown>, cust: Record<string, unknown> | null) {
  const company = String(cust?.company || ""), person = String(cust?.name || "");
  const billingAddress = pvAddress(String(cust?.address || ""), company, person);
  const shippingAddress = o.delivery_method !== "pickup" ? pvAddress(String(o.ship_to || ""), company, person) || pvAddress(String(cust?.ship_address || cust?.address || ""), company, person) : null;
  return { billingAddress, shippingAddress };
}
const CARD_RE = CARD;
const day = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "");
/** a Printavo date-time as the shop's calendar day (Central) */
const centralDay = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : "");

export async function printavoStatuses(): Promise<PvStatus[]> {
  const d = await pv<{ statuses: { nodes: PvStatus[] } }>(`query{ statuses(first:100){ nodes{ id name color position type } } }`);
  return (d.statuses?.nodes || []).sort((a, b) => (a.type === b.type ? a.position - b.position : a.type === "QUOTE" ? -1 : 1));
}

async function load(admin: SupabaseClient, orderId: string) {
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) throw new PrintavoError("Order not found.");
  const { data: cust } = o.customer_id ? await admin.from("customers").select("*").eq("id", o.customer_id).maybeSingle() : { data: null };
  const { data: pc } = o.customer_id ? await admin.from("printavo_customers").select("printavo_id, data").eq("customer_id", o.customer_id) : { data: [] };
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const { data: oi } = await admin.from("order_internal").select("production_notes").eq("order_id", orderId).maybeSingle();
  return { o: o as Order & Record<string, unknown>, cust: cust as Record<string, unknown> | null, pcs: (pc || []) as { printavo_id: string; data: Record<string, unknown> }[], settings: mergeSettings(st?.data), prodNote: String(oi?.production_notes || "") };
}

/** The Printavo contact the quote goes to: the one with the customer's email, else the customer's primary contact. */
function pickContact(pcs: { printavo_id: string; data: Record<string, unknown> }[], email: string) {
  type C = { id: string; fullName?: string; email?: string };
  for (const p of pcs) {
    const all = [p.data.primaryContact, ...((p.data.contacts as C[]) || []), ...((p.data.extraContacts as C[]) || [])].filter(Boolean) as C[];
    const hit = all.find((c) => email && (c.email || "").toLowerCase() === email.toLowerCase()) || (p.data.primaryContact as C | undefined) || all[0];
    if (hit?.id) return { id: String(hit.id), name: hit.fullName || "", email: hit.email || "", company: String(p.data.companyName || "") };
  }
  return null;
}

/** What the Send to Printavo window shows: the statuses to pick from, the dates and who it goes to. */
export async function sendPreview(admin: SupabaseClient, orderId: string): Promise<SendPreview> {
  const { o, cust, pcs, settings, prodNote } = await load(admin, orderId);
  const number = o.number as number;
  let problem = "";
  if (!(number >= 40000 && number < 50000)) problem = "Only orders #40000-#49999 go to Printavo.";
  else if (!cust) problem = "Pick the customer first.";
  else if (!cust.moved_at) problem = "Move this customer to the new system first (customer page → Move from Printavo).";
  else if (!pcs.length) problem = "This customer isn't linked to a Printavo customer, so Printavo wouldn't know who it's for. Link them on the customer page first.";
  const contact = pickContact(pcs, String(cust?.email || ""));
  // check the contact in Printavo itself (and that it belongs to the linked customer)
  let checked = contact;
  if (contact && !problem) {
    const c = await pv<{ contact: { id: string; fullName: string; email: string; customer: { id: string; companyName: string } | null } | null }>(`query($id:ID!){ contact(id:$id){ id fullName email customer{ id companyName } } }`, { id: contact.id }).catch(() => null);
    if (!c?.contact) problem = `The Printavo contact (${contact.name || contact.id}) wasn't found in Printavo.`;
    else checked = { id: c.contact.id, name: c.contact.fullName, email: c.contact.email, company: c.contact.customer?.companyName || contact.company };
  }
  const statuses = problem ? [] : await printavoStatuses();
  const def = statuses.find((s) => s.type === "INVOICE" && /approv/i.test(s.name)) || statuses.find((s) => /approv/i.test(s.name)) || statuses[0];
  const calc = calcOrder(o, settings);
  const ps = o.printavo_state as Record<string, string> | null;
  const { count: files } = await admin.from("art_files").select("id", { count: "exact", head: true }).eq("order_id", orderId);
  const { count: mockups } = await admin.from("mockups").select("id", { count: "exact", head: true }).eq("order_id", orderId).is("archived_at", null);
  return {
    number, nickname: String(o.nickname || "").trim(), po: String(o.po_number || ""),
    customerDue: day(o.due_date as string), productionDue: day((o.production_date as string) || (o.due_date as string)), productionNote: prodNote,
    contact: checked, problem, statuses, defaultStatus: def?.id || "", total: calc.total, files: files || 0, mockups: mockups || 0,
    sent: o.printavo_id ? { printavoId: String(o.printavo_id), visualId: String(o.printavo_visual_id || ""), publicUrl: ps?.publicUrl || "", url: ps?.url || "", status: ps?.status || "", at: String(o.printavo_sent_at || "") } : null,
  };
}

export type SendInput = { orderId: string; statusId: string; customerDue: string; productionDue: string; nickname: string; po: string; productionNote: string; by: string };

/** Makes the quote in Printavo, sets its status and links it to our order. Refuses if the order was already sent. */
export async function sendToPrintavo(admin: SupabaseClient, inp: SendInput) {
  const pre = await sendPreview(admin, inp.orderId);
  if (pre.problem) throw new PrintavoError(pre.problem);
  if (pre.sent) throw new PrintavoError(`Already in Printavo as #${pre.sent.visualId}. It isn't sent twice.`);
  if (!pre.contact) throw new PrintavoError("No Printavo contact for this customer.");
  const status = pre.statuses.find((s) => s.id === inp.statusId);
  if (!status) throw new PrintavoError("Pick a Printavo status.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.customerDue) || !/^\d{4}-\d{2}-\d{2}$/.test(inp.productionDue)) throw new PrintavoError("Pick the production date and the customer's due date.");

  const { o, cust, settings } = await load(admin, inp.orderId);
  const number = o.number as number;
  // one send at a time: a second click while the first is still working is turned away
  const was = (o.printavo_state || {}) as { sending?: string | null };
  if (was.sending && Date.now() - new Date(was.sending).getTime() < 120_000) throw new PrintavoError("It's being sent right now. Give it a minute, then refresh.");
  const claim = await admin.from("orders").update({ printavo_state: { ...(o.printavo_state as object || {}), sending: new Date().toISOString(), by: inp.by, error: null } }).eq("id", inp.orderId).is("printavo_id", null).select("id");
  if (!claim.data?.length) throw new PrintavoError("Already in Printavo.");

  const started = Date.now();
  const calc = calcOrder(o, settings);
  const groups = orderGroups(o);
  const taxed = !o.tax_exempt;
  // types of work, matched by name (Screen Printing, Embroidery, DTF...)
  // and the line items' categories (Screen Printing, Embroidery, Heat Press): Printavo's reports and syncs go by them
  type Named = { id: string; name: string; archived?: boolean };
  const acct = await pv<{ account: { typesOfWork: { nodes: Named[] }; categories: { nodes: Named[] } } }>(`query{ account{ typesOfWork(first:50){ nodes{ id name archived } } categories(first:100){ nodes{ id name } } } }`).then((d) => d.account).catch(() => null);
  const tow = (acct?.typesOfWork?.nodes || []).filter((t) => !t.archived), cats = acct?.categories?.nodes || [];
  const methodRe = (m: string) => (m === "screen" ? /screen\s*print/i : m === "embroidery" ? /embroid/i : /heat\s*press|dtf|transfer/i);
  const towFor = (m: string) => tow.find((t) => methodRe(m).test(t.name));
  const catFor = (m: string) => cats.find((c) => methodRe(m).test(c.name.trim()));
  const missingCat = groups.map((g) => g.imprints[0]?.method).filter((m) => !!m && !catFor(m));
  if (missingCat.length) await admin.from("orders").update({ printavo_state: { ...(o.printavo_state as object || {}), sending: null } }).eq("id", inp.orderId);
  if (missingCat.length) throw new PrintavoError(`Printavo has no line item category for ${[...new Set(missingCat)].join(", ")} (looked for Screen Printing / Embroidery / Heat Press).`);

  const lineItemGroups = groups.map((g, gi) => {
    const c = calc.groups[gi];
    return {
      position: gi + 1,
      lineItems: sentLines(g).map((l, li, all) => {
        const lastLine = all.length - 1;
        const lc = c?.lines.find((x) => x.id === l.id);
        const counts: Record<string, number> = {};
        for (const z of SIZES) { const q = +(l.sizes?.[z] || 0); if (q > 0) { const k = PV_SIZE[z] || "size_other"; counts[k] = (counts[k] || 0) + q; } }
        const cat = catFor(g.imprints[0]?.method || "screen");
        return {
          // mockups go on after the quote is made (attachFiles): inside quoteCreate Printavo fetches every picture before
          // answering, and with big ones it gave up with HTTP 503 (Oct 20, #40072)
          position: li + 1, itemNumber: l.style || undefined, color: l.color || undefined, ...(cat ? { category: { id: cat.id } } : {}),
          // the prints under the garment on the last line (Oct 16, Nick: the customer can't see Printavo's imprints):
          // "Full Front · 3 colors · White, PMS Cool Gray 5 C, PMS 199 C · 11.5" wide"
          description: lineDescription(g, l, li === lastLine),
          price: lc ? lc.each : 0, taxed,
          sizes: Object.entries(counts).map(([size, count]) => ({ size, count })),
        };
      }),
      imprints: g.imprints.map((d, ii) => {
        const t = towFor(d.method);
        // production runs from Printavo during the move: an unconfirmed size / ink says so on the print
        const unconf = d.confirm && (d.confirm.size || d.confirm.ink) ? `*** REORDER - PRODUCTION DETAILS NEEDED: ${[d.confirm.size && "SIZE & PLACEMENT", d.confirm.ink && "INK"].filter(Boolean).join(" & ")} *** (best guess: ${d.confirm.why}). Confirm in the portal: link in the production note.`
          : d.confirmed ? `Specs confirmed by production (${d.confirmed.by}, ${new Date(d.confirmed.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${d.confirmed.from ? `, from ${d.confirmed.from}` : ""}).` : "";
        const details = [imprintLabel(d), unconf, d.notes].filter(Boolean).join("\n").slice(0, 1000);
        return { details, ...(t ? { typeOfWork: { id: t.id } } : {}) };
      }),
    };
  }).filter((g) => g.lineItems.length);

  // setup as Printavo's own fee names (their reports and syncs go by them): New / Repeat Screen Fee per screen,
  // Digitize File, PMS MATCH, Color Change; 2XL+ as Sizes Above XL; the order's own fees (no card surcharge: added in Printavo when they pay by card)
  type PvFee = { description: string; amount?: number; quantity?: number; unitPrice?: number; unitPriceAsPercentage?: boolean; taxable: boolean };
  const FEE_NAME = { screens: "New Screen Fee ", remake: "Repeat Screen Fee ", digitize: "Digitize File", pms: "PMS MATCH", inkchange: "Color Change", min: "Minimum Order Charge" } as const;
  // Printavo reads a fee's `amount` as the price of ONE and multiplies it by the quantity itself (Oct 20, #40090: 7 repeat
  // screens sent as quantity 7, amount $105 came out 7 × $105 = $735 instead of 7 × $15): amount = the unit price
  const sum = new Map<string, PvFee>();
  for (const c of calc.groups) {
    for (const it of c.setupItems) {
      // a charge that doesn't split evenly per screen goes as one line for its exact total (no cents lost to rounding)
      const even = Math.abs(it.unit * it.qty - it.amount) < 0.005;
      const key = even ? `${it.kind}|${it.unit}` : `${it.kind}|total|${sum.size}`, f = sum.get(key);
      if (f) f.quantity = (f.quantity || 0) + it.qty;
      else sum.set(key, even ? { description: FEE_NAME[it.kind], quantity: it.qty, unitPrice: it.unit, amount: it.unit, taxable: taxed }
        : { description: `${FEE_NAME[it.kind].trim()} (${it.qty})`, quantity: 1, unitPrice: it.amount, amount: it.amount, taxable: taxed });
    }
    if (c.materials > 0) { const f = sum.get("materials"); if (f) { f.amount = Math.round(((f.amount || 0) + c.materials) * 100) / 100; f.unitPrice = f.amount; } else sum.set("materials", { description: "Sizes Above XL", quantity: 1, unitPrice: c.materials, amount: c.materials, taxable: taxed }); }
  }
  const fees: PvFee[] = [...sum.values()];
  // (a card surcharge already on our order is Printavo's, brought back: the percentage one below replaces it)
  for (const f of (o.fees || []) as { label: string; amount: number | ""; free?: boolean }[]) if (+f.amount && !f.free && !/credit card processing surcharge/i.test(f.label)) fees.push({ description: f.label || "Fee", amount: +f.amount, quantity: 1, unitPrice: +f.amount, taxable: taxed });
  // customers pay through Printavo during the move: the usual 3% card surcharge goes on every order, as on Printavo's own
  // no card surcharge (Oct 16, Nick): it's added in Printavo only for a customer paying by card, and comes back here then

  const { billingAddress, shippingAddress } = orderAddresses(o, cust);
  const discount = o.discount_type === "amt" ? +(o.discount_amt || 0) : +(o.discount_pct || 0);
  const input = {
    contact: { id: pre.contact.id },
    nickname: inp.nickname.slice(0, 200),
    visualPoNumber: inp.po || undefined,
    customerDueAt: inp.customerDue,
    dueAt: `${inp.productionDue}T17:00:00-05:00`,
    // a reorder with prints production hasn't confirmed: the link to confirm them in the portal (Oct 14, Nick: "a link in
    // the production notes so they can click it and fill it out"); Printavo itself is never changed for this
    productionNote: [
      groups.some((g) => g.imprints.some((d) => d.confirm && (d.confirm.size || d.confirm.ink))) ? `REORDER: confirm the print specs (size, placement, inks) before printing: ${SITE_URL}/shop/details?order=${inp.orderId}` : "",
      inp.productionNote, `Entered in the new FBS system as order #${number}.`,
    ].filter(Boolean).join("\n\n"),
    customerNote: String(o.notes || "").trim() || undefined,
    salesTax: taxed ? calc.rate : 0,
    ...(discount ? { discount, discountAsPercentage: o.discount_type !== "amt" } : {}),
    tags: [`#FBS${number}`], // Printavo tags start with # and have no spaces
    // the customer's billing and shipping addresses (Oct 16, Nick: they came over blank)
    ...(billingAddress ? { billingAddress } : {}), ...(shippingAddress ? { shippingAddress } : {}),
    lineItemGroups, fees,
    // the art and order files go on after the quote is made (attachFiles), like the mockups
    productionFiles: [{ publicFileUrl: orderLink(number) }],
  };
  type Made = { id: string; visualId: string; publicUrl: string; url: string; total: number; status: { name: string } };
  let made: Made | null = null, warn = "";
  try {
    const r = await transitionWrite<{ quoteCreate: Made | null; __warnings?: string }>(`mutation($input:QuoteCreateInput!){ quoteCreate(input:$input){ id visualId publicUrl url total status{ name } } }`, { input }, number);
    made = r.quoteCreate; warn = r.__warnings || "";
  } catch (e) {
    await admin.from("orders").update({ printavo_state: { ...(o.printavo_state as object || {}), sending: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } }).eq("id", inp.orderId);
    throw e;
  }
  if (!made?.id) {
    await admin.from("orders").update({ printavo_state: { ...(o.printavo_state as object || {}), sending: null, error: warn || "Printavo didn't return the new quote." } }).eq("id", inp.orderId);
    throw new PrintavoError(warn || "Printavo didn't return the new quote. Check Printavo before trying again.");
  }
  // linked right away, so nothing imports it as a separate order and it can't be sent twice
  const state: Record<string, unknown> = { publicUrl: made.publicUrl, url: made.url, status: made.status?.name || "", sentTotal: made.total, ourTotal: calc.total, by: inp.by, warnings: warn || null };
  await admin.from("orders").update({ printavo_id: made.id, printavo_visual_id: String(made.visualId || ""), printavo_sent_at: new Date().toISOString(), printavo_state: state }).eq("id", inp.orderId);
  let statusErr = "";
  if (status.name !== made.status?.name) {
    try {
      const s = await transitionWrite<{ statusUpdate: unknown }>(`mutation($p:ID!,$s:ID!){ statusUpdate(parentId:$p, statusId:$s){ __typename } }`, { p: made.id, s: status.id }, number);
      void s; state.status = status.name;
    } catch (e) { statusErr = e instanceof Error ? e.message : String(e); state.statusError = statusErr; }
    await admin.from("orders").update({ printavo_state: state }).eq("id", inp.orderId);
  }
  await admin.from("order_events").insert({ order_id: inp.orderId, kind: "printavo", detail: `Sent to Printavo as #${made.visualId} (${state.status})`, actor: inp.by });
  await fixConfirmationReply(admin, inp.orderId, number, String(made.visualId || ""), made.publicUrl);
  // Printavo numbers it from its own counter: give it our number so both systems match (#40003 is #40003)
  let visualId = String(made.visualId || ""), numberError = "", total = made.total;
  try { const m = await matchPrintavoNumber(admin, inp.orderId, inp.by); visualId = m.visualId; total = m.total; } catch (e) { numberError = e instanceof Error ? e.message : String(e); }
  // then the mockups and the art, one at a time (a slow or refused picture doesn't lose the quote)
  let files: Awaited<ReturnType<typeof attachFiles>> | null = null, filesError = "";
  try { files = await attachFiles(admin, inp.orderId, started + 95_000); } catch (e) { filesError = e instanceof Error ? e.message : String(e); }
  const filesNote = filesError ? `Mockups and art weren't added (${filesError}). Use "Add mockups & art" to try again.`
    : files && (files.failed.length || files.left) ? `${files.added} mockup${files.added === 1 ? "" : "s"} / file${files.added === 1 ? "" : "s"} added; ${files.failed.length + files.left} didn't go on${files.failed.length ? ` (${files.failed[0]})` : ""}. Use "Add mockups & art" to try again.` : "";
  return { printavoId: made.id, visualId, publicUrl: made.publicUrl, url: made.url, status: String(state.status || ""), statusError: statusErr, numberError, warnings: [warn, filesNote].filter(Boolean).join(" "), filesAdded: files?.added || 0, sentTotal: total, ourTotal: calc.total, cardFee: 0 };
}

type PvNow = { __typename: "Invoice" | "Quote"; visualId: string; total: number; status: { name: string } | null };
const readNow = async (id: string) => (await pv<{ order: PvNow | null }>(`query($id:ID!){ order(id:$id){ __typename ... on Invoice{ visualId total status{ name } } ... on Quote{ visualId total status{ name } } } }`, { id })).order;

/** Sets the Printavo order's number to ours (Printavo #34613 → #40003). Only the number changes. */
export async function matchPrintavoNumber(admin: SupabaseClient, orderId: string, by: string) {
  const { data: o } = await admin.from("orders").select("number, printavo_id, printavo_visual_id, printavo_state").eq("id", orderId).maybeSingle();
  if (!o?.printavo_id) throw new PrintavoError("This order hasn't been sent to Printavo.");
  const number = o.number as number, want = String(number);
  if (!(number >= 40000 && number < 50000)) throw new PrintavoError("Only orders #40000-#49999 sync with Printavo.");
  const now = await readNow(String(o.printavo_id));
  if (!now) throw new PrintavoError("The order wasn't found in Printavo.");
  const old = String(now.visualId || o.printavo_visual_id || "");
  let visualId = old, total = now.total;
  if (old !== want) {
    const kind = now.__typename === "Invoice" ? "invoiceUpdate" : "quoteUpdate", type = now.__typename === "Invoice" ? "InvoiceInput" : "QuoteInput";
    const r = await transitionWrite<Record<string, { visualId: string; total: number } | null>>(`mutation($id:ID!,$input:${type}!){ ${kind}(id:$id, input:$input){ visualId total } }`, { id: String(o.printavo_id), input: { visualId: want } }, number);
    const got = r[kind];
    if (!got || String(got.visualId) !== want) throw new PrintavoError(`Printavo kept #${got?.visualId || old}${r.__warnings ? ` (${r.__warnings})` : ""}.`);
    visualId = String(got.visualId); total = got.total;
    await admin.from("order_events").insert({ order_id: orderId, kind: "printavo", detail: `Printavo number changed from #${old} to #${visualId} to match`, actor: by });
    // the waiting confirmation reply quoted Printavo's old number
    const { data: acts } = await admin.from("activities").select("id, meta").eq("order_id", orderId).limit(20);
    for (const a of acts || []) {
      const meta = (a.meta || {}) as { reply_options?: { at?: string; options?: { label: string; subject: string; body: string }[] } };
      const opts = meta.reply_options?.options;
      if (!opts?.some((op) => op.body.includes(`Order #${old}`))) continue;
      const next = opts.map((op) => ({ ...op, body: op.body.replace(new RegExp(`Order #${old}\\b`, "g"), `Order #${visualId}`) }));
      await admin.from("activities").update({ meta: { ...meta, reply_options: { ...meta.reply_options, at: new Date().toISOString(), options: next } } }).eq("id", a.id);
    }
  }
  await admin.from("orders").update({ printavo_visual_id: visualId, printavo_state: { ...((o.printavo_state || {}) as object), sentTotal: total, status: now.status?.name || (o.printavo_state as { status?: string } | null)?.status || "" } }).eq("id", orderId);
  return { visualId, total, status: now.status?.name || "" };
}

/** The "Thanks for your order" reply waiting in the Inbox: the link becomes Printavo's invoice page and the number Printavo's. */
async function fixConfirmationReply(admin: SupabaseClient, orderId: string, number: number, visualId: string, publicUrl: string) {
  const { data: acts } = await admin.from("activities").select("id, meta").eq("order_id", orderId).limit(20);
  for (const a of acts || []) {
    const meta = (a.meta || {}) as { reply_options?: { at?: string; options?: { label: string; subject: string; body: string }[] } };
    const opts = meta.reply_options?.options;
    if (!opts?.length) continue;
    let changed = false;
    const next = opts.map((op) => {
      const body = op.body
        .replace(/(order confirmation:[ \t]*)(\[Printavo link[^\]]*\]|\S+)/i, (_m, a1) => `${a1}${publicUrl}`)
        .replace(new RegExp(`Order #${number}\\b`, "g"), `Order #${visualId}`);
      if (body !== op.body) changed = true;
      return { ...op, body };
    });
    if (changed) await admin.from("activities").update({ meta: { ...meta, reply_options: { ...meta.reply_options, at: new Date().toISOString(), options: next } } }).eq("id", a.id);
  }
}

/** What the order looks like in Printavo now (kept on our order as printavo_state.pv, compared on the order page). */
export type PvSnap = {
  at: string; visualId: string; status: string; total: number; kind: string; productionNote: string;
  customerNote: string; nickname: string; po: string; customerDue: string; productionDue: string; discount: number; discountPct: boolean; salesTax: number;
  imprints: string[][]; payments: { id: string; kind: string; amount: number; category: string; date: string; processing: boolean }[];
  groups: { lines: { itemNumber: string; color: string; description: string; category: string; sizes: Record<string, number>; price: number; mockups: number; /** Printavo's goods status: received / partially_received / ordered / "" */ goods?: string }[] }[];
  fees: { description: string; amount: number; quantity: number | null; unitPrice: number | null; pct: boolean }[];
};
const OUR_SIZE: Record<string, string> = Object.fromEntries(Object.entries(PV_SIZE).map(([k, v]) => [v, k]));

/**
 * Our status for a Printavo status (Oct 15, Nick: "#40003… moved along our old system and you never updated it on the
 * new portal side, still just shows quote"). null = not ours to guess (an issue, a hold, a status we don't know): the
 * order keeps its status underneath (Printavo's own words still show), except that an invoice is at least Approved.
 */
export function ourStatusFor(name: string, kind: string): StatusKey | null {
  const s = (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (/^quote/.test(s)) return /paid|approved/.test(s) ? "approved" : /closed/.test(s) ? null : /sent/.test(s) ? "quote_sent" : kind === "invoice" ? "approved" : "quote";
  if (/complete|picked up|delivered/.test(s)) return "completed";
  if (/^shipping|ready to ship|ready for pick ?up/.test(s)) return "ready";
  if (/^issue|on hold|holder|waiting on details/.test(s)) return null;
  if (/transfers ordered|blanks|garments ordered|goods ordered|receiving/.test(s)) return "blanks";
  if (/\bart\b|proof/.test(s)) return "art";
  if (/press|printing|fulfillment|finishing|production|scheduling|^emb\b|^sp\b|^hp\b|^op\b|^dtf\b|mixed order/.test(s)) return "production";
  return null;
}
/** the order's goods from Printavo's line goods statuses: every line received → received; some → partial; else null */
export function goodsFromPrintavo(snap: Pick<PvSnap, "groups">): "received" | "partial" | null {
  const lines = snap.groups.flatMap((g) => g.lines).filter((l) => Object.values(l.sizes || {}).some((v) => +v > 0));
  if (!lines.length) return null;
  const st = lines.map((l) => String(l.goods || "").toLowerCase());
  if (st.every((x) => x === "received")) return "received";
  if (st.some((x) => x === "received" || x === "partially_received")) return "partial";
  return null;
}

/**
 * Reads the order back from Printavo (two-way during the move: quantities, prices and fees changed in Printavo come
 * back here to be accepted on the order page; the number and status are taken as they are, our status following
 * Printavo's: ourStatusFor).
 */
export async function refreshFromPrintavo(admin: SupabaseClient, orderId: string, fingerprint?: string) {
  const { data: o } = await admin.from("orders").select("number, printavo_id, printavo_state").eq("id", orderId).maybeSingle();
  if (!o?.printavo_id) throw new PrintavoError("This order hasn't been sent to Printavo.");
  // only the 40,000s talk back and forth; everything below (Printavo's history) and above (after Nov 2) is locked
  if (!((o.number as number) >= 40000 && (o.number as number) < 50000)) throw new PrintavoError("Only orders #40000-#49999 sync with Printavo.");
  const p = await getOrder(String(o.printavo_id));
  const snap: PvSnap = {
    at: new Date().toISOString(), visualId: p.visualId, status: p.status.name, total: p.total, kind: p.kind, productionNote: htmlText(p.productionNote || ""),
    customerNote: htmlText(p.customerNote || ""), nickname: p.nickname || "", po: p.poNumber || "", customerDue: day(p.customerDueAt), productionDue: centralDay(p.dueAt),
    discount: p.discount || 0, discountPct: !!p.discountAsPercentage, salesTax: p.salesTax || 0,
    imprints: p.groups.map((g) => g.imprints.map((i) => i.details || "")),
    payments: p.transactions.filter((t) => /^(Payment|Refund|Return)$/.test(t.kind)).map((t) => ({ id: t.id, kind: t.kind, amount: t.amount, category: t.category, date: day(t.date) || t.date, processing: t.processing })),
    groups: p.groups.map((g) => ({ lines: g.lines.map((l) => ({ itemNumber: l.itemNumber, color: l.color, description: l.description, category: l.category, price: l.price, mockups: l.mockups.length, goods: l.status,
      sizes: Object.fromEntries(Object.entries(l.sizes).map(([k, v]) => [OUR_SIZE[k] || k.replace(/^size_/, "").toUpperCase(), v])) })) })),
    fees: p.fees.map((f) => ({ description: f.description, amount: f.amount, quantity: f.quantity, unitPrice: f.unitPrice, pct: f.pct })),
  };
  const st = (o.printavo_state || {}) as Record<string, unknown>;
  // the card surcharge is always worked out in Printavo: taken as it is, no Accept needed
  const { data: full } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  const card = snap.fees.find((f) => CARD_RE.test(f.description));
  const fees0 = ((full?.fees || []) as { label: string; amount: number | "" }[]);
  const mine = fees0.find((f) => CARD_RE.test(f.label));
  const cardPatch: Record<string, unknown> = {};
  if (full && (card ? !mine || Math.abs(+(mine.amount || 0) - card.amount) > 0.005 : !!mine)) {
    const fees = [...fees0.filter((f) => !CARD_RE.test(f.label)), ...(card ? [{ label: card.description.trim(), amount: card.amount }] : [])];
    const { data: sset } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    cardPatch.fees = fees;
    cardPatch.total = calcOrder({ ...(full as Order), fees }, mergeSettings(sset?.data)).total;
  }
  // payments made in Printavo are registered here as they are (once each; refunds and returns as negative amounts)
  const settled = snap.payments.filter((t) => !t.processing && t.amount);
  if (settled.length) {
    const keys = settled.map((t) => `printavo:${t.id}`);
    const { data: have } = await admin.from("payments").select("processor_id").in("processor_id", keys);
    const got = new Set((have || []).map((x) => x.processor_id as string));
    const METHOD: Record<string, string> = { CREDIT_CARD: "Credit card", ECHECK: "ACH", CHECK: "Check", CASH: "Cash" };
    const add = settled.filter((t) => !got.has(`printavo:${t.id}`)).map((t) => ({ order_id: orderId, amount: t.kind === "Payment" ? Math.abs(t.amount) : -Math.abs(t.amount), method: METHOD[t.category] || "Other",
      paid_on: /^\d{4}-\d{2}-\d{2}/.test(t.date) ? t.date.slice(0, 10) : new Date().toISOString().slice(0, 10), processor_id: `printavo:${t.id}`, fee: 0,
      note: `${t.kind === "Payment" ? "Paid" : t.kind} in Printavo (#${p.visualId})` }));
    if (add.length) {
      const { error } = await admin.from("payments").insert(add);
      if (!error) await admin.from("order_events").insert({ order_id: orderId, kind: "printavo", detail: `Payment from Printavo: ${add.map((x) => `$${x.amount.toFixed(2)} ${x.method}`).join(", ")}`, actor: "Printavo" });
    }
  }
  // Printavo runs these jobs: our status mirrors Printavo's, always (Oct 15, Nick: "the order status in Printavo should
  // take over… just have it mirror back"). The order shows Printavo's own words (components/bits.tsx pvStatusOf); our
  // status underneath is the nearest of ours, for the lists, the dashboard and the customer's portal.
  const ours = String(full?.status || "");
  const want = ourStatusFor(p.status.name, p.kind) ?? (p.kind === "invoice" && ST[ours]?.type !== "invoice" ? "approved" : null);
  const statusPatch: Record<string, unknown> = {};
  if (want && want !== ours) {
    statusPatch.status = want; statusPatch.type = ST[want].type;
    await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: want, actor: `Printavo: ${p.status.name}` });
  }
  // the goods: Printavo's receiving (each line's goods status) overrides ours on these jobs (Oct 15, Nick: "the goods
  // were received in Printavo via their goods status… the receiving status in Printavo should override the new
  // system for the 40000 series"). Quietly: no message or email to the customer (Printavo talks to them during the
  // move). Received / partly received there → the same here; nothing received there → back to waiting, if Printavo
  // had set it.
  const fromPv = goodsFromPrintavo(snap);
  {
    const { data: g } = await admin.from("order_goods").select("status, updated_by").eq("order_id", orderId).maybeSingle();
    const now = g?.status as string | undefined;
    const goods = fromPv || (g?.updated_by === "Printavo" && (now === "received" || now === "partial") ? "waiting" : null);
    if (goods && (g || full?.price_type === "wholesale") && now !== goods) {
      await admin.from("order_goods").upsert({ order_id: orderId, status: goods, ...(goods === "received" ? { issue_type: "", issue_note: "" } : {}), updated_by: "Printavo", updated_at: new Date().toISOString() });
      await admin.from("order_events").insert({ order_id: orderId, kind: "printavo", detail: goods === "received" ? "Goods: Received in Printavo" : goods === "partial" ? "Goods: Partly received in Printavo" : "Goods: not received in Printavo", actor: "Printavo" });
    }
  }
  await admin.from("orders").update({ ...cardPatch, ...statusPatch, printavo_visual_id: p.visualId, printavo_state: { ...st, pv: snap, status: p.status.name, url: p.urls.url || st.url, publicUrl: p.urls.publicUrl || st.publicUrl, ...(fingerprint ? { fp: fingerprint } : {}) } }).eq("id", orderId);
  return snap;
}

/**
 * Our mockups and art onto an order already made in Printavo, one write at a time: each product line's own mockup (the
 * customer's invoice page shows line mockups), every mockup of the group on its first print, and the order's files and
 * each print's art as production files. Anything already there is skipped, so it can run again. Stops starting new
 * writes at `until` (the rest is counted in `left`). Oct 20: sent inside quoteCreate, Printavo fetched every picture
 * (about 19 MB for #40072) before answering and gave up with HTTP 503.
 */
/** `again`: add the current mockups even where Printavo already has some (remade mockups; the old ones there are left
 *  for staff to remove: nothing is deleted in Printavo) */
export async function attachFiles(admin: SupabaseClient, orderId: string, until = Date.now() + 95_000, again = false) {
  const { data: o } = await admin.from("orders").select("number, printavo_id, groups, lines").eq("id", orderId).maybeSingle();
  if (!o?.printavo_id) throw new PrintavoError("This order hasn't been sent to Printavo.");
  const number = o.number as number;
  if (!(number >= 40000 && number < 50000)) throw new PrintavoError("Only orders #40000-#49999 sync with Printavo.");
  const p = await getOrder(String(o.printavo_id));
  const groups = orderGroups(o as Pick<Order, "groups" | "lines">);
  const sign = async (paths: string[]) => {
    if (!paths.length) return [] as string[];
    const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 60 * 60 * 24 * 3);
    return (data || []).map((x) => x.signedUrl || "");
  };
  // our mockups, by the group they were made for (mockups.group_id; else the title starts with the group's name, else
  // the first group). Each product line gets only its own garment's mockup (Oct 20, Nick: every line of #40072 got
  // all three shirts; the groups had no name, so the title match failed and every line fell back to the whole group)
  const { data: proofs } = await admin.from("mockups").select("title, file_path, group_id").eq("order_id", orderId).is("archived_at", null).order("created_at");
  const urls = await sign((proofs || []).map((x) => x.file_path as string));
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const groupOf = (x: { t: string; g: string }) => {
    const byId = groups.findIndex((g) => g.id === x.g);
    if (byId >= 0) return byId;
    const byName = groups.findIndex((g) => !!g.name && x.t.startsWith(g.name));
    return byName >= 0 ? byName : 0;
  };
  const mocks = (proofs || []).map((x, i) => ({ t: String(x.title || ""), g: String(x.group_id || ""), u: urls[i] })).filter((x) => x.u);
  const groupMocks = (gi: number) => mocks.filter((x) => groupOf(x) === gi);
  // a line's own mockup: the title ends with its style and color ("Group 1 — Tultex 245 White/ Royal")
  const lineMocks = (gi: number, style?: string, color?: string) => {
    const want = norm(`${style || ""} ${color || ""}`);
    const own = want ? groupMocks(gi).filter((x) => norm(x.t).endsWith(want)) : [];
    if (own.length) return own.slice(-1);
    // one garment in the group: its mockup(s); otherwise nothing rather than every shirt on every line
    return groupMocks(gi).length === 1 ? groupMocks(gi) : [];
  };
  const jobs: { what: string; q: string; v: Record<string, unknown> }[] = [];
  let pgi = 0;
  for (const [gi, g] of groups.entries()) {
    const ours = sentLines(g);
    if (!ours.length) continue;
    const pg = p.groups[pgi++];
    if (!pg) break;
    for (const [li, l] of ours.entries()) {
      const pl = pg.lines[li];
      if (!pl || (pl.mockups.length && !again)) continue;
      for (const m of lineMocks(gi, l.style, l.color)) jobs.push({ what: `mockup on ${l.style || "line"} ${l.color || ""}`.trim(), q: `mutation($id:ID!,$u:String!){ lineItemMockupCreate(lineItemId:$id, publicImageUrl:$u){ id } }`, v: { id: pl.id, u: m.u } });
    }
    const pi = pg.imprints[0];
    if (pi && (!pi.mockups.length || again)) for (const m of groupMocks(gi).slice(0, 6)) jobs.push({ what: "mockup on the print", q: `mutation($id:ID!,$u:String!){ imprintMockupCreate(imprintId:$id, publicImageUrl:$u){ id } }`, v: { id: pi.id, u: m.u } });
  }
  // production files: the order's files and each print's art (skipped when a file of that name is already there)
  const { data: af } = await admin.from("art_files").select("file_path").eq("order_id", orderId);
  const designIds = [...new Set(groups.flatMap((g) => g.imprints.map((d) => d.design_id).filter(Boolean)))] as string[];
  const { data: ds } = designIds.length ? await admin.from("designs").select("file_path").in("id", designIds) : { data: [] };
  const paths = [...new Set([...(af || []).map((x) => x.file_path as string), ...(ds || []).map((x) => x.file_path as string)].filter(Boolean))];
  const base = (u: string) => decodeURIComponent((u.split("?")[0].split("/").pop() || "")).toLowerCase();
  const have = new Set(p.files.flatMap((f) => [base(f.name || ""), base(f.full)]).filter(Boolean));
  const fileUrls = await sign(paths);
  paths.forEach((path, i) => { if (fileUrls[i] && !have.has(base(path))) jobs.push({ what: path.split("/").pop() || "file", q: `mutation($p:ID!,$u:String!){ productionFileCreate(parentId:$p, publicFileUrl:$u){ id } }`, v: { p: String(o.printavo_id), u: fileUrls[i] } }); });
  let added = 0, left = 0;
  const failed: string[] = [];
  for (const j of jobs) {
    if (Date.now() > until) { left++; continue; }
    try { await transitionWrite(j.q, j.v, number); added++; }
    catch (e) { failed.push(`${j.what}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); }
  }
  await admin.from("order_events").insert({ order_id: orderId, kind: "printavo", detail: `Added to Printavo: ${added} mockup${added === 1 ? "" : "s"} / file${added === 1 ? "" : "s"}${failed.length ? `; ${failed.length} refused` : ""}${left ? `; ${left} left for next time` : ""}` });
  return { added, failed, left, total: jobs.length };
}

/**
 * An order already in Printavo gets what the send now includes (Oct 16, Nick: "resync 40070 with the changes"): the
 * prints under the garment in each line's description, and the billing and shipping addresses. Lines are matched by
 * position within each group. Nothing else in Printavo is touched (fees, prices, sizes stay as they are there).
 */
export async function resyncDetails(admin: SupabaseClient, orderId: string) {
  const { o, cust } = await load(admin, orderId);
  if (!o.printavo_id) throw new PrintavoError("This order hasn't been sent to Printavo.");
  const number = o.number as number;
  if (!(number >= 40000 && number < 50000)) throw new PrintavoError("Only orders #40000-#49999 sync with Printavo.");
  const p = await getOrder(String(o.printavo_id));
  const groups = orderGroups(o as Order).filter((g) => sentLines(g).length);
  let lines = 0;
  for (const [gi, g] of groups.entries()) {
    const pg = p.groups[gi];
    if (!pg) break;
    const ours = sentLines(g);
    for (const [li, l] of ours.entries()) {
      const pl = pg.lines[li];
      if (!pl) break;
      const want = lineDescription(g, l, li === ours.length - 1);
      if ((pl.description || "").trim() === want.trim()) continue;
      await transitionWrite(`mutation($id:ID!,$input:LineItemInput!){ lineItemUpdate(id:$id, input:$input){ id } }`, { id: pl.id, input: { position: pl.position, description: want } }, number);
      lines++;
    }
  }
  const { billingAddress, shippingAddress } = orderAddresses(o, cust);
  let addresses = false;
  if (billingAddress || shippingAddress) {
    const now = await readNow(String(o.printavo_id));
    const inv = now?.__typename === "Invoice";
    const kind = inv ? "invoiceUpdate" : "quoteUpdate", type = inv ? "InvoiceInput" : "QuoteInput";
    await transitionWrite(`mutation($id:ID!,$input:${type}!){ ${kind}(id:$id, input:$input){ id } }`, { id: String(o.printavo_id), input: { ...(billingAddress ? { billingAddress } : {}), ...(shippingAddress ? { shippingAddress } : {}) } }, number);
    addresses = true;
  }
  // the link that opens the order here, when it isn't in the production files yet
  let link = false;
  if (!p.files.some((f) => /Open-in-FBS-Order-Desk/i.test(`${f.name || ""} ${f.full}`))) {
    await transitionWrite(`mutation($p:ID!,$u:String!){ productionFileCreate(parentId:$p, publicFileUrl:$u){ id } }`, { p: String(o.printavo_id), u: orderLink(number) }, number);
    link = true;
  }
  await admin.from("order_events").insert({ order_id: orderId, kind: "printavo", detail: `Resynced to Printavo: ${lines} line description${lines === 1 ? "" : "s"}${addresses ? ", billing and shipping addresses" : ""}${link ? ", the link to this order" : ""}` });
  return { lines, addresses, link };
}
