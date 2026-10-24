import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { loadTokens, Qbo, QboError } from "@/lib/qbo/client";
import { qboEnv } from "@/lib/qbo/config";
import { loadQboSettings } from "@/lib/qbo/runner";
import { explainQboError, Pusher } from "@/lib/qbo/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Owner only: send ONE test invoice to the connected QuickBooks, or void it (Oct 24, Nick: "the real quickbooks… just
 * try to sync this one invoice to make sure it's working ok"). Works while the sync is off; touches nothing else.
 * POST { number } → makes "TEST-<number>" (and the customer, if they aren't in QuickBooks yet)
 * POST { voidId } → voids that test invoice (only invoices numbered TEST-…)
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return NextResponse.json({ error: "Only the owner can send a test invoice." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { number?: number; voidId?: string };
  const admin = createAdminClient();
  const env = qboEnv();
  const tokens = env.configured ? await loadTokens(admin) : null;
  if (!tokens) return NextResponse.json({ error: "QuickBooks isn't connected. Press Connect QuickBooks first." }, { status: 400 });
  if (tokens.env && env.env && tokens.env !== env.env) return NextResponse.json({ error: `The QuickBooks sign-in is for ${tokens.env}, but QBO_ENV is ${env.env}. Connect QuickBooks again first.` }, { status: 400 });
  const qs = await loadQboSettings(admin);
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const qbo = new Qbo(admin);
  try {
    const realm = await qbo.realm();
    const pusher = new Pusher(admin, qs, mergeSettings(st?.data), qbo, realm, true, true);
    if (body.voidId) return NextResponse.json(await pusher.testVoid(String(body.voidId)));
    const n = Math.round(+(body.number || 0));
    const { data: o } = await admin.from("orders").select("id").eq("number", n).maybeSingle();
    if (!o) return NextResponse.json({ error: `No order #${n}.` }, { status: 404 });
    return NextResponse.json(await pusher.testInvoice(o.id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof QboError ? explainQboError(e) : e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
