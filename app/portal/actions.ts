"use server";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import Stripe from "stripe";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, type Order, type Payment } from "@/lib/pricing";
import { money } from "@/lib/format";

type Result = { ok: boolean; error?: string; url?: string };

/**
 * Confirms the signed-in customer can see this order (row security does the check),
 * and returns what later steps need. Staff previews are read-only.
 */
async function customerOrder(orderId: string) {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Customers take these actions from their own login.");
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("We couldn't find that order.");
  const admin = createAdminClient();
  const [{ data: cust }, { data: s }] = await Promise.all([
    admin.from("customers").select("*").eq("id", order.customer_id).maybeSingle(),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  const who = cust?.name || email;
  return { admin, order: order as Order, email, who, settings: mergeSettings(s?.data) };
}

async function notifyShop(subject: string, heading: string, body: string, orderId: string, shopName: string) {
  const to = SHOP_NOTIFY_EMAIL;
  if (!to) return;
  await sendEmail({ to, subject, html: emailLayout(shopName, heading, body, "Open order", `${siteUrl()}/shop/orders/${orderId}`) });
}

const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

export async function approveQuote(orderId: string, signature: string): Promise<Result> {
  try {
    const name = signature.trim();
    if (name.length < 2) return { ok: false, error: "Type your full name to sign." };
    const { admin, order, email, settings } = await customerOrder(orderId);
    if (order.status !== "quote_sent") return { ok: false, error: "This quote was already approved or changed. Refresh the page." };
    const now = new Date().toISOString();
    const { error } = await admin.from("orders").update({ status: "approved", type: "invoice", approved_at: now, approved_name: name }).eq("id", orderId).eq("status", "quote_sent");
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert([
      { order_id: orderId, kind: "approved", detail: `Signed "${name}"`, actor: email },
      { order_id: orderId, kind: "status", detail: "approved", actor: email },
    ]);
    await notifyShop(`Quote #${order.number} approved`, `${name} approved quote #${order.number}`, `${order.nickname || "Order"} · ${money(order.total)}`, orderId, settings.shop.name);
    revalidatePath(`/portal/orders/${orderId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function requestQuoteChanges(orderId: string, comment: string): Promise<Result> {
  try {
    const text = comment.trim().slice(0, 5000);
    if (!text) return { ok: false, error: "Tell us what you'd like changed." };
    const { admin, order, email, who, settings } = await customerOrder(orderId);
    await admin.from("messages").insert({ order_id: orderId, author_type: "customer", author_email: email, author_name: who, body: `Change request: ${text}` });
    await admin.from("order_events").insert({ order_id: orderId, kind: "changes", detail: "", actor: email });
    await notifyShop(`Changes requested on #${order.number}`, `${who} asked for changes on #${order.number}`, text, orderId, settings.shop.name);
    revalidatePath(`/portal/orders/${orderId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function decideProof(proofId: string, decision: "approved" | "changes", signature: string, comment: string): Promise<Result> {
  try {
    const { supabase, user } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    const { data: proof } = await supabase.from("proofs").select("id,order_id,title,status").eq("id", proofId).maybeSingle();
    if (!proof) return { ok: false, error: "We couldn't find that proof." };
    const { admin, order, email, who, settings } = await customerOrder(proof.order_id);
    if (proof.status !== "pending") return { ok: false, error: "This proof was already reviewed. Refresh the page." };
    const name = signature.trim() || who;
    if (decision === "approved" && name.length < 2) return { ok: false, error: "Type your name to approve." };
    if (decision === "changes" && !comment.trim()) return { ok: false, error: "Tell us what to change." };
    await admin.from("proofs").update({ status: decision, customer_comment: comment.trim().slice(0, 2000), decided_at: new Date().toISOString(), decided_name: name }).eq("id", proofId);
    await admin.from("order_events").insert({ order_id: order.id, kind: decision === "approved" ? "proof_approved" : "proof_changes", detail: proof.title, actor: email });
    await notifyShop(
      decision === "approved" ? `Proof approved on #${order.number}` : `Proof changes on #${order.number}`,
      decision === "approved" ? `${name} approved "${proof.title}"` : `${name} wants changes to "${proof.title}"`,
      comment.trim() || "No comment.", order.id, settings.shop.name
    );
    revalidatePath(`/portal/orders/${order.id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function customerMessage(orderId: string, body: string): Promise<Result> {
  try {
    const text = body.trim().slice(0, 5000);
    if (!text) return { ok: false, error: "Write a message first." };
    const { admin, order, email, who, settings } = await customerOrder(orderId);
    const { error } = await admin.from("messages").insert({ order_id: orderId, author_type: "customer", author_email: email, author_name: who, body: text });
    if (error) return { ok: false, error: error.message };
    await notifyShop(`New message on #${order.number}`, `${who} wrote about #${order.number}`, text, orderId, settings.shop.name);
    revalidatePath(`/portal/orders/${orderId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Starts a Stripe Checkout for the deposit or the full balance. Amounts are always worked out here, never taken from the browser. */
export async function startCheckout(orderId: string, kind: "deposit" | "balance"): Promise<Result> {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: "Online payments aren't set up yet. Please contact the shop." };
    const { admin, order, email, settings } = await customerOrder(orderId);
    if (order.type !== "invoice") return { ok: false, error: "Approve the quote first, then you can pay." };
    const { data: pays } = await admin.from("payments").select("amount").eq("order_id", orderId);
    const c = calcOrder(order, settings, (pays || []) as Payment[]);
    if (c.balance <= 0.004) return { ok: false, error: "This order is already paid in full." };
    let amount = c.balance;
    if (kind === "deposit") amount = Math.min(c.balance, Math.round(c.total * settings.depositPct) / 100);
    const cents = Math.round(amount * 100);
    if (cents < 50) return { ok: false, error: "The amount is too small to pay online." };
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{
        quantity: 1,
        price_data: { currency: "usd", unit_amount: cents, product_data: { name: `${settings.shop.name} order #${order.number}${kind === "deposit" ? " deposit" : ""}`, description: order.nickname || undefined } },
      }],
      metadata: { order_id: orderId, kind },
      payment_intent_data: { metadata: { order_id: orderId, order_number: String(order.number) } },
      success_url: `${siteUrl()}/portal/orders/${orderId}?paid=1`,
      cancel_url: `${siteUrl()}/portal/orders/${orderId}#pay`,
    });
    return { ok: true, url: session.url || undefined };
  } catch (e) { return fail(e); }
}
