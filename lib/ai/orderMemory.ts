import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What staff taught the AI about a customer's orders, remembered for their next emails (Oct 20, Nick: "if Terrible
 * Toddler… you don't get it right, I can say, oh, all they were looking for was a reorder of this order… and it learns
 * and remembers").
 *
 * Saved when staff tick "Remember this for <customer>" on what they told the order reader, or start an Assistant
 * message with "remember", "from now on" or "next time". Kept as ai_suggestions rows (kind order_memory, one per
 * note), read into every order reading for that customer: how many orders an email holds (emailPlan), the order
 * itself (emailOrder) and the Inbox Assistant (emailChat). Staff see them and forget any in the Create order panel.
 */
export const MEMORY_KIND = "order_memory";
export type Memory = { id: string; text: string; by: string; at: string; subject?: string };

export async function loadMemories(admin: SupabaseClient, customerId: string | null): Promise<Memory[]> {
  if (!customerId) return [];
  const { data } = await admin.from("ai_suggestions").select("id, payload, created_at").eq("kind", MEMORY_KIND).eq("customer_id", customerId).neq("status", "dismissed").order("created_at", { ascending: false }).limit(30);
  return (data || []).map((r) => { const p = (r.payload || {}) as Partial<Memory>; return { id: r.id as string, text: String(p.text || ""), by: String(p.by || ""), at: String(p.at || r.created_at || ""), ...(p.subject ? { subject: p.subject } : {}) }; }).filter((m) => m.text);
}

/** the memories as the AI reads them (newest first; a newer one wins where they disagree) */
export function memoryText(ms: Memory[], who: string) {
  if (!ms.length) return "";
  return `WHAT STAFF TAUGHT YOU ABOUT ${who.toUpperCase()} (from earlier emails, newest first: facts about how this customer orders; apply them whenever they fit this email, a newer one wins where two disagree):
${ms.map((m) => `- ${m.at.slice(0, 10)}${m.subject ? ` (about "${m.subject.slice(0, 80)}")` : ""}: ${m.text}`).join("\n")}`;
}

export async function saveMemory(admin: SupabaseClient, o: { customerId: string; text: string; by: string; activityId?: string | null; subject?: string }) {
  const text = o.text.replace(/^\s*(please\s+)?(remember( that)?|from now on|next time)[:,]?\s*/i, "").trim().slice(0, 600);
  if (!text) return { ok: false as const, error: "Nothing to remember." };
  const at = new Date().toISOString();
  const { data, error } = await admin.from("ai_suggestions").insert({
    kind: MEMORY_KIND, dedupe_key: `memory:${o.customerId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, priority: 3, source: "staff", status: "done",
    customer_id: o.customerId, activity_id: o.activityId || null, title: "Remembered for this customer's orders", body: text,
    payload: { text, by: o.by, at, ...(o.subject ? { subject: o.subject.slice(0, 120) } : {}) },
  }).select("id").single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, id: data.id as string, text };
}

export async function forgetMemory(admin: SupabaseClient, id: string) {
  const { error } = await admin.from("ai_suggestions").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", id).eq("kind", MEMORY_KIND);
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * The shop's own rules, approved by the owner from the overnight review of corrections (Oct 23, Nick: "you would then
 * store… you should learn from it… then we go on from there"): ai_suggestions rows (kind shop_rule). Every order
 * reading and the order check read them, for every customer.
 */
export const RULE_KIND = "shop_rule";
export async function loadShopRules(admin: SupabaseClient): Promise<{ id: string; text: string }[]> {
  const { data } = await admin.from("ai_suggestions").select("id, payload").eq("kind", RULE_KIND).neq("status", "dismissed").order("created_at", { ascending: false }).limit(40);
  return (data || []).map((r) => ({ id: r.id as string, text: String(((r.payload || {}) as { text?: string }).text || "") })).filter((r) => r.text);
}
export const shopRulesText = (rs: { text: string }[]) => (rs.length ? `THE SHOP'S RULES (approved by the owner from past corrections; follow them on every order):\n${rs.map((r) => `- ${r.text}`).join("\n")}` : "");
