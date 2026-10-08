import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cacheFilm, filmFolders, findFilms, guessFolder } from "@/lib/dropboxFilms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?customer=&q=&date=: the customer's film files that look like the job, best first */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const admin = createAdminClient();
  const { data: c } = await v.supabase.from("customers").select("*").eq("id", sp.get("customer") || "").maybeSingle();
  if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const { data: pc } = await admin.from("printavo_customers").select("data").eq("customer_id", c.id).limit(3);
  const names = [c.company, c.name, ...(pc || []).map((x) => String((x.data as { companyName?: string })?.companyName || ""))].filter(Boolean) as string[];
  const linked = (c as { film_folder?: string | null }).film_folder || null;
  try {
    // the customer page: their folder (linked, or the one that matches their name), its films, and every folder to pick from
    if (sp.get("folders")) {
      const guess = linked || (await guessFolder(admin, names));
      const films = guess ? (await findFilms(admin, { names, nickname: "", folder: guess })).films : [];
      return NextResponse.json({ linked, folder: guess, films, folders: await filmFolders(admin) });
    }
    return NextResponse.json(await findFilms(admin, { names, nickname: sp.get("q") || "", date: sp.get("date"), folder: linked }));
  }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}

/** POST { id, orderId? }: copies the film into our storage (and onto the order's production files) and returns a link */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "");
  if (!/^id:[\w-]+$/.test(id)) return NextResponse.json({ error: "Missing file." }, { status: 400 });
  const admin = createAdminClient();
  try {
    const f = await cacheFilm(admin, id);
    if (b.orderId) {
      const { data: mine } = await v.supabase.from("orders").select("id").eq("id", String(b.orderId)).maybeSingle();
      if (mine) {
        const { data: have } = await admin.from("art_files").select("id").eq("order_id", mine.id).eq("file_path", f.path).maybeSingle();
        if (!have) await admin.from("art_files").insert({ order_id: mine.id, name: `Film: ${f.name}`, file_path: f.path, file_type: /\.pdf$/i.test(f.name) ? "application/pdf" : "application/postscript" });
      }
    }
    const { data: su } = await admin.storage.from("proofs").createSignedUrl(f.path, 900);
    return NextResponse.json({ ...f, url: su?.signedUrl || "" });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}

/** PUT { customer, folder }: links the customer to their film folder (blank = find it by name) */
export async function PUT(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const folder = String(b.folder || "").trim();
  if (folder && !folder.toLowerCase().startsWith("/fbs film folder/")) return NextResponse.json({ error: "Pick a folder in FBS Film Folder." }, { status: 400 });
  const { error } = await v.supabase.from("customers").update({ film_folder: folder || null }).eq("id", String(b.customer || ""));
  if (error) return NextResponse.json({ error: /film_folder/.test(error.message) ? "Run supabase/migrations/116_integration_tokens.sql in Supabase first." : error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
