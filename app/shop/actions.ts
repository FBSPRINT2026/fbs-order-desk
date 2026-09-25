"use server";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, ST } from "@/lib/pricing";

async function requireStaff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}

async function loadOrderAndCustomer(orderId: string) {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id,number,nickname,status,customer_id").eq("id", orderId).single();
  if (!order) throw new Error("Order not found.");
  const { data: customer } = order.customer_id
    ? await admin.from("customers").select("id,name,company,email").eq("id", order.customer_id).single()
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
  const patch: Record<string, unknown> = { sent_at: new Date().toISOString() };
  if (order.status === "quote") patch.status = "quote_sent";
  await admin.from("orders").update(patch).eq("id", orderId);
  if (patch.status) await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "quote_sent", actor: staffEmail });
  await admin.from("order_events").insert({ order_id: orderId, kind: "sent", detail: customer.email, actor: staffEmail });
  const link = `${siteUrl()}/portal/orders/${orderId}`;
  const isQuote = ST[(patch.status as string) || order.status]?.type === "quote";
  const emailed = await sendEmail({
    to: customer.email,
    replyTo: SHOP_NOTIFY_EMAIL,
    subject: `${isQuote ? "Your quote" : "Your order"} #${order.number} from ${settings.shop.name}`,
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
    subject: `Artwork proof ready for order #${order.number}`,
    html: emailLayout(settings.shop.name, "Your artwork proof is ready", `Please look over the proof for "${order.nickname || "your order"}" and approve it or tell us what to change. We start printing once it's approved.`, "Review artwork", link),
  });
  return { ok: true, link, emailed };
}

/** Post a shop message on an order and email the customer. */
export async function staffMessage(orderId: string, body: string) {
  const { email: staffEmail } = await requireStaff();
  const text = body.trim().slice(0, 5000);
  if (!text) return { ok: false, error: "Write a message first." };
  const { admin, order, customer, settings } = await loadOrderAndCustomer(orderId);
  const { error } = await admin.from("messages").insert({ order_id: orderId, author_type: "staff", author_email: staffEmail, author_name: settings.shop.name, body: text });
  if (error) return { ok: false, error: error.message };
  let emailed = false;
  if (customer?.email && order.status !== "quote") {
    emailed = await sendEmail({
      to: customer.email,
      replyTo: SHOP_NOTIFY_EMAIL,
      subject: `New message about order #${order.number}`,
      html: emailLayout(settings.shop.name, `Message about #${order.number}`, text, "Reply in your portal", `${siteUrl()}/portal/orders/${orderId}#messages`),
    });
  }
  return { ok: true, emailed };
}
