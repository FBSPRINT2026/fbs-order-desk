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

export type Task = { id: string; owner: string; title: string; notes: string; area: string; due: string | null; status: string; snooze_until: string | null; source: string; mail_inbox_id: string | null; activity_id: string | null; order_id: string | null; created_by: string; handed_by: string | null; created_at: string; done_at: string | null; done_by: string | null; from?: string; subject?: string; /** what it's about (the Job watcher: the job) */ url?: string | null; ref?: string | null };
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
    const { data: t } = await admin.from("tasks").select("id, mail_inbox_id, status, ref").eq("id", id).eq("owner", owner).maybeSingle();
    if (!t) return { ok: false as const, error: "That to-do isn't yours." };
    const now = new Date().toISOString();
    await admin.from("tasks").update(done ? { status: "done", done_at: now, done_by: email } : { status: "open", done_at: null, done_by: null }).eq("id", id);
    // a Job watcher step done by one owner is done for the other too
    if (done && t.ref) await admin.from("tasks").update({ status: "done", done_at: now, done_by: email }).eq("ref", t.ref).eq("status", "open").neq("id", id);
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
      .gte("due_date", fromDay).lte("due_date", toDay).eq("draft", false).is("discarded_at", null).not("status", "in", "(quote,quote_sent,request,completed)").order("due_date").limit(300);
    return { ok: true as const, orders: ((data || []) as unknown as { id: string; number: number; nickname: string; due_date: string; status: string; customers: { company: string | null; name: string | null } | null }[]).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, day: o.due_date, status: o.status, customer: o.customers?.company || o.customers?.name || "" })) };
  } catch (e) { return fail(e); }
}

/** the appointments in a window (the Calendar's day / week / month), added and suggested */
export async function eventsBetween(fromDay: string, toDay: string) {
  try {
    const { admin, owner } = await me();
    const f = ymd(fromDay), t = ymd(toDay);
    if (!f || !t) return { ok: false as const, error: "Those days don't look right." };
    const { data, error } = await admin.from("events").select("*").eq("owner", owner).in("status", ["added", "suggested"]).gte("day", f).lte("day", t).order("day").order("starts_at", { ascending: true, nullsFirst: true }).limit(1000);
    if (error) throw new Error(error.message);
    return { ok: true as const, events: (data || []) as CalEvent[] };
  } catch (e) { return fail(e); }
}

/** move or resize an appointment (the Calendar's week view: drag it, or drag its bottom edge), or change its words */
export async function updateEvent(id: string, p: { title?: string; place?: string; notes?: string; starts_at?: string | null; ends_at?: string | null; day?: string; all_day?: boolean }) {
  try {
    const { admin, owner } = await me();
    const patch: Record<string, unknown> = {};
    if (p.title != null) { if (!p.title.trim()) return { ok: false as const, error: "Give it a name." }; patch.title = p.title.trim().slice(0, 200); }
    if (p.place != null) patch.place = p.place.slice(0, 200);
    if (p.notes != null) patch.notes = p.notes.slice(0, 1000);
    const iso = (v: unknown) => (typeof v === "string" && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
    if (p.starts_at !== undefined) patch.starts_at = iso(p.starts_at);
    if (p.ends_at !== undefined) patch.ends_at = iso(p.ends_at);
    if (p.day != null) { const d = ymd(p.day); if (!d) return { ok: false as const, error: "That day doesn't look right." }; patch.day = d; }
    if (p.all_day != null) patch.all_day = p.all_day;
    const { data, error } = await admin.from("events").update(patch).eq("id", id).eq("owner", owner).select("*").single();
    if (error) throw new Error(error.message);
    return { ok: true as const, event: data as CalEvent };
  } catch (e) { return fail(e); }
}

/**
 * The Jobs calendar (Oct 26, Nick: "you look at your jobs calendar. It's like, here's what's due today. Here's what's due
 * tomorrow"): every open job due in the window, ours and the ones still in Printavo, plus the late ones (due before
 * today and not done). by = "due" (the in-hands date) or "print" (the production date).
 */
export type CalJob = { id: string; href: string; number: string; customer: string; nickname: string; day: string; qty: number; status: string; statusLabel: string; methods: string[]; printavo: boolean; /** the account manager's first name (lowercase) */ owner: string; /** one of the signed-in person's (or the viewed-as person's) accounts */ mine: boolean };
export async function jobDates(fromDay: string, toDay: string, today: string, by: "due" | "print" = "due") {
  try {
    const { admin, name: myName, owner: myEmail } = await me();
    const f = ymd(fromDay), t = ymd(toDay), td = ymd(today);
    if (!f || !t || !td) return { ok: false as const, error: "Those days don't look right." };
    const col = by === "print" ? "production_date" : "due_date";
    const lateFrom = new Date(Date.parse(td + "T12:00:00Z") - 60 * 864e5).toISOString().slice(0, 10);
    const lo = f < td ? f : lateFrom;
    const OPEN_PV = '("Job Completed","Quote - Closed","Quote")';
    const [{ data: ours }, { data: pv }] = await Promise.all([
      admin.from("orders").select(`id, number, nickname, ${col}, qty, status, groups, customer_id, customers(company, name)`).gte(col, lo).lte(col, t).eq("draft", false).is("discarded_at", null)
        .not("status", "in", "(quote,quote_sent,request,completed)").order(col).limit(1000),
      by === "print" ? Promise.resolve({ data: [] }) : admin.from("archived_orders").select("id, visual_id, nickname, due_date, qty, status_name, kind, customer_id, imps:data->groups, owner:data->>owner").eq("kind", "invoice").gte("due_date", lo).lte("due_date", t)
        .not("status_name", "in", OPEN_PV).order("due_date").limit(1000),
    ]);
    const kindOf = (w: string) => (/emb/i.test(w) ? "embroidery" : /dtf|transfer|heat/i.test(w) ? "dtf" : /screen/i.test(w) ? "screen" : "");
    const custIds = [...new Set(((pv || []) as { customer_id: string | null }[]).map((r) => r.customer_id).filter(Boolean))] as string[];
    // whose account each job is (Oct 27, Nick: "by default make it just your jobs… as the account manager"): the account
    // owner set on the customer (Settings → Staff → Account owners), else the owner on the customer's latest Printavo
    // order, the same rule as the dashboard's "My accounts"
    const { accountOwners, firstName: first } = await import("@/lib/accountOwners");
    const acct = await accountOwners(admin, [...custIds, ...((ours || []) as { customer_id: string | null }[]).map((r) => r.customer_id || "")]);
    const meFirst = first(myName) || first(myEmail);
    const names = new Map<string, string>();
    for (let i = 0; i < custIds.length; i += 200) {
      const { data: cs } = await admin.from("customers").select("id, company, name").in("id", custIds.slice(i, i + 200));
      for (const c of (cs || []) as { id: string; company: string | null; name: string | null }[]) names.set(c.id, c.company || c.name || "");
    }
    const { STATUSES } = await import("@/lib/pricing");
    const label = (k: string) => STATUSES.find((x) => x.k === k)?.label || k;
    const jobs: CalJob[] = [
      ...((ours || []) as unknown as { id: string; number: number; nickname: string | null; qty: number | null; status: string; groups: { imprints?: { method?: string }[] }[] | null; customer_id: string | null; customers: { company: string | null; name: string | null } | null; [k: string]: unknown }[]).map((o) => ({
        id: o.id, href: `/shop/orders/${o.id}`, number: String(o.number), customer: o.customers?.company || o.customers?.name || "", nickname: o.nickname || "", day: String(o[col] || ""), qty: o.qty || 0,
        status: o.status, statusLabel: label(o.status), methods: [...new Set((o.groups || []).flatMap((g) => (g.imprints || []).map((i) => i.method || "")).filter(Boolean))], printavo: false,
        owner: acct.get(String(o.customer_id || "")) || "", mine: false,
      })),
      ...((pv || []) as { id: string; visual_id: string; nickname: string | null; due_date: string; qty: number | null; status_name: string; customer_id: string | null; imps: { imprints?: { typeOfWork?: string }[] }[] | null; owner: string | null }[]).map((o) => ({
        id: o.id, href: `/shop/archive/${o.id}`, number: o.visual_id, customer: (o.customer_id && names.get(o.customer_id)) || "", nickname: o.nickname || "", day: o.due_date, qty: o.qty || 0,
        status: "printavo", statusLabel: o.status_name, methods: [...new Set((o.imps || []).flatMap((g) => (g.imprints || []).map((i) => kindOf(i.typeOfWork || ""))).filter(Boolean))], printavo: true,
        owner: (o.customer_id && acct.get(o.customer_id)) || first(o.owner), mine: false,
      })),
    ].filter((j) => j.day).map((j) => ({ ...j, mine: !!meFirst && j.owner === meFirst }));
    // hasAccounts: whether this person manages any of these (production crew don't: they keep seeing everyone's)
    return { ok: true as const, jobs, hasAccounts: jobs.some((j) => j.mine) };
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
