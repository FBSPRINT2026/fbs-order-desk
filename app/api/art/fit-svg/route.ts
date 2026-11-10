import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAll } from "@/lib/readAll";
import { fitRoundedImages } from "@/lib/svgFit";

export const maxDuration = 300;

/**
 * Once (Nov 9, #40407's E78 cut off at the bottom right): every logo saved as an SVG that holds a picture Illustrator
 * scaled a little too big (lib/svgFit.ts) is saved again with the picture fitting its box, so every mockup, close-up and
 * proof drawn from it shows the whole art. The logo's file and its picture, nothing else; each original is kept first in backups/logo-originals/2026-11-09/. ?dry=1 only lists them.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const ds = await readAll<{ id: string; number: number; file_path: string | null; preview_path: string | null }>((from, to) =>
    admin.from("designs").select("id, number, file_path, preview_path").or("file_path.ilike.%.svg,preview_path.ilike.%.svg").order("id").range(from, to));
  const fixed: { number: number; paths: string[] }[] = [], failed: string[] = [];
  for (const d of ds) {
    const paths = [...new Set([d.file_path, d.preview_path].filter((p): p is string => !!p && /\.svg$/i.test(p)))];
    const done: string[] = [];
    for (const p of paths) {
      const { data: blob } = await admin.storage.from("proofs").download(p);
      if (!blob) continue;
      const r = fitRoundedImages(await blob.text());
      if (!r.changed) continue;
      if (!dry) {
        // the original first, untouched, in the private backups bucket (put back from there if ever needed)
        const keep = await admin.storage.from("backups").upload(`logo-originals/2026-11-09/${p}`, blob, { upsert: true, contentType: "image/svg+xml" });
        if (keep.error) { failed.push(`D-${d.number} ${p}: couldn't keep the original (${keep.error.message}), left as is`); continue; }
        const up = await admin.storage.from("proofs").upload(p, new Blob([r.svg], { type: "image/svg+xml" }), { upsert: true, contentType: "image/svg+xml" });
        if (up.error) { failed.push(`D-${d.number} ${p}: ${up.error.message}`); continue; }
      }
      done.push(p);
    }
    if (done.length) fixed.push({ number: d.number, paths: done });
  }
  return NextResponse.json({ dry, checked: ds.length, fixed, failed });
}
