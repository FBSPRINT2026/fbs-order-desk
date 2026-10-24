import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, orderGroups, type Order } from "@/lib/pricing";

/**
 * Sew-out approval (Oct 24, Nick: "we sent it off to get digitized and then… we do a sew out, like a physical, so we
 * have to send them a picture of what it looks like… when our embroidery team does the sew out and they take a picture,
 * automatically send an email for approval… crop it and say here's your sew out… put it on a PDF that has approval like
 * our proof approval does now, then you approve that, on file for future reference").
 *
 * - Maria takes the photo (Digitizing), crops it, and saving it sends it: the customer gets an email with the photo and a
 *   link to approve it (Nick picked "send right away"; it's sent by her click, so the customer-contact switch is kept).
 * - A newer photo of the same print is the next version; the one before steps aside (archived, still in the history).
 * - The customer approves (typing their name) or asks for changes; the shop hears either way. "Approved another way"
 *   records a call or an email.
 * - An approved sew-out is kept on the logo (designs.specs.embroidery.sewout), so every reorder has it on file.
 */
type Staff = { email: string; name: string };
export type Sewout = {
  id: string; order_id: string; imprint_id: string; design_id: string | null; version: number; photo_path: string; raw_path: string | null; note: string;
  sent_at: string | null; sent_to: string | null; viewed_at: string | null; last_viewed_at: string | null; view_count: number;
  status: "pending" | "approved" | "changes"; decided_at: string | null; decided_name: string | null; customer_comment: string; approved_via: string;
  created_by: string; created_at: string; archived_at: string | null;
};

async function load(admin: SupabaseClient, orderId: string) {
  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("Order not found.");
  const o = order as Order;
  const { data: customer } = o.customer_id ? await admin.from("customers").select("id, name, company, email").eq("id", o.customer_id).maybeSingle() : { data: null };
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return { o, customer: customer as { id: string; name: string; company: string; email: string } | null, settings: mergeSettings(s?.data) };
}

/** the print a sew-out is for, and its logo's name */
export function printOf(o: Order, imprintId: string) {
  for (const g of orderGroups(o)) for (const im of g.imprints || []) if (im.id === imprintId) return { g, im };
  return null;
}

/** Save a sew-out photo as the print's next version and email it to the customer for approval. */
export async function sendSewout(admin: SupabaseClient, x: { orderId: string; imprintId: string; photoPath: string; rawPath?: string; note?: string }, me: Staff) {
  const { o, customer, settings } = await load(admin, x.orderId);
  const pr = printOf(o, x.imprintId);
  if (!pr) return { ok: false as const, error: "That print isn't on the order anymore." };
  const { data: prev } = await admin.from("sewouts").select("id, version, archived_at").eq("order_id", o.id).eq("imprint_id", x.imprintId);
  const rows = (prev || []) as { id: string; version: number; archived_at: string | null }[];
  const version = (rows.length ? Math.max(...rows.map((r) => r.version)) : 0) + 1;
  const at = new Date().toISOString();
  const live = rows.filter((r) => !r.archived_at);
  if (live.length) await admin.from("sewouts").update({ archived_at: at }).in("id", live.map((r) => r.id));
  const to = customer?.email || "";
  const { data: made, error } = await admin.from("sewouts").insert({
    order_id: o.id, imprint_id: x.imprintId, design_id: pr.im.design_id || null, version, photo_path: x.photoPath, raw_path: x.rawPath || null,
    note: (x.note || "").trim().slice(0, 1000), sent_at: to ? at : null, sent_to: to || null, created_by: me.email,
  }).select("id").single();
  if (error || !made) return { ok: false as const, error: error?.message || "Couldn't save the sew-out." };
  const where = `${pr.im.location}${pr.im.size ? `, ${pr.im.size}` : ""}`;
  await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_sent", detail: `Sew-out v${version} (${where})${to ? ` to ${to}` : ", not emailed: no customer email"}`, actor: me.email });
  if (!to) return { ok: true as const, id: made.id, version, emailed: false, error: "Saved, but this customer has no email address, so it wasn't sent." };
  const emailed = await emailSewout(admin, { o, to, shop: settings.shop.name, id: made.id, photoPath: x.photoPath, where, note: x.note || "", reminder: false });
  return { ok: true as const, id: made.id, version, emailed };
}

/** the email: the photo itself, what it is, and the button to approve it */
async function emailSewout(admin: SupabaseClient, p: { o: Order; to: string; shop: string; id: string; photoPath: string; where: string; note: string; reminder: boolean }) {
  const link = `${siteUrl()}/portal/orders/${p.o.id}/sewout/${p.id}`;
  // the photo stays viewable from the email for 30 days; the portal page always has it
  const { data: su } = await admin.storage.from("proofs").createSignedUrl(p.photoPath, 60 * 60 * 24 * 30);
  const body = `Here's the sew-out of your logo for "${p.o.nickname || `order #${p.o.number}`}" (${p.where}): the real thing, stitched on our machine. Please look it over and approve it, or tell us what to change. We start the run once it's approved.${p.note ? `\n\n${p.note}` : ""}`;
  const base = emailLayout(p.shop, p.reminder ? "Your sew-out is waiting for you" : "Your sew-out is ready to approve", body, "Review the sew-out", link);
  const photo = su?.signedUrl ? `<div style="max-width:520px;margin:0 auto;padding:0 24px"><a href="${link}"><img src="${su.signedUrl}" alt="Your sew-out" style="width:100%;border-radius:8px;border:1px solid #E3E7EE;display:block" /></a></div>` : "";
  // the photo goes right under the heading and text, before the button
  const html = photo ? base.replace(/<p style="margin:24px 0">/, `${photo}<p style="margin:24px 0">`) : base;
  return sendEmail({ to: p.to, replyTo: SHOP_NOTIFY_EMAIL, subject: `${p.reminder ? "Reminder: " : ""}Sew-out ready for your approval: order #${p.o.number}`, html });
}

/** Remind the customer to review the sew-out waiting on them. */
export async function remindSewout(admin: SupabaseClient, id: string, me: Staff) {
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", id).maybeSingle();
  const s = sw as Sewout | null;
  if (!s || s.archived_at) return { ok: false as const, error: "That sew-out was replaced by a newer one." };
  if (s.status !== "pending") return { ok: false as const, error: "The customer already answered." };
  const { o, customer, settings } = await load(admin, s.order_id);
  if (!customer?.email) return { ok: false as const, error: "This order's customer has no email address." };
  const pr = printOf(o, s.imprint_id);
  const where = pr ? `${pr.im.location}${pr.im.size ? `, ${pr.im.size}` : ""}` : "your logo";
  const emailed = await emailSewout(admin, { o, to: customer.email, shop: settings.shop.name, id: s.id, photoPath: s.photo_path, where, note: "", reminder: true });
  await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_reminder", detail: `Sew-out v${s.version} to ${customer.email}`, actor: me.email });
  return { ok: true as const, emailed };
}

/** An approved sew-out goes on file with the logo, for every reorder. */
async function keepOnLogo(admin: SupabaseClient, s: Sewout, name: string, number: number) {
  if (!s.design_id) return;
  const { data: d } = await admin.from("designs").select("specs").eq("id", s.design_id).maybeSingle();
  const sp = ((d?.specs || {}) as Record<string, unknown>), emb = (sp.embroidery || {}) as Record<string, unknown>;
  await admin.from("designs").update({ specs: { ...sp, embroidery: { ...emb, sewout: { id: s.id, path: s.photo_path, at: new Date().toISOString(), by: name, order: number, version: s.version } } } }).eq("id", s.design_id);
}

/** The customer's answer (from their portal): approved with their typed name, or changes with what to change. */
export async function decideSewout(admin: SupabaseClient, s: Sewout, o: Order, decision: "approved" | "changes", name: string, comment: string, actor: string) {
  if (s.archived_at) return { ok: false as const, error: "This sew-out was replaced by a newer one. Refresh the page." };
  if (s.status !== "pending") return { ok: false as const, error: "This sew-out was already reviewed. Refresh the page." };
  const who = name.trim().slice(0, 120), note = comment.trim().slice(0, 2000);
  if (decision === "approved" && who.length < 2) return { ok: false as const, error: "Type your full name to approve." };
  if (decision === "changes" && !note) return { ok: false as const, error: "Tell us what to change." };
  const at = new Date().toISOString();
  await admin.from("sewouts").update({ status: decision, customer_comment: note, decided_at: at, decided_name: who || actor, approved_via: decision === "approved" ? "customer" : "" }).eq("id", s.id);
  await admin.from("order_events").insert({ order_id: o.id, kind: decision === "approved" ? "sewout_approved" : "sewout_changes", detail: `Sew-out v${s.version}${note ? `: ${note.slice(0, 200)}` : ""}`, actor });
  if (decision === "approved") await keepOnLogo(admin, s, who, o.number);
  const { settings } = await load(admin, o.id);
  if (SHOP_NOTIFY_EMAIL) await sendEmail({
    to: SHOP_NOTIFY_EMAIL,
    subject: decision === "approved" ? `Sew-out approved on #${o.number}` : `Sew-out changes on #${o.number}`,
    html: emailLayout(settings.shop.name, decision === "approved" ? `${who} approved the sew-out` : `${who || "The customer"} wants changes to the sew-out`, note || (decision === "approved" ? "Good to run." : "No comment."), "Open order", `${siteUrl()}/shop/orders/${o.id}`),
  });
  return { ok: true as const };
}

/** Approved another way (a call, an email, in person): the sew-out is approved and kept on file. */
export async function approveSewoutAnotherWay(admin: SupabaseClient, id: string, me: Staff, how: string) {
  const h = how.trim().slice(0, 300);
  if (h.length < 4) return { ok: false as const, error: "Say how the customer approved it (a call, an email…)." };
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", id).maybeSingle();
  const s = sw as Sewout | null;
  if (!s || s.archived_at) return { ok: false as const, error: "That sew-out was replaced by a newer one." };
  const { o } = await load(admin, s.order_id);
  const name = `${me.name} (${h})`.slice(0, 200);
  await admin.from("sewouts").update({ status: "approved", approved_via: "staff", decided_at: new Date().toISOString(), decided_name: name }).eq("id", s.id);
  await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_approved", detail: `Sew-out v${s.version}: ${me.name}: ${h}`, actor: me.email });
  await keepOnLogo(admin, s, name, o.number);
  return { ok: true as const };
}

/** The customer opened the sew-out page: first time, last time, how many times. */
export async function sewoutViewed(admin: SupabaseClient, id: string) {
  const { data } = await admin.from("sewouts").select("viewed_at, view_count").eq("id", id).maybeSingle();
  if (!data) return;
  const at = new Date().toISOString();
  await admin.from("sewouts").update({ viewed_at: data.viewed_at || at, last_viewed_at: at, view_count: (data.view_count || 0) + 1 }).eq("id", id);
}
