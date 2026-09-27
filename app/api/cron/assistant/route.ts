import { NextResponse } from "next/server";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyDecisions, computeFollowUps, loadAssistantData } from "@/lib/crm/followups";
import { mergeSettings } from "@/lib/pricing";
import { aiState } from "@/lib/ai/claude";
import { processEmailActivity } from "@/lib/ai/email";
import { sendEmail, siteUrl } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Assistant's daily run (Vercel Cron, see vercel.json). Needs CRON_SECRET in Vercel;
// Vercel sends it as "Authorization: Bearer <CRON_SECRET>".
//   1. With AI on and "read emails" on: reads any stored emails it hasn't read yet.
//   2. With "daily digest" on: emails the shop today's follow-up list.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const admin = createAdminClient();
  const out: Record<string, unknown> = {};

  const st = await aiState(admin);
  if (st.ready && st.settings.assistant.ai.readEmails) {
    const { data: todo } = await admin.from("activities").select("id").eq("kind", "email").eq("direction", "in").is("ai_processed_at", null).order("occurred_at").limit(15);
    let n = 0;
    for (const a of todo || []) { const r = await processEmailActivity(admin, a.id as string); if (r.ok) n++; }
    out.emailsRead = n;
  }

  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);
  const data = await loadAssistantData(admin);
  const { data: dec } = await admin.from("ai_suggestions").select("dedupe_key,status,snoozed_until").eq("source", "rules").limit(5000);
  const { open } = applyDecisions(computeFollowUps(data, settings), (dec || []) as { dedupe_key: string | null; status: string; snoozed_until: string | null }[]);
  const { data: extra } = await admin.from("ai_suggestions").select("title,priority,order_id,customer_id").neq("source", "rules").eq("status", "open").limit(50);
  out.followUps = open.length;

  if (settings.assistant.digest && SHOP_NOTIFY_EMAIL && (open.length || extra?.length)) {
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const li = (title: string, href: string, body = "") => `<li style="margin:0 0 8px"><a href="${siteUrl()}${href}" style="color:#0A7BA6;font-weight:600;text-decoration:none">${esc(title)}</a>${body ? `<div style="color:#4A566B;font-size:13px">${esc(body)}</div>` : ""}</li>`;
    const sec = (h: string, items: string[]) => (items.length ? `<h2 style="font-size:15px;margin:18px 0 8px">${h}</h2><ul style="padding-left:18px;margin:0">${items.join("")}</ul>` : "");
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#141D2B">
      <div style="font-weight:800;font-size:18px;margin-bottom:6px">${esc(settings.shop.name)} · Today's follow-ups</div>
      <div style="color:#7A8599;font-size:13px">${open.length} from your orders${extra?.length ? `, ${extra.length} from the Assistant and your to-dos` : ""}</div>
      ${sec("Urgent", open.filter((x) => x.priority === 1).map((x) => li(x.title, x.href, x.body)))}
      ${sec("Today", open.filter((x) => x.priority === 2).map((x) => li(x.title, x.href, x.body)))}
      ${sec("Assistant & to-dos", (extra || []).map((x) => li(x.title as string, x.order_id ? `/shop/orders/${x.order_id}` : x.customer_id ? `/shop/customers/${x.customer_id}` : "/shop/assistant")))}
      ${sec("When you can", open.filter((x) => x.priority === 3).slice(0, 15).map((x) => li(x.title, x.href)))}
      <p style="margin:24px 0"><a href="${siteUrl()}/shop/assistant" style="background:#0A7BA6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block">Open the Assistant</a></p>
    </div>`;
    out.digest = await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `${open.filter((x) => x.priority === 1).length ? `${open.filter((x) => x.priority === 1).length} urgent · ` : ""}${open.length + (extra?.length || 0)} follow-ups today`, html });
  }
  return NextResponse.json({ ok: true, ...out });
}
