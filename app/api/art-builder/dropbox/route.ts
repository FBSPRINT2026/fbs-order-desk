import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { download, listFolder } from "@/lib/dropbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dropbox for the Customer artwork builder (Oct 28, Nick: "can you look at the Dropbox… the FBS embroidery folder and
 * the FBS film folder… embroidery, Cedar Promos… everything for BMWC… crewnecks, hats, names, polos. The tool should
 * bring in from there too"). Staff only; reads Dropbox, never writes to it.
 *   GET ?path=/FBS Embroidery Folder/Embroidery/Cedar Promo → the folder's folders and files
 *   POST { path } → that folder's files copied into our storage (dropbox/<file id>/<name>), so the builder shows and
 *   brings them in like a Printavo job's files
 */
const ROOTS = ["/FBS Embroidery Folder", "/FBS Film Folder"];
const okPath = (p: string) => ROOTS.some((r) => p === r || p.startsWith(r + "/")) && !p.includes("..");
const KEEP = /\.(dst|emb|pdf|ai|eps|png|jpe?g|svg|psd|tiff?|webp)$/i;

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const path = new URL(req.url).searchParams.get("path") || "";
  if (!path) return NextResponse.json({ entries: ROOTS.map((r) => ({ id: r, name: r.slice(1), folder: true, path: r })) });
  if (!okPath(path)) return NextResponse.json({ error: "Only the embroidery and film folders." }, { status: 400 });
  try {
    const list = await listFolder(createAdminClient(), path);
    const entries = list.map((e) => ({ id: e.id, name: e.name, folder: e[".tag"] === "folder", path: e.path_display, size: e.size || 0, modified: e.server_modified || "" }))
      .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
    return NextResponse.json({ entries });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const path = String(b.path || "");
  if (!okPath(path)) return NextResponse.json({ error: "Only the embroidery and film folders." }, { status: 400 });
  const admin = createAdminClient();
  try {
    const files = (await listFolder(admin, path)).filter((e) => e[".tag"] === "file" && KEEP.test(e.name) && (e.size || 0) < 40_000_000).slice(0, 40);
    const out: { name: string; path: string }[] = [];
    const t0 = Date.now();
    for (const f of files) {
      if (Date.now() - t0 > 50_000) break; // the rest on the next open
      const to = `dropbox/${f.id.replace(/[^\w-]/g, "")}/${f.name.replace(/[^\w .()&-]+/g, "_")}`;
      const { data: have } = await admin.storage.from("proofs").list(to.split("/").slice(0, 2).join("/"));
      if (!(have || []).some((x) => x.name === to.split("/")[2])) {
        const { buf } = await download(admin, f.id);
        const up = await admin.storage.from("proofs").upload(to, buf, { upsert: true, contentType: /\.pdf$/i.test(f.name) ? "application/pdf" : "application/octet-stream" });
        if (up.error) continue;
      }
      out.push({ name: f.name, path: to });
    }
    return NextResponse.json({ files: out, more: files.length > out.length });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
