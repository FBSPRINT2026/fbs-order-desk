import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, type LookedUp } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { jobsText, pastJobs, readFiles, signaturePaths } from "@/lib/ai/emailOrder";
import type { Settings } from "@/lib/pricing";

/**
 * Inbox chat: staff talk an email through with the AI ("what should I do with this?"). It reads the email, its
 * attachments, the earlier emails, the customer and their past jobs, their open orders and how busy the shop is, and
 * answers in plain words with next steps staff can take with a click: create the order (or a reorder of a past job,
 * with what to know), a reply to send (taking it, turning it down, asking for more time or details), filing it under
 * an order, or no reply needed. Nothing happens until staff click. The conversation is kept with the email.
 */
export type EmailAction =
  | { kind: "create_order"; label: string; told?: string; job?: string }
  | { kind: "reply"; label: string; subject?: string; body: string }
  | { kind: "file_under"; label: string; order_number: number }
  | { kind: "no_reply"; label: string }
  | { kind: "order_goods"; label: string };
export type EmailChatMsg = { role: "staff" | "ai" | "event"; text: string; at: string; by?: string; actions?: EmailAction[]; lookedUp?: LookedUp; /** event: where it leads (the order made) */ href?: string };
type Att = { name: string; path: string; type: string; size: number };

export async function emailChatThread(admin: SupabaseClient, activityId: string): Promise<EmailChatMsg[]> {
  const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `email_chat:${activityId}`).limit(1).maybeSingle();
  return ((data?.payload as { messages?: EmailChatMsg[] } | null)?.messages || []);
}

export async function emailChat(admin: SupabaseClient, s: Settings, activityId: string, by: string, message: string, lookedUp?: LookedUp | null): Promise<{ ok: true; messages: EmailChatMsg[] } | { ok: false; error: string }> {
  const msg = message.trim().slice(0, 2000);
  if (!msg) return { ok: false, error: "Type a question first." };
  const { data: a } = await admin.from("activities").select("id, customer_id, order_id, subject, body, from_email, occurred_at, meta, direction").eq("id", activityId).maybeSingle();
  if (!a) return { ok: false, error: "Email not found." };
  const cid = (a.customer_id as string) || null;
  const atts = ((a.meta as { attachments?: Att[] })?.attachments || []);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const in21 = new Date(Date.now() + 21 * 86400_000).toISOString().slice(0, 10);
  const [thread, { data: cust }, past, { data: open }, { data: load }, { data: earlier }, sigs] = await Promise.all([
    emailChatThread(admin, activityId),
    cid ? admin.from("customers").select("company, name, email, price_type, notes").eq("id", cid).maybeSingle() : Promise.resolve({ data: null }),
    pastJobs(admin, cid).catch(() => []),
    cid ? admin.from("orders").select("number, nickname, status, due_date").eq("customer_id", cid).not("status", "in", "(completed,request)").order("number", { ascending: false }).limit(10) : Promise.resolve({ data: [] as { number: number; nickname: string | null; status: string; due_date: string | null }[] }),
    admin.from("orders").select("due_date, status, groups").not("status", "in", "(completed,request,quote,quote_sent,ready)").gte("due_date", today).lte("due_date", in21).limit(300),
    cid ? admin.from("activities").select("direction, subject, body, occurred_at").eq("customer_id", cid).neq("id", activityId).lt("occurred_at", a.occurred_at as string).order("occurred_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] as { direction: string; subject: string | null; body: string | null; occurred_at: string }[] }),
    signaturePaths(admin, { id: a.id as string, from_email: (a.from_email as string) || null }, atts).catch(() => new Set<string>()),
  ]);
  // how busy the shop is: jobs and pieces due each of the next three weeks
  const weeks = [0, 1, 2].map((w) => ({ w, jobs: 0, pcs: 0 }));
  for (const o of (load || []) as { due_date: string; groups: { lines?: { sizes?: Record<string, number> }[] }[] | null }[]) {
    const k = Math.min(2, Math.floor((new Date(o.due_date).getTime() - new Date(today).getTime()) / (7 * 86400_000)));
    weeks[k].jobs++;
    weeks[k].pcs += (o.groups || []).reduce((t, g) => t + (g.lines || []).reduce((u, l) => u + Object.values(l.sizes || {}).reduce((v, q) => v + (+q || 0), 0), 0), 0);
  }
  const { images, documents, listing } = await readFiles(admin, atts as never, sigs).catch(() => ({ images: [], documents: [], listing: [] as string[] }));

  const prompt = [
    cust ? `Customer: ${cust.company || cust.name} <${cust.email || a.from_email}>, ${cust.price_type === "wholesale" ? "wholesale (they supply their own garments)" : "retail"}.${cust.notes ? ` Notes on file: ${String(cust.notes).slice(0, 400)}` : ""}` : `Sender ${a.from_email} isn't a customer on file yet.`,
    (open || []).length ? `Their open orders: ${(open || []).map((o) => `#${o.number} ${o.nickname || ""} (${o.status}${o.due_date ? `, due ${o.due_date}` : ""})`).join("; ")}` : "No open orders for them.",
    past.length ? `Their past jobs (newest first):\n${jobsText(past.slice(0, 12))}` : "No past jobs on file.",
    `How busy the shop is (orders in production due): this week ${weeks[0].jobs} jobs / ${weeks[0].pcs} pcs, next week ${weeks[1].jobs} / ${weeks[1].pcs}, the week after ${weeks[2].jobs} / ${weeks[2].pcs}. Today is ${today}.`,
    (earlier || []).length ? `Earlier emails with them (newest first):\n${(earlier || []).map((e) => `- ${String(e.occurred_at).slice(0, 10)} ${e.direction === "out" ? "we wrote" : "they wrote"}: ${e.subject ? `"${e.subject}" ` : ""}${String(e.body || "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}` : "",
    `Attached files:\n${listing.join("\n") || "(none)"}`,
    `THE EMAIL (${String(a.occurred_at).slice(0, 10)}):\nSubject: ${a.subject || ""}\n"""\n${String(a.body || "").slice(0, 10000)}\n"""`,
    thread.length ? `The conversation with staff so far:\n${thread.slice(-16).map((m) => `${m.role === "staff" ? "Staff" : m.role === "event" ? "(What happened)" : "You"}: ${m.text}`).join("\n")}` : "",
    `Staff now says: ${msg}`,
    lookedUp?.text ? `Looked up online for that: ${lookedUp.text}` : "",
  ].filter(Boolean).join("\n\n");

  const r = await askClaude<{ reply: string; actions?: { kind: string; label: string; told?: string; job?: number; subject?: string; body?: string; order_number?: number }[] }>({
    task: "email_chat", model: s.assistant.ai.model, maxTokens: 2000, timeoutMs: 55_000, admin, images, documents,
    ctx: { activity_id: a.id as string, customer_id: cid, by },
    tool: { name: "answer", description: "Your reply to staff and the next steps they can take with a click.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, short: what the email is, what you'd do, and why." },
      actions: { type: "array", description: "1-3 next steps, best first.", items: { type: "object", properties: {
        kind: { type: "string", enum: ["create_order", "reply", "file_under", "no_reply", "order_goods"] },
        label: { type: "string", description: 'Button text, e.g. "Create the reorder of #31174", "Reply: we need more time", "Reply: we can\'t take this one"' },
        told: { type: "string", description: "create_order: what the order reader should know (the job, changes, colors) in one or two sentences" },
        job: { type: "number", description: "create_order for a reorder: the J number of the past job" },
        subject: { type: "string" }, body: { type: "string", description: "reply: the email to send, in the shop's voice, signed off without a name" },
        order_number: { type: "number", description: "file_under: the open order it's about" },
      }, required: ["kind", "label"] } },
    }, required: ["reply"] } },
    system: `${SHOP_CONTEXT(s)}

You're helping staff handle a customer email, like an experienced shop manager reading over their shoulder. Read the email and its files, and use the customer's past jobs, open orders and how busy the shop is. Say plainly what it is and what you'd do: make a new order, make a reorder of a past job (name it), answer a question, ask for missing details, say we need more time (when the date they want is too soon for how busy we are), or turn the job down (when it's something the shop doesn't do or can't do in time). Offer the next steps as actions. When the garments are clear and the job is likely (a reorder, an approved quote, a tight date), you can offer order_goods: buying the blanks from S&S now, ahead of the order. Replies to the customer are written in the shop's voice (${s.assistant.ai.voice}), short, and never promise prices or exact dates unless staff gave them.
Follow what staff tell you; it's fact. Keep your own reply to a few sentences, no headings.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const actions: EmailAction[] = [];
  for (const x of (r.data.actions || []).slice(0, 4)) {
    const label = String(x.label || "").slice(0, 80);
    if (x.kind === "create_order") {
      const job = x.job && past[x.job - 1] ? past[x.job - 1].ref : undefined;
      actions.push({ kind: "create_order", label, told: String(x.told || "").slice(0, 800), ...(job ? { job } : {}) });
    } else if (x.kind === "reply" && x.body) actions.push({ kind: "reply", label, subject: String(x.subject || "").slice(0, 200), body: String(x.body).slice(0, 6000) });
    else if (x.kind === "file_under" && x.order_number) actions.push({ kind: "file_under", label, order_number: Math.floor(x.order_number) });
    else if (x.kind === "no_reply") actions.push({ kind: "no_reply", label });
    else if (x.kind === "order_goods") actions.push({ kind: "order_goods", label });
  }
  const now = new Date().toISOString();
  const messages: EmailChatMsg[] = [...thread,
    { role: "staff" as const, text: msg, at: now, by },
    { role: "ai" as const, text: String(r.data.reply || "").slice(0, 4000), at: new Date().toISOString(), actions, ...(lookedUp?.text ? { lookedUp } : {}) },
  ].slice(-60);
  const row = { kind: "email_chat", dedupe_key: `email_chat:${activityId}`, source: "ai", status: "done", priority: 3, customer_id: cid, activity_id: a.id, title: `Email chat: ${String(a.subject || "").slice(0, 80)}`, body: msg.slice(0, 300), payload: { messages }, model: r.model, run_id: r.runId, updated_at: now };
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", row.dedupe_key).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update(row).eq("id", had.id);
  else await admin.from("ai_suggestions").insert(row);
  return { ok: true, messages };
}

/** something that happened while staff worked the email (an order made from it), into the conversation */
export async function noteEmail(admin: SupabaseClient, activityId: string, text: string, href?: string) {
  const thread = await emailChatThread(admin, activityId);
  const messages: EmailChatMsg[] = [...thread, { role: "event" as const, text: text.slice(0, 300), at: new Date().toISOString(), ...(href && href.startsWith("/") ? { href } : {}) }].slice(-60);
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", `email_chat:${activityId}`).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update({ payload: { messages }, updated_at: new Date().toISOString() }).eq("id", had.id);
  else {
    const { data: a } = await admin.from("activities").select("customer_id, subject").eq("id", activityId).maybeSingle();
    await admin.from("ai_suggestions").insert({ kind: "email_chat", dedupe_key: `email_chat:${activityId}`, source: "ai", status: "done", priority: 3, customer_id: a?.customer_id || null, activity_id: activityId, title: `Email chat: ${String(a?.subject || "").slice(0, 80)}`, body: text.slice(0, 300), payload: { messages } });
  }
}
