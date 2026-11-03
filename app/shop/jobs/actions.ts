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

export async function loadJobs() {
  try {
    const t0 = Date.now();
    const { admin, who } = await me();
    const t1 = Date.now();
    const items = await loadJobCenter(admin);
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

/** The customer walked away: off the steps, under Declined for two weeks. Nothing else on the order changes. */
export async function markDeclined(orderId: string, reason: string) {
  try {
    const { admin, email } = await me();
    const why = (reason || "").trim().slice(0, 500);
    const { error } = await admin.from("orders").update({ declined_at: new Date().toISOString(), declined_reason: why }).eq("id", orderId);
    if (error) throw new Error(error.message);
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
    const { error } = await admin.from("orders").update({ declined_at: null, declined_reason: "" }).eq("id", orderId);
    if (error) throw new Error(error.message);
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
