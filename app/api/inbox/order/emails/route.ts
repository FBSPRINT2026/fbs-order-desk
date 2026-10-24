import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConversation } from "@/lib/ai/emailOrder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create order → "which emails make up this order?" (Oct 24, Nick: "when I go to create an order from an email… you
 * should first scan the email and maybe even ask me… I noticed these other messages. Are we bringing in all this
 * information?… Sometimes you need three or four emails"). GET ?activity=<email id>:
 * - convo: the other emails in the same conversation (same thread, or the same subject from the same company; Kassidy's
 *   order and Fisher's follow-up), brought in unless unticked;
 * - others: other recent emails from the same customer with a different subject (two weeks either side), left out
 *   unless ticked (a size sheet or supplier invoice sent separately).
 */
type Row = { id: string; subject: string | null; from_email: string | null; to_email: string | null; occurred_at: string; direction: string; customer_id: string | null; meta: { from_name?: string; attachments?: { name: string }[] } | null };

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const activity = new URL(req.url).searchParams.get("activity") || "";
  const admin = createAdminClient();
  const cv = await emailConversation(admin, activity).catch(() => null);
  if (!cv) return NextResponse.json({ convo: [], others: [] });
  const show = (e: Row) => ({
    id: e.id, at: e.occurred_at, out: e.direction === "out",
    from: e.direction === "out" ? "We" : e.meta?.from_name || e.from_email || "",
    subject: (e.subject || "(no subject)").slice(0, 120),
    files: (e.meta?.attachments || []).map((f) => f.name).slice(0, 8),
  });
  const C = cv.clicked as unknown as Row;
  const inConvo = new Set(cv.convo.map((e) => e.id));
  const at = Date.parse(C.occurred_at), span = 14 * 864e5;
  const convo = (cv.convo as unknown as Row[]).filter((e) => e.id !== C.id).map(show);
  const others = (cv.near as unknown as Row[])
    .filter((e) => !inConvo.has(e.id) && e.direction === "in" && !!C.customer_id && e.customer_id === C.customer_id && Math.abs(Date.parse(e.occurred_at) - at) <= span)
    .slice(0, 8).map(show);
  return NextResponse.json({ clicked: show(C), convo, others });
}
