import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { backupRound, dropboxRound, startBackup, type Manifest } from "@/lib/backupFull";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Restore points: every table in the database as plain files (lib/backupFull.ts), in the private "backups" bucket and
 * copied to Dropbox /Portal backups/. The same backup runs by itself every week (/api/cron/backup).
 * POST builds it in rounds (each call ~4 minutes; the page calls again until it's done). Owner only.
 */

async function owner() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("staff").select("role").ilike("email", v.email).maybeSingle();
  return me?.role === "owner" ? { admin, who: v.email as string } : null;
}

export async function GET() {
  const a = await owner();
  if (!a) return NextResponse.json({ error: "Only the owner can see restore points." }, { status: 403 });
  const { data } = await a.admin.from("data_backups").select("*").eq("kind", "full").order("created_at", { ascending: false }).limit(10);
  const out: Record<string, unknown>[] = [];
  for (const b of data || []) {
    const m = (b.manifest || {}) as Partial<Manifest>;
    const files = (m.files || []).concat(b.status === "done" ? [{ path: `${b.folder}/manifest.json`, name: "manifest.json", bytes: 0, rows: 0, sha256: "", table: "" }, { path: `${b.folder}/README.txt`, name: "README.txt", bytes: 0, rows: 0, sha256: "", table: "" }] : []);
    const links: { name: string; bytes: number; url: string }[] = [];
    if (b.status === "done") {
      const { data: s } = await a.admin.storage.from("backups").createSignedUrls(files.map((f) => f.path), 3600);
      files.forEach((f, i) => { if (s?.[i]?.signedUrl) links.push({ name: f.name, bytes: f.bytes, url: s[i].signedUrl }); });
    }
    out.push({ id: b.id, status: b.status, created_at: b.created_at, finished_at: b.finished_at, created_by: b.created_by, error: b.error, dropbox: b.dropbox || null, label: (m as { label?: string }).label || "", tables: (m.tables || []).length || (m.done || []).length, done: (m.done || []).length, rows: Object.values(m.rows || {}).reduce((x, y) => x + y, 0), links });
  }
  return NextResponse.json({ backups: out });
}

export async function POST(req: Request) {
  const a = await owner();
  if (!a) return NextResponse.json({ error: "Only the owner can make a restore point." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  let id = typeof body.id === "string" ? body.id : "";
  try {
    if (!id) id = await startBackup(a.admin, a.who, String(body.label || ""));
    const r = await backupRound(a.admin, id, a.who);
    if (r.status === "done") { const d = await dropboxRound(a.admin, id); if (!d.done && d.left > 0 && !d.error) return NextResponse.json({ ...r, status: "building", dropboxLeft: d.left }); }
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ id, status: "building", error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
