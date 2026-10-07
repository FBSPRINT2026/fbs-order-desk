import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobActor } from "@/lib/jobAccess";
import { BATCH_COLS, batchesFor } from "@/lib/inkBatches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PMS batches mixed in the ink room (ink_batches): when a color was last made and how much. The job's phone menu logs a
 * batch when someone taps "Make" and weighs it out; the Ink Room shows the history on each color. Staff, or crew signed
 * in with their PIN on the shop network.
 */
/** ?codes=123 C,186 C → the last batches of each (newest first) */
export async function GET(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const codes = (new URL(req.url).searchParams.get("codes") || "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 40);
  if (!codes.length) return NextResponse.json({ batches: [] });
  const batches = await batchesFor(createAdminClient(), codes);
  return NextResponse.json({ batches });
}

/** Log a batch: { code, qt, grams?, job?: { kind, id, label }, note? } */
export async function POST(req: Request) {
  const who = await jobActor();
  if (!who) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const code = String(b.code || "").trim().slice(0, 60), qt = +b.qt;
  if (!code) return NextResponse.json({ error: "Which color?" }, { status: 400 });
  if (!(qt > 0 && qt <= 400)) return NextResponse.json({ error: "How much was made?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: f } = await admin.from("ink_formulas").select("id, code").eq("system", "RX").eq("rec_type", "S").ilike("code", code.replace(/[%_\\]/g, "")).not("lines", "is", null).limit(1).maybeSingle();
  const job = b.job && (b.job.kind === "o" || b.job.kind === "a") && /^[0-9a-f-]{36}$/i.test(String(b.job.id)) ? b.job : null;
  const row = {
    code: (f?.code as string) || code, formula_id: (f?.id as string) || null, qt: Math.round(qt * 100) / 100, grams: +b.grams > 0 ? Math.round(+b.grams * 10) / 10 : null,
    order_id: job?.kind === "o" ? job.id : null, archived_order_id: job?.kind === "a" ? job.id : null, job: String(job?.label || "").slice(0, 120),
    note: String(b.note || "").slice(0, 500), made_by: who.name || who.email, employee_id: who.employeeId,
  };
  const { data, error } = await admin.from("ink_batches").insert(row).select(BATCH_COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, batch: data });
}
