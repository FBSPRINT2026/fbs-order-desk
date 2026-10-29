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
  const { data: order } = await admin.from("orders").select("id, number, nickname, status, customer_id, groups").eq("id", orderId).maybeSingle();
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

/** what was changed on the customer's art, said in the proof email */
const artChangesOf = (o: { groups?: unknown }) => [...new Set(((o.groups || []) as { imprints?: { artChanges?: string[] }[] }[]).flatMap((g) => (g.imprints || []).flatMap((d) => d.artChanges || [])))].slice(0, 6);
/** the proof email with its link (lib/proofLinks.ts), sent; with send=false only made (the shop's preview) */
async function linkEmail(admin: SupabaseClient, x: { order: { id: string; number: number; nickname: string; groups?: unknown }; customer: { name: string; company: string; email: string }; settings: ReturnType<typeof mergeSettings>; version: number; mocks: Mockup[]; reminder: boolean; note: string; by: string; send?: boolean }) {
  const { proofLinkFor, proofUrl, proofEmail, proofRows, firstName } = await import("@/lib/proofLinks");
  const { data: full } = await admin.from("orders").select("*").eq("id", x.order.id).maybeSingle();
  const o = full as import("@/lib/pricing").Order;
  const url = x.send === false ? `${siteUrl()}/proof/preview` : proofUrl(await proofLinkFor(admin, { kind: "art", orderId: o.id, version: x.version, to: x.customer.email, by: x.by }));
  const m0 = x.mocks[0];
  const { data: su } = m0 ? await admin.storage.from("proofs").createSignedUrl(String(m0.file_path).replace(/\.png$/, "-thumb.png"), 60 * 60 * 24 * 30) : { data: null };
  const em = proofEmail({ settings: x.settings, first: firstName(x.customer), kind: "art", o, picture: su?.signedUrl || undefined, rows: proofRows(o, "art"), url, reminder: x.reminder, note: x.note });
  if (x.send === false) return { url, emailed: false, ...em };
  const emailed = await sendEmail({ to: x.customer.email, replyTo: SHOP_NOTIFY_EMAIL, subject: em.subject, html: em.html });
  return { url, emailed, ...em };
}

/** What sending the proof would email (the shop's preview before Send): the subject, the email, who it goes to. */
export async function previewProofEmail(admin: SupabaseClient, orderId: string, note = "") {
  const { order, customer, settings } = await load(admin, orderId);
  const mocks = await currentMockups(admin, orderId);
  const { next } = await liveProofs(admin, orderId);
  const lk = await linkEmail(admin, { order, customer: customer || { name: "", company: "", email: "" }, settings, version: next, mocks, reminder: false, note: [...(note.trim() ? [note.trim()] : []), ...artChangesOf(order)].join("\n"), by: "", send: false });
  return { to: customer?.email || "", subject: lk.subject, html: lk.html, version: next, mockups: mocks.length };
}

/** Send the current mockups to the customer as the next proof version. */
export async function sendProofs(admin: SupabaseClient, orderId: string, me: Staff, /** what we changed on their art (Oct 24, Nick: "we've got to say what we did to it") */ note = "",
  /** email: false = make the proof and its link without emailing (Oct 29, Nick: "copy a link… so I can just type an email
   *  and go, hey, here's your proof, and then just click the button below") */ opts: { email?: boolean } = {}) {
  const email = opts.email !== false;
  const { order, customer, settings } = await load(admin, orderId);
  if (email && !customer?.email) return { ok: false as const, error: "This order's customer has no email address." };
  const mocks = await currentMockups(admin, orderId);
  if (!mocks.length) return { ok: false as const, error: "Make a mockup in the Mockup Creator first." };
  const { live } = await liveProofs(admin, orderId);
  const same = live.length === mocks.length && mocks.every((m) => live.some((p) => p.mockup_id === m.id));
  const { proofLinkFor, proofUrl } = await import("@/lib/proofLinks");
  if (same && live.some((p) => p.status === "pending")) {
    if (email) return { ok: false as const, error: "The customer already has this version. Use Remind instead." };
    // the version already out: its link again
    const v = live[0].version;
    return { ok: true as const, version: v, emailed: false, link: proofUrl(await proofLinkFor(admin, { kind: "art", orderId, version: v, by: me.email })) };
  }
  const at = new Date().toISOString();
  const to = email ? customer!.email : customer?.email || "";
  const version = await makeVersion(admin, orderId, mocks, { sent_at: at, sent_to: email ? to : "link copied" });
  await admin.from("order_events").insert({ order_id: orderId, kind: "proofs_requested", detail: `Version ${version} ${email ? `to ${to}` : "(link copied to send yourself)"}${note.trim() ? `: ${note.trim().slice(0, 200)}` : ""}`, actor: me.email });
  // what we changed goes with the proof: in their Messages on the order, and in the email
  if (note.trim()) await admin.from("messages").insert({ order_id: orderId, author_type: "staff", author_email: me.email, author_name: settings.shop.name, body: `Proof version ${version}: ${note.trim().slice(0, 2000)}` });
  if (!email) return { ok: true as const, version, emailed: false, link: proofUrl(await proofLinkFor(admin, { kind: "art", orderId, version, to, by: me.email })) };
  // the customer's proof link (lib/proofLinks.ts): their page with the PDF, approve or ask for changes, no sign-in
  const lk = await linkEmail(admin, { order, customer: customer!, settings, version, mocks, reminder: false, note: [...(note.trim() ? [note.trim()] : []), ...artChangesOf(order)].join("\n"), by: me.email });
  return { ok: true as const, version, emailed: lk.emailed, link: lk.url };
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
  const lk = await linkEmail(admin, { order, customer, settings, version: waiting[0].version, mocks: await currentMockups(admin, orderId), reminder: true, note: "", by: me.email });
  return { ok: true as const, emailed: lk.emailed };
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
