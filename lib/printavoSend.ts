import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pv, transitionWrite, PrintavoError } from "@/lib/printavo";
import { calcOrder, imprintLabel, mergeSettings, orderGroups, SIZES, type Order } from "@/lib/pricing";

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
const day = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : "");

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
  const { count: mockups } = await admin.from("proofs").select("id", { count: "exact", head: true }).eq("order_id", orderId);
  return {
    number, nickname: `#${number} ${String(o.nickname || "").trim()}`.trim(), po: String(o.po_number || ""),
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

  const { o, settings } = await load(admin, inp.orderId);
  const number = o.number as number;
  // one send at a time: a second click while the first is still working is turned away
  const was = (o.printavo_state || {}) as { sending?: string | null };
  if (was.sending && Date.now() - new Date(was.sending).getTime() < 120_000) throw new PrintavoError("It's being sent right now. Give it a minute, then refresh.");
  const claim = await admin.from("orders").update({ printavo_state: { ...(o.printavo_state as object || {}), sending: new Date().toISOString(), by: inp.by, error: null } }).eq("id", inp.orderId).is("printavo_id", null).select("id");
  if (!claim.data?.length) throw new PrintavoError("Already in Printavo.");

  const calc = calcOrder(o, settings);
  const groups = orderGroups(o);
  const taxed = !o.tax_exempt;
  const sign = async (paths: string[]) => {
    if (!paths.length) return [] as string[];
    const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 60 * 60 * 24 * 3);
    return (data || []).map((x) => x.signedUrl || "");
  };
  // our mockups, by group (the title starts with the group's name), else on the first group
  const { data: proofs } = await admin.from("proofs").select("title, file_path, created_at").eq("order_id", inp.orderId).order("created_at");
  const proofUrls = await sign((proofs || []).map((p) => p.file_path as string));
  const named = (t: string) => groups.findIndex((g) => !!g.name && t.startsWith(g.name));
  const mockFor = (gi: number) => (proofs || []).map((p, i) => ({ gi: named(String(p.title || "")), u: proofUrls[i] }))
    .filter((p) => p.u && (p.gi === gi || (p.gi < 0 && gi === 0))).map((p) => ({ publicImageUrl: p.u }));
  // types of work, matched by name (Screen Printing, Embroidery, DTF...)
  const tow = await pv<{ account: { typesOfWork: { nodes: { id: string; name: string; archived: boolean }[] } } }>(`query{ account{ typesOfWork(first:50){ nodes{ id name archived } } } }`).then((d) => d.account?.typesOfWork?.nodes?.filter((t) => !t.archived) || []).catch(() => []);
  const towFor = (m: string) => tow.find((t) => (m === "screen" ? /screen/i : m === "embroidery" ? /embroid/i : /dtf|transfer/i).test(t.name));

  const lineItemGroups = groups.map((g, gi) => {
    const c = calc.groups[gi];
    return {
      position: gi + 1,
      lineItems: g.lines.filter((l) => SIZES.some((z) => +(l.sizes?.[z] || 0) > 0)).map((l, li) => {
        const lc = c?.lines.find((x) => x.id === l.id);
        const counts: Record<string, number> = {};
        for (const z of SIZES) { const q = +(l.sizes?.[z] || 0); if (q > 0) { const k = PV_SIZE[z] || "size_other"; counts[k] = (counts[k] || 0) + q; } }
        return {
          position: li + 1, itemNumber: l.style || undefined, color: l.color || undefined,
          description: [l.brand, l.garment].filter(Boolean).join(" ") + (g.name ? ` (${g.name})` : ""),
          price: lc ? lc.each : 0, taxed,
          sizes: Object.entries(counts).map(([size, count]) => ({ size, count })),
        };
      }),
      imprints: g.imprints.map((d, ii) => {
        const t = towFor(d.method);
        const details = [imprintLabel(d), d.notes].filter(Boolean).join("\n").slice(0, 1000);
        return { details, ...(t ? { typeOfWork: { id: t.id } } : {}), ...(ii === 0 ? { mockups: mockFor(gi) } : {}) };
      }),
    };
  }).filter((g) => g.lineItems.length);

  // screens / setup, 2XL+ charges and the order's own fees as Printavo fees
  const fees: { description: string; amount: number; quantity?: number; unitPrice?: number; taxable: boolean }[] = [];
  calc.groups.forEach((c, gi) => {
    const nm = groups[gi]?.name ? ` (${groups[gi].name})` : "";
    if (c.setup > 0) fees.push({ description: `Setup: screens${c.inkFees ? " & ink" : ""}${c.minCharge ? " & minimum" : ""}${nm}`, amount: c.setup, quantity: 1, unitPrice: c.setup, taxable: taxed });
    if (c.materials > 0) fees.push({ description: `2XL+ materials charge${nm}`, amount: c.materials, quantity: 1, unitPrice: c.materials, taxable: taxed });
  });
  for (const f of (o.fees || []) as { label: string; amount: number | "" }[]) if (+f.amount) fees.push({ description: f.label || "Fee", amount: +f.amount, quantity: 1, unitPrice: +f.amount, taxable: taxed });

  // production files: the customer's files and mockup copies on the order, and each print's art
  const { data: af } = await admin.from("art_files").select("file_path").eq("order_id", inp.orderId);
  const designIds = [...new Set(groups.flatMap((g) => g.imprints.map((d) => d.design_id).filter(Boolean)))] as string[];
  const { data: ds } = designIds.length ? await admin.from("designs").select("file_path").in("id", designIds) : { data: [] };
  const fileUrls = await sign([...(af || []).map((x) => x.file_path as string), ...((ds || []).map((x) => x.file_path as string).filter(Boolean))]).then((u) => u.filter(Boolean));

  const discount = o.discount_type === "amt" ? +(o.discount_amt || 0) : +(o.discount_pct || 0);
  const input = {
    contact: { id: pre.contact.id },
    nickname: inp.nickname.slice(0, 200),
    visualPoNumber: inp.po || undefined,
    customerDueAt: inp.customerDue,
    dueAt: `${inp.productionDue}T17:00:00-05:00`,
    productionNote: [inp.productionNote, `Entered in the new FBS system as order #${number}.`].filter(Boolean).join("\n\n"),
    salesTax: taxed ? calc.rate : 0,
    ...(discount ? { discount, discountAsPercentage: o.discount_type !== "amt" } : {}),
    tags: [`FBS #${number}`],
    lineItemGroups, fees,
    productionFiles: fileUrls.map((u) => ({ publicFileUrl: u })),
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
  return { printavoId: made.id, visualId: String(made.visualId || ""), publicUrl: made.publicUrl, url: made.url, status: String(state.status || ""), statusError: statusErr, warnings: warn, sentTotal: made.total, ourTotal: calc.total };
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
