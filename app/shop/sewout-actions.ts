"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { approveSewoutAnotherWay, remindSewout, sendSewout } from "@/lib/sewouts";
import { makeSnap } from "@/lib/phoneSnap";

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

/** A phone link for this print's sew-out photo (the QR code on the computer, lib/phoneSnap.ts). */
export async function sewoutPhoneLink(orderId: string, imprintId: string) {
  return run(async () => {
    const who = await me();
    const id = await makeSnap(createAdminClient(), { kind: "sewout", orderId, target: imprintId, by: who.email });
    return { ok: true as const, id };
  });
}
/** Has the phone sent the photo yet? (the computer's pop-up asks every few seconds) */
export async function phoneSnapState(id: string) {
  return run(async () => {
    await me();
    const { data } = await createAdminClient().from("phone_snaps").select("used_at, result, expires_at").eq("id", id).maybeSingle();
    const r = data as { used_at: string | null; result: { msg?: string } | null; expires_at: string } | null;
    return { ok: true as const, done: !!r?.used_at, msg: r?.result?.msg || "", expired: !r || new Date(r.expires_at).getTime() < Date.now() };
  });
}
