import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { saveCheckin } from "@/lib/checkin";
import { ST, type StatusKey } from "@/lib/pricing";
import type { CheckLine } from "@/lib/checkinShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The post count (the catcher's, at the end of the oven; Nick, Nov 13 2026): what's here now by size, started from the
 * count-in so only what's different is typed. Saved with what happened to the rest:
 *  - all_here: every piece here; short: fewer, nothing reprints (a reseller's waste);
 *  - reprint: the rejects print again (an Issue on the run, Reject, by size: it's its own job on the schedule).
 * A wrong count-in is fixed too ("you counted 10, there were 9"): saved as a new count-in with the right numbers.
 * Optionally the order moves on to Ready (worded by its delivery: pickup, ship, deliver) once it's boxed.
 */
type Line = { style: string; color: string; size: string; pre: number; post: number; reject: number; was?: number };

export async function GET(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const u = new URL(req.url), kind = u.searchParams.get("kind"), id = u.searchParams.get("id") || "";
  const { data, error } = await createAdminClient().from("post_counts").select("*").eq(kind === "a" ? "archived_order_id" : "order_id", id).order("created_at", { ascending: false }).limit(5);
  if (error) return NextResponse.json({ counts: [], setup: false });
  return NextResponse.json({ counts: data || [], setup: true });
}

export async function POST(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => null);
  const job = b?.job as { kind: "o" | "a"; id: string } | undefined;
  if (!job?.id || !Array.isArray(b.lines) || !b.lines.length) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const n = (x: unknown) => Math.max(0, Math.round(+(x as number) || 0));
  const lines: Line[] = (b.lines as Line[]).map((l) => ({ style: String(l.style || "").slice(0, 60), color: String(l.color || "").slice(0, 60), size: String(l.size || "").slice(0, 12), pre: n(l.pre), post: n(l.post), reject: n(l.reject), ...(l.was != null && n(l.was) !== n(l.pre) ? { was: n(l.was) } : {}) }));
  const pre = lines.reduce((a, l) => a + l.pre, 0), post = lines.reduce((a, l) => a + l.post, 0), rejects = lines.reduce((a, l) => a + l.reject, 0);
  const outcome = b.outcome === "reprint" && rejects > 0 ? "reprint" : post >= pre ? "all_here" : "short";
  const preFixed = lines.some((l) => l.was != null);
  const admin = createAdminClient();
  const ins = await admin.from("post_counts").insert({ order_id: job.kind === "o" ? job.id : null, archived_order_id: job.kind === "a" ? job.id : null, lines, pre, post, rejects, outcome, pre_fixed: preFixed, note: String(b.note || "").slice(0, 1000), by: who.name }).select("*").single();
  if (ins.error) return NextResponse.json({ error: /post_counts/.test(ins.error.message) ? "Post counts aren't set up in the database yet. Tell the office." : ins.error.message }, { status: 500 });
  const done: string[] = [];

  // the count-in was wrong: a new count-in with the right numbers (the goods issue follows it, as any count does)
  if (preFixed) {
    const fixed: CheckLine[] = lines.map((l) => ({ item: [l.style, l.color].filter(Boolean).join(" "), style: l.style, color: l.color, size: l.size, expected: l.was ?? l.pre, received: l.pre, issue: "" }));
    await saveCheckin(admin, who.name, { ref: job.kind === "a" ? `pv:${job.id}` : job.id, lines: fixed, note: `Count-in fixed at the post count by ${who.name}`, source: "post-count" }).then(() => done.push("count-in fixed")).catch(() => null);
  }

  // the rejects print again: an Issue on the run (Reject), its own job on the schedule
  if (outcome === "reprint" && job.kind === "o") {
    const sizes: Record<string, number> = {};
    for (const l of lines) if (l.reject) sizes[l.size] = (sizes[l.size] || 0) + l.reject;
    const { data: sl } = await admin.from("production_slots").select("id, kind").eq("order_id", job.id).order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const r = await admin.from("production_issues").insert({ order_id: job.id, kind: (sl?.kind as string) || "screen", locations: null, why: "reject", sizes, pcs: rejects, from_slot: sl?.id || null, by: who.name });
    if (!r.error) done.push(`${rejects} to reprint`);
  }

  // boxed: the order moves on to Ready, unless pieces are still to print
  if (b.ready && job.kind === "o" && outcome !== "reprint") {
    const { data: o } = await admin.from("orders").select("status").eq("id", job.id).maybeSingle();
    const { data: open } = await admin.from("production_issues").select("id").eq("order_id", job.id).eq("status", "open").limit(1);
    const cur = (o?.status as string) || "";
    if (!(open || []).length && ["production", "fulfillment"].includes(cur)) {
      const k: StatusKey = "ready";
      const up = await admin.from("orders").update({ status: k, type: ST[k].type }).eq("id", job.id);
      if (!up.error) {
        await admin.from("order_events").insert({ order_id: job.id, kind: "status", detail: k, actor: who.name });
        // the customer's usual "ready" email (as the schedule's Complete sends it)
        await (await import("@/lib/customerEmailServer")).emailForStatus(admin, job.id, k, who.name).catch(() => null);
        done.push("moved to Ready");
      }
    }
  }
  return NextResponse.json({ count: ins.data, done });
}
