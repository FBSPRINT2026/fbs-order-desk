"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";
import { carrierOf } from "@/lib/goods";
import { cleanAttachments, type Attachment } from "@/lib/messages";

type Result = { ok: boolean; error?: string };
export type TrackingInput = { carrier: string; tracking: string; boxes: number | null; eta: string | null; note: string; files: Attachment[] };

/** A wholesale customer tells us goods are on the way: tracking, boxes, expected date, packing slip or photos. */
export async function addTracking(orderId: string, t: TrackingInput): Promise<Result> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview. Customers add tracking from their own login." };
    // row security: only their own orders come back
    const { data: o } = await supabase.from("orders").select("id, number, nickname, customer_id").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false, error: "We couldn't find that order." };
    const admin = createAdminClient();
    const { data: cust } = await admin.from("customers").select("id, name, company").eq("id", o.customer_id).maybeSingle();
    const tracking = (t.tracking || "").trim().slice(0, 80);
    const note = (t.note || "").trim().slice(0, 2000);
    const files = cleanAttachments(t.files, o.customer_id);
    if (!tracking && !note && !files.length) return { ok: false, error: "Add a tracking number, a note or a file." };
    const who = cust?.name || email;
    const { error } = await admin.from("goods_shipments").insert({
      order_id: orderId, carrier: (t.carrier || carrierOf(tracking)).slice(0, 40), tracking, boxes: t.boxes && t.boxes > 0 ? Math.min(9999, Math.round(t.boxes)) : null,
      eta: t.eta && /^\d{4}-\d{2}-\d{2}$/.test(t.eta) ? t.eta : null, note, files, added_by: "customer", author_name: who,
    });
    if (error) return { ok: false, error: error.message };
    // waiting → on the way
    const { data: g } = await admin.from("order_goods").select("status").eq("order_id", orderId).maybeSingle();
    if (!g || g.status === "waiting") await admin.from("order_goods").upsert({ order_id: orderId, status: "on_way", updated_by: email, updated_at: new Date().toISOString() });
    if (SHOP_NOTIFY_EMAIL) {
      const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const lines = [tracking && `Tracking: ${t.carrier || carrierOf(tracking) || ""} ${tracking}`.trim(), t.boxes ? `Boxes: ${t.boxes}` : "", t.eta ? `Expected: ${t.eta}` : "", note, files.length ? `${files.length} file${files.length === 1 ? "" : "s"} attached` : ""].filter(Boolean).join("\n");
      await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `Goods on the way for #${o.number} (${cust?.company || who})`, html: emailLayout(mergeSettings(s?.data).shop.name, `${who} sent goods for #${o.number}`, lines, "Open order", `${siteUrl()}/shop/orders/${orderId}`) });
    }
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
