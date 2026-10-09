"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, hasAiKey, lookUpFacts, type LookedUp } from "@/lib/ai/claude";
import { draftMessage, orderFromText, reviewOrder } from "@/lib/ai/tasks";
import { emailContext, orderFacts, writeReplyOptions } from "@/lib/ai/replies";
import { describeGroups, proposalToGroups, type ProposedOrder } from "@/lib/ai/normalize";
import { processEmailActivity } from "@/lib/ai/email";
import { storeInboundEmail } from "@/lib/crm/inbound";
import { LOCATIONS, orderGroups, type Group, type Imprint, type Order } from "@/lib/pricing";
import { reorderCheck, type ReorderCheck, type ReorderFix } from "@/lib/ai/reorderCheck";

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

/**
 * 3 or 4 different answers to a customer's email ("Yes, we can make it", "Can't, offer Monday", …), each written out.
 * Usually already written by the mailbox check; "Other answers" (fresh) writes a new set.
 */
export async function aiReplyOptions(activityId: string, fresh = false) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    const r = await writeReplyOptions(admin, activityId, st, email || "staff", fresh);
    return r.ok ? { ok: true as const, options: r.options } : { ok: false as const, off: r.off, error: r.error };
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

/** "Back to inbox": an answered email goes back on Needs a reply (e.g. "Got it" was sent, the order still has to be made) */
export async function putBackInInbox(activityId: string) {
  try {
    const { admin } = await staff();
    const { data: a } = await admin.from("activities").select("id, meta").eq("id", activityId).maybeSingle();
    if (!a) return { ok: false as const, error: "That email isn't on file." };
    const meta = (a.meta || {}) as { triage?: Record<string, unknown> };
    await admin.from("activities").update({ meta: { ...meta, no_reply: false, reopened_at: new Date().toISOString(), triage: { ...(meta.triage || {}), needs_reply: true } } }).eq("id", activityId);
    return { ok: true as const };
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

/** Reorder check: the AI compares this reorder with the old job it copies (files, film, art, our mockup). */
/** Look up online what a staff note points to ("we used the LA Lakers PMS colors"); null when nothing to look up. */
export async function aiLookUp(note: string, ctx: { orderId?: string; activityId?: string } = {}) {
  try {
    const { admin, email } = await staff();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    const r = await lookUpFacts({ model: st.settings.assistant.ai.model, note, admin, ctx: { order_id: ctx.orderId || null, activity_id: ctx.activityId || null, by: email } });
    return { ok: true as const, lookedUp: r };
  } catch (e) { return fail(e); }
}

export async function aiReorderCheck(orderId: string, onlyIfNone = false, told?: string, lookedUp?: LookedUp | null) {
  try {
    const { admin, email } = await staff();
    if (onlyIfNone) {
      const { data: had } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `reorder_check:${orderId}`).limit(1).maybeSingle();
      // checked already, and no newer mockup since: show that one
      const { data: mk } = await admin.from("mockups").select("created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const c = had?.payload as ReorderCheck | undefined;
      if (c && !(mk && c.at && mk.created_at > c.at)) return { ok: true as const, check: c };
    }
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, off: true, error: st.reason };
    // what staff told it before is kept unless they change it
    let say = told, found = lookedUp ?? undefined;
    if (say == null) { const { data: had } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `reorder_check:${orderId}`).limit(1).maybeSingle(); const pc = had?.payload as ReorderCheck | undefined; say = pc?.told || ""; found = found || pc?.lookedUp; }
    const r = await reorderCheck(admin, st.settings, orderId, email, say, found);
    return r.ok ? { ok: true as const, check: r.check } : { ok: false as const, error: r.error };
  } catch (e) { return fail(e); }
}

/** The last reorder check on this order, if any. */
export async function lastReorderCheck(orderId: string) {
  try {
    const { admin } = await staff();
    const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `reorder_check:${orderId}`).limit(1).maybeSingle();
    return { ok: true as const, check: (data?.payload as ReorderCheck | undefined) || null };
  } catch (e) { return fail(e); }
}

/** Apply one fix from the reorder check to the print it names. */
export async function applyReorderFix(orderId: string, fix: ReorderFix) {
  try {
    const { admin, email } = await staff();
    const { data: o } = await admin.from("orders").select("id, groups").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false as const, error: "Order not found." };
    const groups = (o.groups || []) as Group[];
    let hit: Imprint | null = null;
    for (const g of groups) for (const im of g.imprints) if (im.id === fix.imprint_id) hit = im;
    if (!hit) return { ok: false as const, error: "That print isn't on the order anymore." };
    const v = String(fix.value || "").trim().slice(0, 120);
    if (fix.field === "size") hit.size = /^\d/.test(v) && !/wide|tall/i.test(v) ? `${parseFloat(v)}" wide` : v;
    else if (fix.field === "location") { if (!(LOCATIONS as readonly string[]).includes(v)) return { ok: false as const, error: `"${v}" isn't one of the locations.` }; hit.location = v; }
    else if (fix.field === "inks") hit.inks = v;
    else if (fix.field === "colors") { const n = parseInt(v, 10); if (!(n > 0 && n < 13)) return { ok: false as const, error: "Not a number of colors." }; hit.colors = n; }
    else if (fix.field === "drop") hit.drop = String(parseFloat(v) || "");
    else return { ok: false as const, error: "Unknown fix." };
    hit.notes = [hit.notes, `Reorder check: ${fix.field} → ${v} (${fix.why})`].filter(Boolean).join(". ").slice(0, 300);
    const { error } = await admin.from("orders").update({ groups }).eq("id", orderId);
    if (error) return { ok: false as const, error: error.message };
    await admin.from("order_events").insert({ order_id: orderId, kind: "edited", detail: `Reorder check fix: ${fix.field} → ${v}`, actor: email });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
