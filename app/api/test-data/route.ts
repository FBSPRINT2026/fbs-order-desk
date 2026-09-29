import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sampleOrders } from "@/lib/sampleJobs";
import { mergeProduction, needsForOrder, suggest } from "@/lib/production";
import type { Group } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Test accounts (owner / admin only).
 * POST {customerId, action: "flag", on}: mark a customer as a test account (or not).
 * POST {customerId, action: "generate", count? (25)}: add sample jobs to a test account, and book about half of the ready
 *      ones onto the production calendar (a few earlier this week already done, one running).
 * POST {customerId, action: "clear"}: remove every job on a test account (only ever a test account).
 */
const shopToday = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { data: me } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  if (!["owner", "admin"].includes((me?.role as string) || "")) return NextResponse.json({ error: "Only an owner or admin can change test accounts." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.customerId || "");
  const admin = createAdminClient();
  const { data: cust } = await admin.from("customers").select("id, company, name, is_test").eq("id", id).maybeSingle();
  if (!cust) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  if (b.action === "flag") {
    const { error } = await admin.from("customers").update({ is_test: !!b.on }).eq("id", id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, is_test: !!b.on });
  }
  if (!cust.is_test) return NextResponse.json({ error: "Turn on Test account for this customer first." }, { status: 400 });

  if (b.action === "clear") {
    const { data: os } = await admin.from("orders").select("id").eq("customer_id", id);
    const ids = (os || []).map((o) => o.id as string);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await admin.from("orders").delete().in("id", ids.slice(i, i + 200));
      if (error) return NextResponse.json({ error: error.message, cleared: i }, { status: 500 });
    }
    return NextResponse.json({ ok: true, cleared: ids.length });
  }

  if (b.action === "generate") {
    const today = shopToday();
    const n = Math.max(1, Math.min(150, Math.round(+b.count || 25)));
    const rows = sampleOrders(id, today, n);
    const { data: made, error } = await admin.from("orders").insert(rows).select("id, number, due_date, status, groups, lines, nickname");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // book about half of the ready jobs where the scheduler would put them
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const ps = mergeProduction((st?.data as { production?: unknown } | null)?.production);
    const { data: existing } = await admin.from("production_slots").select("machine, day, minutes").gte("day", today);
    const load: Record<string, Record<string, number>> = {};
    for (const x of existing || []) (load[x.machine as string] ||= {})[x.day as string] = (load[x.machine as string]?.[x.day as string] || 0) + (x.minutes as number);
    const ready = (made || []).filter((o) => o.status === "production").sort((a, c) => String(a.due_date).localeCompare(String(c.due_date)));
    const slots: Record<string, unknown>[] = [];
    ready.slice(0, Math.ceil(ready.length * 0.7)).forEach((o) => {
      for (const need of needsForOrder(ps, o as never, o.groups as Group[])) {
        // spread the sample work out: plan each job to start a few working days before it's due (not all today)
        let from = String(o.due_date); for (let k = 0; k < 4 && from > today; ) { const x = new Date(from + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); from = x.toISOString().slice(0, 10); const w = x.getUTCDay(); if (w !== 0 && w !== 6) k++; }
        if (from < today) from = today;
        const sug = suggest(ps, need, o.due_date as string, from, load);
        if (!sug) continue;
        (load[sug.machine.id] ||= {})[sug.day] = (load[sug.machine.id]?.[sug.day] || 0) + sug.minutes;
        slots.push({ order_id: o.id, machine: sug.machine.id, day: sug.day, minutes: sug.minutes, position: slots.length, kind: need.type, label: need.label, source: "sample" });
      }
    });
    // a few finished earlier this week, and one running now, so the week looks lived-in
    const dow = new Date(today + "T12:00:00Z").getUTCDay();
    const pastDays: string[] = [];
    for (let k = 1; k < dow && k <= 4; k++) { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - k); pastDays.push(x.toISOString().slice(0, 10)); }
    slots.slice(-Math.min(4, pastDays.length * 2)).forEach((x, i) => { x.day = pastDays[i % pastDays.length]; x.status = "done"; });
    const first = slots.find((x) => x.day === today && !x.status); if (first) first.status = "running";
    if (slots.length) {
      const { error: e2 } = await admin.from("production_slots").insert(slots);
      if (e2) return NextResponse.json({ error: e2.message, created: made?.length || 0 }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created: made?.length || 0, booked: slots.length });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
