import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planEmail, type EmailPlan } from "@/lib/ai/emailPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * How many orders an email holds (lib/ai/emailPlan.ts), staff only.
 *   GET  ?activity=<email id>          the saved plan, or made now
 *   POST { activity }                  made again (the conversation changed, or staff want another look)
 */
/**
 * Which of the email's orders are already made (Oct 23, Nick: "if I go back to email, say create order, it's like, oh,
 * you already created the first order… It's 40113. Would you like to make the second one?"): each part's order, from
 * its saved reading (`email:<anchor>:order:<key>`, marked done with the order when Create order makes it).
 */
async function withMade(admin: ReturnType<typeof createAdminClient>, plan: EmailPlan) {
  const keys = plan.parts.map((p) => `email:${p.anchor || plan.anchor}:order:${p.key}`);
  if (!keys.length) return plan;
  const { data: sg } = await admin.from("ai_suggestions").select("dedupe_key, order_id").in("dedupe_key", keys).eq("status", "done").not("order_id", "is", null);
  const ids = [...new Set((sg || []).map((x) => x.order_id as string))];
  const { data: os } = ids.length ? await admin.from("orders").select("id, number").in("id", ids) : { data: [] };
  const num = new Map((os || []).map((o) => [o.id as string, o.number as number]));
  const byKey = new Map((sg || []).filter((x) => num.has(x.order_id as string)).map((x) => [x.dedupe_key as string, x.order_id as string]));
  return { ...plan, parts: plan.parts.map((p, i) => { const id = byKey.get(keys[i]); return id ? { ...p, made: { id, number: num.get(id)! } } : p; }) };
}

async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export async function GET(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("activity") || "";
  const admin = createAdminClient();
  const r = await planEmail(admin, id, v.user!.email || "staff");
  return r.ok ? NextResponse.json(await withMade(admin, r.plan)) : NextResponse.json({ error: r.error }, { status: 400 });
}

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const r = await planEmail(admin, String(b.activity || ""), v.user!.email || "staff", { fresh: true });
  return r.ok ? NextResponse.json(await withMade(admin, r.plan)) : NextResponse.json({ error: r.error }, { status: 400 });
}
