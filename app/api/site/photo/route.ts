import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** staff: put a photo on the public website (the "site" bucket, lib/siteContent.ts sitePhoto): { path: "work/x.jpg", dataUrl } */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ ok: false, error: "Staff only." }, { status: 403 });
  const { path, dataUrl } = (await req.json().catch(() => ({}))) as { path?: string; dataUrl?: string };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
  if (!path || !/^[a-z0-9/_-]+\.(jpg|png|webp)$/.test(path) || !m) return NextResponse.json({ ok: false, error: "Send a path and an image." }, { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Up to 8 MB." }, { status: 400 });
  const { error } = await createAdminClient().storage.from("site").upload(path, buf, { contentType: m[1], upsert: true, cacheControl: "86400" });
  return NextResponse.json(error ? { ok: false, error: error.message } : { ok: true });
}
