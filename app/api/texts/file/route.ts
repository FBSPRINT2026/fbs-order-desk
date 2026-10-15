import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deviceFor } from "@/lib/texts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** FBS Texts (the Mac): a picture from a customer text, kept with the text (storage: proofs/texts/<text id>/…) */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const d = await deviceFor(admin, req);
  if (!d) return new Response("Not a known Mac.", { status: 401 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const guid = String(fd?.get("guid") || ""), id = String(fd?.get("id") || "");
  if (!fd || !(file instanceof Blob) || !guid || !id) return NextResponse.json({ error: "guid, id and file" }, { status: 400 });
  if (file.size > 40e6) return NextResponse.json({ error: "Too big." }, { status: 413 });
  const { data: m } = await admin.from("text_messages").select("id, owner, files").eq("guid", guid).maybeSingle();
  if (!m || m.owner !== d.owner) return NextResponse.json({ error: "No such text." }, { status: 404 });
  const files = (m.files || []) as { id: string }[];
  if (files.some((f) => String(f.id) === id)) return NextResponse.json({ ok: true, had: true });
  const name = (String(fd.get("name") || "") || (file as File).name || "file").replace(/[^\w.\- ]+/g, "_").slice(-120);
  const type = String(fd.get("type") || "") || file.type || "application/octet-stream";
  const path = `texts/${m.id}/${id}-${name}`;
  const { error } = await admin.storage.from("proofs").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("text_messages").update({ files: [...files, { id, name, type, size: file.size, path }] }).eq("id", m.id);
  return NextResponse.json({ ok: true });
}
