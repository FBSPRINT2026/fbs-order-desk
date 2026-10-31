import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerTrainings, trainingsForText } from "@/lib/orderTrainings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create order → "I spotted a Nine18 · All My Sons order: make it with the rules?" (Oct 30, Nick: "a little pop-up…
 * I detected this is 918 All My Sons order. Would you like me to enter this with the rules?… it's going to trump
 * everything in the create orders"). GET ?activity=<email or ClickUp job>: which of the customer's Create order trainings
 * (order_trainings) are for this job, by the words its "Use it when the job says" lists (whole words,
 * any case) in the job's subject or text. A customer with training and no words: every job of theirs.
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const activity = new URL(req.url).searchParams.get("activity") || "";
  if (!/^[0-9a-f-]{36}$/i.test(activity)) return NextResponse.json({ applies: false });
  const admin = createAdminClient();
  const { data: a } = await admin.from("activities").select("customer_id, subject, body").eq("id", activity).maybeSingle();
  if (!a?.customer_id) return NextResponse.json({ applies: false });
  const [ts, { data: c }] = await Promise.all([
    customerTrainings(admin, a.customer_id as string),
    admin.from("customers").select("company, name").eq("id", a.customer_id).maybeSingle(),
  ]);
  const text = ` ${a.subject || ""} ${String(a.body || "").slice(0, 4000)} `;
  const hit = trainingsForText(ts, text);
  const cust = String(c?.company || c?.name || "");
  return NextResponse.json({ applies: hit.length > 0, customer: cust, name: hit.map((t) => t.name).filter(Boolean).join(" / ") || cust });
}
