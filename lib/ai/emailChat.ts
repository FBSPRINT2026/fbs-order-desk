import "server-only";
import { loadMemories, memoryText, saveMemory } from "@/lib/ai/orderMemory";
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

/** a text-message length answer: the first two sentences, at most ~280 characters */
function brief(t: string) {
  const s = t.replace(/\s+/g, " ").trim();
  const parts = s.match(/[^.!?]+[.!?]+(\s|$)/g) || [s];
  let out = parts.slice(0, 2).join("").trim();
  if (out.length > 280) out = out.slice(0, 277).replace(/\s+\S*$/, "") + "…";
  return out || s.slice(0, 280);
}

export async function emailChatThread(admin: SupabaseClient, activityId: string): Promise<EmailChatMsg[]> {
  const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", `email_chat:${activityId}`).limit(1).maybeSingle();
  return ((data?.payload as { messages?: EmailChatMsg[] } | null)?.messages || []);
}

/**
 * Any email in the Inbox, not only customers' (Oct 12, Nick: "some emails don't have the Assistant"): "inbox:<mail_inbox
 * id>" reads it from the 45-day cache (or the mailbox) and finds the sender among the customers when they're one.
 */
export type ActRow = { id: string | null; customer_id: string | null; order_id: string | null; subject: string | null; body: string | null; from_email: string | null; occurred_at: string; meta: unknown; direction: string };
async function inboxAsActivity(admin: SupabaseClient, inboxId: string): Promise<ActRow | null> {
  const { data: r } = await admin.from("mail_inbox").select("id, account_id, uid, uidvalidity, message_id, from_email, subject, received_at").eq("id", inboxId).maybeSingle();
  if (!r) return null;
  const { data: c } = await admin.from("mail_cache").select("body_text").eq("account_id", r.account_id).eq("message_id", r.message_id).is("gone_at", null).limit(1).maybeSingle();
  let body = (c?.body_text as string) || "";
  if (!body) {
    const { data: acct } = await admin.from("mail_accounts").select("*").eq("id", r.account_id).maybeSingle();
    if (acct) {
      const { readLive } = await import("@/lib/mail/read");
      const m = await readLive(acct as never, r as { uid: number; uidvalidity: number; message_id: string }).catch(() => null);
      body = m?.text || (m?.html ? m.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ") : "");
    }
  }
  const { data: cu } = await admin.from("customers").select("id").ilike("email", String(r.from_email || "")).limit(1).maybeSingle();
  return { id: null, customer_id: (cu?.id as string) || null, order_id: null, subject: r.subject as string, body, from_email: r.from_email as string, occurred_at: (r.received_at as string) || new Date().toISOString(), meta: {}, direction: "in" };
}

export async function emailChat(admin: SupabaseClient, s: Settings, activityId: string, by: string, message: string, lookedUp?: LookedUp | null, opts: { given?: ActRow; draft?: boolean; /** who is writing and how replies end (Email settings) */ writer?: string } = {}): Promise<{ ok: true; messages: EmailChatMsg[] } | { ok: false; error: string }> {
  const msg = message.trim().slice(0, 2000);
  if (!msg) return { ok: false, error: "Type a question first." };
  const inbox = !!opts.given || activityId.startsWith("inbox:");
  const a: ActRow | null = opts.given ? opts.given : activityId.startsWith("inbox:") ? await inboxAsActivity(admin, activityId.slice(6))
    : ((await admin.from("activities").select("id, customer_id, order_id, subject, body, from_email, occurred_at, meta, direction").eq("id", activityId).maybeSingle()).data as ActRow | null);
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
    cid ? admin.from("activities").select("direction, subject, body, occurred_at").eq("customer_id", cid).neq("id", a.id || "00000000-0000-0000-0000-000000000000").lt("occurred_at", a.occurred_at as string).order("occurred_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] as { direction: string; subject: string | null; body: string | null; occurred_at: string }[] }),
    a.id ? signaturePaths(admin, { id: a.id, from_email: (a.from_email as string) || null }, atts).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  // how busy the shop is: jobs and pieces due each of the next three weeks
  const weeks = [0, 1, 2].map((w) => ({ w, jobs: 0, pcs: 0 }));
  for (const o of (load || []) as { due_date: string; groups: { lines?: { sizes?: Record<string, number> }[] }[] | null }[]) {
    const k = Math.min(2, Math.floor((new Date(o.due_date).getTime() - new Date(today).getTime()) / (7 * 86400_000)));
    weeks[k].jobs++;
    weeks[k].pcs += (o.groups || []).reduce((t, g) => t + (g.lines || []).reduce((u, l) => u + Object.values(l.sizes || {}).reduce((v, q) => v + (+q || 0), 0), 0), 0);
  }
  const { images, documents, listing } = await readFiles(admin, atts as never, sigs).catch(() => ({ images: [], documents: [], listing: [] as string[] }));
  // what staff taught about this customer's orders; "remember …" / "from now on …" / "next time …" teaches it
  // (Oct 20, Nick: "it learns and remembers")
  let learned = "";
  if (cid && /^\s*(please\s+)?(remember|from now on|next time)\b/i.test(msg)) {
    const sv = await saveMemory(admin, { customerId: cid, text: msg, by, activityId: a.id || null, subject: String(a.subject || "") }).catch(() => null);
    if (sv?.ok) learned = sv.text;
  }
  const mems = await loadMemories(admin, cid).catch(() => []);

  const prompt = [
    cust ? `Customer: ${cust.company || cust.name} <${cust.email || a.from_email}>, ${cust.price_type === "wholesale" ? "wholesale (they supply their own garments)" : "retail"}.${cust.notes ? ` Notes on file: ${String(cust.notes).slice(0, 400)}` : ""}` : `Sender ${a.from_email} isn't a customer on file yet.`,
    (open || []).length ? `Their open orders: ${(open || []).map((o) => `#${o.number} ${o.nickname || ""} (${o.status}${o.due_date ? `, due ${o.due_date}` : ""})`).join("; ")}` : "No open orders for them.",
    past.length ? `Their past jobs (newest first):\n${jobsText(past.slice(0, 12))}` : "No past jobs on file.",
    `How busy the shop is (orders in production due): this week ${weeks[0].jobs} jobs / ${weeks[0].pcs} pcs, next week ${weeks[1].jobs} / ${weeks[1].pcs}, the week after ${weeks[2].jobs} / ${weeks[2].pcs}. Today is ${today}.`,
    (earlier || []).length ? `Earlier emails with them (newest first):\n${(earlier || []).map((e) => `- ${String(e.occurred_at).slice(0, 10)} ${e.direction === "out" ? "we wrote" : "they wrote"}: ${e.subject ? `"${e.subject}" ` : ""}${String(e.body || "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}` : "",
    `Attached files:\n${listing.join("\n") || "(none)"}`,
    `THE EMAIL (${String(a.occurred_at).slice(0, 10)}):\nSubject: ${a.subject || ""}\n"""\n${String(a.body || "").slice(0, 10000)}\n"""`,
    thread.length ? `The conversation with staff so far:\n${thread.slice(-16).map((m) => `${m.role === "staff" ? "Staff" : m.role === "event" ? "(What happened)" : "You"}: ${m.text}`).join("\n")}` : "",
    memoryText(mems, String(cust?.company || cust?.name || "this customer")),
    `Staff now says: ${msg}`,
    learned ? `(That's now saved: you'll remember it for this customer's next emails. Say so in your reply.)` : "",
    lookedUp?.text ? `Looked up online for that: ${lookedUp.text}` : "",
  ].filter(Boolean).join("\n\n");

  const r = await askClaude<{ reply: string; actions?: { kind: string; label: string; told?: string; job?: number; subject?: string; body?: string; order_number?: number }[] }>({
    task: "email_chat", model: s.assistant.ai.model, maxTokens: 2000, timeoutMs: 55_000, admin, images, documents,
    ctx: { activity_id: a.id, customer_id: cid, by },
    tool: { name: "answer", description: "Your reply to staff and the next steps they can take with a click.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "One short text-message sentence, 25 words at most." },
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

You're helping staff handle ${inbox && !cid ? "an email from their Inbox (it may be a possible new customer, a vendor or partner, or anything else: say what it is)" : "a customer email"}, like an experienced shop manager reading over their shoulder. Read the email and its files, and use the customer's past jobs, open orders and how busy the shop is. Say plainly what it is and what you'd do: make a new order, make a reorder of a past job (name it), answer a question, ask for missing details, say we need more time (when the date they want is too soon for how busy we are), or turn the job down (when it's something the shop doesn't do or can't do in time). Offer the next steps as actions. When the garments are clear and the job is likely (a reorder, an approved quote, a tight date), you can offer order_goods: buying the blanks from S&S now, ahead of the order. Replies to the customer are written in the shop's voice (${s.assistant.ai.voice}), short, and never promise prices or exact dates unless staff gave them.
Follow what staff tell you; it's fact.${opts.writer ? `\nReplies: ${opts.writer}` : ""}${opts.draft ? `
Staff just told you (spoken, so it may be loose) what they want to say back. Your FIRST action must be kind "reply": the complete email to send, written from what they said, in their words where it works, warm and short, with nothing they didn't say (no prices, dates or promises they didn't give). The reply sentence just says it's drafted.` : ""}
Write like a quick text message from a coworker: ONE short sentence, 25 words at most. No greetings, headings, lists, prices or restating the email (staff can read it). Answer exactly what was asked. The detail goes into the actions: 1-3 actions, best first, with short button labels (2-5 words).`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const actions: EmailAction[] = [];
  for (const x of (r.data.actions || []).slice(0, 4)) {
    const label = String(x.label || "").slice(0, 80);
    if (x.kind === "create_order") {
      // the J number, else the job number it names in the button or the note (Oct 20, Little Groupies: "Create reorder of
      // #32668 The Bottles" came without its J number, so the order was read as a new one with no art)
      const named = [...`${x.label || ""} ${x.told || ""}`.matchAll(/#?\b(\d{4,6})\b/g)].map((m) => m[1]);
      const byNum = past.find((p) => named.some((n) => new RegExp(`^#${n}\\b`).test(p.label)));
      const job = x.job && past[x.job - 1] ? past[x.job - 1].ref : byNum?.ref;
      actions.push({ kind: "create_order", label, told: String(x.told || "").slice(0, 800), ...(job ? { job } : {}) });
    } else if (x.kind === "reply" && x.body) actions.push({ kind: "reply", label, subject: String(x.subject || "").slice(0, 200), body: String(x.body).slice(0, 6000) });
    else if (x.kind === "file_under" && x.order_number) actions.push({ kind: "file_under", label, order_number: Math.floor(x.order_number) });
    else if (x.kind === "no_reply") actions.push({ kind: "no_reply", label });
    else if (x.kind === "order_goods") actions.push({ kind: "order_goods", label });
  }
  const now = new Date().toISOString();
  const messages: EmailChatMsg[] = [...thread,
    { role: "staff" as const, text: msg, at: now, by },
    { role: "ai" as const, text: brief(String(r.data.reply || "")), at: new Date().toISOString(), actions, ...(lookedUp?.text ? { lookedUp } : {}) },
  ].slice(-60);
  const row = { kind: "email_chat", dedupe_key: `email_chat:${activityId}`, source: "ai", status: "done", priority: 3, customer_id: cid, activity_id: a.id || null, title: `Email chat: ${String(a.subject || "").slice(0, 80)}`, body: msg.slice(0, 300), payload: { messages }, model: r.model, run_id: r.runId, updated_at: now };
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
    const inbox = activityId.startsWith("inbox:");
    const { data: a } = inbox ? { data: null } : await admin.from("activities").select("customer_id, subject").eq("id", activityId).maybeSingle();
    await admin.from("ai_suggestions").insert({ kind: "email_chat", dedupe_key: `email_chat:${activityId}`, source: "ai", status: "done", priority: 3, customer_id: a?.customer_id || null, activity_id: inbox ? null : activityId, title: `Email chat: ${String(a?.subject || "").slice(0, 80)}`, body: text.slice(0, 300), payload: { messages } });
  }
}
