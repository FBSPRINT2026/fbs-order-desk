import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Settings } from "@/lib/pricing";
import { askClaude, type AiCtx } from "@/lib/ai/claude";

/**
 * My Day: read one email (business or personal: the owners' mailboxes are both) and say what it means for the
 * person: something to do, something on the calendar, just so you know, or junk. Customer email has its own flow
 * (lib/mail/process.ts); this is for everything else in the Inbox.
 */
export type Bucket = "todo" | "event" | "fyi" | "ignore";
export type Area = "personal" | "money" | "shop";
export type OrganizedTodo = { title: string; area: Area; due: string | null; notes: string };
export type OrganizedEvent = { title: string; date: string; start: string | null; end: string | null; place: string; notes: string };
export type Organized = { bucket: Bucket; summary: string; todos: OrganizedTodo[]; events: OrganizedEvent[] };

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const weekday = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });

export function organizeEmail(s: Settings, email: { owner: string; ownerName: string; from: string; to: string; cc: string; subject: string; date: string; body: string }, ctx: AiCtx & { admin?: SupabaseClient }) {
  return askClaude<Organized>({
    task: "organize_email", model: s.assistant.ai.fastModel || s.assistant.ai.model, maxTokens: 900, ctx, admin: ctx.admin, timeoutMs: 25_000,
    tool: { name: "organize", description: "What this email means for the person.", input_schema: { type: "object", properties: {
      bucket: { type: "string", enum: ["todo", "event", "fyi", "ignore"], description: "todo: the person needs to do something (answer, send, pay, sign, decide, call, fix). event: mainly a date/time to be somewhere or something happening (appointment, family event, meeting, delivery window they must be there for). fyi: worth a glance, nothing to do (receipts, shipping updates, confirmations, statements, approvals done). ignore: ads, promotions, newsletters, spam, social notifications." },
      summary: { type: "string", description: "One short sentence, plain words, what it is and what's needed (e.g. \"CPA needs your 2025 documents uploaded\")." },
      todos: { type: "array", maxItems: 3, description: "Things the person has to do because of this email. Empty for fyi / ignore. Only real actions, written as a short command starting with a verb (\"Send the CPA the 2025 documents\", \"Pay Lamtex invoice #15129 ($840)\").", items: { type: "object", properties: {
        title: { type: "string" },
        area: { type: "string", enum: ["personal", "money", "shop"], description: "money: bills, invoices, payments, taxes, bank, insurance, accounting. personal: family, home, health, personal purchases. shop: running the business (vendors, staff, equipment, suppliers, software)." },
        due: { type: ["string", "null"], description: "YYYY-MM-DD when the email gives or clearly implies a deadline; null otherwise." },
        notes: { type: "string", description: "Anything needed to do it (amount, link text, who to call). Short. Empty if nothing." },
      }, required: ["title", "area", "due", "notes"] } },
      events: { type: "array", maxItems: 3, description: "Dated happenings the person should have on their calendar. Only with a real date. Not deadlines (those are to-dos).", items: { type: "object", properties: {
        title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" },
        start: { type: ["string", "null"], description: "HH:MM 24-hour local time, null for all day" }, end: { type: ["string", "null"], description: "HH:MM or null" },
        place: { type: "string" }, notes: { type: "string" },
      }, required: ["title", "date", "start", "end", "place", "notes"] } },
    }, required: ["bucket", "summary", "todos", "events"] } },
    system: `You are the personal assistant of ${email.ownerName || email.owner}, an owner of ${s.shop.name} (a screen printing, embroidery and DTF shop in Texas). You read every email in their inbox, business and personal, and turn it into a short, calm to-do list and calendar. Be practical: most email is fyi or ignore. Customer orders are handled elsewhere; if this is a customer asking about printing, make it a single "shop" to-do to answer them. If the person was only copied (Cc), only make a to-do when the email clearly asks them for something. Today is ${weekday()} (${today()}), Central time.`,
    prompt: `From: ${email.from}\nTo: ${email.to}${email.cc ? `\nCc: ${email.cc}` : ""}\nDate: ${email.date}\nSubject: ${email.subject}\n"""\n${email.body.slice(0, 12000)}\n"""`,
  });
}
