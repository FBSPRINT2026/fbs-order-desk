import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { loadJobCard } from "@/lib/jobCard";
import { pressSheets, saveActual } from "@/lib/pressActualServer";

export const dynamic = "force-dynamic";

/**
 * Suggested vs as-printed press setups for a job.
 * GET ?kind=o|a&id=… → { sheets, presses }
 * POST { job: { kind, id }, sheet, pressId, heads, notes, learn } → saves what really ran (crew on the shop Wi-Fi or
 * staff), adds a "Press setup" shop note, and with `learn` updates the separation, design and order inks.
 */
async function load(kind: string, id: string) {
  const admin = createAdminClient();
  if ((kind !== "o" && kind !== "a") || !id) return null;
  const [card, { data: st }] = await Promise.all([loadJobCard(admin, { kind, id }), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
  return card ? { admin, card, settings: st?.data } : null;
}

export async function GET(req: Request) {
  if (!(await jobActor())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const j = await load(sp.get("kind") || "", sp.get("id") || "");
  if (!j) return NextResponse.json({ error: "That job doesn't exist." }, { status: 404 });
  return NextResponse.json(await pressSheets(j.admin, j.card, j.settings));
}

export async function POST(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { job?: { kind: string; id: string }; sheet?: string; pressId?: string; heads?: unknown; notes?: string; learn?: boolean };
  const j = b.job ? await load(b.job.kind, b.job.id) : null;
  if (!j) return NextResponse.json({ error: "That job doesn't exist." }, { status: 404 });
  try {
    const actual = await saveActual(j.admin, who, j.card, j.settings, { sheet: String(b.sheet || ""), pressId: String(b.pressId || ""), heads: b.heads, notes: b.notes, learn: b.learn !== false });
    return NextResponse.json({ actual, ...(await pressSheets(j.admin, j.card, j.settings)) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
