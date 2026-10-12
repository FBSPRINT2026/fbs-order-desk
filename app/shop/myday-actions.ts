"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountForUser } from "@/lib/mail/config";
import { mailboxToRead } from "@/lib/mail/viewing";
import { archiveInbox, chicago } from "@/lib/mail/mirror";
import { inboxSig, writeBrief, type Brief } from "@/lib/mail/brief";
export type { Brief };

/**
 * My Day: each person's to-dos and calendar. To-dos come from email (the AI reads the Inbox), from the shop, or are
 * typed in; they can be handed to the other owner. Done on a to-do from an email archives that email in Outlook
 * (and archiving it in Outlook closes its to-dos). Events are suggested from email and added with a tap; the
 * person's private calendar link puts the added ones (and the shop's in-hands dates) on their phone.
 */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const admin = createAdminClient();
  // "View as" a person (owners): My Day is theirs (Oct 12, Nick: "View as Amanda shows my dashboard")
  if (v.role === "owner") {
    const want = ((await cookies()).get("fbs_view_as")?.value || "").toLowerCase();
    if (want.includes("@") && want !== v.email.toLowerCase()) {
      const { data: p } = await admin.from("staff").select("email, name").ilike("email", want).maybeSingle();
      if (p) return { ...v, admin, owner: want, name: String(p.name || "") || want.split("@")[0], viewing: true };
    }
  }
  return { ...v, admin, owner: v.email.toLowerCase(), name: String(v.staff?.name || "") || v.email.split("@")[0], viewing: false };
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


/** Email → Inbox brief: the AI reads what's in your Inbox right now (plus to-dos due and today's calendar) and sums it up */
/** the Inbox summary: the one written ahead of time (instant), else written now; `fresh` writes it again */
export async function inboxBrief(fresh = false) {
  try {
    const v = await me(), { admin, owner, name } = v;
    const { acct } = await mailboxToRead(admin, v);
    if (!acct || !acct.enabled) return { ok: false as const, error: "Connect your email first." };
    if (!fresh) {
      const { data: kept } = await admin.from("mail_brief").select("sig, brief").eq("account_id", acct.id).maybeSingle();
      if (kept?.brief) return { ok: true as const, brief: kept.brief as Brief, stale: kept.sig !== (await inboxSig(admin, acct.id)) };
    }
    const r = await writeBrief(admin, acct, owner, name);
    return r.ok ? { ok: true as const, brief: r.brief, stale: false } : { ok: false as const, error: r.error };
  } catch (e) { return fail(e); }
}

/**
 * After you send a reply (Oct 12, Nick: "I said we're on track and we're going to deliver on Wednesday… it should pop up
 * and say would you like to create a task or a reminder to deliver Gateway on Wednesday, and put that on my
 * dashboard"): the AI reads what you just wrote and offers the follow-ups it promises, as to-dos or calendar events.
 * Nothing is added until you tap one.
 */
export type FollowUp = { kind: "todo" | "event"; title: string; day: string | null; start: string | null; area: "personal" | "money" | "shop"; why: string };
export async function suggestFollowUps(input: { to: string; subject: string; body: string; theirs?: string }) {
  try {
    const { admin, owner } = await me();
    const { aiState, askClaude } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: true as const, items: [] as FollowUp[] };
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
    const r = await askClaude<{ items: unknown }>({
      task: "reply_followups", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 700, admin, ctx: { by: owner }, timeoutMs: 20_000,
      tool: { name: "followups", description: "Follow-ups the sender just committed to.", input_schema: { type: "object", properties: {
        items: { type: "array", maxItems: 3, description: "0-3 things the sender promised or now has to do because of this reply (deliver, ship, send a quote, call, follow up, meet). Empty when the reply commits to nothing.", items: { type: "object", properties: {
          kind: { type: "string", enum: ["todo", "event"], description: "event: being somewhere or something happening at a set time (a meeting, a call at 2pm, a delivery they'll be there for). todo: something to do by a day." },
          title: { type: "string", description: "Short, starts with a verb, names who/what: \"Deliver Gateway's order\", \"Send David the revised quote\"" },
          day: { type: ["string", "null"], description: "YYYY-MM-DD when the reply gives or clearly implies the day (\"Wednesday\" = the coming Wednesday); null otherwise" },
          start: { type: ["string", "null"], description: "HH:MM 24-hour when a time is given; else null" },
          area: { type: "string", enum: ["personal", "money", "shop"] },
          why: { type: "string", description: "A few words from the reply that it comes from" },
        }, required: ["kind", "title", "day", "start", "area", "why"] } },
      }, required: ["items"] } },
      system: `You help a print shop owner keep their promises. They just sent this reply. List only follow-ups the reply actually commits them to. Today is ${today} (Central time).`,
      prompt: `To: ${input.to}\nSubject: ${input.subject}\n\nWhat they wrote:\n"""\n${input.body.slice(0, 4000)}\n"""${input.theirs ? `\n\nThe email they were answering:\n"""\n${input.theirs.slice(0, 3000)}\n"""` : ""}`,
    });
    if (!r.ok) return { ok: true as const, items: [] as FollowUp[] };
    const raw = Array.isArray(r.data.items) ? r.data.items : typeof r.data.items === "string" ? (() => { try { return JSON.parse(r.data.items as string); } catch { return []; } })() : [];
    const items = (raw as Partial<FollowUp>[]).filter((x) => x && x.title).slice(0, 3).map((x) => ({
      kind: x.kind === "event" && x.day ? "event" as const : "todo" as const, title: String(x.title).slice(0, 160), day: ymd(x.day || null), start: x.start && /^\d{1,2}:\d{2}$/.test(x.start) ? x.start : null,
      area: (["personal", "money", "shop"].includes(String(x.area)) ? x.area : "shop") as FollowUp["area"], why: String(x.why || "").slice(0, 120),
    }));
    return { ok: true as const, items };
  } catch (e) { return fail(e); }
}

/** Cheer mode: fireworks and a kind note when you finish something (My Day's switch) */
export async function getCheer() {
  try { const { admin, owner } = await me(); const { data } = await admin.from("staff").select("cheer").ilike("email", owner).maybeSingle(); return { ok: true as const, on: !!data?.cheer }; } catch (e) { return fail(e); }
}
export async function setCheer(on: boolean) {
  try { const { admin, owner } = await me(); await admin.from("staff").update({ cheer: on }).ilike("email", owner); return { ok: true as const }; } catch (e) { return fail(e); }
}
