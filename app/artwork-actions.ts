"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: boolean; error?: string };

/** The design, if the signed-in person may change it (staff: any; customers: their own). */
async function myDesign(id: string) {
  const { supabase, user, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  const admin = createAdminClient();
  // customers read through their own session, so row security only returns their designs
  const { data } = await (isStaff ? admin : supabase).from("designs").select("id,customer_id,file_path,preview_path").eq("id", id).maybeSingle();
  if (!data) throw new Error("We couldn't find that logo.");
  return { admin, d: data as { id: string; customer_id: string; file_path: string; preview_path: string } };
}
async function inUse(admin: ReturnType<typeof createAdminClient>, d: { id: string; customer_id: string }) {
  const { data } = await admin.rpc("designs_in_use", { p_customer: d.customer_id });
  return ((data || []) as string[]).includes(d.id);
}
const done = () => { revalidatePath("/portal"); revalidatePath("/shop/artwork"); return { ok: true }; };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });

/** Delete a logo that hasn't been used on a mockup or order (file and preview too). */
export async function deleteDesign(id: string): Promise<Result> {
  try {
    const { admin, d } = await myDesign(id);
    if (await inUse(admin, d)) return { ok: false, error: "This logo is on a mockup or order, so it can only be archived." };
    const files = [d.file_path, d.preview_path].filter(Boolean);
    if (files.length) await admin.storage.from("proofs").remove(files);
    const { error } = await admin.from("designs").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return done();
  } catch (e) { return fail(e); }
}

/** Archive (hide from pickers) or restore a logo. */
export async function archiveDesign(id: string, archived: boolean): Promise<Result> {
  try {
    const { admin } = await myDesign(id);
    const { error } = await admin.from("designs").update({ archived_at: archived ? new Date().toISOString() : null, ...(archived ? { starred: false } : {}) }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return done();
  } catch (e) { return fail(e); }
}
