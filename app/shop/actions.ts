"use server";
import { orderSubject } from "@/lib/orderSubject";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, orderGroups, ST, type Order } from "@/lib/pricing";
import { fullColorWaiting } from "@/lib/fullColor";
import { attachNote, cleanAttachments, withFiles, type Attachment, type HubMsg } from "@/lib/messages";

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
  // the customer can keep messages in their portal only (Settings: "Email me our messages", Oct 24)
  if (customer?.email && order.status !== "quote" && customer.message_email !== false) {
    emailed = await sendEmail({
      to: customer.email,
      replyTo: SHOP_NOTIFY_EMAIL,
      subject: orderSubject(order.number, tp ? "New message about the goods" : "New message", order.nickname),
      html: emailLayout(settings.shop.name, `Message about #${order.number}`, (text || "") + attachNote(attachments), "Reply in your portal", `${siteUrl()}/portal?area=messages&c=${orderId}${tp ? ":goods" : ""}`),
    });
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
  if (customer.email && customer.message_email !== false) {
    emailed = await sendEmail({
      to: customer.email,
      replyTo: SHOP_NOTIFY_EMAIL,
      subject: projectId ? `New message about your project` : `New message from ${settings.shop.name}`,
      html: emailLayout(settings.shop.name, `A message from ${settings.shop.name}`, (text || "") + attachNote(attachments), "Reply in your portal", projectId ? `${siteUrl()}/portal/projects/${projectId}` : `${siteUrl()}/portal?area=messages`),
    });
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
    const { data } = await admin.from("messages").select("id, order_id, project_id, topic, author_type, author_name, body, created_at, read_at, attachments")
      .or(`customer_id.eq.${customerId}${oids.length ? `,order_id.in.(${oids.join(",")})` : ""}`).order("created_at").limit(2000);
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
    const s = o.simple_order as { about?: string; qty?: number | null; garments?: string; method?: string; by?: string };
    const { data: cust } = await admin.from("customers").select("company, name, email").eq("id", o.customer_id).maybeSingle();
    const { data: files } = await admin.from("art_files").select("name, file_path, file_type, category").eq("order_id", orderId).like("file_path", "requests/%");
    const sizes = await Promise.all((files || []).map(async (f) => {
      const dir = String(f.file_path).replace(/\/[^/]+$/, ""), base = String(f.file_path).split("/").pop() || "";
      const { data: l } = await admin.storage.from("proofs").list(dir, { search: base, limit: 5 });
      return (l || []).find((x) => x.name === base)?.metadata?.size as number | undefined;
    }));
    const atts = (files || []).slice(0, 12).map((f, i) => ({ name: String(f.name), path: String(f.file_path), type: String(f.file_type || ""), size: sizes[i] || 0 }));
    const kindOf = new Map((files || []).map((f) => [String(f.file_path), f.category === "order_sheet" ? "their PO" : f.category === "art" ? "art" : "a file"]));
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
