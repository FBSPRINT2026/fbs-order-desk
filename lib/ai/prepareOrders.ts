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
    await readAhead(admin, a.id, deadline, out, doneConvos);
  }
  return { prepared: out };
}

/** one conversation (an email's, or a ClickUp job's) worked out in full: its plan, then each order in it read (the
 *  reading Create order opens on). Skipped when it's already read and nothing new came in, or an order was made. */
async function readAhead(admin: SupabaseClient, activityId: string, deadline: number, out: string[], doneConvos: Set<string>) {
  const a = { id: activityId };
  const cv = await emailConversation(admin, a.id).catch(() => null);
  if (!cv) return;
  const anchor = anchorOf(cv.convo);
  if (doneConvos.has(anchor)) return;
  doneConvos.add(anchor);
  // an order already made from this conversation: nothing to do
  const ids = cv.convo.map((e) => e.id);
  // (an order made and since deleted doesn't count: Nov 1, Baton Rouge was back on New and read only when clicked)
  const { data: made } = await admin.from("ai_suggestions").select("order_id").in("activity_id", ids).in("kind", ["draft_order", "draft_order_part"]).eq("status", "done").limit(20);
  if (await stillMade(admin, [...((made || []) as { order_id: string | null }[]).map((m) => m.order_id), ...cv.convo.map((e) => (e as { order_id?: string | null }).order_id)])) return;
  const r = await planEmail(admin, a.id, "assistant").catch(() => null);
  if (!r?.ok) { out.push(`${a.id}: no plan`); return; }
  const plan: EmailPlan = r.plan;
  const newest = cv.convo.find((e) => e.direction === "in") || cv.convo[0];
  // safety (Oct 22: one email was read 2,100 times in two days, about $100): an email the assistant has already read
  // in the last 12 hours is left alone, whatever the checks below say
  const { count: recent } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("task", "order_from_email").eq("created_by", "assistant")
    .eq("activity_id", newest.id).gte("created_at", new Date(Date.now() - 12 * 3600_000).toISOString());
  if ((recent || 0) >= Math.max(1, plan.parts.length)) return;
  if (plan.parts.length > 1) {
    // several orders: each read on its own, those not read yet (or read before the conversation grew). A part is
    // saved under the email it was read from (newest), so look there as well as under the conversation's first email:
    // looking only under the first one never found it, and every part was read again every run (the Oct 22 bill)
    for (const p of plan.parts) {
      if (Date.now() > deadline - 60_000) break;
      const { data: hads } = await admin.from("ai_suggestions").select("status, payload, order_id").in("dedupe_key", [...new Set([`email:${anchor}:order:${p.key}`, `email:${newest.id}:order:${p.key}`])]);
      const later = (a?: string | null, b?: string | null) => !!a && !!b && Date.parse(a) >= Date.parse(b);
      if (await stillMade(admin, (hads || []).filter((had) => had.status === "done").map((had) => had.order_id as string | null)) || (hads || []).some((had) => had.status !== "done" && later((had.payload as { seen?: string } | null)?.seen, plan.seen))) continue;
      const x = await suggestEmailOrder(admin, newest.id, "assistant", { jobRef: p.job, reorderOk: !!p.job, part: p }).catch(() => null);
      out.push(`${p.label}: ${x?.ok ? "ready" : "failed"}`);
    }
  } else {
    // one order: read in full as the email's order, with the past order it repeats
    const p = plan.parts[0];
    const { data: had } = await admin.from("ai_suggestions").select("status, payload, order_id").eq("dedupe_key", `email:${newest.id}:order`).maybeSingle();
    const pl = had?.payload as { v?: number; seen?: string } | null;
    if ((had?.status === "done" && await stillMade(admin, [had.order_id as string | null])) || (had?.status !== "done" && (pl?.v === 2 && !!pl.seen && Date.parse(pl.seen) >= Date.parse(plan.seen)))) return;
    const told = p ? [p.kind === "reorder" && p.jobLabel ? `This is a reorder of ${p.jobLabel}.` : p.kind === "new" ? "This is a new order." : "", p.changes ? `What's different: ${p.changes}` : ""].filter(Boolean).join(" ") : "";
    const x = await suggestEmailOrder(admin, newest.id, "assistant", { told, jobRef: p?.job || null, reorderOk: !!p?.job }).catch(() => null);
    out.push(`${p?.label || newest.id}: ${x?.ok ? "ready" : "failed"}`);
  }
}

/** any of these orders still exists (an order made from the conversation that wasn't deleted since) */
async function stillMade(admin: SupabaseClient, ids: (string | null | undefined)[]): Promise<boolean> {
  const want = [...new Set(ids.filter(Boolean) as string[])];
  if (!want.length) return false;
  const { data } = await admin.from("orders").select("id").in("id", want).limit(1);
  return !!data?.length;
}

/**
 * ClickUp jobs read ahead too (Oct 27, Nick: "you know how we did the pre-read the email so the create order tool works
 * faster… Can you do the same thing with ClickUp orders?"): a new job on a customer's board (waiting on ClickUp Jobs,
 * made in the last 2 weeks, its workspace matched to a customer) is brought in like Process does (lib/clickup.ts
 * importClickUpTask: the task, its notes and its files) and read like an order email, so Process opens on the reading.
 * Shares the assistant's daily limit with the emails. At most 3 jobs a run.
 */
export async function prepareClickUpOrders(admin: SupabaseClient, deadline: number): Promise<Record<string, unknown>> {
  const st = await aiState(admin);
  if (!st.ready) return { off: st.reason };
  const { count: today } = await admin.from("ai_runs").select("id", { count: "exact", head: true }).eq("created_by", "assistant")
    .in("task", ["order_from_email", "email_plan"]).gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if ((today || 0) >= 60) return { off: `daily limit: ${today} background reads in the last 24 hours` };
  const { importClickUpTask } = await import("@/lib/clickup");
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data } = await admin.from("clickup_tasks").select("id, team_id, activity_id, name").eq("waiting", true).is("parent", null).is("order_id", null)
    .gte("created_at_cu", since).order("created_at_cu", { ascending: false }).limit(12);
  const { data: teams } = await admin.from("clickup_teams").select("id, customer_id, hidden");
  const ok = new Set(((teams || []) as { id: string; customer_id: string | null; hidden: boolean }[]).filter((t) => t.customer_id && !t.hidden).map((t) => t.id));
  const out: string[] = [], done = new Set<string>();
  let n = 0;
  for (const t of (data || []) as { id: string; team_id: string; activity_id: string | null; name: string }[]) {
    if (Date.now() > deadline - 100_000 || n >= 3) break;
    if (!ok.has(t.team_id)) continue;
    // already brought in and read (or an order made from it): nothing to do
    if (t.activity_id) {
      // a reading waiting to be used, or an order that still exists; a reading whose order was deleted is read again
      const { data: had } = await admin.from("ai_suggestions").select("status, order_id").eq("activity_id", t.activity_id).in("kind", ["draft_order", "draft_order_part"]).limit(20);
      const hs = (had || []) as { status: string; order_id: string | null }[];
      if (hs.some((h) => h.status !== "done") || await stillMade(admin, hs.map((h) => h.order_id))) continue;
    }
    n++;
    const im = await importClickUpTask(admin, t.id, "assistant").catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!im.ok) { out.push(`${t.name}: ${im.error}`); continue; }
    const before = out.length;
    await readAhead(admin, im.activityId, deadline, out, done);
    if (out.length === before) out.push(`${t.name}: already read`);
  }
  return { prepared: out };
}
