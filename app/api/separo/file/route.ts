import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Separo's finished separation, brought in by its link (Nick, Nov 23 2026: learning from Separo without downloading
 * and uploading). Separo's download is a zip on its own file server, which won't let our pages read it, so the server
 * fetches it, keeps it in our storage and hands back a short-lived link the page can read. Only Separo's file server
 * (a cloudfront.net address under /separations/) is fetched: never any other address.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { url?: string };
  let u: URL;
  try { u = new URL(String(b.url || "").trim()); } catch { return NextResponse.json({ error: "That isn't a link." }, { status: 400 }); }
  const art = /^\/(normalized_artworks|artwork_thumbnails)\/[\w-]+\.png$/i.test(u.pathname);
  if (u.protocol !== "https:" || !/\.cloudfront\.net$/i.test(u.hostname) || !(art || /^\/separations\/[\w-]+\/[^/]+\.zip$/i.test(u.pathname)))
    return NextResponse.json({ error: "That isn't Separo's download link (it ends in .zip, from Download separation)." }, { status: 400 });
  // the art Separo worked from (a job's picture): small, handed straight back for learning how it limits colors
  if (art) {
    const r = await fetch(u.toString(), { redirect: "error" }).catch(() => null);
    if (!r || !r.ok) return NextResponse.json({ error: `Separo's file server didn't send it (${r?.status || "no answer"}).` }, { status: 502 });
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > 4e6) return NextResponse.json({ error: "Too big." }, { status: 413 });
    return new NextResponse(bytes, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
  }
  const r = await fetch(u.toString(), { redirect: "error" }).catch(() => null);
  if (!r || !r.ok) return NextResponse.json({ error: `Separo's file server didn't send it (${r?.status || "no answer"}).` }, { status: 502 });
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > 80e6) return NextResponse.json({ error: "That file is too big." }, { status: 413 });
  const name = decodeURIComponent(u.pathname.split("/").pop() || "separation.zip").replace(/[^\w.-]+/g, "_");
  const path = `separo/${u.pathname.split("/")[2]}/${name}`;
  const admin = createAdminClient();
  const up = await admin.storage.from("proofs").upload(path, bytes, { upsert: true, contentType: "application/zip" });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const { data } = await admin.storage.from("proofs").createSignedUrl(path, 600);
  return NextResponse.json({ ok: true, name, url: data?.signedUrl, size: bytes.length });
}
