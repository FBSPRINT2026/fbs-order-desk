"use server";
import { orderSubject } from "@/lib/orderSubject";
import { allRows } from "@/lib/readAll";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, orderGroups, ST, type Order } from "@/lib/pricing";
import { fullColorWaiting } from "@/lib/fullColor";
import { attachNote, cleanAttachments, withFiles, type Attachment, type HubMsg } from "@/lib/messages";
import { matchGoodsSoon } from "@/lib/goodsSoon";
import { prodKindLabel } from "@/lib/productionFileKinds";

async function requireStaff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}

async function loadOrderAndCustomer(orderId: string) {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id,number,nickname,status,customer_id,groups,lines").eq("id", orderId).single();
  if (!order) throw new Error("Order not found.");
  const { data: customer } = order.customer_id
    ? await admin.from("customers").select("id,name,company,email,message_email").eq("id", order.customer_id).single()
    : { data: null };
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return { admin, order, customer, settings: mergeSettings(s?.data) };
}

/** Publish a quote or invoice to the customer's portal and email them the link. */
export async function sendToCustomer(orderId: string, note: string) {
  const { email: staffEmail } = await requireStaff();
  const { admin, order, customer, settings } = await loadOrderAndCustomer(orderId);
  if (!customer) return { ok: false, error: "Pick a customer for this order first." };
  if (!customer.email) return { ok: false, error: "This customer has no email address. Add one on their customer page." };
  // a full color print waits for production's colors (and so the price) before the quote goes out (Oct 26, Nick); the
  // customer can already have a picture-only proof
  if ((order.status === "quote" || order.status === "request") && orderGroups(order as Order).some((g) => g.imprints.some(fullColorWaiting)))
    return { ok: false, error: "Production hasn't confirmed the full color print yet (its colors set the price). The quote goes out after that; the picture-only proof can go now." };
  const patch: Record<string, unknown> = { sent_at: new Date().toISOString() };
  // a customer's order request becomes a normal quote waiting on their final OK
  if (order.status === "quote" || order.status === "request") patch.status = "quote_sent";
  await admin.from("orders").update(patch).eq("id", orderId);
  if (patch.status) await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "quote_sent", actor: staffEmail });
  await admin.from("order_events").insert({ order_id: orderId, kind: "sent", detail: customer.email, actor: staffEmail });
  matchGoodsSoon(); // sent to the customer: look for its goods now (lib/goodsSoon.ts)
  // sent to the customer: the order teaches Create order (lib/ai/orderExamples.ts)
  { const { saveExample } = await import("@/lib/ai/orderExamples"); await saveExample(admin, orderId, staffEmail).catch((e) => console.warn("saveExample", e)); }
  // the note also starts the message thread the customer sees in their portal
  if (note.trim()) await admin.from("messages").insert({ order_id: orderId, author_type: "staff", author_email: staffEmail, author_name: settings.shop.name, body: note.trim() });
  const link = `${siteUrl()}/portal/orders/${orderId}`;
  const isQuote = ST[(patch.status as string) || order.status]?.type === "quote";
  const emailed = await sendEmail({
    to: customer.email,
    replyTo: SHOP_NOTIFY_EMAIL,
    subject: orderSubject(order.number, isQuote ? "Quote ready for approval" : "Order update", order.nickname),
    html: emailLayout(
      settings.shop.name,
      isQuote ? `Quote #${order.number} is ready for your review` : `An update on order #${order.number}`,
      (note ? note + "\n\n" : "") + (isQuote ? "You can review the details, approve it and pay your deposit online." : "You can see the details, artwork and balance online."),
      isQuote ? "Review and approve" : "View your order",
      link
    ),
  });
  return { ok: true, link, emailed };
}

/** Ask the customer to review newly uploaded proofs. */
export async function requestProofApproval(orderId: string) {
  const { email: staffEmail } = await requireStaff();
  const { admin, order, customer, settings } = await loadOrderAndCustomer(orderId);
  if (!customer?.email) return { ok: false, error: "This order's customer has no email address." };
  if (order.status === "quote") return { ok: false, error: "Send the quote first so the customer can see this order." };
  await admin.from("order_events").insert({ order_id: orderId, kind: "proofs_requested", detail: "", actor: staffEmail });
  const link = `${siteUrl()}/portal/orders/${orderId}#proofs`;
  const emailed = await sendEmail({
    to: customer.email,
    replyTo: SHOP_NOTIFY_EMAIL,
    subject: orderSubject(order.number, "Artwork proof ready", order.nickname),
    html: emailLayout(settings.shop.name, "Your artwork proof is ready", `Please look over the proof for "${order.nickname || "your order"}" and approve it or tell us what to change. We start printing once it's approved.`, "Review artwork", link),
  });
  return { ok: true, link, emailed };
}

/** Post a shop message on an order and email the customer. */
export async function staffMessage(orderId: string, body: string, files: Attachment[] = [], topic = "") {
  const { email: staffEmail } = await requireStaff();
  const text = body.trim().slice(0, 5000);
  const { admin, order, customer, settings } = await loadOrderAndCustomer(orderId);
  const attachments = customer ? cleanAttachments(files, customer.id) : [];
  if (!text && !attachments.length) return { ok: false, error: "Write a message first." };
  const tp = topic === "goods" ? "goods" : "";
  const { error } = await admin.from("messages").insert({ order_id: orderId, topic: tp, author_type: "staff", author_email: staffEmail, author_name: settings.shop.name, body: text, attachments });
  if (error) return { ok: false, error: error.message };
  let emailed = false;
  // to whoever at the customer gets Messages (their email settings, lib/customerEmails.ts; off: it waits in their portal)
  if (customer?.id && order.status !== "quote") {
    const m = await import("@/lib/customerEmailServer");
    const r = await m.sendCustomerEmail(admin, {
      customerId: customer.id, kind: "messages", orderId, actor: staffEmail,
      subject: orderSubject(order.number, tp ? "New message about the goods" : "New message", order.nickname),
      html: m.customerEmailHtml({ shop: settings.shop, chip: { text: "Message", tone: "blue" }, head: `A message about ${order.nickname || `order #${order.number}`}`, lines: [text, ...(attachments.length ? [`${attachments.length} file${attachments.length === 1 ? "" : "s"} attached: open it in your portal.`] : [])], button: { label: "Reply in your portal", url: `${siteUrl()}/portal?area=messages&c=${orderId}${tp ? ":goods" : ""}` }, after: "Replies in the portal go straight onto your order." }),
    });
    emailed = r.sent.length > 0;
  }
  return { ok: true, emailed };
}

/** A general message to a customer (not about one order): shows in their portal's Messages area and emails them. */
export async function staffCustomerMessage(customerId: string, body: string, files: Attachment[] = [], projectId: string | null = null) {
  const { email: staffEmail } = await requireStaff();
  const text = body.trim().slice(0, 5000);
  const attachments = cleanAttachments(files, customerId);
  if (!text && !attachments.length) return { ok: false, error: "Write a message first." };
  const admin = createAdminClient();
  const [{ data: customer }, { data: s }] = await Promise.all([
    admin.from("customers").select("id,name,company,email,message_email").eq("id", customerId).maybeSingle(),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  if (!customer) return { ok: false, error: "Customer not found." };
  const settings = mergeSettings(s?.data);
  const { error } = await admin.from("messages").insert({ customer_id: customerId, project_id: projectId, author_type: "staff", author_email: staffEmail, author_name: settings.shop.name, body: text, attachments });
  if (error) return { ok: false, error: error.message };
  let emailed = false;
  {
    const m = await import("@/lib/customerEmailServer");
    const r = await m.sendCustomerEmail(admin, {
      customerId, kind: "messages", actor: staffEmail,
      subject: projectId ? `New message about your project` : `New message from ${settings.shop.name}`,
      html: m.customerEmailHtml({ shop: settings.shop, chip: { text: "Message", tone: "blue" }, head: `A message from ${settings.shop.name}`, lines: [text, ...(attachments.length ? [`${attachments.length} file${attachments.length === 1 ? "" : "s"} attached: open it in your portal.`] : [])], button: { label: "Reply in your portal", url: projectId ? `${siteUrl()}/portal/projects/${projectId}` : `${siteUrl()}/portal?area=messages` } }),
    });
    emailed = r.sent.length > 0;
  }
  return { ok: true, emailed };
}

/** All of a customer's messages (general and on their orders), oldest first, with links to their files. */
export async function shopMessages(customerId: string): Promise<{ ok: boolean; error?: string; messages?: HubMsg[] }> {
  try {
    await requireStaff();
    const admin = createAdminClient();
    const { data: os } = await admin.from("orders").select("id").eq("customer_id", customerId);
    const oids = (os || []).map((o) => o.id);
    const { data } = await allRows((ra, rb) => admin.from("messages").select("id, order_id, project_id, topic, author_type, author_name, body, created_at, read_at, attachments").is("hidden_at", null)
      .or(`customer_id.eq.${customerId}${oids.length ? `,order_id.in.(${oids.join(",")})` : ""}`).order("created_at").order("id").range(ra, rb));
    const messages = await withFiles(data || [], async (paths) => {
      const { data: s } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
      return (s || []).map((x) => x.signedUrl || null);
    });
    return { ok: true, messages };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Staff opened a conversation: the customer's messages in it are now read. */
export async function shopMarkRead(customerId: string, orderId: string | null, topic = "", projectId: string | null = null) {
  await requireStaff();
  const admin = createAdminClient();
  let q = admin.from("messages").update({ read_at: new Date().toISOString() }).eq("author_type", "customer").is("read_at", null);
  q = orderId ? q.eq("order_id", orderId).eq("topic", topic === "goods" ? "goods" : "") : projectId ? q.is("order_id", null).eq("project_id", projectId) : q.is("order_id", null).is("project_id", null).eq("customer_id", customerId);
  await q;
  return { ok: true };
}

/**
 * Accept a customer's order request (Oct 24, Nick: "it's sent to us for confirmation. We're going to have to go in on our
 * portal side and say, hey, we've got it, looks good, we can take it… thanks for the order, we're good to go. And then it'll
 * send them a message in their message center"). The request becomes an approved order (their sending it in is their
 * OK; the prices are their wholesale prices), and our note goes to their Messages. Staff click it; nothing is automatic.
 */
export async function acceptRequest(orderId: string, note: string, mode: "as_is" | "changes" = "as_is") {
  try {
    const { email: staffEmail } = await requireStaff();
    const { admin, order } = await loadOrderAndCustomer(orderId);
    const { data: o } = await admin.from("orders").select("status, submitted_at").eq("id", orderId).maybeSingle();
    if (!o || order.status !== "request" || !o.submitted_at) return { ok: false, error: "Only an order request the customer sent in can be accepted." };
    const now = new Date().toISOString();
    // Accept as is (Oct 24, Nick: "if they make it in the mock-up, there's no proof step anymore… it should go to waiting on
    // goods or in production, depending on what's going on with it"): their mockup is the approved art; with their goods
    // already checked in it's In production, otherwise Waiting on goods. Accept with changes: Proof (we edit the mockup
    // and send it back for their OK).
    let status = "art";
    if (mode === "as_is") {
      const { data: g } = await admin.from("order_goods").select("status").eq("order_id", orderId).maybeSingle();
      status = g?.status === "received" ? "production" : "blanks";
    }
    const { error } = await admin.from("orders").update({ status, type: "invoice", sent_at: now, approved_at: now, approved_name: "Sent in by the customer" }).eq("id", orderId).eq("status", "request");
    if (error) return { ok: false, error: error.message };
    matchGoodsSoon();
    await admin.from("order_events").insert([
      { order_id: orderId, kind: "accepted", detail: mode === "as_is" ? "Order and art accepted as sent" : "Order accepted; art being changed for a proof", actor: staffEmail },
      { order_id: orderId, kind: "status", detail: status, actor: staffEmail },
    ]);
    const text = note.trim();
    if (text) { const m = await staffMessage(orderId, text); if (!m.ok) return { ok: true, warn: m.error, status }; }
    return { ok: true, status };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't accept it." }; }
}

/**
 * A simple order from the portal (the customer sent their answers and files instead of filling in the form): brought
 * in like an email so the one Create order tool (components/tools/CreateOrderTool.tsx) reads it, the PO with the PO
 * rules, the art as art. meta.into_order: Create order fills in THIS order instead of making a new one.
 */
export async function simpleOrderActivity(orderId: string): Promise<{ ok: true; activityId: string; text: string } | { ok: false; error: string }> {
  try {
    const { email } = await requireStaff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, customer_id, nickname, due_date, delivery_method, ship_to, po_number, notes, submitted_at, simple_order").eq("id", orderId).maybeSingle();
    if (!o?.simple_order) return { ok: false, error: "This isn't a simple order." };
    const s = o.simple_order as { about?: string; qty?: number | null; garments?: string; method?: string; by?: string; /** the file the Order helper said has the sizes, or "message" */ sizes_in?: string; /** what staff told the Order helper */ helper_note?: string };
    const { data: cust } = await admin.from("customers").select("company, name, email").eq("id", o.customer_id).maybeSingle();
    // the files they sent with it (simple_order.files: uploaded in the portal, or brought in from their ClickUp job)
    // The request's own list is the record: a ClickUp job brought in as a request has its files only there, not on
    // art_files (Nov 3, Nick: Reimagine #40461's PDF wasn't in Resources), so each listed file counts, with its art_files
    // row when there is one, plus anything uploaded to the request in the portal
    const listed = ((s as { files?: { path: string; name?: string; kind?: string }[] }).files || []).filter((f) => f?.path);
    const { data: all } = await admin.from("art_files").select("name, file_path, file_type, category").eq("order_id", orderId);
    const rows = (all || []) as { name: string; file_path: string; file_type: string | null; category: string | null }[];
    const typeOf = (p: string) => /\.pdf$/i.test(p) ? "application/pdf" : /\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.(ai|eps)$/i.test(p) ? "application/postscript" : /\.svg$/i.test(p) ? "image/svg+xml" : "";
    const files = [
      ...listed.map((f) => rows.find((r) => r.file_path === f.path) || { name: f.name || f.path.split("/").pop() || "File", file_path: f.path, file_type: typeOf(f.path), category: f.kind || null }),
      ...rows.filter((r) => r.file_path.startsWith("requests/") && !listed.some((f) => f.path === r.file_path)),
    ];
    const sizes = await Promise.all((files || []).map(async (f) => {
      const dir = String(f.file_path).replace(/\/[^/]+$/, ""), base = String(f.file_path).split("/").pop() || "";
      const { data: l } = await admin.storage.from("proofs").list(dir, { search: base, limit: 5 });
      return (l || []).find((x) => x.name === base)?.metadata?.size as number | undefined;
    }));
    // what each file is, when staff said so (the Order helper, Production files' labels): "Not needed" files stay with
    // the request but aren't read; a vendor's order confirmation is read for who, when and its number, never for sizes
    // (Nov 6, Nick: "it gives us the who it was ordered from, when it's coming, and the order number… But it's not good to
    // take the sizes off of": one confirmation can cover several of their orders)
    const atts = (files || []).map((f, i) => ({ f, i })).filter(({ f }) => f.category !== "not_needed").slice(0, 12).map(({ f, i }) => ({ name: String(f.name), path: String(f.file_path), type: String(f.file_type || ""), size: sizes[i] || 0 }));
    const sizesIn = s.sizes_in || "";
    const kindWord = (c: string | null, path: string) => (path === sizesIn ? "THE SIZES: take every size and quantity from this file"
      : c === "supplier_order" ? "a vendor order confirmation: who the blanks were ordered from, when they arrive and the vendor's order number only; it can cover several orders, so NEVER take sizes or quantities from it"
      : c === "order_sheet" ? "their PO" : c === "art" || c === "print_art" ? "art" : c === "film" ? "their own separations (films), printed as sent: not the art to separate"
      : c === "customer_mockup" ? "their mockup" : c ? prodKindLabel(c).toLowerCase() || "a file" : "a file");
    const kindOf = new Map((files || []).map((f) => [String(f.file_path), kindWord(f.category, String(f.file_path))]));
    const body = [
      `${cust?.company || cust?.name || "The customer"} sent this order from our customer portal as a "simple order": they answered a few questions and uploaded files instead of filling in the order form. It is order #${o.number}; fill it in from what they sent.`,
      s.about ? `What they need, in their words:\n${s.about}` : "",
      o.nickname ? `Order name: ${o.nickname}` : "",
      o.due_date ? `Need it by: ${o.due_date}` : "",
      s.method ? `Decoration: ${({ screen: "screen printing", embroidery: "embroidery", transfer: "transfers (DTF)", mixed: "mixed (more than one kind)" } as Record<string, string>)[s.method] || s.method}` : "",
      o.po_number ? `Their PO #: ${o.po_number}` : "",
      s.qty ? `How many pieces: ${s.qty}` : "",
      s.garments ? `The garments (what they know): ${s.garments}` : "",
      `How they'll get it: ${o.delivery_method === "ship" ? `ship to ${o.ship_to}` : o.delivery_method === "deliver" ? `local delivery to ${o.ship_to}` : "they'll pick it up"}`,
      atts.length ? `Their files: ${atts.map((f) => `${f.name} (${kindOf.get(f.path)})`).join("; ")}` : "",
      s.sizes_in === "message" ? "The sizes and quantities are in their message above, not in a file." : "",
      s.helper_note ? `Staff say: ${s.helper_note}` : "",
    ].filter(Boolean).join("\n\n");
    const ext = `portal-simple:${orderId}`;
    const row = { customer_id: o.customer_id, kind: "portal", direction: "in", subject: `Simple order #${o.number}${o.nickname ? `: ${o.nickname}` : ""}`, body, from_email: s.by || cust?.email || "", to_email: "",
      external_id: ext, thread_id: ext, occurred_at: o.submitted_at || new Date().toISOString(), order_id: null,
      meta: { source: "portal", from_name: cust?.name || cust?.company || "", attachments: atts, att_checked: true, into_order: orderId }, created_by: email };
    const { data: have } = await admin.from("activities").select("id").eq("external_id", ext).maybeSingle();
    if (have) { const { error } = await admin.from("activities").update(row).eq("id", have.id); if (error) return { ok: false, error: error.message }; return { ok: true, activityId: have.id as string, text: row.subject }; }
    const { data: made, error } = await admin.from("activities").insert(row).select("id").single();
    if (error || !made) return { ok: false, error: error?.message || "Couldn't bring it in." };
    return { ok: true, activityId: made.id as string, text: row.subject };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/** Job Center → Requests (Nov 2, Nick: "it should look exactly like what you built for ClickUp new… when you click on
 *  them, it brings up the screen… hit the create order button"): every request a customer sent in from their portal and
 *  we haven't built yet, with what they told us and their files (a simple order's answers, or a form they filled in). */
export type DeskRequest = { id: string; number: number; name: string; customerId: string; customer: string; contact: string; sentAt: string; due: string | null; po: string;
  delivery: string; shipTo: string; simple: boolean; method: string; qty: number | null; garments: string; about: string; pieces: number; /** what they filled in on their side, word for word (ClickUp's Customer Name) */ fields: Record<string, string>; /** their order type (Cedar: Bulk / Cart) */ lane: string; /** what the customer calls its order types (Nine18: Entered by), or empty */ laneLabel: string;
  files: { name: string; path: string; type: string; kind: string; size: number }[];
  /** sent from the website's form (Leads → Website submissions): Ignore / Ignore and block instead of Not an order */ web?: boolean };
export async function requestsDesk(): Promise<{ ok: true; list: DeskRequest[] } | { ok: false; error: string }> {
  try {
    await requireStaff();
    const admin = createAdminClient();
    const { data: os } = await admin.from("orders").select("id, number, customer_id, nickname, due_date, po_number, delivery_method, ship_to, submitted_at, simple_order, groups, qty, order_lane, source")
      .eq("status", "request").not("submitted_at", "is", null).is("discarded_at", null).order("submitted_at", { ascending: false }).limit(200);
    const rows = (os || []) as { id: string; number: number; customer_id: string; nickname: string | null; due_date: string | null; po_number: string | null; delivery_method: string | null; ship_to: string | null; submitted_at: string; simple_order: { about?: string; qty?: number | null; garments?: string; method?: string; files?: { path: string; name: string; kind?: string }[] } | null; groups: Order["groups"]; qty: number | null; source?: string | null }[];
    const custIds = [...new Set(rows.map((r) => r.customer_id))];
    const ids = rows.map((r) => r.id);
    const [{ data: cs }, { data: af }] = await Promise.all([
      custIds.length ? admin.from("customers").select("id, name, company, order_type_label").in("id", custIds) : Promise.resolve({ data: [] }),
      ids.length ? admin.from("art_files").select("order_id, name, file_path, file_type, category").in("order_id", ids).order("id") : Promise.resolve({ data: [] }),
    ]);
    const cust = new Map(((cs || []) as { id: string; name: string | null; company: string | null; order_type_label?: string | null }[]).map((c) => [c.id, c]));
    const filesOf = new Map<string, { order_id: string; name: string; file_path: string; file_type: string | null; category: string | null }[]>();
    for (const f of (af || []) as { order_id: string; name: string; file_path: string; file_type: string | null; category: string | null }[]) filesOf.set(f.order_id, [...(filesOf.get(f.order_id) || []), f]);
    // file sizes for the tiles, from storage (one listing per folder)
    const dirs = new Map<string, Set<string>>();
    for (const list of filesOf.values()) for (const f of list) { const d = f.file_path.replace(/\/[^/]+$/, ""); dirs.set(d, (dirs.get(d) || new Set()).add(f.file_path.split("/").pop() || "")); }
    const size = new Map<string, number>();
    await Promise.all([...dirs.entries()].slice(0, 60).map(async ([d, names]) => {
      const { data: l } = await admin.storage.from("proofs").list(d, { limit: 100 });
      for (const x of l || []) if (names.has(x.name)) size.set(`${d}/${x.name}`, +(x.metadata?.size || 0));
    }));
    const list: DeskRequest[] = rows.map((r) => {
      const c = cust.get(r.customer_id), so = r.simple_order;
      const pieces = orderGroups(r as unknown as Order).reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((x, v) => x + (+v || 0), 0), 0), 0);
      return {
        id: r.id, number: r.number, name: r.nickname || "", customerId: r.customer_id, customer: c?.company || c?.name || "Customer", contact: c?.company && c?.name ? c.name : "",
        sentAt: r.submitted_at, due: r.due_date, po: r.po_number || "", delivery: r.delivery_method || "pickup", shipTo: r.ship_to || "",
        simple: !!so, method: so?.method || "", qty: so?.qty ?? r.qty ?? null, garments: so?.garments || "", about: so?.about || "", pieces, fields: ((so as { fields?: Record<string, string> } | null)?.fields) || {}, lane: String((r as { order_lane?: string }).order_lane || ""), laneLabel: String(c?.order_type_label || ""),
        files: (filesOf.get(r.id) || []).map((f) => ({ name: f.name, path: f.file_path, type: f.file_type || "", kind: f.category === "order_sheet" ? "po" : f.category || "", size: size.get(f.file_path) || 0 })),
        web: r.source === "website",
      };
    });
    return { ok: true, list };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/** "Not an order" on a request in the Job Center: put away (soft: discarded_at, kept on file), noted on the order */
export async function requestNotAnOrder(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { email } = await requireStaff();
    const admin = createAdminClient();
    const { error } = await admin.from("orders").update({ discarded_at: new Date().toISOString() }).eq("id", orderId).eq("status", "request");
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: orderId, kind: "request_put_away", detail: "Marked not an order in the Job Center", actor: email });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
