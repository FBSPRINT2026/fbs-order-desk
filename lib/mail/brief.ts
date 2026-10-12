import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailAccount } from "./config";
import { aiState, askClaude } from "@/lib/ai/claude";
import { senderLabel } from "./sender";

/**
 * Email → Inbox summary, written ahead of time (Oct 12, Nick: "it pops up very slow"): the mailbox job rewrites it
 * when the Inbox changes (at most every 5 minutes) and keeps it in mail_brief, so opening it is instant. The AI reads
 * what's in the Inbox now (plus to-dos due soon and the next 2 days of calendar) and says what to do first.
 */
export type BriefItem = { text: string; ref: string; who?: string; why?: string };
export type Brief = { greeting: string; headline: string; sections: { title: string; items: BriefItem[] }[]; at: string };

/** what the Inbox holds right now (when this changes, the summary is out of date) */
export async function inboxSig(admin: SupabaseClient, accountId: string) {
  const { data } = await admin.from("mail_inbox").select("id").eq("account_id", accountId).is("gone_at", null).limit(500);
  return ((data || []) as { id: string }[]).map((r) => r.id).sort().join(",");
}

export async function makeBrief(admin: SupabaseClient, acct: Pick<MailAccount, "id">, owner: string, name: string): Promise<{ ok: true; brief: Brief } | { ok: false; error: string }> {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const soon = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const [{ data: rows }, { data: t }, { data: ev }] = await Promise.all([
      admin.from("mail_inbox").select("id, from_name, from_email, subject, summary, bucket, activity_id, cc_only, unread, received_at").eq("account_id", acct.id).is("gone_at", null).order("received_at", { ascending: false }).limit(80),
      admin.from("tasks").select("title, area, due").eq("owner", owner).eq("status", "open").or(`due.lte.${soon},due.is.null`).limit(40),
      admin.from("events").select("title, day, starts_at, place, status").eq("owner", owner).eq("status", "added").gte("day", today).lte("day", soon).limit(20),
    ]);
    const items = (rows || []) as { id: string; from_name: string; from_email: string; subject: string; summary: string; bucket: string | null; activity_id: string | null; cc_only: boolean; unread: boolean; received_at: string | null }[];
    const actIds = items.map((r) => r.activity_id).filter(Boolean) as string[];
    const { data: acts } = actIds.length ? await admin.from("activities").select("id, customer_id, meta, customers(company, name, email)").in("id", actIds) : { data: [] };
    const am = new Map(((acts || []) as unknown as { id: string; meta: { triage?: { intent?: string; urgency?: string; urgent_reason?: string; needs_reply?: boolean; summary?: string }; no_reply?: boolean } | null; customers: { company: string | null; name: string | null; email: string | null } | null }[]).map((a) => [a.id, a]));
    const lines = items.map((r) => {
      const a = r.activity_id ? am.get(r.activity_id) : undefined, tr = a?.meta?.triage;
      const who = senderLabel(r.from_name, r.from_email, a?.customers);
      return `[${r.id}] ${a ? `CUSTOMER ${who}` : r.from_name || r.from_email}${r.cc_only ? " (cc'd)" : ""}${r.unread ? " (unread)" : ""} · ${r.subject} · ${tr?.summary || r.summary || ""}${tr?.intent ? ` · intent ${tr.intent}` : r.bucket ? ` · ${r.bucket}` : ""}${tr?.urgency === "high" ? ` · URGENT ${tr.urgent_reason || ""}` : ""}${a && tr?.needs_reply && !a.meta?.no_reply ? " · needs a reply" : ""} · ${r.received_at ? new Date(r.received_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }) : ""}`;
    });
    const st = await aiState(admin);
    if (!st.ready) return { ok: false, error: st.reason };
    const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
    const res = await askClaude<{ greeting: string; headline: string; lines: unknown }>({
      task: "inbox_brief", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 3000, admin, ctx: { by: owner }, timeoutMs: 40000,
      tool: { name: "brief", description: "A short morning-style brief of the inbox.", input_schema: { type: "object", properties: {
        greeting: { type: "string", description: `A warm one-line greeting using the name ${name} and the time of day (${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}).` },
        headline: { type: "string", description: "One or two sentences: how the inbox looks overall and the most important thing to do first. Plain and encouraging, no fluff." },
        lines: { type: "array", maxItems: 14, description: "The brief, at most 14 short lines (under 15 words each), one per item, in order. Group them with `group` (use these names, skip empty ones, most important first): \"Needs you now\" (urgent, waiting on a reply), \"Orders & reorders\", \"To-dos\", \"Coming up\" (calendar, due dates), \"Just so you know\".", items: { type: "object", properties: {
          group: { type: "string" },
          who: { type: "string", description: "Who it's from or about, short (\"Dear Heart Designs\", \"Neal Talreja (CPA)\")" },
          text: { type: "string", description: "What it is and what to do, one short line without repeating who, e.g. \"New .ai files for 2 orders; pickup week of Oct 19\"" },
          why: { type: "string", description: "Only for the first 3 lines of \"Needs you now\": why it comes first, a few words (\"pickup today\", \"3 months overdue\"). Else empty." },
          ref: { type: "string", description: "The [id] of the email this is about, or empty" },
        }, required: ["group", "who", "text", "ref"] } },
      }, required: ["greeting", "headline", "lines"] } },
      system: `You are ${name}'s assistant at ${st.settings.shop.name} (a screen printing shop). Summarize their email inbox the way a sharp office manager would at the start of the day: what matters, in order. Customer emails about orders, reorders, artwork and payments come first. Use only what's listed. Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" })}.`,
      prompt: `INBOX (${items.length} emails):\n${lines.join("\n") || "(empty)"}\n\nTO-DOS DUE SOON OR UNDATED:\n${((t || []) as { title: string; area: string; due: string | null }[]).map((x) => `- ${x.title} (${x.area}${x.due ? `, due ${x.due}` : ""})`).join("\n") || "(none)"}\n\nCALENDAR (next 2 days):\n${((ev || []) as { title: string; day: string; starts_at: string | null; place: string }[]).map((e) => `- ${e.day} ${e.starts_at ? new Date(e.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : ""} ${e.title}${e.place ? ` @ ${e.place}` : ""}`).join("\n") || "(nothing)"}`,
    });
    if (!res.ok) return { ok: false, error: res.error };
    const ids = new Set(items.map((r) => r.id));
    // the model sometimes hands a list back as JSON text: read it either way
    const arr = <T,>(v: unknown): T[] => { if (Array.isArray(v)) return v as T[]; if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? (j as T[]) : []; } catch { return []; } } return []; };
    const sections: Brief["sections"] = [];
    for (const l of arr<{ group?: string; who?: string; text?: string; why?: string; ref?: string }>(res.data.lines)) {
      if (!l?.text) continue;
      const title = (l.group || "Today").trim(), ref = (l.ref || "").replace(/[[\]]/g, "").trim();
      let sec = sections.find((x) => x.title === title);
      if (!sec) { sec = { title, items: [] }; sections.push(sec); }
      sec.items.push({ text: l.text, ref: ids.has(ref) ? ref : "", who: (l.who || "").trim(), why: (l.why || "").trim() });
    }
    const brief: Brief = { greeting: res.data.greeting, headline: res.data.headline, sections, at: new Date().toISOString() };
    return { ok: true, brief };
}

/** write it and keep it */
export async function writeBrief(admin: SupabaseClient, acct: Pick<MailAccount, "id">, owner: string, name: string) {
  const sig = await inboxSig(admin, acct.id);
  const r = await makeBrief(admin, acct, owner, name);
  if (r.ok) await admin.from("mail_brief").upsert({ account_id: acct.id, sig, brief: r.brief, at: new Date().toISOString() });
  return r;
}
