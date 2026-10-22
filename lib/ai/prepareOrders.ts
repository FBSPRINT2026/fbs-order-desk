import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState } from "@/lib/ai/claude";
import { emailConversation, suggestEmailOrder } from "@/lib/ai/emailOrder";
import { anchorOf, planEmail, type EmailPlan } from "@/lib/ai/emailPlan";

/**
 * Orders made ready before anyone opens the email (Oct 20, Nick: "Little Groupies emailed me yesterday… 'this is a hit,
 * we're already sold out, I'd like to place another order.' You should be able to just figure it out on your own. And
 * all I got to do is click a button to approve it").
 *
 * Every few minutes (the mail bodies run), customer emails of the last 4 days that read as an order or a reorder, with
 * no order made from them yet, are worked out in full in the background: how many orders the conversation holds
 * (lib/ai/emailPlan.ts), then each order read with its files and the past order it repeats. Create order then opens
 * on orders already read, ready to approve. A few AI reads per run; the rest wait for the next run.
 */
type A = { id: string; customer_id: string | null; occurred_at: string; order_id: string | null; meta: { triage?: { intent?: string } } | null };

export async function prepareOrders(admin: SupabaseClient, deadline: number): Promise<Record<string, unknown>> {
  const st = await aiState(admin);
  if (!st.ready) return { off: st.reason };
  // a ceiling on background reads: at most 60 order reads a day by the assistant (a normal day is well under that).
  // Opening an email and clicking Create order still reads it.
  const { count: today } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("created_by", "assistant")
    .in("task", ["order_from_email", "email_plan"]).gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if ((today || 0) >= 60) return { off: `daily limit: ${today} background reads in the last 24 hours` };
  const since = new Date(Date.now() - 4 * 86400_000).toISOString();
  const { data } = await admin.from("activities").select("id, customer_id, occurred_at, order_id, meta").eq("kind", "email").eq("direction", "in")
    .not("customer_id", "is", null).is("order_id", null).gte("occurred_at", since).in("meta->triage->>intent", ["new_order", "reorder"]).order("occurred_at", { ascending: false }).limit(30);
  const out: string[] = [];
  const doneConvos = new Set<string>();
  for (const a of (data || []) as A[]) {
    if (Date.now() > deadline - 70_000) break;
    const cv = await emailConversation(admin, a.id).catch(() => null);
    if (!cv) continue;
    const anchor = anchorOf(cv.convo);
    if (doneConvos.has(anchor)) continue;
    doneConvos.add(anchor);
    // an order already made from this conversation: nothing to do
    const ids = cv.convo.map((e) => e.id);
    const { data: made } = await admin.from("ai_suggestions").select("id").in("activity_id", ids).in("kind", ["draft_order", "draft_order_part"]).eq("status", "done").limit(1);
    if (made?.length || cv.convo.some((e) => (e as { order_id?: string | null }).order_id)) continue;
    const r = await planEmail(admin, a.id, "assistant").catch(() => null);
    if (!r?.ok) { out.push(`${a.id}: no plan`); continue; }
    const plan: EmailPlan = r.plan;
    const newest = cv.convo.find((e) => e.direction === "in") || cv.convo[0];
    // safety (Oct 22: one email was read 2,100 times in two days, about $100): an email the assistant has already read
    // in the last 12 hours is left alone, whatever the checks below say
    const { count: recent } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("task", "order_from_email").eq("created_by", "assistant")
      .eq("activity_id", newest.id).gte("created_at", new Date(Date.now() - 12 * 3600_000).toISOString());
    if ((recent || 0) >= Math.max(1, plan.parts.length)) continue;
    if (plan.parts.length > 1) {
      // several orders: each read on its own, those not read yet (or read before the conversation grew). A part is
      // saved under the email it was read from (newest), so look there as well as under the conversation's first email:
      // looking only under the first one never found it, and every part was read again every run (the Oct 22 bill)
      for (const p of plan.parts) {
        if (Date.now() > deadline - 60_000) break;
        const { data: hads } = await admin.from("ai_suggestions").select("status, payload").in("dedupe_key", [...new Set([`email:${anchor}:order:${p.key}`, `email:${newest.id}:order:${p.key}`])]);
        const later = (a?: string | null, b?: string | null) => !!a && !!b && Date.parse(a) >= Date.parse(b);
        if ((hads || []).some((had) => had.status === "done" || later((had.payload as { seen?: string } | null)?.seen, plan.seen))) continue;
        const x = await suggestEmailOrder(admin, newest.id, "assistant", { jobRef: p.job, reorderOk: !!p.job, part: p }).catch(() => null);
        out.push(`${p.label}: ${x?.ok ? "ready" : "failed"}`);
      }
    } else {
      // one order: read in full as the email's order, with the past order it repeats
      const p = plan.parts[0];
      const { data: had } = await admin.from("ai_suggestions").select("status, payload").eq("dedupe_key", `email:${newest.id}:order`).maybeSingle();
      const pl = had?.payload as { v?: number; seen?: string } | null;
      if (had?.status === "done" || (pl?.v === 2 && !!pl.seen && Date.parse(pl.seen) >= Date.parse(plan.seen))) continue;
      const told = p ? [p.kind === "reorder" && p.jobLabel ? `This is a reorder of ${p.jobLabel}.` : p.kind === "new" ? "This is a new order." : "", p.changes ? `What's different: ${p.changes}` : ""].filter(Boolean).join(" ") : "";
      const x = await suggestEmailOrder(admin, newest.id, "assistant", { told, jobRef: p?.job || null, reorderOk: !!p?.job }).catch(() => null);
      out.push(`${p?.label || newest.id}: ${x?.ok ? "ready" : "failed"}`);
    }
  }
  return { prepared: out };
}
