"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkManifestMail, getBox, publicBox, saveBox } from "@/lib/manifestMail";

/** Goods & Receiving → Settings (Oct 27, Nick): the mailbox supplier manifests arrive in. Owners and admins change it. */
async function boss() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { can: v.role === "owner" || v.role === "admin" };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

export async function receivingSettings() {
  try {
    const { can } = await boss();
    return { ok: true as const, can, box: publicBox(await getBox(createAdminClient())) };
  } catch (e) { return fail(e); }
}

export async function saveManifestMailbox(p: { email: string; password?: string; enabled: boolean }) {
  try {
    const { can } = await boss();
    if (!can) return { ok: false as const, error: "Only an owner or admin can change this." };
    return { ok: true as const, box: await saveBox(createAdminClient(), p) };
  } catch (e) { return fail(e); }
}

/** look in the mailbox now (the hourly pass does the same on its own) */
export async function checkManifestMailNow(days = 4) {
  try {
    await boss();
    const admin = createAdminClient();
    const r = await checkManifestMail(admin, { days: Math.min(14, Math.max(1, Math.round(days))), deadline: Date.now() + 240000 });
    return { ok: true as const, result: r, box: publicBox(await getBox(admin)) };
  } catch (e) { return fail(e); }
}
