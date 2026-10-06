import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { artGate, requestSeparations } from "@/lib/artGate";

export const dynamic = "force-dynamic";

/**
 * Request separations for an order, behind the art check (lib/artGate.ts).
 * GET ?order=<id> → { gate }: is the art approved and final, and each screen-print location with its separation.
 * POST { order, only?: imprint ids } → makes the missing separations (they land in the Separation Center, Working).
 * POST { order, approve: { note } } → staff mark the art approved another way (phone, email…), with how. Logged on the
 *   order; a proof sent after it has to be approved again.
 */
async function staff() {
  const v = await getViewer().catch(() => null);
  if (!v?.user || !v.isStaff) return null;
  const { data } = await v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle();
  return { email: v.email, name: (data?.name as string) || v.email.split("@")[0] };
}

export async function GET(req: Request) {
  const me = await staff();
  if (!me) return NextResponse.json({ error: "Staff only." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("order") || "";
  if (!id) return NextResponse.json({ error: "Which order?" }, { status: 400 });
  const { order, gate } = await artGate(createAdminClient(), id);
  if (!order) return NextResponse.json({ error: "That order doesn't exist." }, { status: 404 });
  return NextResponse.json({ gate });
}

export async function POST(req: Request) {
  const me = await staff();
  if (!me) return NextResponse.json({ error: "Staff only." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { order?: string; only?: string[]; approve?: { note?: string } };
  if (!b.order) return NextResponse.json({ error: "Which order?" }, { status: 400 });
  const admin = createAdminClient();
  if (b.approve) {
    const note = (b.approve.note || "").trim().slice(0, 500);
    if (note.length < 4) return NextResponse.json({ error: "Say how the customer approved it (a call, an email…)." }, { status: 400 });
    const { order, gate } = await artGate(admin, b.order);
    if (!order) return NextResponse.json({ error: "That order doesn't exist." }, { status: 404 });
    if (gate.approved) return NextResponse.json({ gate });
    await admin.from("order_events").insert({ order_id: b.order, kind: "art_approved", detail: `${me.name}: ${note}`, actor: me.email });
    return NextResponse.json({ gate: (await artGate(admin, b.order)).gate });
  }
  const r = await requestSeparations(admin, b.order, me.email, Array.isArray(b.only) ? b.only : undefined);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
