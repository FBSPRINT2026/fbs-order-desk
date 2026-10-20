import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planEmail } from "@/lib/ai/emailPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * How many orders an email holds (lib/ai/emailPlan.ts), staff only.
 *   GET  ?activity=<email id>          the saved plan, or made now
 *   POST { activity }                  made again (the conversation changed, or staff want another look)
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export async function GET(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("activity") || "";
  const r = await planEmail(createAdminClient(), id, v.user!.email || "staff");
  return r.ok ? NextResponse.json(r.plan) : NextResponse.json({ error: r.error }, { status: 400 });
}

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const r = await planEmail(createAdminClient(), String(b.activity || ""), v.user!.email || "staff", { fresh: true });
  return r.ok ? NextResponse.json(r.plan) : NextResponse.json({ error: r.error }, { status: 400 });
}
