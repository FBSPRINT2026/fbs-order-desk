import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { viewerPerms } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkinJobs, resolveCheckin, saveCheckin, weekOf } from "@/lib/checkin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Check-In (Goods & Receiving): staff with the Goods & Receiving permission. */
async function who() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  if (!(await viewerPerms(v.supabase, v.email, v.role)).receiving) return null;
  const { data } = await v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle();
  return { ...v, name: ((data?.name as string) || v.email.split("@")[0]) };
}
const fail = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  // the check-ins table isn't in the database yet
  if (/goods_checkins/.test(m) && /does not exist|schema cache/i.test(m)) return NextResponse.json({ error: "Check-In needs a one-time database update (migration 087_goods_checkins.sql) before counts can be saved.", setup: true }, { status: 500 });
  return NextResponse.json({ error: m }, { status: 500 });
};

/** The week's jobs and their goods (?week=YYYY-MM-DD, any day of that week; default this week). */
export async function GET(req: Request) {
  if (!(await who())) return NextResponse.json({ error: "Goods & Receiving only." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const from = weekOf(sp.get("week") || today);
  const to = new Date(new Date(from + "T12:00").getTime() + 6 * 86400000).toISOString().slice(0, 10);
  try { return NextResponse.json({ from, to, today, ...(await checkinJobs(createAdminClient(), from, to)) }); }
  catch (e) { return fail(e); }
}

/** Save a count. */
export async function POST(req: Request) {
  const v = await who(); if (!v) return NextResponse.json({ error: "Goods & Receiving only." }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.ref || !Array.isArray(b.lines) || !b.lines.length) return NextResponse.json({ error: "Nothing to check in." }, { status: 400 });
  try { return NextResponse.json({ checkin: await saveCheckin(createAdminClient(), v.name, b) }); }
  catch (e) { return fail(e); }
}

/** Resolve a problem (or reopen it). */
export async function PATCH(req: Request) {
  const v = await who(); if (!v) return NextResponse.json({ error: "Goods & Receiving only." }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.id) return NextResponse.json({ error: "Which check-in?" }, { status: 400 });
  try { return NextResponse.json({ checkin: await resolveCheckin(createAdminClient(), v.name, b.id, String(b.resolution || ""), !!b.reopen) }); }
  catch (e) { return fail(e); }
}
