"use server";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";
import { carrierOf, supplierLabel } from "@/lib/goods";
import { cleanAttachments, type Attachment } from "@/lib/messages";
import { startTracker } from "@/lib/goodsTrack";
import { getPortalCtx } from "@/lib/portal";
import { linkByHand } from "@/lib/manifest";

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
    const carrier = (t.carrier || carrierOf(tracking)).slice(0, 40);
    const { data: row, error } = await admin.from("goods_shipments").insert({
      order_id: orderId, carrier, tracking, boxes: t.boxes && t.boxes > 0 ? Math.min(9999, Math.round(t.boxes)) : null,
      eta: t.eta && /^\d{4}-\d{2}-\d{2}$/.test(t.eta) ? t.eta : null, note, files, added_by: "customer", author_name: who,
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    // start live tracking right away (status, estimated delivery)
    if (tracking && row) { const f = await startTracker(tracking, carrier).catch(() => null); if (f) await admin.from("goods_shipments").update(f).eq("id", row.id); }
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

export type GoodsInfo = { supplier: string; supplier_po: string; ship_date: string | null };

/**
 * Where the goods for a wholesale order are coming from (SanMar, S&S Activewear, other), the supplier order #
 * and when it ships. All optional; it's posted in the order's goods conversation so both sides see it.
 */
export async function saveGoodsInfo(orderId: string, g: GoodsInfo): Promise<Result> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview. Customers fill this in from their own login." };
    const { data: o } = await supabase.from("orders").select("id, number, customer_id").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false, error: "We couldn't find that order." };
    const admin = createAdminClient();
    const supplier = (g.supplier || "").trim().slice(0, 60), po = (g.supplier_po || "").trim().slice(0, 60);
    const ship = g.ship_date && /^\d{4}-\d{2}-\d{2}$/.test(g.ship_date) ? g.ship_date : null;
    const { data: prev } = await admin.from("order_goods").select("supplier, supplier_po, ship_date").eq("order_id", orderId).maybeSingle();
    if (prev && prev.supplier === supplier && prev.supplier_po === po && (prev.ship_date || null) === ship) return { ok: true };
    const { error } = await admin.from("order_goods").upsert({ order_id: orderId, supplier, supplier_po: po, ship_date: ship, updated_by: email, updated_at: new Date().toISOString() }, { onConflict: "order_id" });
    if (error) return { ok: false, error: error.message };
    if (!supplier && !po && !ship && !prev) { revalidatePath("/portal"); return { ok: true }; } // nothing to say yet: the goods record just exists
    const { data: cust } = await admin.from("customers").select("name, company").eq("id", o.customer_id).maybeSingle();
    const parts = [supplier ? `coming from ${supplierLabel(supplier)}` : "supplier not known yet", po && `order/PO ${po}`, ship && `ships ${new Date(ship + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`].filter(Boolean);
    await admin.from("messages").insert({ order_id: orderId, topic: "goods", author_type: "customer", author_email: email, author_name: cust?.name || email, body: `📦 Goods for #${o.number}: ${parts.join(" · ")}.` });
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/** "These goods are for my order #…": the customer links an incoming shipment (not on an order yet) to their order. */
export async function linkIncoming(pick: { lineId: string; orderId: string }[]): Promise<Result> {
  try {
    const ctx = await getPortalCtx();
    if (ctx.isStaff || ctx.preview) return { ok: false, error: "This is a preview. Customers link goods from their own login." };
    if (!ctx.customerIds.length || !pick.length) return { ok: false, error: "Pick your order." };
    await linkByHand(createAdminClient(), pick, ctx.email || "customer", ctx.customerIds);
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export type ShipmentRead = { vendor: string; orderNo: string; carrier: string; tracking: string[]; boxes: number | null; eta: string; what: string; orderId: string; why: string };
/**
 * "Shipping us something?": a dropped or pasted order confirmation / shipping email from any vendor (One Stop, Peter
 * Millar, a store…) read into the form (Nov 2, Nick: "drag and drop… read it and say, hey, this is coming… tell me what
 * order it is"): the vendor and its order number, carrier and tracking, boxes, when it comes, what's in it, and which of
 * their open orders it's for (by PO, name or the garments). Nothing is saved: they check it and press Tell us.
 * The file was put in storage first with portalAttachUrl (messages/<their customer id>/…).
 */
export async function readShipmentPaper(input: { path?: string; name?: string; type?: string; text?: string; orders: { id: string; label: string }[] }): Promise<{ ok: boolean; error?: string; read?: ShipmentRead }> {
  try {
    const ctx = await getPortalCtx();
    if (ctx.isStaff || ctx.preview) return { ok: false, error: "This is a preview." };
    const admin = createAdminClient();
    const text = String(input.text || "").trim().slice(0, 8000);
    const path = String(input.path || "");
    if (path && !ctx.customerIds.some((id) => path.startsWith(`messages/${id}/`))) return { ok: false, error: "We couldn't open that file." };
    if (!path && text.length < 5) return { ok: false, error: "Drop a file or paste the email." };
    const { aiState, askClaude } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: false, error: "We couldn't read it here. Fill in what you can and we'll take it from there." };
    const images: { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }[] = [], documents: { data: string }[] = [];
    if (path) {
      const { data: blob } = await admin.storage.from("proofs").download(path);
      if (!blob) return { ok: false, error: "We couldn't open that file." };
      const buf = Buffer.from(await blob.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return { ok: false, error: "That file is too big to read here." };
      const t = (input.type || blob.type || "").toLowerCase(), nm = String(input.name || path);
      if (/pdf/.test(t) || /\.pdf$/i.test(nm)) documents.push({ data: buf.toString("base64") });
      else if (/^image\/(jpeg|png|gif|webp)/.test(t)) images.push({ media_type: t.replace("jpg", "jpeg") as "image/jpeg", data: buf.toString("base64") });
      else return { ok: false, error: "Drop a PDF or a picture (or paste the email's words)." };
    }
    const orders = (input.orders || []).slice(0, 60);
    const mine = new Set(orders.map((o) => o.id));
    const r = await askClaude<{ vendor: string; order_no: string; carrier: string; tracking: string[]; boxes: number | null; eta: string; what: string; order_id: string; why: string }>({
      task: "goods_paper_portal", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 600, admin, ctx: { by: ctx.email || "customer", customer_id: ctx.customerIds[0] }, timeoutMs: 40_000, images, documents,
      tool: { name: "shipment", description: "What this paperwork says about goods on their way to the print shop.", input_schema: { type: "object", required: ["vendor", "order_no", "carrier", "tracking", "boxes", "eta", "what", "order_id", "why"], properties: {
        vendor: { type: "string", description: "Who is shipping or selling the goods: One Stop, Peter Millar, SanMar, a store… Empty when not said." },
        order_no: { type: "string", description: "The vendor's order or confirmation number, or the PO on it. Empty when none." },
        carrier: { type: "string", description: "UPS, FedEx, USPS, DHL, a freight line… Empty when not said." },
        tracking: { type: "array", items: { type: "string" }, description: "Every tracking (or PRO) number, no spaces. Empty when none yet." },
        boxes: { type: ["integer", "null"], description: "How many boxes / cartons, when said." },
        eta: { type: "string", description: "Expected delivery date YYYY-MM-DD, or empty." },
        what: { type: "string", description: "What's in it in a few words: quantity, style, color (\"300 Bella 3001 Black, 120 Richardson 112\")." },
        order_id: { type: "string", description: "The id of the order below these goods are for, by its PO, name or garments. Empty when you can't tell." },
        why: { type: "string", description: "In a few words, why that order (\"PO DH-JLY on it\", \"same garments\"). Empty when no order." } } } },
      system: `A customer of FBS Print (a print shop) is telling the shop that goods (blank garments, hats…) are on their way. Read their paperwork and pull out only what it says; never invent numbers. Their open orders at the shop:\n${orders.map((o) => `- id ${o.id}: ${o.label}`).join("\n") || "(none)"}\nToday is ${new Date().toISOString().slice(0, 10)}.`,
      prompt: text || "Read the attached paperwork.",
    });
    if (!r.ok) return { ok: false, error: "We couldn't read it. Fill in what you can and we'll take it from there." };
    const d = r.data;
    return { ok: true, read: { vendor: d.vendor || "", orderNo: d.order_no || "", carrier: d.carrier || "", tracking: (d.tracking || []).map((x) => String(x).replace(/\s+/g, "")).filter(Boolean).slice(0, 40), boxes: d.boxes && d.boxes > 0 ? Math.round(d.boxes) : null, eta: /^\d{4}-\d{2}-\d{2}$/.test(d.eta || "") ? d.eta : "", what: d.what || "", orderId: mine.has(d.order_id) ? d.order_id : "", why: d.why || "" } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't read it." }; }
}
