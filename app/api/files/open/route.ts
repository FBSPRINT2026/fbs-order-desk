import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileHeaders } from "@/lib/fileOpen";

export const runtime = "nodejs";

/**
 * GET ?p=<path in the proofs bucket>: open a stored file (an email's attachment, art) by a plain link, staff only.
 * A link rather than a signed URL fetched after the tap, which phones block as a pop-up (Oct 21: the .ai on Michael
 * Peticolas's email did nothing). Illustrator files that are PDFs inside open as a PDF preview (lib/fileOpen).
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const q = new URL(req.url).searchParams, p = q.get("p") || "";
  if (!p || p.includes("..") || p.startsWith("/")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("proofs").download(p);
  if (error || !data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const name = (q.get("n") || p.split("/").pop() || "file").slice(0, 200);
  // big files: straight from storage (a function can't send more than ~4 MB)
  if (data.size > 4_000_000) {
    const s = await admin.storage.from("proofs").createSignedUrl(p, 600);
    if (s.data?.signedUrl) return NextResponse.redirect(s.data.signedUrl, 302);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  return new Response(bytes, { headers: fileHeaders(bytes, name, data.type, "private, max-age=600") });
}
