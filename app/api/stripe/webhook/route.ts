import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { money } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe calls this when a customer finishes paying. It records the payment on the order.
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  const stripe = new Stripe(key);
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object as Stripe.Checkout.Session;
    const orderId = s.metadata?.order_id;
    if (orderId && s.payment_status === "paid" && s.amount_total) {
      const admin = createAdminClient();
      const amount = s.amount_total / 100;
      const { data: inserted } = await admin
        .from("payments")
        .upsert({ order_id: orderId, amount, method: "Card", paid_on: new Date().toISOString().slice(0, 10), stripe_session_id: s.id }, { onConflict: "stripe_session_id", ignoreDuplicates: true })
        .select("id");
      if (inserted && inserted.length) {
        await admin.from("order_events").insert({ order_id: orderId, kind: "payment", detail: `${money(amount)} online`, actor: s.customer_details?.email || "customer" });
        const { data: o } = await admin.from("orders").select("number,nickname").eq("id", orderId).maybeSingle();
        if (process.env.SHOP_NOTIFY_EMAIL && o)
          await sendEmail({ to: process.env.SHOP_NOTIFY_EMAIL, subject: `Payment received: ${money(amount)} on #${o.number}`, html: emailLayout("FBS Order Desk", `${money(amount)} paid on #${o.number}`, o.nickname || "", "Open order", `${siteUrl()}/shop/orders/${orderId}`) });
      }
    }
  }
  return NextResponse.json({ received: true });
}
