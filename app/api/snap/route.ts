import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishSnap, openSnap } from "@/lib/phoneSnap";
import { sendSewout } from "@/lib/sewouts";

export const dynamic = "force-dynamic";

/**
 * The phone side of a photo for the computer (lib/phoneSnap.ts). The phone isn't signed in: the short link is its pass.
 *   { id, step: "urls" }  → where to upload the cropped photo and the whole one (straight to storage, no size limit here)
 *   { id, step: "save", photo, raw, note } → the sew-out is saved and sent, the same as from the computer (lib/sewouts.ts)
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; step?: string; photo?: string; raw?: string; note?: string };
  const admin = createAdminClient();
  const got = await openSnap(admin, String(b.id || ""));
  if (!got.ok) return NextResponse.json({ ok: false, error: got.error }, { status: 400 });
  const s = got.snap;
  if (s.kind !== "sewout") return NextResponse.json({ ok: false, error: "This link isn't for a photo." }, { status: 400 });
  const base = `sewouts/${s.order_id}/`;

  if (b.step === "urls") {
    const ts = Date.now();
    const [p, r] = await Promise.all([admin.storage.from("proofs").createSignedUploadUrl(`${base}${ts}.jpg`), admin.storage.from("proofs").createSignedUploadUrl(`${base}${ts}-whole.jpg`)]);
    if (p.error || r.error || !p.data || !r.data) return NextResponse.json({ ok: false, error: "Couldn't get the photo ready to upload. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, photo: { path: p.data.path, token: p.data.token }, raw: { path: r.data.path, token: r.data.token } });
  }

  if (b.step === "save") {
    const mine = (x?: string) => !!x && x.startsWith(base) && /^\d+(-whole)?\.jpg$/.test(x.slice(base.length));
    if (!mine(b.photo) || !mine(b.raw)) return NextResponse.json({ ok: false, error: "The photo didn't upload. Try again." }, { status: 400 });
    const { data: st } = await admin.from("staff").select("name").eq("email", s.created_by).maybeSingle();
    const who = { email: s.created_by, name: (st?.name as string) || s.created_by.split("@")[0] };
    const res = await sendSewout(admin, { orderId: s.order_id, imprintId: s.target, photoPath: b.photo!, rawPath: b.raw!, note: String(b.note || "") }, who);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || "Couldn't save the sew-out." }, { status: 400 });
    const why = "error" in res && res.error ? res.error.replace(/^Sew-out v\d+ saved\.\s*/, "") : "";
    const msg = `Sew-out v${res.version} came in from the phone` + (res.emailed ? " and went to the customer." : why ? `. ${why}` : ". The email didn't go out: use Remind to try again.");
    await finishSnap(admin, s.id, msg);
    return NextResponse.json({ ok: true, version: res.version, msg });
  }
  return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
}
