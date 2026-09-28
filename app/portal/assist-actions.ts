"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { ST, type Order } from "@/lib/pricing";
import { portalSend } from "@/app/portal/message-actions";
import { GOODS, type GoodsStatus } from "@/lib/goods";

/** What the helper can offer to do. Nothing happens until the customer presses the button. */
export type AssistAction = {
  kind: "open_order" | "pay" | "reorder" | "new_order" | "new_order_from_text" | "open_mockup" | "message_shop" | "open_goods" | "open_payments" | "open_statement" | "open_orders" | "open_artwork";
  label: string;
  /** resolved by the server from the customer's own orders */
  orderId?: string; href?: string; archived?: boolean; number?: number;
  /** pay: what to select ("all of August"); message/new order: the text */
  text?: string;
};
export type AssistTurn = { role: "user" | "assistant"; text: string };

const TOOL = {
  name: "respond",
  description: "Answer the customer and offer the next steps as buttons.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "A short, friendly answer (1-3 sentences). Never use the customer's personal name. Use only facts from the account data." },
      actions: {
        type: "array", maxItems: 4,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["open_order", "pay", "reorder", "new_order", "new_order_from_text", "open_mockup", "message_shop", "open_goods", "open_payments", "open_statement", "open_orders", "open_artwork"] },
            label: { type: "string", description: "Button text, e.g. 'Reorder #1005 Summer Camp Tees' or 'Pay all of August ($812.40)'." },
            number: { type: "integer", description: "The order number this is about (for open_order, reorder)." },
            text: { type: "string", description: "pay: the selection in plain words ('all orders in August', 'everything under $100'). message_shop: the message to send the shop. new_order_from_text: what they want made." },
          },
          required: ["kind", "label"],
        },
      },
    },
    required: ["reply"],
  },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The customer's helper on their dashboard: "Where's my order?", "Pay my bill", "Reorder the AMS helper tees from November".
 * Claude sees a summary of this customer's own account (orders, balances, goods) and answers, offering buttons;
 * anything that changes something (reorders, new orders, messages, payments) only happens when the customer presses it.
 */
export async function portalAssist(history: AssistTurn[]): Promise<{ ok: boolean; error?: string; reply?: string; actions?: AssistAction[] }> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "The helper works from the customer's own login." };
    const turns = history.filter((t) => t.text.trim()).slice(-10).map((t) => ({ ...t, text: t.text.slice(0, 800) }));
    const last = turns[turns.length - 1]?.text || "";
    if (!last) return { ok: false, error: "Type what you need." };
    const admin = createAdminClient();

    // this customer's own account (row security limits what comes back)
    const { data: cs } = await supabase.from("customers").select("id, company, price_type, payment_terms");
    const ids = (cs || []).map((c) => c.id);
    if (!ids.length) return { ok: false, error: "We couldn't find your account." };
    const { data: os } = await supabase.from("orders").select("id, number, nickname, status, type, total, due_date, created_at, qty, po_number, price_type, submitted_at").neq("status", "quote").order("created_at", { ascending: false }).limit(150);
    const orders = ((os || []) as (Order & { submitted_at: string | null })[]).filter((o) => !(o.status === "request" && !o.submitted_at));
    const oids = orders.map((o) => o.id);
    const [{ data: pays }, { data: arch }, { data: goods }] = await Promise.all([
      oids.length ? admin.from("payments").select("order_id, amount").in("order_id", oids) : Promise.resolve({ data: [] }),
      admin.from("archived_orders").select("id, visual_id, nickname, status_name, order_date, total, qty").in("customer_id", ids).order("order_date", { ascending: false }).limit(150),
      oids.length ? admin.from("order_goods").select("order_id, status, issue_type").in("order_id", oids) : Promise.resolve({ data: [] }),
    ]);
    const paid: Record<string, number> = {};
    (pays || []).forEach((p) => { paid[p.order_id] = (paid[p.order_id] || 0) + (+p.amount || 0); });
    const gmap = new Map(((goods || []) as { order_id: string; status: GoodsStatus; issue_type: string }[]).map((g) => [g.order_id, g]));
    const wholesale = (cs || []).some((c) => c.price_type === "wholesale");
    const lines = orders.map((o) => {
      const bal = o.type === "invoice" ? r2((+o.total || 0) - (paid[o.id] || 0)) : 0;
      const g = gmap.get(o.id);
      return `#${o.number} | ${(o.created_at || "").slice(0, 10)} | ${o.nickname || "(no name)"} | ${o.type === "quote" ? "quote: " : ""}${ST[o.status as keyof typeof ST]?.portal || o.status} | total $${(+o.total || 0).toFixed(2)}${bal > 0.004 ? ` | owes $${bal.toFixed(2)}` : ""}${o.due_date ? ` | in-hands ${o.due_date}` : ""}${o.qty ? ` | ${o.qty} pcs` : ""}${o.po_number ? ` | PO ${o.po_number}` : ""}${wholesale && g ? ` | goods: ${GOODS[g.status]?.portal}${g.issue_type ? ` (${g.issue_type})` : ""}` : ""}`;
    });
    const old = ((arch || []) as { id: string; visual_id: string; nickname: string; status_name: string; order_date: string | null; total: number; qty: number }[])
      .map((a) => `#${a.visual_id} | ${a.order_date || ""} | ${a.nickname || "(no name)"} | past order (${a.status_name}) | total $${(+a.total || 0).toFixed(2)}${a.qty ? ` | ${a.qty} pcs` : ""}`);
    const due = orders.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, (+o.total || 0) - (paid[o.id] || 0)), 0);

    const byNumber = new Map<number, AssistAction>();
    orders.forEach((o) => byNumber.set(o.number, { kind: "open_order", label: "", orderId: o.id, href: `/portal/orders/${o.id}`, number: o.number }));
    (arch || []).forEach((a) => { const n = +a.visual_id; if (n && !byNumber.has(n)) byNumber.set(n, { kind: "open_order", label: "", orderId: a.id, href: `/portal/archive/${a.id}`, archived: true, number: n }); });

    const ai = await aiState(admin);
    let reply = "", raw: { kind: AssistAction["kind"]; label: string; number?: number; text?: string }[] = [];
    if (ai.ready) {
      const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
      const r = await askClaude<{ reply: string; actions?: typeof raw }>({
        task: "portal_assist", model: ai.settings.assistant.ai.fastModel || ai.settings.assistant.ai.model, maxTokens: 900, admin, tool: TOOL, ctx: { customer_id: ids[0], by: user.email || "customer" },
        system: `You are the helper in ${ai.settings.shop.name}'s customer portal (custom printed apparel: screen printing, embroidery, DTF). Today is ${today}.
Help this customer with their account: order status, paying, reordering, starting a new order, mockups, artwork, messages to the shop${wholesale ? ", and the garments (goods) they send us" : ""}.
Rules:
- Never use the customer's personal name.
- Only state facts found in the account data below. If something isn't there, say so and offer to message the shop.
- Keep replies short and plain. No markdown.
- Offer next steps as actions (buttons). Anything that changes something (reorder, new order, sending a message, paying) must be an action the customer presses, never done by you.
- Reorders: find the order they mean by name, date or number (past orders count too) and offer "reorder" with its number. If several match, list the best 2-3 as separate reorder buttons.
- Paying: offer "pay" with text describing the selection ("all orders in August", "everything", "#1002 and #1004", "everything under $100"). Include the amount in the label when you can work it out.
- New orders described in words ("48 navy tees with our logo on the front"): offer "new_order_from_text" with their description as text. Otherwise "new_order".
- Questions for a person, changes to an order in progress, rush requests, complaints: offer "message_shop" with a clear message written for them as text.
- Use open_order for status questions about one order.`,
        prompt: `ACCOUNT\nCompany: ${(cs || [])[0]?.company || ""}\nBalance due: $${due.toFixed(2)}\n\nORDERS (newest first; number | date | name | status | money | details)\n${lines.join("\n") || "(none)"}\n\nPAST ORDERS FROM BEFORE THE PORTAL\n${old.join("\n") || "(none)"}\n\nCONVERSATION\n${turns.map((t) => `${t.role === "user" ? "Customer" : "Helper"}: ${t.text}`).join("\n")}`,
      });
      if (!r.ok) return { ok: false, error: r.off ? "The helper is resting right now. Use the buttons below or message us." : r.error };
      reply = r.data.reply; raw = r.data.actions || [];
    } else {
      // no AI: a simple guess from keywords, same buttons
      const t = last.toLowerCase();
      if (/\bpay|bill|balance|owe|invoice/.test(t)) { reply = due > 0.004 ? `Your balance is $${due.toFixed(2)}.` : "You're all paid up."; raw = [{ kind: "pay", label: "Choose what to pay", text: last }, { kind: "open_statement", label: "View statement" }]; }
      else if (/reorder|again|same as/.test(t)) { reply = "Pick the order to repeat from your orders, then press Order this again."; raw = [{ kind: "open_orders", label: "See my orders" }]; }
      else if (/new order|place an order|quote|need shirts|order some/.test(t)) { reply = "Let's start a new order."; raw = [{ kind: "new_order", label: "Start an order" }]; }
      else if (/mockup|design|idea/.test(t)) { reply = "Try the Mockup Creator."; raw = [{ kind: "open_mockup", label: "Open Mockup Creator" }]; }
      else if (/status|where|when|ready|done|ship/.test(t)) { reply = "Here are your orders with their status."; raw = [{ kind: "open_orders", label: "See my orders" }]; }
      else { reply = "I'll pass that to the shop."; raw = [{ kind: "message_shop", label: "Send this to the shop", text: last }]; }
    }

    const actions: AssistAction[] = [];
    for (const a of raw.slice(0, 4)) {
      if (["open_order", "reorder"].includes(a.kind)) {
        const hit = a.number !== undefined ? byNumber.get(a.number) : undefined;
        if (!hit) continue; // never offer an order that isn't theirs
        actions.push({ ...hit, kind: a.kind, label: a.label || `#${a.number}` });
      } else actions.push({ kind: a.kind, label: a.label, text: a.text });
    }
    return { ok: true, reply, actions };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/**
 * "Reorder" a past order from before the portal. Those don't have garment details we can copy into a new order,
 * so the shop gets a clear request (in Messages, and by email) and sends back a quote.
 */
export async function reorderArchived(archivedId: string, note = ""): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user || isStaff) return { ok: false, error: "Reorders start from the customer's own login." };
    const { data: cs } = await supabase.from("customers").select("id");
    const admin = createAdminClient();
    const { data: a } = await admin.from("archived_orders").select("id, visual_id, nickname, qty").eq("id", archivedId).in("customer_id", (cs || []).map((c) => c.id)).maybeSingle();
    if (!a) return { ok: false, error: "We couldn't find that order." };
    return portalSend(null, `I'd like to reorder past order #${a.visual_id}${a.nickname ? ` (${a.nickname})` : ""}: same garments and artwork as before${a.qty ? ` (last time ${a.qty} pcs)` : ""}.${note ? `\n\n${note.slice(0, 1000)}` : ""}\n\nPlease send me a quote.`);
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
