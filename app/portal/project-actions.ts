"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, newGroup } from "@/lib/pricing";

type Result = { ok: boolean; error?: string; id?: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });
const day = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** The signed-in customer (staff previews are read-only). */
async function me() {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Customers do this from their own login.");
  const { data: cs } = await supabase.from("customers").select("id, name, company, price_type, tax_exempt");
  const cust = (cs || [])[0];
  if (!cust) throw new Error("We couldn't find your account.");
  return { supabase, email, cust, admin: createAdminClient() };
}
/** One of this customer's projects (row security decides). */
async function myProject(id: string) {
  const ctx = await me();
  const { data: p } = await ctx.supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!p) throw new Error("We couldn't find that project.");
  return { ...ctx, project: p };
}

export async function createProject(input: { name: string; event_date?: string | null; in_hands_date?: string | null; delivery?: string; requests?: string }): Promise<Result> {
  try {
    const { cust, email, admin } = await me();
    const name = (input.name || "").trim().slice(0, 120);
    if (!name) return { ok: false, error: "Give the project a name." };
    const { data, error } = await admin.from("projects").insert({ customer_id: cust.id, name, event_date: day(input.event_date), in_hands_date: day(input.in_hands_date), delivery: (input.delivery || "").slice(0, 1000), requests: (input.requests || "").slice(0, 4000), created_by: email }).select("id").single();
    if (error) return { ok: false, error: error.message };
    if (SHOP_NOTIFY_EMAIL) {
      const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `New project: ${name} (${cust.company || cust.name})`, html: emailLayout(mergeSettings(s?.data).shop.name, `${cust.company || cust.name} started a project`, [`${name}`, input.event_date ? `Event: ${input.event_date}` : "", input.in_hands_date ? `Needs it by: ${input.in_hands_date}` : "", input.requests || ""].filter(Boolean).join("\n"), "Open project", `${siteUrl()}/shop/projects/${data.id}`) });
    }
    revalidatePath("/portal");
    return { ok: true, id: data.id };
  } catch (e) { return fail(e); }
}

export async function updateProject(id: string, patch: { name?: string; event_date?: string | null; in_hands_date?: string | null; delivery?: string; requests?: string }): Promise<Result> {
  try {
    const { admin } = await myProject(id);
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name.trim().slice(0, 120) || "Project";
    if (patch.event_date !== undefined) row.event_date = day(patch.event_date);
    if (patch.in_hands_date !== undefined) row.in_hands_date = day(patch.in_hands_date);
    if (patch.delivery !== undefined) row.delivery = patch.delivery.slice(0, 1000);
    if (patch.requests !== undefined) row.requests = patch.requests.slice(0, 4000);
    const { error } = await admin.from("projects").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/portal/projects/${id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** The customer adds a to-do for themselves (e.g. "Send final attendee count"). */
export async function addMyTask(projectId: string, title: string, due: string | null): Promise<Result> {
  try {
    const { admin } = await myProject(projectId);
    const t = title.trim().slice(0, 200);
    if (!t) return { ok: false, error: "Write the task first." };
    const { error } = await admin.from("project_tasks").insert({ project_id: projectId, title: t, due_date: day(due), who: "customer", shop_only: false, done_by: "", position: Date.now() % 2147483647 });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/portal/projects/${projectId}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Check off (or un-check) a task the customer can see. */
export async function toggleMyTask(taskId: string, done: boolean): Promise<Result> {
  try {
    const { supabase, admin, email } = await me();
    const { data: t } = await supabase.from("project_tasks").select("id, project_id").eq("id", taskId).maybeSingle();
    if (!t) return { ok: false, error: "We couldn't find that task." };
    const { error } = await admin.from("project_tasks").update({ done_at: done ? new Date().toISOString() : null, done_by: done ? email : "" }).eq("id", taskId);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/portal/projects/${t.project_id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Put one of their orders in a project (or take it out with projectId null). */
export async function setOrderProject(orderId: string, projectId: string | null): Promise<Result> {
  try {
    const { supabase, admin } = await me();
    const { data: o } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false, error: "We couldn't find that order." };
    if (projectId) { const { data: p } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle(); if (!p) return { ok: false, error: "We couldn't find that project." }; }
    const { error } = await admin.from("orders").update({ project_id: projectId }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Start a new order request inside the project. */
export async function startProjectOrder(projectId: string): Promise<Result> {
  try {
    const { admin, cust, project } = await myProject(projectId);
    const { data, error } = await admin.from("orders").insert({
      customer_id: cust.id, status: "request", type: "quote", source: "portal", price_type: cust.price_type || "retail", tax_exempt: !!cust.tax_exempt,
      groups: [newGroup()], total: 0, project_id: projectId, nickname: `${project.name}`.slice(0, 120), due_date: project.in_hands_date || null,
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) { return fail(e); }
}
