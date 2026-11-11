import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEmb } from "@/lib/embFile";

export const runtime = "nodejs";

/**
 * GET ?p=<path of an .EMB in the proofs bucket>: what the Wilcom file says (lib/embFile.ts), staff only: its size,
 * stitches, stops and threads as JSON; &pic=1 returns its TrueView picture instead.
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const q = new URL(req.url).searchParams, p = q.get("p") || "";
  if (!p || p.includes("..") || p.startsWith("/") || !/\.emb$/i.test(p)) return NextResponse.json({ error: "Not an EMB." }, { status: 404 });
  const { data } = await createAdminClient().storage.from("proofs").download(p);
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const e = await readEmb(await data.arrayBuffer());
    if (q.get("pic")) return e.preview ? new Response(e.preview as BodyInit, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } }) : NextResponse.json({ error: "No picture in it." }, { status: 404 });
    return NextResponse.json({ ...e, preview: !!e.preview });
  } catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read it." }, { status: 422 }); }
}
