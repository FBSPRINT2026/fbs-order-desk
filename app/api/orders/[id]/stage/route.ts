import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stageView } from "@/lib/orderStagesServer";
import { FLAGS, STEP, type Check, type Flag, type FlagKey, type StepKey } from "@/lib/orderStages";
import { pvStatusOf } from "@/components/bits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An order's shop stage and flags (lib/orderStages.ts), staff only.
 *  GET → the steps (done or not, and how), the current one, flags, and what the customer sees.
 *  POST { op: "check", step, done, note? } → a step checked off (or back on) by hand
 *  POST { op: "flag", key, on, note?, date? } → a hold or flag on or off
 * Checking off moves the order's status forward only (proof approved → In Production; out the door → Ready); never back.
 * Orders run from Printavo keep Printavo's status: nothing here changes them.
 */
async function staff() { const v = await getViewer(", name"); return v.user && v.isStaff ? v : null; }

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staff())) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { id } = await ctx.params;
  const s = await stageView(createAdminClient(), id);
  return s ? NextResponse.json(s) : NextResponse.json({ error: "Order not found." }, { status: 404 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const v = await staff();
  if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { op?: string; step?: string; done?: boolean; note?: string; key?: string; on?: boolean; date?: string };
  const admin = createAdminClient();
  const { data: o } = await admin.from("orders").select("id, number, status, printavo_id, pv_status, printavo_state, stage_checks, flags").eq("id", id).maybeSingle();
  if (!o) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (pvStatusOf(o as never)) return NextResponse.json({ error: "This job is run from Printavo: its status is Printavo's." }, { status: 400 });
  const by = String(v.staff?.name || "") || v.email.split("@")[0], at = new Date().toISOString();
  const note = String(b.note || "").trim().slice(0, 300);
  const patch: Record<string, unknown> = {};
  let detail = "";
  if (b.op === "check") {
    const step = String(b.step || "") as StepKey;
    if (!STEP[step]) return NextResponse.json({ error: "Which step?" }, { status: 400 });
    const checks = { ...((o.stage_checks || {}) as Record<string, Check>) };
    if (b.done) checks[step] = { by, at, ...(note ? { note } : {}) }; else delete checks[step];
    patch.stage_checks = checks;
    detail = `${STEP[step].label}: ${b.done ? "done" : "not done"}${note ? ` (${note})` : ""}`;
    // the order's status follows, forward only
    if (b.done && step === "out" && !["ready", "completed"].includes(o.status)) patch.status = "ready";
    else if (b.done && ["approved", "art", "blanks"].includes(o.status) && !["approved", "proof"].includes(step)) patch.status = "production";
  } else if (b.op === "flag") {
    const key = String(b.key || "") as FlagKey;
    const def = FLAGS.find((f) => f.key === key);
    if (!def) return NextResponse.json({ error: "Which flag?" }, { status: 400 });
    const flags = ((Array.isArray(o.flags) ? o.flags : []) as Flag[]).filter((f) => f.key !== key);
    if (b.on) flags.push({ key, by, at, ...(note ? { note } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? { date: String(b.date) } : {}) });
    patch.flags = flags;
    detail = `${def.label}: ${b.on ? "on" : "off"}${note ? ` (${note})` : ""}`;
  } else return NextResponse.json({ error: "What change?" }, { status: 400 });
  const { error } = await admin.from("orders").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: /stage_checks|flags/.test(error.message) ? "Run supabase/migrations/182_order_stages.sql first." : error.message }, { status: 500 });
  await admin.from("order_events").insert({ order_id: id, kind: "status", detail: `Shop step · ${detail}${patch.status ? ` · status → ${patch.status}` : ""}`.slice(0, 1000), actor: by });
  const s = await stageView(admin, id);
  return NextResponse.json(s);
}
