import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState } from "@/lib/ai/claude";
import { orderFromText, triageEmail } from "@/lib/ai/tasks";
import { proposalToGroups } from "@/lib/ai/normalize";
import { custLabel } from "@/lib/format";

/**
 * Has the AI read one incoming email (an activity) and leave suggestions in the Assistant:
 *   - a drafted reply when the email needs one
 *   - a proposed order (groups ready to become a quote) when it's a new order or reorder
 *   - a pointer to the order when it's about an existing one
 * Nothing is sent or changed without staff clicking. Safe to call twice: suggestions are keyed by email.
 */
export async function processEmailActivity(admin: SupabaseClient, activityId: string): Promise<{ ok: boolean; error?: string; created: number }> {
  const { settings, ready, reason } = await aiState(admin);
  if (!ready || !settings.assistant.ai.readEmails) return { ok: false, error: reason || "Reading emails is off.", created: 0 };
  const { data: a } = await admin.from("activities").select("*").eq("id", activityId).maybeSingle();
  if (!a) return { ok: false, error: "Email not found.", created: 0 };
  if (a.ai_processed_at) return { ok: true, created: 0 };

  const { data: cust } = a.customer_id ? await admin.from("customers").select("id,company,name,email").eq("id", a.customer_id).maybeSingle() : { data: null };
  const { data: open } = a.customer_id
    ? await admin.from("orders").select("id,number,nickname,status").eq("customer_id", a.customer_id).neq("status", "completed").order("number", { ascending: false }).limit(10)
    : { data: [] };
  const ctx = { admin, activity_id: a.id as string, customer_id: (a.customer_id as string) || null, order_id: (a.order_id as string) || null, by: "assistant" };
  const t = await triageEmail(settings, {
    from: a.from_email, subject: a.subject, body: a.body,
    customer: cust ? `${custLabel(cust)} <${cust.email}>` : undefined,
    openOrders: (open || []).map((o) => `#${o.number} ${o.nickname || ""} (${o.status})`).join("; "),
  }, ctx);
  if (!t.ok) return { ok: false, error: t.error, created: 0 };
  const tri = t.data;
  const who = cust ? custLabel(cust) : a.from_email;
  const rows: Record<string, unknown>[] = [];
  let orderId = a.order_id as string | null;
  if (!orderId && tri.order_number && a.customer_id) {
    const hit = (open || []).find((o) => o.number === tri.order_number);
    if (hit) orderId = hit.id as string;
  }

  if (tri.intent !== "not_customer" && tri.needs_reply && tri.suggested_reply) {
    rows.push({ kind: "email_reply", dedupe_key: `email:${a.id}:reply`, priority: tri.urgency === "high" ? 1 : 2, source: "ai", model: t.model, run_id: t.runId,
      customer_id: a.customer_id, order_id: orderId, activity_id: a.id,
      title: `Reply to ${who}: ${a.subject || "(no subject)"}`, body: tri.summary, payload: { from_email: a.from_email },
      draft: { channel: "email", subject: a.subject?.toLowerCase().startsWith("re:") ? a.subject : `Re: ${a.subject || ""}`, body: tri.suggested_reply } });
  }
  if (tri.intent === "new_order" || tri.intent === "reorder") {
    const p = await orderFromText(settings, `Subject: ${a.subject}\n\n${a.body}`, ctx);
    if (p.ok) {
      const groups = proposalToGroups(p.data);
      if (groups.length) rows.push({ kind: "draft_order", dedupe_key: `email:${a.id}:order`, priority: 1, source: "ai", model: p.model, run_id: p.runId,
        customer_id: a.customer_id, order_id: null, activity_id: a.id,
        title: `New order in ${who}'s email`, body: `${tri.summary}${p.data.questions?.length ? `\nStill need: ${p.data.questions.join("; ")}` : ""}`,
        payload: { proposal: p.data, groups } });
    }
  } else if (orderId && ["change_to_order", "artwork", "payment"].includes(tri.intent)) {
    rows.push({ kind: "email_about_order", dedupe_key: `email:${a.id}:order_note`, priority: tri.urgency === "high" ? 1 : 2, source: "ai", model: t.model, run_id: t.runId,
      customer_id: a.customer_id, order_id: orderId, activity_id: a.id,
      title: `${who} emailed about an order (${tri.intent.replace(/_/g, " ")})`, body: tri.summary });
  }

  if (rows.length) await admin.from("ai_suggestions").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true, defaultToNull: false });
  await admin.from("activities").update({ ai_processed_at: new Date().toISOString(), order_id: orderId, meta: { ...(a.meta || {}), triage: tri } }).eq("id", a.id);
  return { ok: true, created: rows.length };
}
