import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST (form: session, file, opaque?): the mockup picture of a Canva design saved without one (a Canva Free account
 * can't export a see-through PNG, so the Mockup Creator draws it from the PDF with a clear page). Only for the trip's
 * own design, only while it has no picture yet; staff, or the person who made the trip. `opaque=1`: the picture still
 * has a solid background (the Canva design has one), noted on the design.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const sid = String(form?.get("session") || ""), file = form?.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(sid) || !(file instanceof Blob)) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const admin = createAdminClient();
  const { data: s } = await admin.from("canva_sessions").select("id, user_id, design_ref").eq("id", sid).maybeSingle();
  if (!s || !s.design_ref || (!v.isStaff && s.user_id !== v.user.id)) return NextResponse.json({ error: "No such design." }, { status: 404 });
  const { data: d } = await admin.from("designs").select("id, preview_path, notes").eq("id", s.design_ref).maybeSingle();
  if (!d) return NextResponse.json({ error: "No such design." }, { status: 404 });
  if (d.preview_path) return NextResponse.json({ ok: true, design: null });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length < 100 || buf.length > 25 * 1024 * 1024 || buf.readUInt32BE(0) !== 0x89504e47) return NextResponse.json({ error: "That picture isn't a PNG." }, { status: 400 });
  const path = `designs/${d.id}-pv/preview-${Date.now().toString(36)}.png`;
  const up = await admin.storage.from("proofs").upload(path, buf, { contentType: "image/png" });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const opaque = form?.get("opaque") === "1";
  const notes = opaque ? `${d.notes || ""} The picture has a solid background (the Canva design has one, and this Canva plan can't export see-through): remove it in Canva, or before printing.`.trim().slice(0, 600) : d.notes;
  const { data: nd, error } = await admin.from("designs").update({ preview_path: path, width_px: buf.readUInt32BE(16), height_px: buf.readUInt32BE(20), notes }).eq("id", d.id).eq("preview_path", "").select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const url = (await admin.storage.from("proofs").createSignedUrl(path, 3600)).data?.signedUrl || "";
  return NextResponse.json({ ok: true, design: nd, url });
}
