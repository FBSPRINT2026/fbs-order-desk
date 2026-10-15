import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { specHistory, type SpecHistory } from "@/lib/ai/specHistory";
import { mailboxToRead } from "@/lib/mail/viewing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Spec history for a reorder (lib/ai/specHistory.ts). Staff only.
 *  GET ?order=<id>: the last one found (or null).
 *  POST { order }: search everything again (can take a minute or two: it reads the old jobs, emails and pictures).
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  return v;
}

export async function GET(req: Request) {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("order") || "";
  const { data } = await createAdminClient().from("ai_suggestions").select("payload").eq("dedupe_key", `spec_history:${id}`).limit(1).maybeSingle();
  return NextResponse.json({ history: (data?.payload as SpecHistory | undefined) || null });
}

export async function POST(req: Request) {
  const v = await staff();
  if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { order?: string };
  if (!b.order) return NextResponse.json({ error: "Which order?" }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ error: st.reason }, { status: 503 });
  const { acct } = await mailboxToRead(admin, v);
  const r = await specHistory(admin, st.settings, b.order, v.email, acct && acct.enabled ? acct : null);
  return r.ok ? NextResponse.json({ history: r.history }) : NextResponse.json({ error: r.error }, { status: 422 });
}
