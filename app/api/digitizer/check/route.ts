import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import type { MailAccount } from "@/lib/mail/config";
import { runAccount } from "@/lib/mail/run";
import { sweepDigitizerReplies } from "@/lib/digitizerAuto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Digitizing → Check now (Oct 28, Nick: "add a check now button… if it comes in, you just check"): reads Amanda's
 * mailbox (where the digitizer answers) right now, then adds the files of any reply that came in (lib/digitizerAuto.ts).
 * Staff only. Reads mail; sends nothing.
 */
export async function POST() {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const admin = createAdminClient();
  const before = await sweepDigitizerReplies(admin).catch(() => 0);
  const { data: a } = await admin.from("mail_accounts").select("*").eq("enabled", true).ilike("email", "amanda@fbsprint.com").maybeSingle();
  let read: unknown = null;
  if (a) read = await runAccount(admin, a as MailAccount, Date.now() + 35000).catch((e) => String(e));
  const after = await sweepDigitizerReplies(admin).catch(() => 0);
  return NextResponse.json({ ok: true, added: before + after, read });
}
