"use server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobTimeline, loadJobCenter } from "@/lib/jobCenter";
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
    const { admin, who } = await me();
    const items = await loadJobCenter(admin);
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
    await admin.from("order_events").insert({ order_id: orderId, kind: "job_declined", detail: why || "No reason given", actor: email });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** Put a declined job back on. */
export async function undoDeclined(orderId: string) {
  try {
    const { admin, email } = await me();
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
