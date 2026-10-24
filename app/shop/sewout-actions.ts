"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveSewoutAnotherWay, remindSewout, sendSewout } from "@/lib/sewouts";

/** Sew-out approval from the shop (lib/sewouts.ts): save the photo and email it, remind, or approved another way. */
async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const { data } = await v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle();
  return { email: v.email, name: (data?.name as string) || v.email.split("@")[0] };
}
const run = async <T,>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." }; } };

/** The cropped sew-out photo (already uploaded) becomes the print's next sew-out and is emailed to the customer. */
export async function sendSewoutPhoto(orderId: string, imprintId: string, photoPath: string, rawPath: string, note: string) {
  return run(async () => sendSewout(createAdminClient(), { orderId, imprintId, photoPath, rawPath, note }, await me()));
}
export async function remindSewoutAction(id: string) { return run(async () => remindSewout(createAdminClient(), id, await me())); }
export async function approveSewoutAnother(id: string, how: string) { return run(async () => approveSewoutAnotherWay(createAdminClient(), id, await me(), how)); }
