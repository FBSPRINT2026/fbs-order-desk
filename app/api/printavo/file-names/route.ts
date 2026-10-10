import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchFileMeta, FilestackBusy, saveFileMeta } from "@/lib/printavoFileMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Looks up the original names of the files copied from Printavo (migration 123), run every minute by the database's
 * schedule (printavo_file_names_tick) until every handle is done; the schedule then removes itself.
 * Each run takes the next waiting handles in batches (8 lookups at a time) from Filestack's public metadata endpoint:
 * the name is saved, a file Filestack no longer has is marked missing, errors are tried again (3 tries).
 * Only reads from Filestack; nothing in Printavo, archived_orders or storage is changed.
 */
const RUN_MS = 240000, BATCH = 400, CONCURRENCY = 8;

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== (s as { token: string }).token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { data: got } = await admin.rpc("printavo_sync_claim", { p_job: "file-names", p_seconds: 290 });
  if (!got) return NextResponse.json({ busy: true });
  const started = Date.now(), deadline = started + RUN_MS;
  const did = { ok: 0, missing: 0, errors: 0, busy: 0, batches: 0 };
  let pause = 0, lastError = "";
  try {
    while (Date.now() < deadline - 15000) {
      const { data: rows, error } = await admin.rpc("printavo_file_names_claim", { p_n: BATCH });
      if (error) { lastError = error.message; break; }
      const handles = ((rows || []) as (string | { printavo_file_names_claim?: string; handle?: string })[])
        .map((r) => (typeof r === "string" ? r : r.handle || r.printavo_file_names_claim || "")).filter(Boolean);
      if (!handles.length) break;
      did.batches++;
      let i = 0;
      const worker = async () => {
        while (i < handles.length) {
          const h = handles[i++];
          // out of time: what's left of the batch goes back to waiting
          if (Date.now() > deadline) { await admin.from("printavo_file_names").update({ status: null }).eq("handle", h).eq("status", "working"); continue; }
          if (pause > Date.now()) await new Promise((r) => setTimeout(r, pause - Date.now()));
          try {
            const m = await fetchFileMeta(h);
            await saveFileMeta(admin, h, m);
            if (m === "missing" || !m.filename) did.missing++; else did.ok++;
          } catch (e) {
            const msg = e instanceof Error ? `${e.name === "TimeoutError" ? "timeout" : e.message}` : String(e);
            // Filestack says slow down: everyone waits a bit longer each time
            if (e instanceof FilestackBusy) { did.busy++; pause = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(did.busy, 4)); }
            did.errors++; lastError = msg;
            await saveFileMeta(admin, h, { error: msg });
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }
  } finally {
    await admin.rpc("printavo_sync_release", { p_job: "file-names" });
  }
  const { data: progress } = await admin.rpc("printavo_file_names_progress");
  const secs = Math.round((Date.now() - started) / 1000);
  const done = did.ok + did.missing + did.errors;
  return NextResponse.json({ ...did, seconds: secs, perMinute: secs ? Math.round((done / secs) * 60) : 0, ...(lastError ? { lastError: lastError.slice(0, 200) } : {}), progress });
}
