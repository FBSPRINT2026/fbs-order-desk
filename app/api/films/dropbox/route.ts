import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadFile } from "@/lib/dropbox";
import { filmAsOnePlate } from "@/lib/filmFix";

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
  // a file already in our storage (a customer's own separations, components/SuppliedFilms.tsx): read here, so a big PDF
  // never has to go up through the request (a request body tops out around 4 MB)
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as { path?: string; name?: string };
    const path = String(b.path || "");
    const admin = createAdminClient();
    // only a file that is one of an order's production files (wherever it's kept: uploaded here, or brought from an old job)
    const { data: own } = path ? await admin.from("art_files").select("id").eq("file_path", path).limit(1).maybeSingle() : { data: null };
    if (!own) return NextResponse.json({ error: "That isn't an order's file." }, { status: 400 });
    const name = String(b.name || path.split("/").pop() || "film.pdf").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 180);
    const { data, error } = await admin.storage.from("proofs").download(path);
    if (error || !data) return NextResponse.json({ error: "Couldn't read that file." }, { status: 404 });
    // their art drawn in a spot plate ("Black") prints as solid black, not just the crop marks (lib/filmFix.ts)
    const raw = new Uint8Array(await data.arrayBuffer());
    const fixed = await filmAsOnePlate(raw).catch(() => null);
    const out = fixed ? name.replace(/\.(ai|eps)$/i, "") + (/\.pdf$/i.test(name) ? "" : ".pdf") : name;
    try {
      const e = await uploadFile(admin, `${HOT_FOLDER}/${out}`, fixed || raw);
      return NextResponse.json({ ok: true, name: e.name });
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  }
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!(f instanceof Blob)) return NextResponse.json({ error: "No film to send." }, { status: 400 });
  const name = String(fd?.get("name") || "film.pdf").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 180);
  try {
    const e = await uploadFile(createAdminClient(), `${HOT_FOLDER}/${name}`, new Uint8Array(await f.arrayBuffer()));
    return NextResponse.json({ ok: true, name: e.name });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
