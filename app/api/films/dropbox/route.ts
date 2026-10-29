import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadFile } from "@/lib/dropbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Print films through Dropbox (Oct 29, Nick: Jose's films hit "This browser's security check wouldn't let the portal
 * save into the hot folder" again). The film goes from here into Dropbox's FILM DIRECT TO PRINT, which syncs down to
 * the film PC where FilmMaker's queue watches it. No browser saves into a folder any more, so nothing on a PC (Chrome's
 * checks, Dropbox locking a file mid-save, antivirus, folder permissions) can stop it, and any computer can print.
 * One film per request, sent in print order by the Studio (components/SeparationStudio.tsx PrintFilms).
 */
const HOT_FOLDER = "/FILM DIRECT TO PRINT";

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!(f instanceof Blob)) return NextResponse.json({ error: "No film to send." }, { status: 400 });
  const name = String(fd?.get("name") || "film.pdf").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 180);
  try {
    const e = await uploadFile(createAdminClient(), `${HOT_FOLDER}/${name}`, new Uint8Array(await f.arrayBuffer()));
    return NextResponse.json({ ok: true, name: e.name });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
