"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { driveProblem, driveState, newDriveKey, saveDrive, sha, type DriveState } from "@/lib/backupDrive";

async function owner() {
  const v = await getViewer().catch(() => null);
  if (!v?.user || v.role !== "owner") throw new Error("Only the owner can set up the backup drive.");
  return { admin: createAdminClient(), email: String(v.email || "").toLowerCase() };
}

export type DriveView = { seenAt?: string; pages?: number; linked?: number; setUp: boolean; madeAt?: string; last?: DriveState["last"]; lastDone?: string; problem: string; allowBig: boolean };
export async function driveView(): Promise<{ ok: true; v: DriveView } | { ok: false; error: string }> {
  try {
    const { admin } = await owner();
    const { st } = await driveState(admin);
    return { ok: true, v: { seenAt: st.seenAt, pages: st.pages, linked: st.linked, setUp: !!st.keyHash, madeAt: st.madeAt, last: st.last, lastDone: st.lastDone, problem: driveProblem(st), allowBig: !!st.allowBig } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** a new key for the program at home (shown once, inside the download); the old one stops working */
export async function makeDriveKey(): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  try {
    const { admin, email } = await owner();
    const key = newDriveKey();
    await saveDrive(admin, { keyHash: sha(key), madeAt: new Date().toISOString(), madeBy: email, ownerEmail: email });
    return { ok: true, key };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** a run paused because a lot of files changed at once: the owner looked, and it's fine */
export async function allowBigChange(): Promise<{ ok: boolean; error?: string }> {
  try { const { admin } = await owner(); await saveDrive(admin, { allowBig: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
