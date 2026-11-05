import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailButton, sendEmail, siteUrl } from "@/lib/email";

/**
 * The shop's emails about something a customer did on an order (Nov 5, Nick: "these emails… your proof is approved and,
 * customer wants to make a change, but they're generic… say like Logotology wants to make a change on order 367…
 * maybe even… a little picture"). One email for all of them: the subject names the company, what they did and the order
 * ("Logotology wants changes · #40481 Spring tees"); the email shows the order's mockup picture beside the company, order
 * # and job name, then what they wrote, and a button to the order.
 */
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function orderCard(admin: SupabaseClient, orderId: string) {
  const { data: o } = await admin.from("orders").select("number, nickname, customer_id, po_number").eq("id", orderId).maybeSingle();
  const { data: c } = o?.customer_id ? await admin.from("customers").select("company, name").eq("id", o.customer_id).maybeSingle() : { data: null };
  const { data: mk } = await admin.from("mockups").select("file_path").eq("order_id", orderId).is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const path = mk?.file_path ? String(mk.file_path) : "";
  const { data: su } = path ? await admin.storage.from("proofs").createSignedUrl(/\.png$/i.test(path) ? path.replace(/\.png$/i, "-thumb.png") : path, 60 * 60 * 24 * 30) : { data: null };
  return {
    number: o?.number as number | undefined, job: String(o?.nickname || ""), po: String(o?.po_number || ""),
    company: String(c?.company || c?.name || "A customer"), pic: su?.signedUrl || "",
  };
}

/** e.g. notifyShopAbout(admin, id, { did: "wants changes", head: "…", body: "…" }) */
export async function notifyShopAbout(admin: SupabaseClient, orderId: string, x: { did: string; head?: string; body: string; shopName: string; to?: string; button?: string }) {
  const to = x.to || SHOP_NOTIFY_EMAIL;
  if (!to) return false;
  const k = await orderCard(admin, orderId).catch(() => null);
  const num = k?.number ? `#${k.number}` : "an order";
  const subject = `${k?.company || "A customer"} ${x.did} · ${num}${k?.job ? ` ${k.job}` : ""}`.slice(0, 180);
  const url = `${siteUrl()}/shop/orders/${orderId}`;
  const card = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #E3E7EE;border-radius:10px;margin:0 0 16px"><tr>
    ${k?.pic ? `<td style="width:96px;padding:10px"><img src="${esc(k.pic)}" alt="" width="84" style="display:block;width:84px;height:auto;border-radius:6px;background:#F4F5F7"></td>` : ""}
    <td style="padding:10px 14px;font-size:14px;line-height:1.4;color:#141D2B"><div style="font-weight:700">${esc(k?.company || "")}</div>
    <div style="color:#3C475A">Order ${esc(num)}${k?.job ? ` · ${esc(k.job)}` : ""}</div>${k?.po ? `<div style="color:#7A8599;font-size:12px">PO ${esc(k.po)}</div>` : ""}</td></tr></table>`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#141D2B">
  <div style="font-weight:800;font-size:18px;letter-spacing:.02em;margin-bottom:14px">${esc(x.shopName)}</div>
  <h1 style="font-size:20px;margin:0 0 12px">${esc(x.head || `${k?.company || "A customer"} ${x.did}`)}</h1>
  ${card}
  <div style="font-size:15px;line-height:1.5;color:#3C475A;white-space:pre-line">${esc(x.body)}</div>
  <div style="margin:22px 0">${emailButton(url, x.button || "Open order", "#0A7BA6").replace('align="center" style="margin:0 auto"', 'style="margin:0"')}</div>
</div>`;
  return sendEmail({ to, subject, html });
}
