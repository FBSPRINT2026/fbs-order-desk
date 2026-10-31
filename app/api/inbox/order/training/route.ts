import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create order → "I spotted a Nine18 · All My Sons order: make it with the rules?" (Oct 30, Nick: "a little pop-up…
 * I detected this is 918 All My Sons order. Would you like me to enter this with the rules?… it's going to trump
 * everything in the create orders"). GET ?activity=<email or ClickUp job>: whether the customer's Create order training
 * (customer_private.order_training) is for this job, by the words its "Use it when the job says" lists (whole words,
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
  const [{ data: p }, { data: c }] = await Promise.all([
    admin.from("customer_private").select("order_training, order_training_name, order_training_when").eq("customer_id", a.customer_id).maybeSingle(),
    admin.from("customers").select("company, name").eq("id", a.customer_id).maybeSingle(),
  ]);
  const training = String(p?.order_training || "").trim();
  if (!training) return NextResponse.json({ applies: false });
  const words = String(p?.order_training_when || "").split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean);
  const text = ` ${a.subject || ""} ${String(a.body || "").slice(0, 4000)} `;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const hit = !words.length || words.some((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`, "i").test(text));
  return NextResponse.json({ applies: hit, customer: c?.company || c?.name || "", name: String(p?.order_training_name || "").trim() || c?.company || c?.name || "" });
}
