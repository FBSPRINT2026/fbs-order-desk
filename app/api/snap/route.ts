import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishSnap, openSnap } from "@/lib/phoneSnap";
import { changeWords, saveSewout, type SewnInput } from "@/lib/sewouts";

export const dynamic = "force-dynamic";

/**
 * The phone side of a photo for the computer (lib/phoneSnap.ts). The phone isn't signed in: the short link is its pass.
 *   { id, step: "urls" }  → where to upload the cropped photo and the whole one (straight to storage, no size limit here)
 *   { id, step: "save", photo, raw, placement?, note, sewn } → the sew-out is saved with what was sewn, and the order
 *   changed to match, the same as from the computer (lib/sewouts.ts saveSewout). Sending is done from the computer.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; step?: string; photo?: string; raw?: string; placement?: string; note?: string; sewn?: SewnInput };
  const admin = createAdminClient();
  const got = await openSnap(admin, String(b.id || ""));
  if (!got.ok) return NextResponse.json({ ok: false, error: got.error }, { status: 400 });
  const s = got.snap;
  if (s.kind !== "sewout") return NextResponse.json({ ok: false, error: "This link isn't for a photo." }, { status: 400 });
  const base = `sewouts/${s.order_id}/`;

  if (b.step === "urls") {
    const ts = Date.now();
    const [p, r, pl] = await Promise.all(["", "-whole", "-placement"].map((x) => admin.storage.from("proofs").createSignedUploadUrl(`${base}${ts}${x}.jpg`)));
    if (p.error || r.error || pl.error || !p.data || !r.data || !pl.data) return NextResponse.json({ ok: false, error: "Couldn't get the photo ready to upload. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, photo: { path: p.data.path, token: p.data.token }, raw: { path: r.data.path, token: r.data.token }, placement: { path: pl.data.path, token: pl.data.token } });
  }

  if (b.step === "save") {
    const mine = (x?: string) => !!x && x.startsWith(base) && /^\d+(-whole|-placement)?\.jpg$/.test(x.slice(base.length));
    if (!mine(b.photo) || !mine(b.raw) || (b.placement && !mine(b.placement))) return NextResponse.json({ ok: false, error: "The photo didn't upload. Try again." }, { status: 400 });
    const { data: st } = await admin.from("staff").select("name").eq("email", s.created_by).maybeSingle();
    const who = { email: s.created_by, name: (st?.name as string) || s.created_by.split("@")[0] };
    const res = await saveSewout(admin, { orderId: s.order_id, imprintId: s.target, photoPath: b.photo!, rawPath: b.raw!, placementPath: b.placement || undefined, note: String(b.note || ""), sewn: b.sewn }, who);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || "Couldn't save the sew-out." }, { status: 400 });
    const msg = `Sew-out v${res.version} came in from the phone.${res.changes.length ? ` The order now matches what was sewn: ${changeWords(res.changes)}.` : ""} Download the PDF proof or send it to the customer.`;
    await finishSnap(admin, s.id, msg);
    return NextResponse.json({ ok: true, version: res.version, msg });
  }
  return NextResponse.json({ ok: false, error: "Unknown step." }, { status: 400 });
}
