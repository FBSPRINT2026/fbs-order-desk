import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { saveCheckin } from "@/lib/checkin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Check-in from the job's phone menu: the same save as Goods & Receiving (lib/checkin.ts saveCheckin), for staff with
 * Goods & Receiving or the crew signed in with their PIN on the shop's Wi-Fi. Multipart: "data" (JSON: ref, lines,
 * boxes, note, source) plus up to 8 "photo" files.
 */
export async function POST(req: Request) {
  const who = await jobActor();
  if (!who?.can.checkin) return NextResponse.json({ error: "Checking goods in needs Goods & Receiving access." }, { status: 403 });
  const fd = await req.formData().catch(() => null);
  const b = fd ? JSON.parse(String(fd.get("data") || "null")) : null;
  if (!b?.ref || !Array.isArray(b.lines) || !b.lines.length) return NextResponse.json({ error: "Nothing to check in." }, { status: 400 });
  const admin = createAdminClient();
  const photos: string[] = [];
  for (const f of (fd!.getAll("photo") as File[]).slice(0, 8)) {
    if (!f || typeof f === "string" || !f.size) continue;
    if (f.size > 12 * 1024 * 1024) return NextResponse.json({ error: "That file is too big (12 MB most)." }, { status: 400 });
    const path = `checkins/${String(b.ref).replace(/[^\w-]/g, "_")}/${Date.now()}-${(f.name || "photo.jpg").replace(/[^\w.-]+/g, "_")}`;
    const up = await admin.storage.from("proofs").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type || "image/jpeg" });
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    photos.push(path);
  }
  try {
    const checkin = await saveCheckin(admin, who.name, { ref: b.ref, lines: b.lines, boxes: b.boxes ?? null, note: String(b.note || ""), photos, source: b.source || "" });
    return NextResponse.json({ checkin });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
