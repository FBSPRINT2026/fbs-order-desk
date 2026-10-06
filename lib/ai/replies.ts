import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { aiState } from "@/lib/ai/claude";
import { replyOptions } from "@/lib/ai/tasks";
import { calcOrder, mergeSettings, PAY_TERMS, ST, type Order, type Payment } from "@/lib/pricing";
import { custLabel, fmtDateLong, money } from "@/lib/format";

/**
 * What the AI needs to answer a customer: order facts, the email and its conversation, and the suggested answers
 * themselves (written ahead of time by the mailbox check, so they're waiting when someone opens the email).
 */

/** Facts about an order (and its customer) for the AI to write from. Never includes costs. */
export async function orderFacts(admin: SupabaseClient, orderId?: string | null, customerId?: string | null) {
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

/** what the AI needs to answer an email: the email, the thread so far, the order and customer (or their open orders) */
export async function emailContext(admin: SupabaseClient, activityId: string) {
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

type Opt = { label: string; subject: string; body: string };
/** write (or return the kept) suggested answers for one email, and keep them on it */
export async function writeReplyOptions(admin: SupabaseClient, activityId: string, st: Awaited<ReturnType<typeof aiState>>, by: string, fresh = false): Promise<{ ok: true; options: Opt[] } | { ok: false; off?: boolean; error: string }> {
  const { data: row } = await admin.from("activities").select("meta").eq("id", activityId).maybeSingle();
  const kept = ((row?.meta || {}) as { reply_options?: { options: Opt[] } }).reply_options;
  if (!fresh && kept?.options?.length) return { ok: true, options: kept.options };
  if (!st.ready) return { ok: false, off: true, error: st.reason || "AI is off." };
  const c = await emailContext(admin, activityId);
  if (!c) return { ok: false, error: "That email isn't on file." };
  const r = await replyOptions(st.settings, { email: c.email, facts: c.facts, history: c.history, today: c.today }, { admin, order_id: c.a.order_id as string | null, customer_id: c.a.customer_id as string | null, by });
  if (!r.ok) return { ok: false, error: r.error };
  const subj = String(c.a.subject || "");
  const re = subj.toLowerCase().startsWith("re:") ? subj : `Re: ${subj}`;
  const options = (r.data.options || []).slice(0, 4).map((o) => ({ label: o.label, subject: re, body: o.body }));
  const { data: now } = await admin.from("activities").select("meta").eq("id", activityId).maybeSingle(); // fresh meta (the mailbox check may have changed it)
  await admin.from("activities").update({ meta: { ...((now?.meta || {}) as object), reply_options: { at: new Date().toISOString(), options } } }).eq("id", activityId);
  return { ok: true, options };
}

/**
 * The mailbox check's spare seconds: suggested answers for customer email still waiting on a reply (open AI reply
 * card, last 14 days, none written yet), a couple per run, so they're ready before anyone opens the email.
 */
export async function prewriteReplyOptions(admin: SupabaseClient, accountId: string, st: Awaited<ReturnType<typeof aiState>>, deadline: number) {
  if (!st.ready) return 0;
  const { data: cand } = await admin.from("activities").select("id, meta").eq("kind", "email").eq("direction", "in").eq("meta->>account_id", accountId)
    .eq("meta->triage->>needs_reply", "true").is("meta->reply_options", null).not("ai_processed_at", "is", null)
    .gte("occurred_at", new Date(Date.now() - 14 * 864e5).toISOString()).order("occurred_at", { ascending: false }).limit(20);
  const ids = (cand || []).filter((x) => { const m = (x.meta || {}) as { no_reply?: boolean; ignored?: boolean }; return !m.no_reply && !m.ignored; }).map((x) => x.id as string);
  if (!ids.length) return 0;
  const { data: open } = await admin.from("ai_suggestions").select("activity_id").in("activity_id", ids).eq("kind", "email_reply").in("status", ["open", "snoozed"]);
  const waiting = ids.filter((id) => (open || []).some((o) => o.activity_id === id));
  let n = 0;
  for (const id of waiting.slice(0, 3)) {
    if (Date.now() > deadline - 20000) break;
    const r = await writeReplyOptions(admin, id, st, "mailbox").catch(() => null);
    if (r?.ok) n++;
  }
  return n;
}
