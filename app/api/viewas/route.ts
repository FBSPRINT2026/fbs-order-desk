import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VIEWAS_COOKIE } from "@/lib/jobAccess";
import { mergeProduction } from "@/lib/production";
import { CREW_VIEWS, crewViewOf, isCrewView, phoneViewsOf } from "@/lib/crewView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * View as (Nick, Nov 13 2026): the owner picks an employee to see the crew phone exactly as they do. Only the owner's own
 * portal login can (no PIN to share or leak); look only (middleware.ts refuses the phone tools' changes while it's on);
 * ends after 2 hours or with Stop. GET lists the people to pick; POST {employeeId} starts; DELETE stops.
 * POST {view} (Nick, Nov 15: "view as press or view as receiving"): the first person whose phone view is that one, so
 * the owner sees a real press operator's or receiver's phone, their press and jobs included.
 */
async function owner() { const v = await getViewer().catch(() => null); return v?.user && v.isStaff && v.role === "owner" ? v : null; }

export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: "Only the owner can view as someone." }, { status: 403 });
  const { data } = await createAdminClient().from("employees").select("id, first_name, last_name, code, department").eq("active", true).order("first_name");
  return NextResponse.json({ people: data || [] });
}

export async function POST(req: Request) {
  if (!(await owner())) return NextResponse.json({ error: "Only the owner can view as someone." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  let id = String(b.employeeId || "");
  if (!id && isCrewView(b.view)) {
    const admin = createAdminClient();
    const [{ data: es }, { data: st }] = await Promise.all([admin.from("employees").select("id, first_name, department, phone_view").eq("active", true).order("first_name"), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
    const views = phoneViewsOf(st?.data), crews = mergeProduction((st?.data as { production?: unknown } | null)?.production).crews;
    const hit = ((es || []) as { id: string; department: string | null; phone_view: string | null }[]).find((e) => crewViewOf(views[e.id] || e.phone_view || null, e.id, crews, e.department || "") === b.view);
    if (!hit) return NextResponse.json({ error: `Nobody has the ${CREW_VIEWS.find((v) => v.id === b.view)?.label || b.view} view yet (Employees → Phone Logins).` }, { status: 400 });
    id = hit.id;
  }
  const { data: e } = /^[0-9a-f-]{36}$/i.test(id) ? await createAdminClient().from("employees").select("id").eq("id", id).maybeSingle() : { data: null };
  if (!e) return NextResponse.json({ error: "Pick someone." }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEWAS_COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2 * 3600 });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEWAS_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
