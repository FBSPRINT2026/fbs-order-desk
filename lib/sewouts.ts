import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings, orderGroups, type Order } from "@/lib/pricing";
import { SEWOUT_EMAILS } from "@/lib/customerContact";

/**
 * Sew-out approval (Oct 24, Nick: "we sent it off to get digitized and then… we do a sew out, like a physical, so we
 * have to send them a picture of what it looks like… when our embroidery team does the sew out and they take a picture,
 * automatically send an email for approval… crop it and say here's your sew out… put it on a PDF that has approval like
 * our proof approval does now, then you approve that, on file for future reference").
 *
 * - Maria takes the photo (Digitizing), crops it, says what was really sewn, and saves it. Saving never sends (Oct 29,
 *   Nick: "after you upload it and take a photo, that should switch to… PDF proof, download or send to customer"):
 *   Send to customer emails the photo and a link to approve it (sendSewoutNow), when SEWOUT_EMAILS is on.
 * - What was sewn talks back to the order (Oct 29, Nick: "we might not even have the thread in stock… select the real
 *   thread we used. It needs to go back and change it on the order form… all this stuff has to talk back"): the stitch
 *   file version sewn (size, stitches) and each thread sewn replace the print's on the order, and the change is written
 *   in the order's history and on the proof.
 * - A second, wider photo shows where it sits on the garment (placement_path).
 * - A newer photo of the same print is the next version; the one before steps aside (archived, still in the history).
 * - The customer approves (typing their name) or asks for changes; the shop hears either way. "Approved another way"
 *   records a call or an email.
 * - An approved sew-out is kept on the logo (designs.specs.embroidery.sewout), so every reorder has it on file.
 */
type Staff = { email: string; name: string };
/** what was really sewn: the stitch file (by its path among the logo's files) and each thread, ordered and sewn */
export type SewnInput = { filePath?: string; threads?: { needle?: number; ordered: string; sewn: string }[] };
export type SewnRecord = { file?: { path: string; name: string; v?: number; wIn: number; hIn: number; stitches: number; at?: string } | null; threads: { needle?: number; ordered: string; sewn: string }[] };
export type SewChange = { what: "thread" | "size" | "stitches" | "file"; from: string; to: string; needle?: number };
export type Sewout = {
  id: string; order_id: string; imprint_id: string; design_id: string | null; version: number; photo_path: string; raw_path: string | null; note: string;
  placement_path?: string | null; sewn?: SewnRecord | null; changes?: SewChange[] | null;
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

/** the width an order's size names ("6\" wide", "4.02 x 0.8", "3.5") */
const widthOf = (size: string | undefined) => { const m = /(\d+(?:\.\d+)?)/.exec(size || ""); return m ? +m[1] : null; };
const inch = (n: number) => `${Math.round(n * 100) / 100}"`;

/**
 * Save a sew-out photo as the print's next version, with what was really sewn, and make the order match it. Nothing is
 * sent: Send to customer (sendSewoutNow) does that.
 */
export async function saveSewout(admin: SupabaseClient, x: { orderId: string; imprintId: string; photoPath: string; rawPath?: string; placementPath?: string; note?: string; sewn?: SewnInput }, me: Staff) {
  const { o } = await load(admin, x.orderId);
  const pr = printOf(o, x.imprintId);
  if (!pr) return { ok: false as const, error: "That print isn't on the order anymore." };
  const { data: prev } = await admin.from("sewouts").select("id, version, archived_at").eq("order_id", o.id).eq("imprint_id", x.imprintId);
  const rows = (prev || []) as { id: string; version: number; archived_at: string | null }[];
  const version = (rows.length ? Math.max(...rows.map((r) => r.version)) : 0) + 1;
  const at = new Date().toISOString();

  const ap = await applySewn(admin, o, pr.im, x.sewn);
  if (!ap.ok) return ap;
  const { sewn, changes, patch } = ap, im = pr.im;

  const live = rows.filter((r) => !r.archived_at);
  if (live.length) await admin.from("sewouts").update({ archived_at: at }).in("id", live.map((r) => r.id));
  const { data: made, error } = await admin.from("sewouts").insert({
    order_id: o.id, imprint_id: x.imprintId, design_id: im.design_id || null, version, photo_path: x.photoPath, raw_path: x.rawPath || null,
    placement_path: x.placementPath || null, sewn, changes: changes.length ? changes : null,
    note: (x.note || "").trim().slice(0, 1000), created_by: me.email,
  }).select("id").single();
  if (error || !made) return { ok: false as const, error: error?.message || "Couldn't save the sew-out." };
  const where = `${im.location}${(patch.size || im.size) ? `, ${patch.size || im.size}` : ""}`;
  await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_saved", detail: `Sew-out v${version} (${where})${x.placementPath ? " with a placement photo" : ""}`, actor: me.email });
  if (changes.length) await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_changes", detail: `Changed to match the sew-out (${im.location}): ${changeWords(changes)}`.slice(0, 1000), actor: me.email });
  return { ok: true as const, id: made.id as string, version, changes };
}

/**
 * What was really sewn, made into the sew-out's record, and the order changed to match it (the stitch file version, its
 * size and stitches, each thread). Used by a new sew-out and by Edit on a saved one.
 */
async function applySewn(admin: SupabaseClient, o: Order, im: import("@/lib/pricing").Imprint, input: SewnInput | undefined) {
  const x = { sewn: input };
  // what was sewn: the file from the logo's versions (or the print's own), the threads as picked
  const { data: d } = im.design_id ? await admin.from("designs").select("specs").eq("id", im.design_id).maybeSingle() : { data: null };
  const { sewVersions } = await import("@/lib/digitizeStatus");
  const files = sewVersions(((d?.specs as { embroidery?: { files?: import("@/lib/digitizedFiles").DigitizedSet[] } } | null)?.embroidery?.files) || []);
  const file = (x.sewn?.filePath ? files.find((f) => f.path === x.sewn!.filePath) : null) || (im.emb?.file ? files.find((f) => f.path === im.emb!.file!.path) || { ...im.emb.file, v: 0 } : files[files.length - 1]) || null;
  const threads = (x.sewn?.threads || []).filter((t) => t.sewn?.trim()).map((t) => ({ needle: t.needle, ordered: t.ordered.trim().slice(0, 80), sewn: t.sewn.trim().slice(0, 80) }));
  const sewn: SewnRecord = { file: file ? { path: file.path, name: file.name, v: file.v || undefined, wIn: file.wIn, hIn: file.hIn, stitches: file.stitches, at: file.at } : null, threads };

  // the order follows what was sewn
  const changes: SewChange[] = [];
  for (const t of threads) if (t.sewn.toLowerCase() !== t.ordered.toLowerCase()) changes.push({ what: "thread", from: t.ordered, to: t.sewn, needle: t.needle });
  const patch: Partial<typeof im> = {};
  if (threads.length) {
    const inks = [...new Set(threads.map((t) => t.sewn))].join(", ");
    if (inks !== (im.inks || "")) patch.inks = inks;
  }
  if (file) {
    const w = widthOf(im.size);
    if (file.wIn && (w === null || Math.abs(w - file.wIn) > 0.05)) { changes.push({ what: "size", from: im.size || "not set", to: `${inch(file.wIn)} wide` }); patch.size = `${inch(file.wIn)} wide`; }
    if (file.stitches && file.stitches !== im.stitches) { changes.push({ what: "stitches", from: im.stitches ? im.stitches.toLocaleString() : "estimate", to: file.stitches.toLocaleString() }); patch.stitches = file.stitches; }
    if (im.emb?.file?.path !== file.path) {
      if (im.emb?.file) changes.push({ what: "file", from: im.emb.file.name, to: `${file.name}${file.v ? ` (version ${file.v})` : ""}` });
      const { v: _v, ...set } = file as typeof file & { v?: number }; void _v;
      patch.emb = { ...(im.emb || {}), stitchesFrom: "file", file: set as import("@/lib/digitizedFiles").DigitizedSet };
    } else if (patch.stitches) patch.emb = { ...(im.emb || {}), stitchesFrom: "file" };
  }
  if (Object.keys(patch).length) {
    const { data: fresh } = await admin.from("orders").select("groups").eq("id", o.id).maybeSingle();
    const groups = ((fresh?.groups || o.groups || []) as import("@/lib/pricing").Group[]).map((g) => ({ ...g, imprints: (g.imprints || []).map((y) => (y.id === im.id ? { ...y, ...patch } : y)) }));
    const { error: ge } = await admin.from("orders").update({ groups }).eq("id", o.id);
    if (ge) return { ok: false as const, error: `Couldn't update the order: ${ge.message}` };
  }

  return { ok: true as const, sewn, changes, patch };
}

/**
 * Edit a saved sew-out at the computer (Oct 29, Nick: "the thread, everything should be editable from there too… I don't
 * need to go back to my phone"): a new crop or photo, the placement photo added, replaced or taken off, the note, and
 * what was sewn (the order follows it again). Only while the customer hasn't answered; the same version is kept.
 */
export async function editSewout(admin: SupabaseClient, id: string, x: { photoPath?: string; rawPath?: string; placementPath?: string | null; note?: string; sewn?: SewnInput }, me: Staff) {
  const { data: row } = await admin.from("sewouts").select("*").eq("id", id).maybeSingle();
  const s = row as Sewout | null;
  if (!s) return { ok: false as const, error: "That sew-out isn't there anymore." };
  if (s.archived_at) return { ok: false as const, error: "That sew-out was replaced by a newer one." };
  if (s.status !== "pending") return { ok: false as const, error: "The customer already answered this one. Take a new sew-out photo instead." };
  const { o } = await load(admin, s.order_id);
  const pr = printOf(o, s.imprint_id);
  if (!pr) return { ok: false as const, error: "That print isn't on the order anymore." };
  const ap = await applySewn(admin, o, pr.im, x.sewn);
  if (!ap.ok) return ap;
  const upd: Record<string, unknown> = { sewn: ap.sewn, note: (x.note ?? s.note ?? "").trim().slice(0, 1000) };
  // what changed on the order since the photo: this edit's changes join the ones already made
  const before = (s.changes || []).filter((c) => !ap.changes.some((n) => n.what === c.what && (n.needle ?? null) === (c.needle ?? null)));
  const all = [...before, ...ap.changes];
  upd.changes = all.length ? all : null;
  if (x.photoPath) { upd.photo_path = x.photoPath; if (x.rawPath) upd.raw_path = x.rawPath; }
  if (x.placementPath !== undefined) upd.placement_path = x.placementPath;
  const { error } = await admin.from("sewouts").update(upd).eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  const what = [x.photoPath ? "photo" : "", x.placementPath !== undefined ? (x.placementPath ? "placement photo" : "placement photo taken off") : "", ap.changes.length ? changeWords(ap.changes) : ""].filter(Boolean).join("; ");
  await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_edited", detail: `Sew-out v${s.version} (${pr.im.location}) edited${what ? `: ${what}` : ""}`.slice(0, 1000), actor: me.email });
  return { ok: true as const, version: s.version, changes: ap.changes };
}

/** the changes in words, for the history and the message */
export const changeWords = (cs: SewChange[]) => cs.map((c) => c.what === "thread" ? `thread${c.needle ? ` (needle ${c.needle})` : ""} ${c.from} → ${c.to}` : c.what === "size" ? `size ${c.from} → ${c.to}` : c.what === "stitches" ? `stitches ${c.from} → ${c.to}` : `stitch file ${c.to}`).join("; ");

/** Send to customer: the saved sew-out emailed for approval (when customer emails are on) */
export async function sendSewoutNow(admin: SupabaseClient, id: string, me: Staff) {
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", id).maybeSingle();
  const s = sw as Sewout | null;
  if (!s || s.archived_at) return { ok: false as const, error: "That sew-out was replaced by a newer one." };
  if (s.status !== "pending") return { ok: false as const, error: "The customer already answered this one." };
  // a person pressed Send after seeing the preview (Oct 29, Nick: "when we send the proof… it should look like this"), so it
  // goes; SEWOUT_EMAILS only says whether saving a photo would email by itself
  const { o, customer, settings } = await load(admin, s.order_id);
  if (!customer?.email) return { ok: false as const, error: "This order's customer has no email address. Download the PDF proof and send it." };
  const pr = printOf(o, s.imprint_id);
  const where = pr ? `${pr.im.location}${pr.im.size ? `, ${pr.im.size}` : ""}` : "your logo";
  const emailed = (await emailSewout(admin, { o, to: customer.email, shop: settings.shop.name, id: s.id, photoPath: s.photo_path, where, note: s.note || "", reminder: false, by: me.email, first: (customer.name || "").trim().split(/\s+/)[0] })).ok;
  if (!emailed) return { ok: false as const, error: "The email didn't go out. Try again in a minute." };
  await admin.from("sewouts").update({ sent_at: new Date().toISOString(), sent_to: customer.email }).eq("id", s.id);
  await admin.from("order_events").insert({ order_id: o.id, kind: "sewout_sent", detail: `Sew-out v${s.version} (${where}) to ${customer.email}`, actor: me.email });
  return { ok: true as const, emailed: true, to: customer.email };
}

/** the email (lib/proofLinks.ts proofEmail): the photo, what it is, and the button to its proof page; send=false only
 *  makes it (the shop's preview) */
async function emailSewout(admin: SupabaseClient, p: { o: Order; to: string; shop: string; id: string; photoPath: string; where: string; note: string; reminder: boolean; by?: string; send?: boolean; first?: string }) {
  const { proofLinkFor, proofUrl, proofEmail, proofRows } = await import("@/lib/proofLinks");
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", p.id).maybeSingle();
  const url = p.send === false ? `${siteUrl()}/proof/preview` : proofUrl(await proofLinkFor(admin, { kind: "sewout", orderId: p.o.id, sewoutId: p.id, to: p.to, by: p.by }));
  const { data: su } = await admin.storage.from("proofs").createSignedUrl(p.photoPath, 60 * 60 * 24 * 30);
  const { settings } = await load(admin, p.o.id);
  const em = proofEmail({ settings, first: p.first || "", kind: "sewout", o: p.o, picture: su?.signedUrl || undefined, rows: proofRows(p.o, "sewout", sw as never), url, reminder: p.reminder, note: p.note });
  if (p.send === false) return { ok: false, url, ...em };
  const ok = await sendEmail({ to: p.to, replyTo: SHOP_NOTIFY_EMAIL, subject: em.subject, html: em.html });
  return { ok, url, ...em };
}

/** What Send would email for this sew-out (the shop's preview before Send). */
export async function previewSewoutEmail(admin: SupabaseClient, id: string) {
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", id).maybeSingle();
  const s = sw as Sewout | null;
  if (!s) return { ok: false as const, error: "That sew-out isn't there anymore." };
  const { o, customer, settings } = await load(admin, s.order_id);
  const pr = printOf(o, s.imprint_id);
  const where = pr ? `${pr.im.location}${pr.im.size ? `, ${pr.im.size}` : ""}` : "your logo";
  const em = await emailSewout(admin, { o, to: customer?.email || "", shop: settings.shop.name, id: s.id, photoPath: s.photo_path, where, note: s.note || "", reminder: false, send: false, first: (customer?.name || "").trim().split(/\s+/)[0] });
  return { ok: true as const, to: customer?.email || "", subject: em.subject, html: em.html };
}

/** The sew-out's proof link to send yourself (Oct 29, Nick: "copy a link… so I can just type an email"): counted as sent. */
export async function sewoutLinkCopy(admin: SupabaseClient, id: string, me: Staff) {
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", id).maybeSingle();
  const s = sw as Sewout | null;
  if (!s || s.archived_at) return { ok: false as const, error: "That sew-out was replaced by a newer one." };
  const { proofLinkFor, proofUrl } = await import("@/lib/proofLinks");
  const url = proofUrl(await proofLinkFor(admin, { kind: "sewout", orderId: s.order_id, sewoutId: s.id, by: me.email }));
  if (!s.sent_at && s.status === "pending") {
    await admin.from("sewouts").update({ sent_at: new Date().toISOString(), sent_to: "link copied" }).eq("id", s.id);
    await admin.from("order_events").insert({ order_id: s.order_id, kind: "sewout_sent", detail: `Sew-out v${s.version} (link copied to send yourself)`, actor: me.email });
  }
  return { ok: true as const, url };
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
  const emailed = (await emailSewout(admin, { o, to: customer.email, shop: settings.shop.name, id: s.id, photoPath: s.photo_path, where, note: "", reminder: true, by: me.email, first: (customer.name || "").trim().split(/\s+/)[0] })).ok;
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
export async function decideSewout(admin: SupabaseClient, s: Sewout, o: Order, decision: "approved" | "changes", name: string, comment: string, actor: string, /** one shop email for several answers at once (the caller sends it) */ quiet = false) {
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
  if (SHOP_NOTIFY_EMAIL && !quiet) await sendEmail({
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
