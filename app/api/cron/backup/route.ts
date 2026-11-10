import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { backupRound, dropboxRound, startBackup } from "@/lib/backupFull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The weekly backup (Nick, Nov 9 2026: "a physical copy of the database as a redundancy… just use Dropbox").
 * Vercel Cron calls this several times early Sunday (vercel.json); each call does one ~4-minute round of whatever is
 * next: carry on a backup that's being built, copy a finished one to Dropbox, or start this week's if the last one is
 * 6+ days old. Nothing to do: it says so. Needs CRON_SECRET (as the daily Assistant), or the sync token to run a round by hand. lib/backupFull.ts does the work.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  // Vercel Cron (CRON_SECRET), or the sync token for running a round by hand (the same guard as the other server jobs)
  const secret = process.env.CRON_SECRET;
  const cron = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  const tok = req.headers.get("x-sync-token");
  const { data: s } = tok ? await admin.from("printavo_sync").select("token").eq("id", 1).single() : { data: null };
  if (!cron && !(s?.token && tok === s.token)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const who = "weekly backup";
  const { data: last } = await admin.from("data_backups").select("id, status, created_at, dropbox").eq("kind", "full").order("created_at", { ascending: false }).limit(1).maybeSingle();
  try {
    if (last && last.status === "building" && Date.now() - +new Date(last.created_at) < 3 * 86400_000) return NextResponse.json({ step: "tables", ...(await backupRound(admin, last.id, who)) });
    if (last && last.status === "done" && !(last.dropbox as { done?: boolean } | null)?.done && Date.now() - +new Date(last.created_at) < 3 * 86400_000) return NextResponse.json({ step: "dropbox", ...(await dropboxRound(admin, last.id)) });
    if (!last || !["building", "done"].includes(last.status) || Date.now() - +new Date(last.created_at) > 6 * 86400_000) {
      const id = await startBackup(admin, who, "Weekly");
      return NextResponse.json({ step: "started", ...(await backupRound(admin, id, who)) });
    }
    return NextResponse.json({ step: "nothing", note: "This week's backup is done." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
