import "server-only";
import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backup drive at home (Nick, Nov 14 2026: "keep it plugged in… set this up automatically… just back up the whole
 * Dropbox, that has film and embroidery files"). A small program on that computer (fbs-backup.ps1, made on Settings →
 * Dropbox) runs every night: it switches the drive on, copies everything new or changed in Dropbox onto it (a file that
 * changed keeps its old copy under _older\<date>), says how it went, and switches the drive off again, so between runs
 * nothing on the computer can reach it. Its key lives here only as a hash (settings.data.backupDrive).
 */
export type DriveReport = { at: string; started?: string; done: boolean; added: number; changed: number; bytes: number; errors: number; firstError?: string; freeGB?: number; sizeGB?: number; held?: string; listed?: number };
export type DriveState = { keyHash?: string; madeAt?: string; madeBy?: string; ownerEmail?: string; last?: DriveReport; lastDone?: string; allowBig?: boolean };

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newDriveKey = () => "fbsb_" + randomBytes(24).toString("base64url");

export async function driveState(admin: SupabaseClient): Promise<{ data: Record<string, unknown>; st: DriveState }> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const d = (data?.data || {}) as Record<string, unknown>;
  return { data: d, st: (d.backupDrive || {}) as DriveState };
}
export async function saveDrive(admin: SupabaseClient, patch: Partial<DriveState>) {
  const { data, st } = await driveState(admin);
  await admin.from("settings").update({ data: { ...data, backupDrive: { ...st, ...patch } } }).eq("id", 1);
}

/** what's wrong with the backup drive, in a sentence, or "" (the nightly check puts it on the owner's My Day) */
export function driveProblem(st: DriveState, now = Date.now()): string {
  if (!st.keyHash) return "";
  const last = st.lastDone || st.last?.at;
  const days = last ? (now - Date.parse(last)) / 86400000 : (now - Date.parse(st.madeAt || new Date(now).toISOString())) / 86400000;
  if (st.last?.held) return `Backup drive: paused, ${st.last.held}. Check Settings → Dropbox → Backup drive.`;
  if (days > 3) return `Backup drive: no backup for ${Math.floor(days)} days. Is the home computer on and the drive plugged in?`;
  if (st.last && st.last.freeGB != null && st.last.sizeGB && st.last.freeGB < st.last.sizeGB * 0.08) return `Backup drive: almost full (${st.last.freeGB} GB left).`;
  return "";
}

/** the nightly check: an open My Day to-do for the owner while something's wrong, never two of the same */
export async function driveCheck(admin: SupabaseClient) {
  const { st } = await driveState(admin);
  const why = driveProblem(st);
  if (!why || !st.ownerEmail) return;
  const { data } = await admin.from("tasks").select("id").eq("owner", st.ownerEmail).ilike("title", "Backup drive:%").eq("status", "open").limit(1);
  if (data?.length) return;
  await admin.from("tasks").insert({ owner: st.ownerEmail, title: why.slice(0, 200), notes: "From the backup drive check (Settings → Dropbox → Backup drive).", area: "shop", source: "auto", created_by: st.ownerEmail });
}
