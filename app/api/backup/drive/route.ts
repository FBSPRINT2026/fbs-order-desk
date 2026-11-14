import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dropboxLinks, dropboxPage } from "@/lib/dropbox";
import { driveState, saveDrive, sha, type DriveReport } from "@/lib/backupDrive";

export const maxDuration = 60;

/**
 * The backup drive's program at home (fbs-backup.ps1) talks only to here, with its key in the x-backup-key header:
 * list: a page of the whole Dropbox (or what changed since its cursor); links: download links for up to 25 files;
 * report: how a run went. Dropbox's own sign-in stays on the server.
 */
export async function POST(req: Request) {
  const key = req.headers.get("x-backup-key") || "";
  const admin = createAdminClient();
  const { st } = await driveState(admin);
  if (!/^fbsb_[\w-]{20,}$/.test(key) || !st.keyHash || sha(key) !== st.keyHash) return NextResponse.json({ error: "Unknown backup drive key. Set it up again on Settings → Dropbox → Backup drive." }, { status: 401 });
  const b = await req.json().catch(() => ({})) as { action?: string; cursor?: string; ids?: string[]; report?: Partial<DriveReport> };
  try {
    if (b.action === "list") {
      const r = await dropboxPage(admin, b.cursor || undefined);
      const entries = r.entries.map((e) => ({ t: e[".tag"], id: e.id || "", p: e.path_display || "", s: e.size ?? 0, m: e.server_modified || "" }));
      // a big change can go through once the owner says so (Settings → Dropbox → Backup drive → Back them up)
      const allowBig = !!st.allowBig;
      return NextResponse.json({ entries, cursor: r.cursor, more: r.has_more, allowBig });
    }
    if (b.action === "links") {
      const ids = (b.ids || []).filter((x) => typeof x === "string" && x.startsWith("id:")).slice(0, 25);
      return NextResponse.json({ links: await dropboxLinks(admin, ids) });
    }
    if (b.action === "report") {
      const r = b.report || {};
      const num = (x: unknown) => (Number.isFinite(+(x as number)) ? +(x as number) : 0);
      const rep: DriveReport = { at: new Date().toISOString(), started: String(r.started || ""), done: !!r.done, added: num(r.added), changed: num(r.changed), bytes: num(r.bytes), errors: num(r.errors), firstError: String(r.firstError || "").slice(0, 300), freeGB: r.freeGB == null ? undefined : num(r.freeGB), sizeGB: r.sizeGB == null ? undefined : num(r.sizeGB), held: String(r.held || "").slice(0, 200), listed: num(r.listed) };
      await saveDrive(admin, { last: rep, ...(rep.done ? { lastDone: rep.at } : {}), ...(rep.done && st.allowBig ? { allowBig: false } : {}) });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Which action?" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
