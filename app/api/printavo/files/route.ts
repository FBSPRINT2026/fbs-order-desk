import { NextResponse } from "next/server";
import { fileUrls, orderFiles, type PvOrder } from "@/lib/archive";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 45 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf", "application/postscript": "ai", "application/illustrator": "ai", "image/vnd.adobe.photoshop": "psd", "application/zip": "zip" };

/**
 * Step 3: copy an archived order's artwork (mockups and production files) into our own storage, so it
 * stays after Printavo is gone. Works for about 40 seconds per call; call again until `left` is 0.
 */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { id } = await req.json().catch(() => ({}));
  const start = Date.now();
  try {
    const { data: row, error } = await g.sb.from("archived_orders").select("id, data, files").eq("id", id).single();
    if (error || !row) throw new Error("Archived order not found.");
    const o = row.data as PvOrder;
    const files = { ...(row.files as Record<string, string>) };
    const failed: string[] = [];
    const names = new Map<string, string>();
    orderFiles(o).forEach((f) => { if (f.name) names.set(f.full, f.name); });
    const todo = fileUrls(o).filter((u) => !files[u]);
    for (const [i, url] of todo.entries()) {
      if (Date.now() - start > 40000) break;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const len = +(r.headers.get("content-length") || 0);
        if (len > MAX) { files[url] = "too-big"; continue; }
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength > MAX) { files[url] = "too-big"; continue; }
        const type = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
        const base = (names.get(url) || url.split("?")[0].split("/").pop() || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
        const ext = /\.[a-z0-9]{2,5}$/i.test(base) ? "" : "." + (EXT[type] || "bin");
        const path = `printavo/${row.id}/${Date.now().toString(36)}${i}-${base}${ext}`;
        const up = await g.sb.storage.from("proofs").upload(path, buf, { contentType: type, upsert: true });
        if (up.error) throw new Error(up.error.message);
        files[url] = path;
      } catch (e) { failed.push(`${url.slice(0, 80)}: ${e instanceof Error ? e.message : e}`); files[url] = "failed"; }
    }
    const copied = Object.values(files).filter((p) => p && !["failed", "too-big"].includes(p)).length;
    await g.sb.from("archived_orders").update({ files, files_copied: copied }).eq("id", row.id);
    const left = fileUrls(o).filter((u) => !files[u]).length;
    return NextResponse.json({ copied, total: fileUrls(o).length, left, failed });
  } catch (e) { return fail(e); }
}
