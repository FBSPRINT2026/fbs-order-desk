"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideByLink, openLink, type LinkDecision, type Step } from "@/lib/proofLinks";
import Stripe from "stripe";
import { decideQuote, orderSteps } from "@/lib/customerSend";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";

/** The customer's answer on their proof link or order page (no sign-in: the link is the key; lib/proofLinks.ts checks it). */
export async function answerProof(id: string, decision: LinkDecision, name: string, note: string, step?: Step) {
  try { return await decideByLink(createAdminClient(), id, decision, name, note, step); }
  catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}

/** Approve the quote (signed) or decline it with why, on the order page. */
export async function answerQuote(id: string, decision: "approve" | "changes" | "decline", name: string, reason: string) {
  try {
    const admin = createAdminClient();
    const link = await openLink(admin, id);
    if (!link || link.kind !== "order") return { ok: false as const, error: "This link doesn't work anymore. Ask us for a new one." };
    return await decideQuote(admin, link.order_id, decision, name, reason, link.sent_to || "customer");
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}

/**
 * The final approval on the order page (Oct 29, Nick: "you would say, looks good or need changes… then you'd move on to
 * the next screen, which is review quote… submit final approval for quote and art… then you got the approval
 * confirmation"). Everything the customer looked over and said looks good, approved together under their name: the
 * proof (with their note as a small change, no new proof), each sew-out, then the quote.
 */
export async function approveAll(id: string, name: string, pick: { art?: { note: string } | null; sewouts?: { id: string; note: string }[]; quote?: boolean; /** the final invoice sent after approval */ invoice?: boolean }) {
  try {
    const admin = createAdminClient();
    const link = await openLink(admin, id);
    if (!link || link.kind !== "order") return { ok: false as const, error: "This link doesn't work anymore. Ask us for a new one." };
    const who = (name || "").trim();
    if (who.length < 2) return { ok: false as const, error: "Type your full name to approve." };
    if (pick.art) {
      const r = await decideByLink(admin, id, pick.art.note.trim() ? "approved_changes" : "approved", who, pick.art.note, { kind: "art" }, true);
      if (!r.ok) return r;
    }
    for (const s of pick.sewouts || []) {
      const r = await decideByLink(admin, id, s.note.trim() ? "approved_changes" : "approved", who, s.note, { kind: "sewout", id: s.id }, true);
      if (!r.ok) return r;
    }
    if (pick.quote) {
      const r = await decideQuote(admin, link.order_id, "approve", who, "", link.sent_to || "customer", true);
      if (!r.ok) return r;
    }
    if (pick.invoice) {
      await admin.from("order_events").insert({ order_id: link.order_id, kind: "invoice_approved", detail: `Signed "${who}" on their order page`, actor: link.sent_to || "customer" });
    }
    // one email to the shop with everything they approved
    if (SHOP_NOTIFY_EMAIL) {
      const { data: o } = await admin.from("orders").select("number, nickname").eq("id", link.order_id).maybeSingle();
      const s = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const what = [pick.art ? "the proof" : "", ...(pick.sewouts || []).map(() => "the sew-out"), pick.quote ? "the quote" : "", pick.invoice ? "the final invoice" : ""].filter(Boolean);
      const notes = [pick.art?.note.trim() ? `Proof: ${pick.art.note.trim()}` : "", ...(pick.sewouts || []).filter((x) => x.note.trim()).map((x) => `Sew-out: ${x.note.trim()}`)].filter(Boolean);
      const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0] || "it";
      await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `#${o?.number} approved: ${list}`, html: emailLayout(mergeSettings(s.data?.data).shop.name, `${who} approved ${list} on #${o?.number}`,
        notes.length ? `Make these small changes before production (no new proof):\n\n${notes.join("\n")}` : `${o?.nickname || "Order"} is good to go.`, "Open order", `${siteUrl()}/shop/orders/${link.order_id}`) });
    }
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}

/**
 * Pay right after approving (Oct 30, Nick: "if their term is due up front… it says approve, and then it says thank you
 * for your approval… here's the link for your deposit… once we have this, we'll get started"). A Stripe card checkout
 * for what their terms say is due now (the deposit, or the whole order when it's paid up front), less anything already
 * paid. No sign-in: the link is the key, the amount is worked out here (never taken from the browser), and the Stripe
 * webhook records the payment on the order (app/api/stripe/webhook).
 */
export async function payByLink(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: "Online payments aren't set up yet. Please call us." };
    const admin = createAdminClient();
    const os = await orderSteps(admin, id);
    if (!os) return { ok: false, error: "This link doesn't work anymore. Ask us for a new one." };
    const dep = os.steps.find((s) => s.kind === "deposit" && s.state === "todo");
    if (!dep) return { ok: false, error: "Nothing is due right now. Thank you!" };
    const { data: pays } = await admin.from("payments").select("amount").eq("order_id", os.o.id);
    const paid = (pays || []).reduce((s, p) => s + +(p.amount || 0), 0);
    const cents = Math.round(Math.max(0, (dep.amount || 0) - paid) * 100);
    if (cents < 50) return { ok: false, error: "Nothing is due right now. Thank you!" };
    const full = dep.amount != null && Math.abs((dep.amount || 0) - os.total) < 0.005;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: (os.customer?.email as string | undefined) || undefined,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: cents, product_data: { name: `${os.settings.shop.name} order #${os.o.number}${full ? "" : " deposit"}`, description: os.o.nickname || undefined } } }],
      metadata: { order_id: os.o.id, kind: full ? "balance" : "deposit", link: id },
      payment_intent_data: { metadata: { order_id: os.o.id, order_number: String(os.o.number) } },
      success_url: `${siteUrl()}/proof/${id}?paid=1`,
      cancel_url: `${siteUrl()}/proof/${id}`,
    });
    if (!session.url) return { ok: false, error: "Couldn't open the payment page. Try again." };
    return { ok: true, url: session.url };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}
