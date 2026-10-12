"use server";
import { randomBytes } from "node:crypto";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountForUser } from "@/lib/mail/config";
import { archiveInbox, chicago } from "@/lib/mail/mirror";
import { aiState, askClaude } from "@/lib/ai/claude";

/**
 * My Day: each person's to-dos and calendar. To-dos come from email (the AI reads the Inbox), from the shop, or are
 * typed in; they can be handed to the other owner. Done on a to-do from an email archives that email in Outlook
 * (and archiving it in Outlook closes its to-dos). Events are suggested from email and added with a tap; the
 * person's private calendar link puts the added ones (and the shop's in-hands dates) on their phone.
 */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return { ...v, admin: createAdminClient(), owner: v.email.toLowerCase(), name: String(v.staff?.name || "") || v.email.split("@")[0] };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const ymd = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const AREAS = ["personal", "money", "shop", "customer"];

export type Task = { id: string; owner: string; title: string; notes: string; area: string; due: string | null; status: string; snooze_until: string | null; source: string; mail_inbox_id: string | null; activity_id: string | null; order_id: string | null; created_by: string; handed_by: string | null; created_at: string; done_at: string | null; done_by: string | null; from?: string; subject?: string };
export type CalEvent = { id: string; title: string; notes: string; place: string; starts_at: string | null; ends_at: string | null; day: string | null; all_day: boolean; status: string; source: string; mail_inbox_id: string | null; from?: string };

export async function getMyDay() {
  try {
    const { admin, owner } = await me();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const from = new Date(Date.now() - 86400e3).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const [{ data: t }, { data: d }, { data: ev }, { data: people }, { data: feed }] = await Promise.all([
      admin.from("tasks").select("*").eq("owner", owner).eq("status", "open").order("due", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(300),
      admin.from("tasks").select("*").eq("owner", owner).eq("status", "done").gte("done_at", new Date(Date.now() - 18 * 3600e3).toISOString()).order("done_at", { ascending: false }).limit(30),
      admin.from("events").select("*").eq("owner", owner).neq("status", "dismissed").gte("day", from).order("day").order("starts_at", { ascending: true, nullsFirst: true }).limit(200),
      admin.from("staff").select("email, name, role").in("role", ["owner", "admin"]),
      admin.from("cal_feeds").select("token").eq("owner", owner).maybeSingle(),
    ]);
    const tasks = [...((t || []) as Task[]), ...((d || []) as Task[])];
    const events = (ev || []) as CalEvent[];
    // where each came from (the email's sender and subject)
    const ids = [...new Set([...tasks.map((x) => x.mail_inbox_id), ...events.map((x) => x.mail_inbox_id)].filter(Boolean))] as string[];
    if (ids.length) {
      const { data: rows } = await admin.from("mail_inbox").select("id, from_name, from_email, subject").in("id", ids);
      const m = new Map(((rows || []) as { id: string; from_name: string; from_email: string; subject: string }[]).map((r) => [r.id, r]));
      for (const x of tasks) { const r = x.mail_inbox_id ? m.get(x.mail_inbox_id) : null; if (r) { x.from = r.from_name || r.from_email; x.subject = r.subject; } }
      for (const x of events) { const r = x.mail_inbox_id ? m.get(x.mail_inbox_id) : null; if (r) x.from = r.from_name || r.from_email; }
    }
    const others = ((people || []) as { email: string; name: string; role: string }[]).filter((p) => p.email.toLowerCase() !== owner).map((p) => ({ email: p.email.toLowerCase(), name: p.name || p.email.split("@")[0] }));
    return { ok: true as const, today, tasks, events, others, hasFeed: !!feed };
  } catch (e) { return fail(e); }
}

export async function addTask(input: { title: string; area?: string; due?: string | null; notes?: string; owner?: string }) {
  try {
    const { admin, owner, name } = await me();
    const title = (input.title || "").trim();
    if (!title) return { ok: false as const, error: "What's the to-do?" };
    const to = (input.owner || owner).toLowerCase();
    const { data, error } = await admin.from("tasks").insert({
      owner: to, title: title.slice(0, 200), notes: (input.notes || "").slice(0, 1000), area: AREAS.includes(input.area || "") ? input.area : "shop",
      due: ymd(input.due), source: "manual", created_by: owner, handed_by: to !== owner ? name : null,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { ok: true as const, task: data as Task };
  } catch (e) { return fail(e); }
}

export async function updateTask(id: string, p: { title?: string; area?: string; due?: string | null; notes?: string; snooze_until?: string | null }) {
  try {
    const { admin, owner } = await me();
    const patch: Record<string, unknown> = {};
    if (p.title !== undefined) { if (!p.title.trim()) return { ok: false as const, error: "A to-do needs a title." }; patch.title = p.title.trim().slice(0, 200); }
    if (p.area !== undefined && AREAS.includes(p.area)) patch.area = p.area;
    if (p.due !== undefined) patch.due = ymd(p.due);
    if (p.notes !== undefined) patch.notes = p.notes.slice(0, 1000);
    if (p.snooze_until !== undefined) patch.snooze_until = ymd(p.snooze_until);
    const { error } = await admin.from("tasks").update(patch).eq("id", id).eq("owner", owner);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Done (or not done). A to-do from an email: Done archives the email in Outlook, unless another to-do from it is still open. */
export async function setTaskDone(id: string, done: boolean) {
  try {
    const { admin, owner, user, email } = await me();
    const { data: t } = await admin.from("tasks").select("id, mail_inbox_id, status").eq("id", id).eq("owner", owner).maybeSingle();
    if (!t) return { ok: false as const, error: "That to-do isn't yours." };
    const now = new Date().toISOString();
    await admin.from("tasks").update(done ? { status: "done", done_at: now, done_by: email } : { status: "open", done_at: null, done_by: null }).eq("id", id);
    let archived = false;
    if (done && t.mail_inbox_id) {
      const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("mail_inbox_id", t.mail_inbox_id).eq("status", "open");
      const { data: row } = await admin.from("mail_inbox").select("id, gone_at, account_id").eq("id", t.mail_inbox_id).maybeSingle();
      const acct = await accountForUser(admin, user!.id);
      if (!count && row && !row.gone_at && acct && acct.enabled && row.account_id === acct.id) {
        try { await archiveInbox(admin, acct, row.id as string, email || "portal"); archived = true; } catch { /* the to-do is done either way */ }
        // archiving closes the email's to-dos as "Archived in Outlook": this one was done by the person
        await admin.from("tasks").update({ status: "done", done_at: now, done_by: email }).eq("id", id);
      }
    }
    return { ok: true as const, archived };
  } catch (e) { return fail(e); }
}

export async function handTask(id: string, to: string) {
  try {
    const { admin, owner, name } = await me();
    const { data: who } = await admin.from("staff").select("email").eq("email", to.toLowerCase()).maybeSingle();
    if (!who) return { ok: false as const, error: "Not someone on the staff list." };
    const { error } = await admin.from("tasks").update({ owner: to.toLowerCase(), handed_by: name }).eq("id", id).eq("owner", owner);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export async function deleteTask(id: string) {
  // not a hard delete: a to-do that shouldn't be one is closed as "Not a to-do" (kept for the AI to learn from later)
  try {
    const { admin, owner, email } = await me();
    await admin.from("tasks").update({ status: "dismissed", done_at: new Date().toISOString(), done_by: email }).eq("id", id).eq("owner", owner);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

export async function addEvent(input: { title: string; day: string; start?: string | null; end?: string | null; place?: string; notes?: string }) {
  try {
    const { admin, owner } = await me();
    const day = ymd(input.day);
    if (!input.title?.trim() || !day) return { ok: false as const, error: "Give it a name and a day." };
    const hm = (s?: string | null) => (s && /^\d{1,2}:\d{2}$/.test(s) ? chicago(day, s) : null);
    const { data, error } = await admin.from("events").insert({
      owner, title: input.title.trim().slice(0, 200), day, all_day: !hm(input.start), starts_at: hm(input.start), ends_at: hm(input.end),
      place: (input.place || "").slice(0, 200), notes: (input.notes || "").slice(0, 1000), status: "added", source: "manual", created_by: owner,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { ok: true as const, event: data as CalEvent };
  } catch (e) { return fail(e); }
}

export async function setEventStatus(id: string, status: "added" | "dismissed" | "suggested") {
  try {
    const { admin, owner } = await me();
    const { error } = await admin.from("events").update({ status }).eq("id", id).eq("owner", owner);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** the private calendar link for the phone (made the first time it's asked for) */
export async function calendarLink() {
  try {
    const { admin, owner } = await me();
    let { data: f } = await admin.from("cal_feeds").select("token, shop").eq("owner", owner).maybeSingle();
    if (!f) {
      const token = randomBytes(18).toString("base64url");
      const { data } = await admin.from("cal_feeds").insert({ owner, token }).select("token, shop").single();
      f = data;
    }
    if (!f) throw new Error("Couldn't make the link.");
    const base = process.env.NEXT_PUBLIC_SITE_URL || "https://portal.fbsprint.com";
    const https = `${base.replace(/\/$/, "")}/api/cal/${f.token}`;
    return { ok: true as const, https, webcal: https.replace(/^https?:/, "webcal:"), shop: f.shop as boolean };
  } catch (e) { return fail(e); }
}

export async function setCalendarShop(on: boolean) {
  try {
    const { admin, owner } = await me();
    await admin.from("cal_feeds").update({ shop: on }).eq("owner", owner);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** the shop's in-hands dates (open orders) for the calendar page */
export async function shopDates(fromDay: string, toDay: string) {
  try {
    const { admin } = await me();
    const { data } = await admin.from("orders").select("id, number, nickname, due_date, status, customer_id, customers(company, name)")
      .gte("due_date", fromDay).lte("due_date", toDay).not("status", "in", "(quote,quote_sent,request,completed)").order("due_date").limit(300);
    return { ok: true as const, orders: ((data || []) as unknown as { id: string; number: number; nickname: string; due_date: string; status: string; customers: { company: string | null; name: string | null } | null }[]).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, day: o.due_date, status: o.status, customer: o.customers?.company || o.customers?.name || "" })) };
  } catch (e) { return fail(e); }
}

/** the to-dos and suggested events the AI made from one email in the Inbox */
export async function inboxItemExtras(mailInboxId: string) {
  try {
    const { admin, owner } = await me();
    const [{ data: t }, { data: e }] = await Promise.all([
      admin.from("tasks").select("*").eq("owner", owner).eq("mail_inbox_id", mailInboxId).neq("status", "dismissed").order("created_at"),
      admin.from("events").select("*").eq("owner", owner).eq("mail_inbox_id", mailInboxId).order("day"),
    ]);
    return { ok: true as const, tasks: (t || []) as Task[], events: (e || []) as CalEvent[] };
  } catch (e) { return fail(e); }
}

export type Brief = { greeting: string; headline: string; sections: { title: string; items: { text: string; ref: string }[] }[]; at: string };

/** Email → Inbox brief: the AI reads what's in your Inbox right now (plus to-dos due and today's calendar) and sums it up */
export async function inboxBrief() {
  try {
    const { admin, owner, name, user } = await me();
    const acct = await accountForUser(admin, user!.id);
    if (!acct || !acct.enabled) return { ok: false as const, error: "Connect your email first." };
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const soon = new Date(Date.now() + 2 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const [{ data: rows }, { data: t }, { data: ev }] = await Promise.all([
      admin.from("mail_inbox").select("id, from_name, from_email, subject, summary, bucket, activity_id, cc_only, unread, received_at").eq("account_id", acct.id).is("gone_at", null).order("received_at", { ascending: false }).limit(80),
      admin.from("tasks").select("title, area, due").eq("owner", owner).eq("status", "open").or(`due.lte.${soon},due.is.null`).limit(40),
      admin.from("events").select("title, day, starts_at, place, status").eq("owner", owner).eq("status", "added").gte("day", today).lte("day", soon).limit(20),
    ]);
    const items = (rows || []) as { id: string; from_name: string; from_email: string; subject: string; summary: string; bucket: string | null; activity_id: string | null; cc_only: boolean; unread: boolean; received_at: string | null }[];
    const actIds = items.map((r) => r.activity_id).filter(Boolean) as string[];
    const { data: acts } = actIds.length ? await admin.from("activities").select("id, customer_id, meta, customers(company, name)").in("id", actIds) : { data: [] };
    const am = new Map(((acts || []) as unknown as { id: string; meta: { triage?: { intent?: string; urgency?: string; urgent_reason?: string; needs_reply?: boolean; summary?: string }; no_reply?: boolean } | null; customers: { company: string | null; name: string | null } | null }[]).map((a) => [a.id, a]));
    const lines = items.map((r) => {
      const a = r.activity_id ? am.get(r.activity_id) : undefined, tr = a?.meta?.triage;
      const who = a?.customers?.company || a?.customers?.name || r.from_name || r.from_email;
      return `[${r.id}] ${a ? `CUSTOMER ${who}` : r.from_name || r.from_email}${r.cc_only ? " (cc'd)" : ""}${r.unread ? " (unread)" : ""} · ${r.subject} · ${tr?.summary || r.summary || ""}${tr?.intent ? ` · intent ${tr.intent}` : r.bucket ? ` · ${r.bucket}` : ""}${tr?.urgency === "high" ? ` · URGENT ${tr.urgent_reason || ""}` : ""}${a && tr?.needs_reply && !a.meta?.no_reply ? " · needs a reply" : ""} · ${r.received_at ? new Date(r.received_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }) : ""}`;
    });
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, error: st.reason };
    const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
    const res = await askClaude<Omit<Brief, "at">>({
      task: "inbox_brief", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 1100, admin, ctx: { by: owner }, timeoutMs: 40000,
      tool: { name: "brief", description: "A short morning-style brief of the inbox.", input_schema: { type: "object", properties: {
        greeting: { type: "string", description: `A warm one-line greeting using the name ${name} and the time of day (${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}).` },
        headline: { type: "string", description: "One or two sentences: how the inbox looks overall and the most important thing to do first. Plain and encouraging, no fluff." },
        sections: { type: "array", maxItems: 5, description: "Groups such as: Needs you now (urgent / waiting on a reply), Orders & reorders, To-dos from email, Coming up (calendar, due dates), Just so you know. Skip empty groups.", items: { type: "object", properties: {
          title: { type: "string" },
          items: { type: "array", maxItems: 6, items: { type: "object", properties: { text: { type: "string", description: "One short line: who and what, e.g. \"Dear Heart Designs: new .ai files for 2 orders, pickup week of Oct 19\"" }, ref: { type: "string", description: "The [id] of the email this is about, or empty" } }, required: ["text", "ref"] } },
        }, required: ["title", "items"] } },
      }, required: ["greeting", "headline", "sections"] } },
      system: `You are ${name}'s assistant at ${st.settings.shop.name} (a screen printing shop). Summarize their email inbox the way a sharp office manager would at the start of the day: what matters, in order. Customer emails about orders, reorders, artwork and payments come first. Use only what's listed. Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" })}.`,
      prompt: `INBOX (${items.length} emails):\n${lines.join("\n") || "(empty)"}\n\nTO-DOS DUE SOON OR UNDATED:\n${((t || []) as { title: string; area: string; due: string | null }[]).map((x) => `- ${x.title} (${x.area}${x.due ? `, due ${x.due}` : ""})`).join("\n") || "(none)"}\n\nCALENDAR (next 2 days):\n${((ev || []) as { title: string; day: string; starts_at: string | null; place: string }[]).map((e) => `- ${e.day} ${e.starts_at ? new Date(e.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : ""} ${e.title}${e.place ? ` @ ${e.place}` : ""}`).join("\n") || "(nothing)"}`,
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    const ids = new Set(items.map((r) => r.id));
    // the model sometimes hands nested lists back as JSON text: read them either way
    const arr = <T,>(v: unknown): T[] => { if (Array.isArray(v)) return v as T[]; if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? (j as T[]) : []; } catch { return []; } } return []; };
    const secs = arr<{ title: string; items: unknown }>(res.data.sections).map((x) => ({ title: x.title, items: arr<{ text: string; ref: string }>(x.items) }));
    const brief: Brief = { ...res.data, sections: secs.map((s) => ({ title: s.title, items: (s.items || []).map((i) => ({ text: i.text, ref: ids.has((i.ref || "").replace(/[[\]]/g, "")) ? (i.ref || "").replace(/[[\]]/g, "") : "" })) })), at: new Date().toISOString() };
    return { ok: true as const, brief };
  } catch (e) { return fail(e); }
}
