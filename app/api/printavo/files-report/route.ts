import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { staffOnly } from "../guard";
import { orderFiles, type PvOrder } from "@/lib/archive";
import { pvHandle } from "@/lib/printavoNames";
import { namesFor } from "@/lib/printavoFileMeta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = { id: string; printavo_id: string; visual_id: string; order_date: string | null; nickname: string | null; files: Record<string, string>; data: PvOrder };

/** a file's name from the order record (mockups, production files, message attachments), else from its link */
function nameOf(r: Row, url: string): string {
  try {
    const f = orderFiles(r.data).find((x) => x.full === url); if (f?.name) return f.name;
    for (const m of r.data.messages || []) for (const a of m.attachments || []) if (a.url === url && a.name) return a.name;
  } catch { /* odd record: fall back to the link */ }
  return decodeURIComponent(url.split("?")[0].split("/").pop() || "file");
}

/**
 * Printavo files that didn't copy: "failed" (the download didn't work) and "too big" (over the size we take).
 * GET lists them (with the size of the big ones, read from the file host, and the original link to save it by hand);
 * POST { action: "retry-failed" | "retry-big", maxMb? } clears those marks and puts the orders back in the copy queue.
 * (Locked history allows this: a file that never copied can still be added.)
 */
export async function GET() {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const admin = createAdminClient();
  const out: { kind: "failed" | "too-big"; archivedId: string; visualId: string; date: string | null; nickname: string | null; name: string; url: string; mb?: number }[] = [];
  const { data, error } = await admin.rpc("printavo_files_unfinished", { p_mark: null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  for (const r of (data || []) as Row[]) for (const [url, v] of Object.entries(r.files || {})) {
    if (v === "failed" || v === "too-big") out.push({ kind: v, archivedId: r.id, visualId: r.visual_id, date: r.order_date, nickname: r.nickname, name: nameOf(r, url), url });
  }
  // files Printavo gave no name (mockups): the name they were uploaded with (printavo_file_names)
  const linkName = (u: string) => decodeURIComponent(u.split("?")[0].split("/").pop() || "file");
  const orig = await namesFor(admin, out.filter((f) => f.name === linkName(f.url)).map((f) => pvHandle(f.url)));
  for (const f of out) { const h = pvHandle(f.url); if (h && orig[h] && f.name === linkName(f.url)) f.name = orig[h]; }
  // sizes of the big ones (a HEAD request to the file host: nothing is downloaded)
  const big = out.filter((f) => f.kind === "too-big");
  for (let i = 0; i < big.length; i += 10) {
    await Promise.all(big.slice(i, i + 10).map(async (f) => {
      try { const r = await fetch(f.url, { method: "HEAD", signal: AbortSignal.timeout(6000) }); const n = +(r.headers.get("content-length") || 0); if (n) f.mb = Math.round((n / 1048576) * 10) / 10; } catch { /* size unknown */ }
    }));
  }
  const { data: cfg } = await admin.from("printavo_sync").select("max_file_mb").eq("id", 1).maybeSingle();
  const { count: copying } = await admin.from("printavo_index").select("printavo_id", { count: "exact", head: true }).eq("status", "files");
  return NextResponse.json({ files: out, maxMb: (cfg as { max_file_mb?: number } | null)?.max_file_mb ?? 45, copying: copying || 0 });
}

export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { action, maxMb } = await req.json().catch(() => ({}));
  const mark = action === "retry-big" ? "too-big" : action === "retry-failed" ? "failed" : "";
  if (!mark) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const admin = createAdminClient();
  if (mark === "too-big" && maxMb) {
    const mb = Math.max(1, Math.min(2000, Math.round(+maxMb)));
    await admin.from("printavo_sync").update({ max_file_mb: mb }).eq("id", 1);
  }
  let orders = 0, files = 0;
  {
    const { data, error: e0 } = await admin.rpc("printavo_files_unfinished", { p_mark: mark });
    if (e0) return NextResponse.json({ error: e0.message }, { status: 500 });
    const todo = (data || []) as { id: string; printavo_id: string; files: Record<string, string> }[];
    for (const r of todo) {
      const keep = Object.fromEntries(Object.entries(r.files || {}).filter(([, v]) => v !== mark));
      files += Object.keys(r.files).length - Object.keys(keep).length;
      const { error } = await admin.from("archived_orders").update({ files: keep }).eq("id", r.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await admin.from("printavo_index").update({ status: "files" }).eq("printavo_id", r.printavo_id);
      orders++;
    }
  }
  return NextResponse.json({ orders, files });
}
