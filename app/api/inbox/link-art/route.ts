import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkArtForEmail } from "@/lib/linkArt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Art sent as a link (Canva, Dropbox, Google Drive) → saved with the email like an attachment (lib/linkArt.ts).
 *   POST { activity, force? }  staff: read the email's links now
 *   GET  ?activity=…&t=…       the shop's tooling token (integration_tokens "tooling", short-lived, set by the owner
 *                              or Claude for a one-off check): same, plus &file=N&part=P returns that saved file in
 *                              base64 pieces (so it can be looked at without a sign-in)
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export async function POST(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { activity, force } = await req.json().catch(() => ({}));
  const r = await linkArtForEmail(createAdminClient(), String(activity || ""), { force: !!force });
  return NextResponse.json(r);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const admin = createAdminClient();
  const { data: tk } = await admin.from("integration_tokens").select("data").eq("name", "tooling").maybeSingle();
  const t = (tk?.data || {}) as { token?: string; expires_at?: string };
  if (!t.token || !t.expires_at || t.expires_at < new Date().toISOString() || q.get("t") !== t.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const id = q.get("activity") || "";
  if (q.get("file") != null) {
    const { data: a } = await admin.from("activities").select("meta").eq("id", id).maybeSingle();
    const f = ((a?.meta as { attachments?: { path: string; name: string; type: string }[] } | null)?.attachments || [])[+(q.get("file") || 0)];
    if (!f) return NextResponse.json({ error: "No such file" }, { status: 404 });
    const { data: blob } = await admin.storage.from("proofs").download(f.path);
    if (!blob) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64"), size = 60_000, part = +(q.get("part") || 0);
    return new NextResponse(`${f.name}|${f.type}|${part}|${Math.ceil(b64.length / size)}|${b64.slice(part * size, (part + 1) * size)}`, { headers: { "content-type": "text/plain" } });
  }
  const r = await linkArtForEmail(admin, id, { force: q.get("force") === "1" });
  return NextResponse.json(r);
}
