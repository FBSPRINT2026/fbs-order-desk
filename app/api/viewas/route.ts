import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VIEWAS_COOKIE } from "@/lib/jobAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * View as (Nick, Nov 13 2026): the owner picks an employee to see the crew phone exactly as they do. Only the owner's own
 * portal login can (no PIN to share or leak); look only (middleware.ts refuses the phone tools' changes while it's on);
 * ends after 2 hours or with Stop. GET lists the people to pick; POST {employeeId} starts; DELETE stops.
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
  const id = String(b.employeeId || "");
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
