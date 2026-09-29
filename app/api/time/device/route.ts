import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEVICE_COOKIE, deviceFor, newDeviceToken, sha } from "@/lib/timeclockServer";

export const dynamic = "force-dynamic";

async function boss() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const { data } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  return ["owner", "admin"].includes((data?.role as string) || "") ? v : null;
}

/** Is this browser a wall clock? */
export async function GET() {
  const jar = await cookies();
  const dev = await deviceFor(createAdminClient(), jar.get(DEVICE_COOKIE)?.value);
  return NextResponse.json({ device: dev ? { id: dev.id, name: dev.name } : null });
}

/** Set up this browser (a tablet on the wall) as a time clock. Owners and admins only. */
export async function POST(req: Request) {
  const v = await boss();
  if (!v) return NextResponse.json({ error: "Only an owner or admin can set up a time clock." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const token = newDeviceToken();
  const { data, error } = await createAdminClient().from("timeclock_devices").insert({ name: String(b.name || "Time clock").slice(0, 60), token_hash: sha(token), created_by: v.email }).select("id, name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = NextResponse.json({ device: data });
  res.cookies.set(DEVICE_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 * 5 });
  return res;
}

/** Stop using this browser as a clock (the device can also be turned off from the list). */
export async function DELETE() {
  const jar = await cookies();
  const t = jar.get(DEVICE_COOKIE)?.value;
  if (t) await createAdminClient().from("timeclock_devices").update({ active: false }).eq("token_hash", sha(t));
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEVICE_COOKIE);
  return res;
}
