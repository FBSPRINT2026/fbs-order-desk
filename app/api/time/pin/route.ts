import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, validPin } from "@/lib/timeclockServer";

export const dynamic = "force-dynamic";

/** Set (or clear) an employee's clock PIN. Owners and admins only; the PIN is stored hashed and never shown again. */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { data: st } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  if (!["owner", "admin"].includes((st?.role as string) || "")) return NextResponse.json({ error: "Only an owner or admin can set PINs." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.employee_id || ""), pin = String(b.pin ?? "");
  const admin = createAdminClient();
  if (!id) return NextResponse.json({ error: "Which employee?" }, { status: 400 });
  if (pin === "") {
    await admin.from("employee_pins").delete().eq("employee_id", id);
    await admin.from("employees").update({ has_pin: false }).eq("id", id);
    return NextResponse.json({ ok: true, has_pin: false });
  }
  if (!validPin(pin)) return NextResponse.json({ error: "PINs are 4 to 6 digits." }, { status: 400 });
  const { error } = await admin.from("employee_pins").upsert({ employee_id: id, pin_hash: hashPin(pin), updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("employees").update({ has_pin: true }).eq("id", id);
  return NextResponse.json({ ok: true, has_pin: true });
}
