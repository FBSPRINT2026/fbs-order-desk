"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { mergeSettings } from "@/lib/pricing";
import { carrierOf, GOODS, ISSUES, type GoodsItem, type GoodsStatus, type IssueType } from "@/lib/goods";
import { loadGoodsItems } from "@/lib/goodsServer";
import type { TrackingInput } from "@/app/portal/goods-actions";

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}

/** Goods for these orders (shop view). */
export async function shopGoods(orderIds: string[]): Promise<{ ok: boolean; error?: string; items?: GoodsItem[] }> {
  try {
    await staff();
    const admin = createAdminClient();
    const { data: os } = orderIds.length ? await admin.from("orders").select("id, number, nickname, status, due_date, qty").in("id", orderIds.slice(0, 300)) : { data: [] };
    return { ok: true, items: await loadGoodsItems(admin, (os || []) as never, "staff", (id) => `/shop/orders/${id}`) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/**
 * Set the goods status. Arrived, received and issues are posted in the order's goods conversation
 * (so the customer sees them in their portal) and emailed to the customer.
 */
export async function setGoods(orderId: string, status: GoodsStatus, issueType: IssueType = "", issueNote = "", tell = true): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  try {
    const { email } = await staff();
    if (!GOODS[status]) return { ok: false, error: "Unknown status." };
    const admin = createAdminClient();
    const it = status === "issue" ? issueType || "other" : "";
    const note = status === "issue" || status === "partial" ? issueNote.trim().slice(0, 2000) : "";
    const { error } = await admin.from("order_goods").upsert({ order_id: orderId, status, issue_type: it, issue_note: note, updated_by: email, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: error.message };
    if (!tell || !["arrived", "partial", "received", "issue"].includes(status)) return { ok: true };
    const [{ data: o }, { data: s }] = await Promise.all([
      admin.from("orders").select("id, number, nickname, customer_id, status").eq("id", orderId).single(),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const shop = mergeSettings(s?.data).shop.name;
    const body = status === "issue"
      ? `⚠️ There's an issue with the goods for #${o.number}: ${ISSUES[it as Exclude<IssueType, "">] || "see note"}.${note ? `\n\n${note}` : ""}\n\nPlease reply here so we can sort it out.`
      : status === "received" ? `✅ All the goods for #${o.number} are checked in. We're ready to print.`
      : status === "partial" ? `📦 Part of the goods for #${o.number} arrived. We're waiting on the rest.${note ? `\n\n${note}` : ""}`
      : `📦 The goods for #${o.number} arrived. We're checking them in now.`;
    await admin.from("messages").insert({ order_id: orderId, topic: "goods", author_type: "staff", author_email: email, author_name: shop, body });
    let emailed = false;
    const { data: c } = o.customer_id ? await admin.from("customers").select("email").eq("id", o.customer_id).maybeSingle() : { data: null };
    if (c?.email && (status === "issue" || status === "received")) {
      emailed = await sendEmail({ to: c.email, replyTo: SHOP_NOTIFY_EMAIL, subject: status === "issue" ? `Issue with the goods for order #${o.number}` : `Goods received for order #${o.number}`,
        html: emailLayout(shop, status === "issue" ? `An issue with your goods for #${o.number}` : `Goods received for #${o.number}`, body, "Open your portal", `${siteUrl()}/portal?area=messages&c=${orderId}:goods`) });
    }
    return { ok: true, emailed };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Staff record tracking the customer gave by phone or email. */
export async function staffAddTracking(orderId: string, t: TrackingInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const { email } = await staff();
    const admin = createAdminClient();
    const tracking = (t.tracking || "").trim().slice(0, 80);
    if (!tracking && !t.note?.trim()) return { ok: false, error: "Add a tracking number or a note." };
    const { error } = await admin.from("goods_shipments").insert({ order_id: orderId, carrier: (t.carrier || carrierOf(tracking)).slice(0, 40), tracking, boxes: t.boxes && t.boxes > 0 ? Math.round(t.boxes) : null,
      eta: t.eta && /^\d{4}-\d{2}-\d{2}$/.test(t.eta) ? t.eta : null, note: (t.note || "").trim().slice(0, 2000), files: [], added_by: "staff", author_name: email });
    if (error) return { ok: false, error: error.message };
    const { data: g } = await admin.from("order_goods").select("status").eq("order_id", orderId).maybeSingle();
    if (!g || g.status === "waiting") await admin.from("order_goods").upsert({ order_id: orderId, status: "on_way", updated_by: email, updated_at: new Date().toISOString() });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
