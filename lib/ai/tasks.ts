import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, type AiCtx } from "@/lib/ai/claude";
import { LOCATIONS, SIZES, type Settings } from "@/lib/pricing";
import type { ProposedOrder } from "@/lib/ai/normalize";

// The AI jobs the order desk can hand to Claude. Each one has a clear job description, the shop's
// facts it needs, and a strict answer format. Add new jobs here the same way.

export const SHOP_CONTEXT = (s: Settings) => `You work at ${s.shop.name}, a screen printing, embroidery and DTF shop.
Order vocabulary:
- Garments are listed by style number and brand (e.g. Gildan 5000, Bella+Canvas 3001, Next Level 6210) with a color and a size run.
- Sizes: ${SIZES.join(", ")} (Y* = youth, OS = one size, for hats and bags).
- Print methods: screen print (priced by number of ink colors; 11+ colors means full color), embroidery, DTF transfer.
- Print locations: ${LOCATIONS.join(", ")}.
- A "group" is a set of garments that share the same prints.
Rules: never invent prices, costs or totals. Never promise dates. If something is unclear, ask about it instead of guessing.`;

const ORDER_TOOL = {
  name: "propose_order",
  description: "The order details found in the text, in the shop's order format.",
  input_schema: {
    type: "object",
    properties: {
      nickname: { type: "string", description: "Short job name, e.g. 'Fall 5K race tees'" },
      due_date: { type: ["string", "null"], description: "In-hands date as YYYY-MM-DD if a specific date is given, else null" },
      po_number: { type: "string" },
      delivery: { type: ["string", "null"], enum: ["pickup", "ship", "deliver", null] },
      ship_to: { type: "string" },
      notes: { type: "string", description: "Anything else the shop should know, in one or two sentences" },
      customer: { type: "object", properties: { company: { type: "string" }, name: { type: "string" }, email: { type: "string" }, phone: { type: "string" } } },
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            garments: { type: "array", items: { type: "object", properties: {
              style: { type: "string" }, brand: { type: "string" }, description: { type: "string" }, color: { type: "string" },
              sizes: { type: "object", description: "Size name to quantity, e.g. {\"S\":10,\"M\":20}", additionalProperties: { type: "integer" } },
            } } },
            prints: { type: "array", items: { type: "object", properties: {
              method: { type: "string", enum: ["screen", "embroidery", "dtf"] }, location: { type: "string" },
              colors: { description: "Number of ink colors, or 'full'", anyOf: [{ type: "integer" }, { type: "string", enum: ["full"] }] },
              inks: { type: "string" }, size: { type: "string", description: "e.g. 11\" wide" }, notes: { type: "string" },
            } } },
          },
        },
      },
      questions: { type: "array", items: { type: "string" }, description: "What the shop still needs to ask the customer" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["groups", "questions", "confidence"],
  },
};

/** Read an email / message / description and propose order inputs. */
export function orderFromText(s: Settings, text: string, ctx: AiCtx & { admin?: SupabaseClient; today?: string }) {
  return askClaude<ProposedOrder>({
    task: "order_from_text", model: s.assistant.ai.model, maxTokens: 3000, ctx, admin: ctx.admin, tool: ORDER_TOOL,
    system: `${SHOP_CONTEXT(s)}\n\nYour job: read what a customer wrote and fill in the order form for the shop to check. Only include what the customer actually said or clearly implied. Put garments that share the same prints in one group. Today is ${ctx.today || new Date().toISOString().slice(0, 10)}.`,
    prompt: `Customer's words:\n"""\n${text.slice(0, 20000)}\n"""`,
  });
}

/**
 * The different ways the shop could answer a customer's email (yes / no / yes-if / a question back), each written
 * out as a complete reply, so the person answering just picks one.
 */
export function replyOptions(s: Settings, input: { email: string; facts: string; history?: string; today: string }, ctx: AiCtx & { admin?: SupabaseClient }) {
  return askClaude<{ options: { label: string; subject: string; body: string }[] }>({
    task: "reply_options", model: s.assistant.ai.model, maxTokens: 3000, ctx, admin: ctx.admin,
    tool: { name: "reply_options", description: "Different answers the shop could give, each a complete reply.", input_schema: { type: "object", properties: { options: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: {
      label: { type: "string", description: "The decision in 3-8 plain words, from the shop's side, e.g. \"Yes, we can make the date\", \"Can't make it, offer the 24th\", \"Yes if we get the order by Saturday\"" },
      subject: { type: "string" },
      body: { type: "string", description: "The whole reply. Plain text, no markdown, under 130 words." },
    }, required: ["label", "subject", "body"] } } }, required: ["options"] } },
    system: `${SHOP_CONTEXT(s)}\n\nYour job: a customer emailed the shop. Give the person answering 3 or 4 genuinely different answers to choose from, each written out as a complete reply they could send as is. Cover the real decisions this email calls for (for a date: yes / no with an alternative / yes on a condition such as getting the order, art approval or payment by a day; for a price or change: accept / counter / ask a question). Put the most likely answer first. Don't make up facts: when an answer needs something you don't know (a new date, a price), make it a condition or a question, or name a sensible weekday relative to today. Voice: ${s.assistant.ai.voice}\nStart with a greeting using the customer's first name if known. End with a short sign-off line (e.g. "Thanks,") but no name, title, phone or company block: the sender's signature is added when it's sent. Today is ${input.today}.`,
    prompt: `The customer's email:\n"""\n${input.email.slice(0, 6000)}\n"""\n\nWhat we know:\n${input.facts}\n${input.history ? `\nEarlier in this conversation (oldest first):\n${input.history}\n` : ""}`,
  });
}

/** Rewrite a follow-up message in the shop's voice, using the facts given. */
export function draftMessage(s: Settings, input: { purpose: string; facts: string; starting?: { subject?: string; body?: string }; history?: string }, ctx: AiCtx & { admin?: SupabaseClient }) {
  return askClaude<{ subject: string; body: string }>({
    task: "draft_message", model: s.assistant.ai.model, maxTokens: 800, ctx, admin: ctx.admin,
    tool: { name: "message", description: "The message to send the customer.", input_schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string", description: "Plain text, no markdown, under 120 words" } }, required: ["subject", "body"] } },
    system: `${SHOP_CONTEXT(s)}\n\nYour job: write a short message from the shop to a customer. Voice: ${s.assistant.ai.voice}\nUse only the facts given. Plain text. No markdown, no placeholders in brackets. End with a short sign-off line (e.g. "Thanks,") but no name, title, phone or company block: the sender's signature is added when it's sent.`,
    prompt: `Purpose: ${input.purpose}\n\nFacts:\n${input.facts}\n${input.history ? `\nRecent conversation (oldest first):\n${input.history}\n` : ""}${input.starting?.body ? `\nStarting draft to improve:\nSubject: ${input.starting.subject || ""}\n${input.starting.body}` : ""}`,
  });
}

/** Check an order for problems before it goes to the customer or the press. */
export function reviewOrder(s: Settings, orderText: string, ctx: AiCtx & { admin?: SupabaseClient }) {
  return askClaude<{ summary: string; issues: { severity: "high" | "medium" | "low"; text: string }[] }>({
    task: "review_order", model: s.assistant.ai.model, maxTokens: 1200, ctx, admin: ctx.admin,
    tool: { name: "review", description: "Problems found in the order.", input_schema: { type: "object", properties: {
      summary: { type: "string", description: "One sentence on the order" },
      issues: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["high", "medium", "low"] }, text: { type: "string" } }, required: ["severity", "text"] } },
    }, required: ["summary", "issues"] } },
    system: `${SHOP_CONTEXT(s)}\n\nYour job: check this order like an experienced production manager before it's sent or printed. Look for missing or conflicting details: garments without sizes or colors, prints without a logo, ink count not matching colors, print sizes that don't fit the location or youth sizes, light inks on light garments, embroidery on thin fabric, unrealistic dates, notes that contradict the form. Only list real problems, most important first. If it looks good, return no issues.`,
    prompt: orderText.slice(0, 20000),
  });
}

export type EmailTriage = {
  intent: "new_order" | "reorder" | "change_to_order" | "artwork" | "payment" | "question" | "not_customer" | "other";
  summary: string;
  urgency: "high" | "normal" | "low";
  urgent_reason?: string;
  order_number: number | null;
  needs_reply: boolean;
  suggested_reply: string;
};

/** Sort an incoming email and say what the shop should do with it. */
export function triageEmail(s: Settings, email: { from: string; subject: string; body: string; customer?: string; openOrders?: string }, ctx: AiCtx & { admin?: SupabaseClient }) {
  return askClaude<EmailTriage>({
    task: "triage_email", model: s.assistant.ai.fastModel || s.assistant.ai.model, maxTokens: 900, ctx, admin: ctx.admin,
    tool: { name: "triage", description: "What this email is and what to do.", input_schema: { type: "object", properties: {
      intent: { type: "string", enum: ["new_order", "reorder", "change_to_order", "artwork", "payment", "question", "not_customer", "other"] },
      summary: { type: "string", description: "One sentence" },
      urgency: { type: "string", enum: ["high", "normal", "low"], description: "high when the customer needs a fast answer or fast work: a rush or quick turnaround, a deadline or event within about 7 days, a same-day pickup, a problem with an order in progress, or words like urgent / ASAP / today. low for thank-yous and FYIs." },
      urgent_reason: { type: "string", description: "When urgency is high: why, in a few words with the date, e.g. \"85 shirts needed by Fri Oct 9\". Empty otherwise." },
      order_number: { type: ["integer", "null"] },
      needs_reply: { type: "boolean" },
      suggested_reply: { type: "string", description: `A short reply in this voice: ${s.assistant.ai.voice}. End with a short sign-off (e.g. "Thanks,") but no name, title or phone block; the sender's email signature is added. Empty if no reply is needed.` },
    }, required: ["intent", "summary", "urgency", "needs_reply", "suggested_reply"] } },
    system: `${SHOP_CONTEXT(s)}\n\nYour job: sort an email that came into the shop's inbox. Spam, vendors and newsletters are "not_customer". Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}.`,
    prompt: `From: ${email.from}\nSubject: ${email.subject}\n${email.customer ? `Known customer: ${email.customer}\n` : "Not a known customer.\n"}${email.openOrders ? `Their open orders: ${email.openOrders}\n` : ""}\n"""\n${email.body.slice(0, 15000)}\n"""`,
  });
}
