"use server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobDetail, jobTimeline, loadJobCenter } from "@/lib/jobCenter";
import { firstName } from "@/lib/accountOwners";

/** The Job Center (app/shop/jobs/page.tsx): every job before production, by the step it's at (lib/jobCenter.ts). */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const admin = createAdminClient();
  // "View as" a person (owners): My accounts is theirs
  if (v.role === "owner") {
    const want = ((await cookies()).get("fbs_view_as")?.value || "").toLowerCase();
    if (want.includes("@") && want !== v.email.toLowerCase()) {
      const { data: p } = await admin.from("staff").select("email, name").ilike("email", want).maybeSingle();
      if (p) return { admin, email: v.email, who: firstName(String(p.name || "") || want) };
    }
  }
  return { admin, email: v.email, who: firstName(String(v.staff?.name || "") || v.email) };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

// the board as last worked out, kept 30 seconds on this server so coming back to the Job Center (or a second person
// opening it) doesn't redo the 3-second count (Nov 10, Nick: "it doesn't need to pull it every second"); a change made
// on the board itself asks for a fresh one
let boardMemo: { at: number; items: Awaited<ReturnType<typeof loadJobCenter>>; job?: Promise<Awaited<ReturnType<typeof loadJobCenter>>> } | null = null;
const BOARD_TTL = 30_000;

export async function loadJobs(fresh = false) {
  try {
    const t0 = Date.now();
    const { admin, who } = await me();
    const t1 = Date.now();
    let items: Awaited<ReturnType<typeof loadJobCenter>>;
    if (!fresh && boardMemo && Date.now() - boardMemo.at < BOARD_TTL) items = boardMemo.items;
    else {
      const job = loadJobCenter(admin);
      items = await job;
      boardMemo = { at: Date.now(), items };
    }
    console.log(`[jc-time] me ${t1 - t0}ms, board ${Date.now() - t1}ms, ${items.length} items`);
    return { ok: true as const, items, me: who, hasAccounts: !!who && items.some((x) => x.owner === who) };
  } catch (e) { return fail(e); }
}

export async function jobHistory(orderId: string) {
  try {
    const { admin } = await me();
    return { ok: true as const, rows: await jobTimeline(admin, orderId) };
  } catch (e) { return fail(e); }
}

/**
 * The customer walked away: off the steps, under Declined for two weeks. A quote becomes a closed quote (Nov 3, Nick:
 * "it needs to be complete… it should say closed quote": stored as completed, still a quote; lib/pricing.ts statusKey);
 * an approved job keeps its status.
 */
export async function markDeclined(orderId: string, reason: string) {
  try {
    const { admin, email } = await me();
    const why = (reason || "").trim().slice(0, 500);
    const { data: o0 } = await admin.from("orders").select("type").eq("id", orderId).maybeSingle();
    const quote = (o0 as { type?: string } | null)?.type === "quote";
    const { error } = await admin.from("orders").update({ declined_at: new Date().toISOString(), declined_reason: why, ...(quote ? { status: "completed" } : {}) }).eq("id", orderId);
    if (error) throw new Error(error.message);
    if (quote) await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "closed", actor: email });
    await (await import("@/lib/closedQuote")).shelveClosedQuoteArt(admin, orderId, true);
    await admin.from("order_events").insert({ order_id: orderId, kind: "job_declined", detail: why || "No reason given", actor: email });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Put a declined job back on. */
export async function undoDeclined(orderId: string) {
  try {
    const { admin, email } = await me();
    await (await import("@/lib/closedQuote")).shelveClosedQuoteArt(admin, orderId, false);
    // a closed quote is a live quote again
    const { data: o0 } = await admin.from("orders").select("status, type").eq("id", orderId).maybeSingle();
    const closed = (o0 as { status?: string; type?: string } | null)?.status === "completed" && (o0 as { type?: string }).type === "quote";
    const { error } = await admin.from("orders").update({ declined_at: null, declined_reason: "", ...(closed ? { status: "quote" } : {}) }).eq("id", orderId);
    if (error) throw new Error(error.message);
    if (closed) await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "quote", actor: email });
    await admin.from("order_events").insert({ order_id: orderId, kind: "job_reopened", detail: "", actor: email });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** A lead that isn't a job: closes the AI's draft order (the email stays where it is). */
export async function notAJob(suggestionId: string) {
  try {
    const { admin, email } = await me();
    const { error } = await admin.from("ai_suggestions").update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: email }).eq("id", suggestionId).eq("kind", "draft_order");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** One job for the right panel (lib/jobCenter.ts jobDetail). */
export async function jobPanel(orderId: string) {
  try {
    const { admin } = await me();
    const [detail, rows] = await Promise.all([jobDetail(admin, orderId), jobTimeline(admin, orderId)]);
    return { ok: true as const, detail, rows };
  } catch (e) { return fail(e); }
}

/** The Job Center's messages (lib/jobChats.ts): every conversation a customer wrote in, the last 60 days. */
export async function loadJobChats() {
  try {
    const { admin } = await me();
    const { loadChats } = await import("@/lib/jobChats");
    return { ok: true as const, chats: await loadChats(admin) };
  } catch (e) { return fail(e); }
}

/** Archive a conversation (or bring it back): off the Message Center until the customer writes again (Nov 6, Nick) */
export async function archiveJobChat(key: string, on: boolean) {
  try {
    const { admin, email } = await me();
    const { error } = await admin.from("chat_archive").upsert({ key, archived_at: on ? new Date().toISOString() : null, archived_by: email || null });
    if (error) throw new Error(error.message);
    if (on) { const { markThreadRead } = await import("@/lib/jobChats"); await markThreadRead(admin, key); }
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Staff change what a customer's message is about (lib/messages.ts REASONS): "Needs a reply after all", or the other way */
export async function setMessageReason(id: string, reason: string | null) {
  try {
    const { admin } = await me();
    const { reasonOf } = await import("@/lib/messages");
    const { error } = await admin.from("messages").update({ reason: reasonOf(reason)?.k || null }).eq("id", id).eq("author_type", "customer");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** One conversation; opening it marks the customer's messages in it read. */
export async function jobChatThread(key: string, markRead = true) {
  try {
    const { admin } = await me();
    const { loadThread, markThreadRead } = await import("@/lib/jobChats");
    if (markRead) await markThreadRead(admin, key);
    return { ok: true as const, messages: await loadThread(admin, key) };
  } catch (e) { return fail(e); }
}

/**
 * Reply from the Job Center. It shows in the customer's portal Messages (and live on their order page). No email for now
 * (Nov 2, Nick: "all email notifications are off for just now"); the order page's message box still emails as before.
 */
export async function jobChatSend(key: string, body: string, files: unknown[] = []) {
  try {
    const { admin, email } = await me();
    const text = String(body || "").trim().slice(0, 5000);
    const { parseKey } = await import("@/lib/jobChats");
    const p = parseKey(key);
    // files: only ones put in this customer's message folder (lib/messages.ts cleanAttachments)
    const cid = p.orderId ? String((await admin.from("orders").select("customer_id").eq("id", p.orderId).maybeSingle()).data?.customer_id || "") : p.customerId || "";
    const { cleanAttachments } = await import("@/lib/messages");
    const attachments = cid ? cleanAttachments(files, cid) : [];
    if (!text && !attachments.length) return { ok: false as const, error: "Write a message first." };
    const { mergeSettings } = await import("@/lib/pricing");
    const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const shop = mergeSettings(s?.data).shop.name;
    const row = p.orderId ? { order_id: p.orderId, topic: p.topic } : { customer_id: p.customerId };
    const { error } = await admin.from("messages").insert({ ...row, author_type: "staff", author_email: email, author_name: shop, body: text, attachments });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/* ── The AI on a customer's message (Nick, Nov 16 2026; lib/ai/messageRead.ts, components/MsgAiCard.tsx) ── */

/** read (or read again) what a customer's message means */
export async function msgAiRead(id: string) {
  try {
    const { admin } = await me();
    const { aiState } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, error: st.reason };
    const { readMessage } = await import("@/lib/ai/messageRead");
    return await readMessage(admin, st.settings, id, true);
  } catch (e) { return fail(e); }
}

/** the messages nobody has read yet, a few at a time (the Job Center asks again while some are left) */
export async function msgAiPending() {
  try {
    const { admin } = await me();
    const { aiState } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: true as const, read: 0, left: 0 };
    const { readPending } = await import("@/lib/ai/messageRead");
    return { ok: true as const, ...(await readPending(admin, st.settings, 3)) };
  } catch (e) { return fail(e); }
}

/** the message is done: it and the earlier ones its read covers come off To do */
async function finish(admin: ReturnType<typeof createAdminClient>, id: string, by: string, ai: Record<string, unknown> | null) {
  const now = new Date().toISOString();
  const covers = ((ai?.covers as string[]) || []).filter(Boolean);
  await admin.from("messages").update({ handled_at: now, handled_by: by, ...(ai ? { ai } : {}) }).eq("id", id);
  if (covers.length) await admin.from("messages").update({ handled_at: now, handled_by: by }).in("id", covers).is("handled_at", null);
}

/** Apply: the changes the AI worked out, made through the AI order helper; the message is done */
export async function msgAiApply(id: string) {
  try {
    const { admin, email, who } = await me();
    const { data: m } = await admin.from("messages").select("id, order_id, author_name, created_at, ai").eq("id", id).maybeSingle();
    const ai = m?.ai as import("@/lib/messageRead").MsgRead | null;
    if (!m || !ai) return { ok: false as const, error: "Nothing to apply." };
    let applied: string[] = [];
    if (m.order_id && ai.changes?.length) {
      const { applyChanges } = await import("@/lib/ai/orderFix");
      const when = new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
      const a = await applyChanges(admin, m.order_id, email || who, ai.changes.filter((c) => c.what !== "art") as never, `From ${(m.author_name || "the customer").split(/\s+/)[0]}'s message, ${when}`);
      if (!a.ok) return a;
      applied = a.applied;
    }
    const read = { ...ai, done: { at: new Date().toISOString(), by: who, applied } };
    await finish(admin, id, who, read);
    return { ok: true as const, applied, reply: ai.reply || "" };
  } catch (e) { return fail(e); }
}

/** "Not this": kept (the next reads are shown it, so it learns); it stays To do */
export async function msgAiNo(id: string, note = "") {
  try {
    const { admin, who } = await me();
    const { data: m } = await admin.from("messages").select("ai").eq("id", id).maybeSingle();
    if (!m?.ai) return { ok: false as const, error: "Nothing to change." };
    const ai = { ...(m.ai as object), kind: "todo", no: { at: new Date().toISOString(), by: who, note: note.trim().slice(0, 300) || undefined } };
    await admin.from("messages").update({ ai, ai_kind: "todo", handled_at: null, handled_by: null }).eq("id", id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** done without changing anything (answered on the phone, handled by hand); or back on To do */
export async function msgAiDone(id: string, on: boolean) {
  try {
    const { admin, who } = await me();
    const { data: m } = await admin.from("messages").select("ai").eq("id", id).maybeSingle();
    if (on) await finish(admin, id, who, null);
    else await admin.from("messages").update({ handled_at: null, handled_by: null, ai_kind: "todo", ...(m?.ai ? { ai: { ...(m.ai as object), kind: "todo" } } : {}) }).eq("id", id);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
