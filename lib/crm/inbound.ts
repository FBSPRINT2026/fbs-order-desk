import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type InboundEmail = {
  from: string; fromName?: string; to?: string; subject: string; text: string;
  messageId?: string; inReplyTo?: string; date?: string;
};

/**
 * Saves an email to the customer timeline (activities), matched to a customer by the sender's
 * address and to an order by a "#1234" in the subject. The same Message-ID is only stored once.
 * Returns the activity id, or null when it was a duplicate.
 */
export async function storeInboundEmail(admin: SupabaseClient, e: InboundEmail): Promise<{ id: string | null; customerId: string | null; orderId: string | null }> {
  const from = (e.from || "").trim().toLowerCase();
  const { data: custs } = from
    ? await admin.from("customers").select("id").or(`email.eq.${from.replace(/[,()"]/g, "")},contact2_email.eq.${from.replace(/[,()"]/g, "")}`).limit(1)
    : { data: [] };
  const customerId = (custs?.[0]?.id as string) || null;
  let orderId: string | null = null;
  const num = (e.subject || "").match(/(?:#|order\s*#?\s*|quote\s*#?\s*|invoice\s*#?\s*)(\d{3,7})\b/i)?.[1];
  if (num && customerId) {
    // only link when the order belongs to the sender (a supplier's "Order #1234" must not land on our #1234)
    const { data: o } = await admin.from("orders").select("id,customer_id").eq("number", +num).maybeSingle();
    if (o && o.customer_id === customerId) orderId = o.id as string;
  }
  const row = {
    customer_id: customerId, order_id: orderId, kind: "email", direction: "in",
    subject: (e.subject || "").slice(0, 500), body: (e.text || "").slice(0, 100000),
    from_email: from, to_email: (e.to || "").slice(0, 500),
    external_id: e.messageId ? e.messageId.slice(0, 500) : null, thread_id: e.inReplyTo ? e.inReplyTo.slice(0, 500) : null,
    occurred_at: e.date && !isNaN(Date.parse(e.date)) ? new Date(e.date).toISOString() : new Date().toISOString(),
    meta: e.fromName ? { from_name: e.fromName.slice(0, 200) } : {}, created_by: "email",
  };
  if (row.external_id) {
    const { data: dup } = await admin.from("activities").select("id").eq("external_id", row.external_id).maybeSingle();
    if (dup) return { id: null, customerId, orderId };
  }
  const { data, error } = await admin.from("activities").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, customerId, orderId };
}
