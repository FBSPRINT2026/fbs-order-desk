"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import type { PayFilter } from "@/lib/paySelect";

const TOOL = {
  name: "select_orders",
  description: "The filter that picks which open orders the customer wants to pay.",
  input_schema: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "Everything open (no other limits needed)." },
      pastDue: { type: "boolean", description: "Only orders whose payment is past due." },
      status: { type: "array", items: { type: "string", enum: ["completed", "ready", "in_progress"] }, description: "completed = finished/picked up/shipped; ready = ready for pickup; in_progress = still being made." },
      months: { type: "array", items: { type: "string", pattern: "^\\d{4}-\\d{2}$" }, description: "Order months as YYYY-MM." },
      from: { type: "string", description: "Order date on or after, YYYY-MM-DD." },
      to: { type: "string", description: "Order date on or before, YYYY-MM-DD." },
      dueBy: { type: "string", description: "Payment due on or before, YYYY-MM-DD." },
      maxAmount: { type: "number" }, minAmount: { type: "number" },
      amountOn: { type: "string", enum: ["balance", "total"], description: "Amount limits apply to what's owed (balance, default) or the order total." },
      text: { type: "array", items: { type: "string" }, description: "Words that must appear in the job name/PO (use the customer's own words, or words from matching job names in the list)." },
      notText: { type: "array", items: { type: "string" }, description: "Words that must not appear in the job name." },
      numbers: { type: "array", items: { type: "integer" }, description: "Specific order numbers. Use this when the request clearly points at particular orders in the list." },
      explain: { type: "string", description: "One short sentence saying what was selected, in plain words." },
      unclear: { type: "boolean", description: "True if the request can't be turned into a selection." },
    },
    required: ["explain"],
  },
};

/**
 * Claude reads the customer's sentence ("the fundraiser stuff", "everything but the hoodies") next to their own
 * open orders and returns a filter. The browser applies it and shows the result for the customer to confirm;
 * nothing is paid without them pressing Pay.
 */
export async function aiPaySelect(text: string): Promise<{ ok: boolean; error?: string; filter?: PayFilter; explain?: string; off?: boolean }> {
  try {
    const q = text.trim().slice(0, 300);
    if (!q) return { ok: false, error: "Type what you'd like to pay." };
    const { supabase, user } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    const admin = createAdminClient();
    const ai = await aiState(admin);
    if (!ai.ready) return { ok: false, off: true, error: "Smart selection isn't available right now." };
    // the customer's own open orders (row security), so Claude can match job names
    const { data: os } = await supabase.from("orders").select("number, nickname, po_number, status, type, total, created_at").neq("status", "quote").eq("type", "invoice").neq("status", "completed").order("number", { ascending: false }).limit(400);
    const { data: done } = await supabase.from("orders").select("number, nickname, po_number, status, type, total, created_at").eq("status", "completed").order("number", { ascending: false }).limit(200);
    const list = [...(os || []), ...(done || [])].map((o) => `#${o.number} | ${(o.created_at || "").slice(0, 10)} | ${o.status} | $${(+o.total || 0).toFixed(2)} | ${o.nickname || ""}${o.po_number ? ` | PO ${o.po_number}` : ""}`).join("\n");
    const today = new Date().toISOString().slice(0, 10);
    const r = await askClaude<PayFilter & { explain: string; unclear?: boolean }>({
      task: "pay_select", model: ai.settings.assistant.ai.fastModel || ai.settings.assistant.ai.model, maxTokens: 600, admin, tool: TOOL, ctx: { by: user.email || "customer" },
      system: `A print shop customer is choosing which of their open orders to pay. Turn their request into the select_orders filter. Today is ${today}. Use as few fields as needed. Prefer general rules (months, amounts, status, words) over listing numbers, unless they name particular jobs; then put the matching order numbers in "numbers". Never invent orders. If the request isn't about choosing orders, set unclear.`,
      prompt: `Their orders (number | date | status | total | job name):\n${list || "(none)"}\n\nWhat they typed: "${q}"`,
    });
    if (!r.ok) return { ok: false, error: r.error, off: r.off };
    if (r.data.unclear) return { ok: false, error: "I couldn't tell which orders you mean. Try something like “all of August” or “everything under $100”." };
    const { explain, unclear: _u, ...filter } = r.data;
    return { ok: true, filter, explain };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
