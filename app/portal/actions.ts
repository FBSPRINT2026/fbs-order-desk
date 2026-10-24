"use server";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import Stripe from "stripe";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, orderGroups, type Order, type Payment } from "@/lib/pricing";
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

/**
 * The customer's decision on a proof (Oct 15, Nick: "approve, approve with changes, or make changes"):
 * - approved: we print it as is.
 * - approved_changes: approved, with small fixes we make without another proof (the note goes on the work order).
 * - changes: sent back; they get a new proof. Their own version from the Mockup Creator goes through submitOwnChange.
 */
export async function decideProof(proofId: string, decision: "approved" | "approved_changes" | "changes", signature: string, comment: string): Promise<Result> {
  try {
    const { supabase, user } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    const { data: proof } = await supabase.from("proofs").select("id,order_id,title,status").eq("id", proofId).is("archived_at", null).maybeSingle();
    if (!proof) return { ok: false, error: "We couldn't find that proof." };
    const { admin, order, email, who, settings } = await customerOrder(proof.order_id);
    if (proof.status !== "pending") return { ok: false, error: "This proof was already reviewed. Refresh the page." };
    // approvals carry the name the customer typed themselves (never filled in for them)
    const name = decision === "changes" ? signature.trim() || who : signature.trim();
    const note = comment.trim().slice(0, 2000);
    if (decision !== "changes" && name.length < 2) return { ok: false, error: "Type your full name to approve." };
    if (decision !== "approved" && !note) return { ok: false, error: decision === "changes" ? "Tell us what to change." : "Tell us the changes to make." };
    const status = decision === "changes" ? "changes" : "approved";
    await admin.from("proofs").update({ status, customer_comment: note, decided_at: new Date().toISOString(), decided_name: name }).eq("id", proofId);
    await admin.from("order_events").insert({ order_id: order.id, kind: status === "approved" ? "proof_approved" : "proof_changes", detail: decision === "approved_changes" ? `${proof.title} (with changes)` : proof.title, actor: email });
    const head = decision === "approved" ? "approved" : decision === "approved_changes" ? "approved with changes" : "wants changes to";
    await notifyShop(
      decision === "approved" ? `Proof approved on #${order.number}` : decision === "approved_changes" ? `Proof approved with changes on #${order.number}` : `Proof changes on #${order.number}`,
      `${name} ${head} "${proof.title}"`,
      decision === "approved_changes" ? `Make these changes before printing (no new proof):\n\n${note}` : note || "No comment.", order.id, settings.shop.name
    );
    revalidatePath(`/portal/orders/${order.id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export type OwnChangeStart = { ok: true; orderId: string; orderNumber: number; groupName: string; lines: { id: string; style: string; brand: string; color: string; garment: string }[];
  imprints: import("@/lib/pricing").Imprint[]; ordered: string[]; mockupSize: string } | { ok: false; error: string };

/** "Make changes → change it myself": the proof's shirt and prints, to open in the customer's Mockup Creator. */
/** (view = just to look at it, from "See the full proof": any status) */
export async function proofForChange(proofId: string, view = false): Promise<OwnChangeStart> {
  try {
    const { supabase, user } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    const { data: proof } = await supabase.from("proofs").select("id,order_id,status").eq("id", proofId).is("archived_at", null).maybeSingle();
    if (!proof) return { ok: false, error: "We couldn't find that proof." };
    if (!view && proof.status !== "pending") return { ok: false, error: "This proof was already reviewed." };
    const { admin, order } = await customerOrder(proof.order_id);
    const { data: mk } = await admin.from("mockups").select("group_id").eq("proof_id", proofId).maybeSingle();
    const groups = orderGroups(order);
    const g = groups.find((x) => x.id === mk?.group_id) || groups[0];
    if (!g) return { ok: false, error: "This order has no garments yet." };
    return {
      ok: true, orderId: order.id, orderNumber: order.number, groupName: g.name || order.nickname || "Mockup",
      lines: g.lines.filter((l) => l.style || l.color).map((l) => ({ id: l.id, style: l.style, brand: l.brand, color: l.color, garment: l.garment })),
      imprints: g.imprints.map((d) => ({ ...d })),
      ordered: [...new Set(g.lines.flatMap((l) => Object.entries(l.sizes || {}).filter(([, q]) => +(q || 0) > 0).map(([z]) => z)))],
      mockupSize: g.mockupSize || "",
    };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/**
 * The customer changed the art themselves in their Mockup Creator: the proof goes back to the shop with their
 * version (garments, prints and the mockup they saved). We check it can print and send it back as the new proof.
 */
export async function submitOwnChange(proofId: string, change: { lines: { id?: string; style: string; brand: string; color: string; garment: string }[]; imprints: import("@/lib/pricing").Imprint[]; mockupPaths: string[]; note: string }): Promise<Result> {
  try {
    const { supabase, user } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    const { data: proof } = await supabase.from("proofs").select("id,order_id,title,status").eq("id", proofId).is("archived_at", null).maybeSingle();
    if (!proof) return { ok: false, error: "We couldn't find that proof." };
    const { admin, order, email, who, settings } = await customerOrder(proof.order_id);
    if (proof.status !== "pending") return { ok: false, error: "This proof was already reviewed. Refresh the page." };
    const { data: cu } = await admin.from("customers").select("id").eq("id", order.customer_id).maybeSingle();
    const paths = (change.mockupPaths || []).filter((x) => cu && x.startsWith(`mockups/${cu.id}/`)).slice(0, 6);
    const groups = orderGroups(order);
    const { data: mk } = await admin.from("mockups").select("group_id").eq("proof_id", proofId).maybeSingle();
    const g = groups.find((x) => x.id === mk?.group_id) || groups[0];
    // what they changed, in words, for the shop
    const was = g ? g.imprints : [];
    const diffs: string[] = [];
    const colorsNow = [...new Set((change.lines || []).map((l) => l.color).filter(Boolean))].join(", ");
    const colorsWas = g ? [...new Set(g.lines.map((l) => l.color).filter(Boolean))].join(", ") : "";
    if (colorsNow && colorsNow !== colorsWas) diffs.push(`Shirt color: ${colorsWas || "—"} → ${colorsNow}`);
    (change.imprints || []).slice(0, 12).forEach((d) => {
      const w = was.find((x) => x.location === d.location);
      if (!w) { diffs.push(`Added a print: ${d.location}${d.size ? `, ${d.size}` : ""}`); return; }
      if ((w.size || "") !== (d.size || "")) diffs.push(`${d.location} size: ${w.size || "—"} → ${d.size || "—"}`);
      if ((w.drop || "") !== (d.drop || "")) diffs.push(`${d.location} drop: ${w.drop ? `${w.drop}"` : "standard"} → ${d.drop ? `${d.drop}"` : "standard"}`);
      if ((w.inks || "") !== (d.inks || "")) diffs.push(`${d.location} ink: ${w.inks || "—"} → ${d.inks || "—"}`);
      if ((w.design_id || "") !== (d.design_id || "")) diffs.push(`${d.location}: a different logo`);
    });
    was.filter((w) => !(change.imprints || []).some((d) => d.location === w.location)).forEach((w) => diffs.push(`Removed the ${w.location} print`));
    const note = (change.note || "").trim().slice(0, 2000);
    const text = [`Changed it in the Mockup Creator.`, ...diffs.map((x) => `• ${x}`), note && `Note: ${note}`].filter(Boolean).join("\n");
    await admin.from("proofs").update({ status: "changes", customer_comment: text.slice(0, 2000), decided_at: new Date().toISOString(), decided_name: who,
      customer_change: { lines: change.lines, imprints: change.imprints, mockups: paths, group_id: g?.id || null, at: new Date().toISOString() } }).eq("id", proofId);
    // their mockup goes with the order group, where the shop sees the customer's mockups
    if (g && paths.length) {
      const ng = groups.map((x) => x.id === g.id ? { ...x, customerMockups: [...paths.map((p) => ({ path: p, name: "Customer's changes" })), ...(x.customerMockups || [])].slice(0, 8) } : x);
      await admin.from("orders").update({ groups: ng }).eq("id", order.id);
    }
    await admin.from("order_events").insert({ order_id: order.id, kind: "proof_changes", detail: `${proof.title} (changed it themselves)`, actor: email });
    await notifyShop(`Customer changed the art on #${order.number}`, `${who} made changes to "${proof.title}" in the Mockup Creator`, `${text}\n\nCheck it can print, then send the new proof.`, order.id, settings.shop.name);
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

/** A general message from the customer to the shop (not about one order). */
export async function customerGeneralMessage(body: string): Promise<Result> {
  try {
    const text = body.trim().slice(0, 5000);
    if (!text) return { ok: false, error: "Write a message first." };
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview. Customers send messages from their own login." };
    const { data: cs } = await supabase.from("customers").select("id,name,company");
    const cust = (cs || [])[0];
    if (!cust) return { ok: false, error: "We couldn't find your account." };
    const admin = createAdminClient();
    const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const settings = mergeSettings(s?.data);
    const who = cust.name || email;
    const { error } = await admin.from("messages").insert({ customer_id: cust.id, author_type: "customer", author_email: email, author_name: who, body: text });
    if (error) return { ok: false, error: error.message };
    if (SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `New message from ${cust.company || who}`, html: emailLayout(settings.shop.name, `${who} wrote`, text, "Open customer", `${siteUrl()}/shop/customers/${cust.id}?area=messages`) });
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Customer stars / unstars one of their designs. */
export async function starMyDesign(designId: string, starred: boolean): Promise<Result> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    // staff (including the portal preview) can star any design; customers only their own (checked in the database)
    const { error } = isStaff
      ? await createAdminClient().from("designs").update({ starred }).eq("id", designId)
      : await supabase.rpc("set_design_star", { p_design: designId, p_starred: starred });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Customer stars / unstars one of their mockups. */
export async function starMyMockup(mockupId: string, starred: boolean): Promise<Result> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    const { error } = isStaff
      ? await createAdminClient().from("mockups").update({ starred }).eq("id", mockupId)
      : await supabase.rpc("set_mockup_star", { p_mockup: mockupId, p_starred: starred });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Archive / bring back one of their mockups (Oct 24, Nick: "you need to be able to archive… it's not trash, you just archive
 * it"): the whole set (every shirt color with its number) moves to Archive. Staff can do it for any customer.
 */
export async function archiveMyMockup(mockupId: string, on: boolean): Promise<Result> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    // row security: a customer only sees their own mockups
    const { data: mk } = await supabase.from("mockups").select("id, customer_id, number").eq("id", mockupId).maybeSingle();
    if (!mk) return { ok: false, error: "We couldn't find that mockup." };
    const admin = createAdminClient();
    let q = admin.from("mockups").update({ shelved_at: on ? new Date().toISOString() : null }).eq("customer_id", mk.customer_id);
    q = mk.number ? q.eq("number", mk.number).is("archived_at", null) : q.eq("id", mk.id);
    const { error } = await q;
    if (error) return { ok: false, error: error.message };
    void isStaff;
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}
