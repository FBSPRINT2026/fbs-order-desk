import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { loadShopRules } from "@/lib/ai/orderMemory";
import type { Settings } from "@/lib/pricing";

/**
 * The overnight look at the day's corrections (Oct 23, Nick: "I don't know how you want to store the corrections at
 * night and try to learn from them"; agreed: the ones that repeat, a short list on My Day in the morning, "here's what
 * went wrong yesterday, and here's the rule I'd add", the owner approves or not; real bugs marked for Claude to fix in
 * the code). Reads the open corrections (ai_suggestions kind order_correction), keeps one review (kind
 * correction_review) and puts a to-do on the owner's My Day. Approved rules become shop rules (orderMemory RULE_KIND).
 */
export type ReviewItem = { kind: "rule" | "bug" | "customer"; text: string; orders: number[]; times: number; state?: "approved" | "no" | "noted" };
export const REVIEW_KIND = "correction_review";

export async function reviewCorrections(admin: SupabaseClient, s: Settings): Promise<{ ok: true; n: number; reviewId?: string } | { ok: false; error: string }> {
  const { data: rows } = await admin.from("ai_suggestions").select("id, order_id, customer_id, title, body, payload, created_at").eq("kind", "order_correction").eq("status", "open").order("created_at").limit(80);
  if (!rows?.length) return { ok: true, n: 0 };
  const nums = new Map<string, number>();
  const ids = [...new Set(rows.map((r) => r.order_id).filter(Boolean))] as string[];
  if (ids.length) { const { data: os } = await admin.from("orders").select("id, number").in("id", ids); for (const o of os || []) nums.set(o.id as string, o.number as number); }
  const rules = await loadShopRules(admin).catch(() => []);
  const list = rows.map((r) => {
    const p = (r.payload || {}) as { by?: string; said?: string; changes?: { say?: string }[]; lesson?: string | null; rule?: string | null };
    return `- #${nums.get(r.order_id as string) || "?"} (${String(r.created_at).slice(0, 10)}, ${p.by || "staff"}): staff said "${(p.said || "").slice(0, 300)}" → changed: ${(p.changes || []).map((c) => c.say).filter(Boolean).join("; ") || "nothing"}${p.rule ? ` · suggested rule: ${p.rule}` : ""}${p.lesson ? ` · customer lesson: ${p.lesson}` : ""}`;
  }).join("\n");
  const r = await askClaude<{ summary: string; items: ReviewItem[] }>({
    task: "correction_review", model: s.assistant.ai.model, maxTokens: 1800, timeoutMs: 55_000, admin,
    tool: { name: "review", description: "What went wrong and what to change.", input_schema: { type: "object", properties: {
      summary: { type: "string", description: "One or two plain sentences for the owner: what went wrong most." },
      items: { type: "array", description: "At most 8, the most useful first.", items: { type: "object", properties: {
        kind: { type: "string", enum: ["rule", "bug", "customer"], description: "rule = a shop-wide rule the order reader should follow from now on; bug = the site itself did something wrong (a measurement, a step skipped) that needs fixing in the code; customer = only about one customer (already remembered for them)" },
        text: { type: "string", description: "One plain sentence. A rule says what to do every time; a bug says what went wrong." },
        orders: { type: "array", items: { type: "number" }, description: "The order numbers it came from" },
        times: { type: "number", description: "How many corrections were about this" },
      }, required: ["kind", "text", "orders", "times"] } },
    }, required: ["summary", "items"] } },
    system: `${SHOP_CONTEXT(s)}

You look over the corrections the shop's staff made to orders after the order was made (by Create order). Group the ones that are the same problem. Prefer problems that happened more than once. Don't repeat a rule the shop already has. Plain words, no jargon.`,
    prompt: `${rules.length ? `The shop's rules so far:\n${rules.map((x) => `- ${x.text}`).join("\n")}\n\n` : ""}The corrections:\n${list}`,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const items = (Array.isArray(r.data.items) ? r.data.items : []).filter((x) => x && x.text && ["rule", "bug", "customer"].includes(x.kind)).slice(0, 8).map((x) => ({ ...x, orders: Array.isArray(x.orders) ? x.orders.slice(0, 10) : [], times: Math.max(1, +x.times || 1) }));
  const { data: rv, error } = await admin.from("ai_suggestions").insert({
    kind: REVIEW_KIND, source: "ai", status: "open", priority: 2, title: `Corrections review: ${rows.length} correction${rows.length === 1 ? "" : "s"}`,
    body: String(r.data.summary || "").slice(0, 300), payload: { summary: r.data.summary, items, corrections: rows.map((x) => x.id), at: new Date().toISOString() }, model: r.model,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString() }).in("id", rows.map((x) => x.id));
  // on the owner's My Day
  const { data: own } = await admin.from("staff").select("email").eq("role", "owner").limit(1).maybeSingle();
  // only when there's something to decide (a rule to approve or a bug); one customer's own fixes don't need the owner
  const todo = items.filter((x) => x.kind !== "customer").length;
  if (own?.email && todo) await admin.from("tasks").insert({ owner: String(own.email).toLowerCase(), title: `Order corrections: ${todo} thing${todo === 1 ? "" : "s"} to look at`.slice(0, 200), notes: String(r.data.summary || "").slice(0, 1000), area: "shop", status: "open", source: "ai", url: `/shop/ai/review?id=${rv.id}`, created_by: "assistant" });
  return { ok: true, n: rows.length, reviewId: rv.id as string };
}
