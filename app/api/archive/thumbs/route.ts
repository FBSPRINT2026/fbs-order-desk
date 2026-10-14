import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Small pictures of Printavo mockups kept in storage (Oct 14: the Furry Feline price history page shows each design's
 * mockup, and a page can't load pictures from elsewhere). Sync token only; Printavo copies only (printavo/…);
 * resized by storage (320 px wide). GET ?p=path&p=path… → { [path]: "data:image/jpeg;base64,…" }.
 */
export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const paths = new URL(req.url).searchParams.getAll("p").filter((x) => /^printavo\/[\w-]+\/[\w.-]+\.(jpe?g|png|webp)$/i.test(x)).slice(0, 30);
  const out: Record<string, string> = {};
  await Promise.all(paths.map(async (p) => {
    try {
      let { data, error } = await admin.storage.from("proofs").download(p, { transform: { width: 320, quality: 70 } });
      if (error || !data) ({ data, error } = await admin.storage.from("proofs").download(p));
      if (!data) return;
      const buf = Buffer.from(await data.arrayBuffer());
      if (buf.length > 600_000) return; // not resized and too big for a page
      out[p] = `data:${data.type || "image/jpeg"};base64,${buf.toString("base64")}`;
    } catch { /* skip that one */ }
  }));
  return NextResponse.json(out);
}
