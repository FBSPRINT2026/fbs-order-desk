import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import type { Settings } from "@/lib/pricing";
import { ctToday, nice } from "@/lib/jobWatch";

/**
 * Away mode (Oct 12, Nick: "a mode where we're not monitoring email… the AI monitors it and only tells us when
 * something super urgent… like they need it Friday and the shirts are coming from S&S, they have to ship two days, so
 * we have to order today"). While a person is away, each new email in their Inbox is read once for one question: does
 * something have to happen today? Only those become phone alerts; everything else waits in the Inbox.
 */

type Verdict = { alert: boolean; title: string; message: string };

const lc = (s: string) => s.trim().toLowerCase();

/** read the new emails in an away person's Inbox; returns the alerts it made (saved in alerts, pushed by the tick) */
export async function watchInbox(admin: SupabaseClient, person: { email: string; name: string; away_since: string | null }, deadline: number) {
  const { data: accts } = await admin.from("mail_accounts").select("id, email").eq("enabled", true).ilike("email", lc(person.email));
  const acct = (accts || [])[0] as { id: string; email: string } | undefined;
  if (!acct) return 0;
  const since = person.away_since || new Date(Date.now() - 3600e3).toISOString();
  // a few minutes old, so a customer email is linked first (its triage and order then come with it)
  const { data } = await admin.from("mail_inbox").select("id, message_id, activity_id, from_email, from_name, subject, received_at, cc_only, bucket, summary")
    .eq("account_id", acct.id).is("gone_at", null).is("watched_at", null).gte("received_at", since).lte("received_at", new Date(Date.now() - 3 * 60000).toISOString())
    .order("received_at", { ascending: true }).limit(8);
  const rows = (data || []) as { id: string; message_id: string; activity_id: string | null; from_email: string; from_name: string; subject: string; received_at: string; cc_only: boolean; bucket: string | null; summary: string | null }[];
  if (!rows.length) return 0;
  const st = await aiState(admin);
  if (!st.ready) return 0;
  let made = 0;
  for (const r of rows) {
    if (Date.now() > deadline - 15000) break;
    await admin.from("mail_inbox").update({ watched_at: new Date().toISOString() }).eq("id", r.id);
    const v = await judge(admin, st.settings as Settings, person, acct.id, r).catch(() => null);
    if (!v?.alert) continue;
    const { error } = await admin.from("alerts").insert({ owner: lc(person.email), kind: "email", title: v.title.slice(0, 120), body: v.message.slice(0, 400), url: `/shop/inbox?item=${r.id}`, dedupe_key: `email:${r.id}:${lc(person.email)}`, mail_inbox_id: r.id });
    if (!error) made++;
  }
  return made;
}

async function judge(admin: SupabaseClient, s: Settings, person: { email: string; name: string }, acctId: string, r: { message_id: string; activity_id: string | null; from_email: string; from_name: string; subject: string; received_at: string; cc_only: boolean; summary: string | null }): Promise<Verdict | null> {
  // the email's text: the customer email on file, else the mailbox copy
  let body = "", triage = "", jobs = "";
  if (r.activity_id) {
    const { data: a } = await admin.from("activities").select("body, customer_id, meta").eq("id", r.activity_id).maybeSingle();
    body = String(a?.body || "");
    const t = (a?.meta as { triage?: { intent?: string; summary?: string; urgency?: string; urgent_reason?: string } } | null)?.triage;
    if (t) triage = `The shop's email reader says: ${t.intent || ""}${t.urgency ? `, urgency ${t.urgency}` : ""}${t.urgent_reason ? ` (${t.urgent_reason})` : ""}. ${t.summary || ""}`;
    if (a?.customer_id) {
      const { data: os } = await admin.from("orders").select("number, nickname, status, due_date").eq("customer_id", a.customer_id).not("status", "in", "(completed)").order("created_at", { ascending: false }).limit(6);
      jobs = (os || []).map((o) => `#${o.number} ${o.nickname || ""} (${o.status}${o.due_date ? `, in hands ${nice(o.due_date as string)}` : ""})`).join("; ");
    }
  }
  if (!body) {
    const { data: m } = await admin.from("mail_cache").select("body_text").eq("account_id", acctId).eq("message_id", r.message_id).limit(1).maybeSingle();
    body = String(m?.body_text || "");
  }
  const today = ctToday(), wd = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" });
  const res = await askClaude<Verdict>({
    task: "away_watch", model: s.assistant.ai.fastModel || s.assistant.ai.model, maxTokens: 400, admin, timeoutMs: 25_000, ctx: { by: "away" },
    tool: { name: "verdict", description: "Whether this email needs the person today.", input_schema: { type: "object", properties: {
      alert: { type: "boolean", description: "true ONLY if something has to be done today (or right now) or it will cost the shop: a job will miss its date, a customer is upset or waiting on something urgent, money or an account is at risk. false for anything that can wait until the person is back." },
      title: { type: "string", description: "The phone notification's title: what to do, a few words (\"Order goods for Methodist today\")." },
      message: { type: "string", description: "One or two short sentences: what has to happen today and why (the date it's needed, what happens if not)." },
    }, required: ["alert", "title", "message"] } },
    system: `${SHOP_CONTEXT(s)}

You watch ${person.name || person.email}'s inbox while they're away from email, and only interrupt them for what can't wait. Today is ${wd} ${today} (Central time). Interrupt for: a customer needing an order by a date that's now tight (our timeline: goods from S&S take 1 business day from Fort Worth, 2–4 from other warehouses; goods must be here ${s.ship?.goodsLeadDays ?? 3} business days before the in-hands date; printing takes a day or two, UPS Ground shipping 2 days); a customer upset, cancelling, or saying something is wrong with an order; a rush or same-day request; a proof or approval holding up a job due within days; a payment, bank, fraud or security problem; a supplier saying an order is stuck or out of stock for a job due soon. Don't interrupt for: new quote requests with no near date, questions that can wait a day, newsletters, receipts, notifications, sales pitches, FYIs, anything the person was only copied on unless it's urgent. When in doubt, don't.`,
    prompt: `From: ${r.from_name} <${r.from_email}>${r.cc_only ? " (they were copied)" : ""}\nReceived: ${r.received_at}\nSubject: ${r.subject}\n${triage ? triage + "\n" : ""}${jobs ? `This customer's open jobs: ${jobs}\n` : ""}"""\n${body.slice(0, 8000) || r.summary || "(no text)"}\n"""`,
  });
  return res.ok ? res.data : null;
}
