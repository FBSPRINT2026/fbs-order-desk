import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { clickupFileByUrl } from "@/lib/clickup";
import { filesFromLink, linkKind, typeByName } from "@/lib/linkArt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A file dragged in from another site's page (Nov 1, Nick: "if I drag something in from ClickUp, it automatically
 * goes in the AI order helper… the two panels side by side"): a dragged attachment arrives as its link, not the file.
 * POST { url } → the file itself (its name in X-File-Name). ClickUp attachments with the workspace's token; Dropbox,
 * Google Drive and direct file links as Create order reads them (lib/linkArt filesFromLink). Nothing else is fetched.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { url } = await req.json().catch(() => ({})) as { url?: string };
  let u: URL;
  try { u = new URL(String(url || "")); } catch { return NextResponse.json({ error: "That isn't a link to a file." }, { status: 400 }); }
  if (u.protocol !== "https:") return NextResponse.json({ error: "Only https links." }, { status: 400 });
  const nameOf = () => decodeURIComponent(u.pathname.split("/").pop() || "file").slice(-120);
  const send = (buf: Buffer | Uint8Array, name: string, type: string) => new Response(new Uint8Array(buf), { headers: { "Content-Type": type || typeByName(name), "X-File-Name": encodeURIComponent(name), "Cache-Control": "no-store" } });
  if (/(^|\.)clickup(-attachments)?\.com$/i.test(u.hostname)) {
    const b = await clickupFileByUrl(u.toString());
    if (!b) return NextResponse.json({ error: "ClickUp didn't hand over that file. Download it and drop it in." }, { status: 400 });
    if (b.length > 40 * 1024 * 1024) return NextResponse.json({ error: "That file is over 40 MB." }, { status: 400 });
    return send(b, nameOf(), typeByName(nameOf()));
  }
  if (linkKind(u.toString()) !== "other") {
    const r = await filesFromLink(u.toString());
    const f = r.files[0];
    if (!f) return NextResponse.json({ error: r.error || "Nothing downloadable at that link." }, { status: 400 });
    return send(f.buf, f.name, f.type);
  }
  return NextResponse.json({ error: "Only files from ClickUp, Dropbox, Google Drive or a direct link to a file can be dropped from a web page. Download it and drop it in." }, { status: 400 });
}
