import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";

/**
 * Proofs and art approval (rebuilt Oct 16, Nick: "Version one is the first version we sent to the client").
 *
 * - A Mockup Creator save is a mockup (the mockups table), never a proof. Mockup history shows every save.
 * - Sending makes the proofs: the order's current mockups become the next version (1, 2, 3…), emailed to the customer.
 *   The version before steps aside (archived, still in the proof history).
 * - The customer opening the proof (portal order page or review page) is recorded on the live proofs.
 * - "Approved another way" (a call, an email, in person) overrides everything: the live proofs are approved, or, when
 *   nothing was sent, the current mockups become an approved version. The proof history, Separations, the order
 *   checklist and the customer's portal all read the proofs, so they agree.
 */

type Staff = { email: string; name: string };
type Mockup = { id: string; title: string; file_path: string; group_id: string | null; created_at: string };

async function load(admin: SupabaseClient, orderId: string) {
  const { data: order } = await admin.from("orders").select("id, number, nickname, status, customer_id").eq("id", orderId).maybeSingle();
  if (!order) throw new Error("Order not found.");
  const { data: customer } = order.customer_id ? await admin.from("customers").select("id, name, company, email").eq("id", order.customer_id).maybeSingle() : { data: null };
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return { order, customer: customer as { id: string; name: string; company: string; email: string } | null, settings: mergeSettings(s?.data) };
}

/** The order's current mockups (one per garment per group), oldest first. */
async function currentMockups(admin: SupabaseClient, orderId: string) {
  const { data } = await admin.from("mockups").select("id, title, file_path, group_id, created_at").eq("order_id", orderId).is("archived_at", null).order("created_at");
  return (data || []) as Mockup[];
}

/** The proofs out with the customer now (the latest version), and the next version number. */
async function liveProofs(admin: SupabaseClient, orderId: string) {
  const { data } = await admin.from("proofs").select("id, mockup_id, version, status").eq("order_id", orderId).not("version", "is", null).order("version");
  const all = (data || []) as { id: string; mockup_id: string | null; version: number; status: string }[];
  const { data: live } = await admin.from("proofs").select("id, mockup_id, version, status").eq("order_id", orderId).not("version", "is", null).is("archived_at", null);
  return { live: (live || []) as typeof all, next: (all.length ? Math.max(...all.map((p) => p.version)) : 0) + 1 };
}

/** The current mockups become proofs (the next version), with the version before archived. */
async function makeVersion(admin: SupabaseClient, orderId: string, mocks: Mockup[], extra: Record<string, unknown>) {
  const { live, next } = await liveProofs(admin, orderId);
  const at = new Date().toISOString();
  if (live.length) await admin.from("proofs").update({ archived_at: at }).in("id", live.map((p) => p.id));
  const rows = mocks.map((m) => ({ order_id: orderId, title: m.title, file_path: m.file_path, file_type: "image/png", version: next, mockup_id: m.id, ...extra }));
  const { data: made, error } = await admin.from("proofs").insert(rows).select("id, mockup_id");
  if (error) throw new Error(error.message);
  for (const p of (made || []) as { id: string; mockup_id: string }[]) await admin.from("mockups").update({ proof_id: p.id }).eq("id", p.mockup_id);
  return next;
}

const proofEmail = (shop: string, number: number, nickname: string, link: string, reminder: boolean) => ({
  subject: reminder ? `Reminder: your artwork proof for order #${number}` : `Artwork proof ready for order #${number}`,
  html: emailLayout(shop, reminder ? "Your artwork proof is waiting for you" : "Your artwork proof is ready",
    `Please look over the proof for "${nickname || "your order"}" and approve it or tell us what to change. We start printing once it's approved.`, "Review artwork", link),
});

/** Send the current mockups to the customer as the next proof version. */
export async function sendProofs(admin: SupabaseClient, orderId: string, me: Staff) {
  const { order, customer, settings } = await load(admin, orderId);
  if (!customer?.email) return { ok: false as const, error: "This order's customer has no email address." };
  if (order.status === "quote") return { ok: false as const, error: "Send the quote first so the customer can see this order." };
  const mocks = await currentMockups(admin, orderId);
  if (!mocks.length) return { ok: false as const, error: "Make a mockup in the Mockup Creator first." };
  const { live } = await liveProofs(admin, orderId);
  const same = live.length === mocks.length && mocks.every((m) => live.some((p) => p.mockup_id === m.id));
  if (same && live.some((p) => p.status === "pending")) return { ok: false as const, error: "The customer already has this version. Use Remind instead." };
  const at = new Date().toISOString();
  const version = await makeVersion(admin, orderId, mocks, { sent_at: at, sent_to: customer.email });
  await admin.from("order_events").insert({ order_id: orderId, kind: "proofs_requested", detail: `Version ${version} to ${customer.email}`, actor: me.email });
  const link = `${siteUrl()}/portal/orders/${orderId}#proofs`;
  const emailed = await sendEmail({ to: customer.email, replyTo: SHOP_NOTIFY_EMAIL, ...proofEmail(settings.shop.name, order.number, order.nickname, link, false) });
  return { ok: true as const, version, emailed, link };
}

/** Remind the customer to review the proof that's waiting on them. */
export async function remindProofs(admin: SupabaseClient, orderId: string, me: Staff) {
  const { order, customer, settings } = await load(admin, orderId);
  if (!customer?.email) return { ok: false as const, error: "This order's customer has no email address." };
  const { live } = await liveProofs(admin, orderId);
  const waiting = live.filter((p) => p.status === "pending");
  if (!waiting.length) return { ok: false as const, error: "No proof is waiting on the customer." };
  const at = new Date().toISOString();
  await admin.from("proofs").update({ reminded_at: at }).in("id", waiting.map((p) => p.id));
  await admin.from("order_events").insert({ order_id: orderId, kind: "proof_reminder", detail: `Version ${waiting[0].version} to ${customer.email}`, actor: me.email });
  const link = `${siteUrl()}/portal/orders/${orderId}#proofs`;
  const emailed = await sendEmail({ to: customer.email, replyTo: SHOP_NOTIFY_EMAIL, ...proofEmail(settings.shop.name, order.number, order.nickname, link, true) });
  return { ok: true as const, emailed };
}

/**
 * The customer approved the art another way (a call, an email, in person). Overrides everything: the live proofs are
 * approved whatever they said before; with no proof sent, the current mockups become an approved version.
 */
export async function approveAnotherWay(admin: SupabaseClient, orderId: string, me: Staff, note: string) {
  const how = note.trim().slice(0, 300);
  if (how.length < 4) return { ok: false as const, error: "Say how the customer approved it (a call, an email…)." };
  const at = new Date().toISOString(), name = `${me.name} (${how})`.slice(0, 200);
  const { live } = await liveProofs(admin, orderId);
  const mocks = await currentMockups(admin, orderId);
  // the art they approved is the current mockup: when it's newer than what was sent, it becomes the approved version
  const sentCurrent = mocks.length > 0 && mocks.every((m) => live.some((p) => p.mockup_id === m.id));
  if (live.length && (sentCurrent || !mocks.length)) {
    await admin.from("proofs").update({ status: "approved", approved_via: "staff", decided_at: at, decided_name: name }).in("id", live.map((p) => p.id));
  } else if (mocks.length) {
    await makeVersion(admin, orderId, mocks, { status: "approved", approved_via: "staff", decided_at: at, decided_name: name });
  }
  await admin.from("order_events").insert({ order_id: orderId, kind: "art_approved", detail: `${me.name}: ${how}`, actor: me.email });
  return { ok: true as const };
}

/** The customer opened their proof (portal order page or review page): first time, last time, how many times. */
export async function proofViewed(admin: SupabaseClient, orderId: string, proofId?: string) {
  let q = admin.from("proofs").select("id, viewed_at, view_count").eq("order_id", orderId).not("version", "is", null).is("archived_at", null);
  if (proofId) q = q.eq("id", proofId);
  const { data } = await q;
  const at = new Date().toISOString();
  for (const p of (data || []) as { id: string; viewed_at: string | null; view_count: number }[])
    await admin.from("proofs").update({ viewed_at: p.viewed_at || at, last_viewed_at: at, view_count: (p.view_count || 0) + 1 }).eq("id", p.id);
}
