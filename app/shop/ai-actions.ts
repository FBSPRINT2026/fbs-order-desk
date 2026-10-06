"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, hasAiKey } from "@/lib/ai/claude";
import { draftMessage, orderFromText, replyOptions, reviewOrder } from "@/lib/ai/tasks";
import { describeGroups, proposalToGroups, type ProposedOrder } from "@/lib/ai/normalize";
import { processEmailActivity } from "@/lib/ai/email";
import { storeInboundEmail } from "@/lib/crm/inbound";
import { calcOrder, mergeSettings, orderGroups, PAY_TERMS, ST, type Group, type Order, type Payment } from "@/lib/pricing";
import { custLabel, fmtDateLong, money } from "@/lib/format";

// Staff-only server actions for the Assistant, the CRM timeline and the AI helpers.
// AI helpers return { ok:false, off:true } until AI is turned on, so the UI can say how to turn it on.

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return { ...v, admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

/** Is AI available, and which parts are switched on? */
export async function getAiStatus() {
  try {
    const { admin } = await staff();
    const { settings, ready, reason } = await aiState(admin);
    return { ok: true as const, ready, reason, hasKey: hasAiKey(), enabled: settings.assistant.ai.enabled, readEmails: settings.assistant.ai.readEmails, customerAssist: settings.assistant.ai.customerAssist, model: settings.assistant.ai.model };
  } catch (e) { return fail(e); }
}

/** Facts about an order (and its customer) for the AI to write from. Never includes costs. */
async function orderFacts(admin: ReturnType<typeof createAdminClient>, orderId?: string | null, customerId?: string | null) {
  const lines: string[] = [];
  let history = "";
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);
  if (orderId) {
    const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (o) {
      const { data: pays } = await admin.from("payments").select("amount").eq("order_id", orderId);
      const c = calcOrder(o as Order, settings, (pays || []) as Payment[]);
      customerId = customerId || o.customer_id;
      lines.push(`Order #${o.number}${o.nickname ? ` "${o.nickname}"` : ""}, status: ${ST[o.status]?.portal || o.status}, ${c.qty} pieces, total ${money(c.total)}, paid ${money(c.paid)}, balance ${money(c.balance)}.`);
      if (o.due_date) lines.push(`In-hands date: ${fmtDateLong(o.due_date)}.`);
      if (o.sent_at) lines.push(`Quote sent: ${fmtDateLong(o.sent_at.slice(0, 10))}.`);
      if (o.delivery_method) lines.push(`Delivery: ${o.delivery_method}${o.tracking ? `, tracking ${o.tracking}` : ""}.`);
      const { data: pr } = await admin.from("proofs").select("status,title").eq("order_id", orderId);
      if (pr?.length) lines.push(`Proofs: ${pr.map((p) => `${p.title} (${p.status})`).join(", ")}.`);
      const { data: msgs } = await admin.from("messages").select("author_type,body,created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(6);
      history = (msgs || []).reverse().map((m) => `${m.author_type === "staff" ? "Shop" : "Customer"}: ${m.body.slice(0, 600)}`).join("\n");
    }
  }
  if (customerId) {
    const { data: c } = await admin.from("customers").select("company,name,payment_terms").eq("id", customerId).maybeSingle();
    if (c) lines.unshift(`Customer: ${custLabel(c)}${c.name ? `, contact ${c.name}` : ""}. Payment terms: ${PAY_TERMS[(c.payment_terms || "receipt") as keyof typeof PAY_TERMS]}.`);
  }
  lines.push(`Shop: ${settings.shop.name}${settings.shop.phone ? `, ${settings.shop.phone}` : ""}. Customers approve quotes, review proofs and pay in their online portal.`);
  return { facts: lines.join("\n"), history, settings };
}

/** Rewrite a follow-up / reply in the shop's voice. */
export async function aiRewriteDraft(input: { purpose: string; orderId?: string | null; customerId?: string | null; subject?: string; body?: string }) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    const { facts, history } = await orderFacts(admin, input.orderId, input.customerId);
    const r = await draftMessage(st.settings, { purpose: input.purpose.slice(0, 500), facts, history, starting: { subject: input.subject, body: input.body?.slice(0, 4000) } }, { admin, order_id: input.orderId, customer_id: input.customerId, by: email });
    return r.ok ? { ok: true as const, subject: r.data.subject, body: r.data.body } : { ok: false as const, error: r.error };
  } catch (e) { return fail(e); }
}

/** what the AI needs to answer an email: the email, the thread so far, the order and customer (or their open orders) */
async function emailContext(admin: ReturnType<typeof createAdminClient>, activityId: string) {
  const { data: a } = await admin.from("activities").select("id, customer_id, order_id, subject, body, from_email, occurred_at, thread_id, external_id, meta").eq("id", activityId).maybeSingle();
  if (!a) return null;
  const meta = (a.meta || {}) as { from_name?: string };
  const { facts, history: msgHistory } = await orderFacts(admin, a.order_id as string | null, a.customer_id as string | null);
  const lines = [facts];
  if (!a.order_id && a.customer_id) {
    const { data: os } = await admin.from("orders").select("number, nickname, status, due_date").eq("customer_id", a.customer_id).not("status", "in", "(completed,cancelled)").order("number", { ascending: false }).limit(6);
    if (os?.length) lines.push(`Their open orders: ${os.map((o) => `#${o.number}${o.nickname ? ` "${o.nickname}"` : ""} (${ST[o.status as keyof typeof ST]?.portal || o.status}${o.due_date ? `, in-hands ${fmtDateLong(o.due_date as string)}` : ""})`).join("; ")}.`);
  }
  // the email thread so far (both directions), oldest first: the emails this one references that we have on file
  const refs = (((a.meta || {}) as { references?: string[] }).references || []).slice(-10);
  let thread = "";
  if (refs.length) {
    const { data: t } = await admin.from("activities").select("direction, body, occurred_at").eq("kind", "email").in("external_id", refs).order("occurred_at", { ascending: false }).limit(5);
    thread = (t || []).reverse().map((m) => `${m.direction === "out" ? "Shop" : "Customer"}: ${String(m.body || "").slice(0, 700)}`).join("\n");
  }
  const email = `From: ${meta.from_name ? `${meta.from_name} <${a.from_email}>` : a.from_email}\nSubject: ${a.subject || ""}\n\n${String(a.body || "").slice(0, 6000)}`;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  return { a, email, facts: lines.join("\n"), history: [msgHistory, thread].filter(Boolean).join("\n"), today };
}

/** 3 or 4 different answers to a customer's email, each written out ("Yes, we can make it", "Can't, offer Monday", …) */
export async function aiReplyOptions(activityId: string) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    const c = await emailContext(admin, activityId);
    if (!c) return { ok: false as const, error: "That email isn't on file." };
    const r = await replyOptions(st.settings, { email: c.email, facts: c.facts, history: c.history, today: c.today }, { admin, order_id: c.a.order_id as string | null, customer_id: c.a.customer_id as string | null, by: email });
    if (!r.ok) return { ok: false as const, error: r.error };
    const subj = String(c.a.subject || "");
    const re = subj.toLowerCase().startsWith("re:") ? subj : `Re: ${subj}`;
    return { ok: true as const, options: (r.data.options || []).slice(0, 4).map((o) => ({ label: o.label, subject: re, body: o.body })) };
  } catch (e) { return fail(e); }
}

/** write (or rewrite) the reply to an email the way you say: "tell her yes if the art is approved by Friday" */
export async function aiWriteReply(input: { activityId: string; instruction?: string; subject?: string; body?: string }) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    const c = await emailContext(admin, input.activityId);
    if (!c) return { ok: false as const, error: "That email isn't on file." };
    const what = input.instruction?.trim();
    const purpose = what ? `Reply to the customer's email. What the shop wants to say: ${what.slice(0, 600)}` : input.body?.trim() ? "Polish this reply to the customer's email: keep what it says, make it clear and friendly." : "Reply to the customer's email.";
    const r = await draftMessage(st.settings, { purpose, facts: `${c.facts}\nToday is ${c.today}.\n\nThe customer's email:\n"""\n${c.email}\n"""`, history: c.history, starting: what ? undefined : { subject: input.subject, body: input.body?.slice(0, 4000) } }, { admin, order_id: c.a.order_id as string | null, customer_id: c.a.customer_id as string | null, by: email });
    return r.ok ? { ok: true as const, subject: input.subject || r.data.subject, body: r.data.body } : { ok: false as const, error: r.error };
  } catch (e) { return fail(e); }
}

/** "No reply needed": off the Needs a reply list (the email stays on file) */
export async function markNoReply(activityId: string, noReply = true) {
  try {
    const { admin, email } = await staff();
    const { data: a } = await admin.from("activities").select("id, meta").eq("id", activityId).maybeSingle();
    if (!a) return { ok: false as const, error: "That email isn't on file." };
    await admin.from("activities").update({ meta: { ...((a.meta || {}) as object), no_reply: noReply } }).eq("id", activityId);
    if (noReply) await admin.from("ai_suggestions").update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: email || "staff" }).eq("activity_id", activityId).eq("kind", "email_reply").in("status", ["open", "snoozed"]);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Read pasted text (an email, a text message, notes from a call) and propose order groups. */
export async function aiOrderFromText(text: string, orderId?: string | null) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    if (text.trim().length < 10) return { ok: false as const, error: "Paste the customer's email or notes first." };
    const r = await orderFromText(st.settings, text, { admin, order_id: orderId, by: email });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, groups: proposalToGroups(r.data), proposal: r.data };
  } catch (e) { return fail(e); }
}

/** Have the AI check an order for problems. */
export async function aiReviewOrder(orderId: string) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false as const, error: "Order not found." };
    const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", orderId).maybeSingle();
    const text = [
      `Order #${o.number} "${o.nickname || ""}", status ${o.status}, ${o.price_type === "wholesale" ? "customer supplies garments" : "shop supplies garments"}.`,
      `In-hands date: ${o.due_date || "not set"}. Production date: ${o.production_date || "not set"}. Today: ${new Date().toISOString().slice(0, 10)}. Rush: ${o.rush ? "yes" : "no"}.`,
      `Delivery: ${o.delivery_method}${o.delivery_method !== "pickup" ? ` to ${o.ship_to || "(no address)"} via ${o.ship_method || "(no method)"}` : ""}.`,
      describeGroups(orderGroups(o as Order)),
      o.notes ? `Customer notes: ${o.notes}` : "",
      inn?.production_notes ? `Production notes: ${inn.production_notes}` : "",
    ].filter(Boolean).join("\n");
    const r = await reviewOrder(st.settings, text, { admin, order_id: orderId, customer_id: o.customer_id, by: email });
    return r.ok ? { ok: true as const, ...r.data } : { ok: false as const, error: r.error };
  } catch (e) { return fail(e); }
}

/** Turn a proposed order (from an email suggestion) into a real quote. Works with or without AI on. */
export async function quoteFromSuggestion(suggestionId: string) {
  try {
    const { admin, email } = await staff();
    const { data: sg } = await admin.from("ai_suggestions").select("*").eq("id", suggestionId).maybeSingle();
    if (!sg) return { ok: false as const, error: "Suggestion not found." };
    const groups = ((sg.payload?.groups || []) as Group[]);
    if (!groups.length) return { ok: false as const, error: "This suggestion has no order in it." };
    const p = (sg.payload?.proposal || {}) as ProposedOrder;
    const { data: cust } = sg.customer_id ? await admin.from("customers").select("price_type,tax_exempt").eq("id", sg.customer_id).maybeSingle() : { data: null };
    const { data, error } = await admin.from("orders").insert({
      customer_id: sg.customer_id, status: "quote", type: "quote", source: "email", groups, lines: [],
      nickname: (p.nickname || "").slice(0, 120), due_date: /^\d{4}-\d{2}-\d{2}$/.test(p.due_date || "") ? p.due_date : null,
      notes: (p.notes || "").slice(0, 2000), po_number: (p.po_number || "").slice(0, 60),
      delivery_method: p.delivery && ["pickup", "ship", "deliver"].includes(p.delivery) ? p.delivery : "pickup", ship_to: (p.ship_to || "").slice(0, 500),
      price_type: cust?.price_type || "retail", tax_exempt: !!cust?.tax_exempt,
    }).select("id").single();
    if (error) return { ok: false as const, error: error.message };
    await admin.from("order_events").insert({ order_id: data.id, kind: "created", detail: "From an email (Assistant)", actor: email });
    if (p.questions?.length) await admin.from("order_internal").upsert({ order_id: data.id, production_notes: `Questions for the customer (from the Assistant):\n- ${p.questions.join("\n- ")}` });
    if (sg.activity_id) await admin.from("activities").update({ order_id: data.id }).eq("id", sg.activity_id);
    await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: email, order_id: data.id }).eq("id", suggestionId);
    return { ok: true as const, id: data.id as string };
  } catch (e) { return fail(e); }
}

/** Log a call, note, meeting or pasted email on a customer's timeline (and optionally an order). */
export async function logActivity(input: { customerId: string | null; orderId?: string | null; kind: "note" | "call" | "email" | "meeting" | "task" | "sms"; direction?: "in" | "out" | "none"; subject?: string; body: string; occurredAt?: string; fromEmail?: string }) {
  try {
    const { admin, email } = await staff();
    const body = (input.body || "").trim();
    if (!body && !(input.subject || "").trim()) return { ok: false as const, error: "Write something first." };
    let customerId = input.customerId;
    if (!customerId && input.orderId) {
      const { data: o } = await admin.from("orders").select("customer_id").eq("id", input.orderId).maybeSingle();
      customerId = o?.customer_id || null;
    }
    const { data, error } = await admin.from("activities").insert({
      customer_id: customerId, order_id: input.orderId || null, kind: input.kind, direction: input.direction || (input.kind === "email" ? "in" : "none"),
      subject: (input.subject || "").slice(0, 500), body: body.slice(0, 100000), from_email: (input.fromEmail || "").toLowerCase().slice(0, 300),
      occurred_at: input.occurredAt && !isNaN(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : new Date().toISOString(),
      created_by: email,
    }).select("*").single();
    if (error) return { ok: false as const, error: error.message };
    // a pasted customer email gets read by the AI when that's switched on
    let aiNote = "";
    if (input.kind === "email" && (input.direction || "in") === "in") {
      const r = await processEmailActivity(admin, data.id);
      aiNote = r.ok ? (r.created ? `The Assistant left ${r.created} suggestion${r.created === 1 ? "" : "s"}.` : "") : "";
    }
    if (customerId) revalidatePath(`/shop/customers/${customerId}`);
    return { ok: true as const, activity: data, aiNote };
  } catch (e) { return fail(e); }
}

/** Store a raw email (e.g. pasted with headers) exactly like the inbound webhook does. */
export async function addEmailToTimeline(input: { from: string; subject: string; text: string }) {
  try {
    const { admin } = await staff();
    const r = await storeInboundEmail(admin, { from: input.from, subject: input.subject, text: input.text });
    if (r.id) await processEmailActivity(admin, r.id);
    return { ok: true as const, ...r };
  } catch (e) { return fail(e); }
}

/** Run the AI over one stored email now (e.g. after turning AI on). */
export async function aiProcessEmail(activityId: string) {
  try {
    const { admin } = await staff();
    return await processEmailActivity(admin, activityId);
  } catch (e) { return { ...fail(e), created: 0 }; }
}
