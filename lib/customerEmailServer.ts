import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailBrandBar, emailButton, emailThumb, sendEmail, siteUrl } from "@/lib/email";
import { EMAIL_KIND, recipientsOf, type EmailKind, type EmailPerson, type EmailPrefs } from "@/lib/customerEmails";
import { orderSubject } from "@/lib/orderSubject";
import { fmtPhone } from "@/lib/phone";
import { mergeSettings, orderGroups, type Order } from "@/lib/pricing";
import { customerHold, type Flag } from "@/lib/orderStages";
import { trackingUrl } from "@/lib/goods";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";

/**
 * Sending to a customer (lib/customerEmails.ts says who gets what). Every customer email goes through sendCustomerEmail:
 * it picks the people from the customer's email settings, skips a kind they turned off, sends each its own copy, and
 * notes it in the order's history (once per order for the one-time ones). The automatic ones (on hold, shipped, ready,
 * delivered, carrier updates) wait until the shop turns on automatic customer emails (settings customerEmails.auto,
 * Settings → Customer emails), so nothing goes out before Nick says go.
 *
 * And the emails themselves (Nov 3, Nick: "zhuzh up these emails… show me like… your order's ready for pickup… your order
 * was delivered… your order shipped. Here's your tracking"): one look with the proof email: the navy bar, a colored
 * chip, the heading, the job with its picture, a few lines, one button.
 */
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const low = (e: string) => e.trim().toLowerCase();

export async function peopleOf(admin: SupabaseClient, customerId: string): Promise<{ people: EmailPerson[]; prefs: EmailPrefs; name: string; company: string }> {
  const [{ data: c }, { data: cs }] = await Promise.all([
    admin.from("customers").select("name, company, email, email_prefs, contact2_name, contact2_email, message_email").eq("id", customerId).maybeSingle(),
    admin.from("customer_contacts").select("name, email, is_primary").eq("customer_id", customerId).is("removed_at", null).order("created_at"),
  ]);
  const cu = (c || {}) as { name?: string; company?: string; email?: string; email_prefs?: EmailPrefs; contact2_name?: string; contact2_email?: string; message_email?: boolean | null };
  const people: EmailPerson[] = [];
  const add = (email: string, name: string, main = false) => { const e = low(email || ""); if (!/@/.test(e) || people.some((p) => p.email === e)) return; people.push({ email: e, name: (name || "").trim() || e, main }); };
  add(cu.email || "", cu.name || "", true);
  for (const x of (cs || []) as { name: string; email: string; is_primary: boolean }[]) add(x.email, x.name, !cu.email && x.is_primary);
  add(cu.contact2_email || "", cu.contact2_name || "");
  // the older "our messages by email too" switch counts until they set Messages here
  const prefs: EmailPrefs = { ...(cu.email_prefs || {}) };
  if (!prefs.messages && cu.message_email === false) prefs.messages = { on: false, to: [] };
  return { people, prefs, name: cu.name || "", company: cu.company || "" };
}

/** the shop's switch for the emails that go by themselves (off until Nick turns it on) */
export async function autoEmailsOn(admin: SupabaseClient) {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  return ((data as { data?: { customerEmails?: { auto?: boolean } } } | null)?.data?.customerEmails?.auto) === true;
}

/** send one kind of email to whoever the customer chose; `once`: a key so the same email never goes twice for an order */
export async function sendCustomerEmail(admin: SupabaseClient, m: { customerId: string | null; kind: EmailKind; orderId?: string | null; subject: string; html: string; once?: string; actor?: string }) {
  if (!m.customerId) return { sent: [] as string[], why: "no customer" };
  if (EMAIL_KIND[m.kind].auto && !(await autoEmailsOn(admin))) return { sent: [] as string[], why: "automatic customer emails are off" };
  const tag = `${m.kind}${m.once ? `:${m.once}` : ""}`;
  if (m.once && m.orderId) {
    const { data: had } = await admin.from("order_events").select("id").eq("order_id", m.orderId).eq("kind", "customer_email").like("detail", `${tag} ·%`).limit(1);
    if ((had || []).length) return { sent: [] as string[], why: "already sent" };
  }
  const { people, prefs } = await peopleOf(admin, m.customerId);
  const to = recipientsOf(prefs, m.kind, people);
  if (!to.length) return { sent: [] as string[], why: "they turned this email off" };
  const sent: string[] = [];
  for (const t of to) if (await sendEmail({ to: t, subject: m.subject, html: m.html, replyTo: SHOP_NOTIFY_EMAIL || undefined })) sent.push(t);
  if (m.orderId && sent.length) await admin.from("order_events").insert({ order_id: m.orderId, kind: "customer_email", detail: `${tag} · ${EMAIL_KIND[m.kind].label} to ${sent.join(", ")}`, actor: m.actor || "Automatic" });
  return { sent, why: sent.length ? "" : "the email service didn't take it" };
}

// ---------- the emails ----------
export type Chip = "blue" | "green" | "amber" | "red";
const CHIP: Record<Chip, [string, string]> = { blue: ["#E6F4FB", "#0B6E99"], green: ["#E8F6EE", "#1E7B47"], amber: ["#FDF3E1", "#8A5A00"], red: ["#FDECEC", "#B42318"] };

export function customerEmailHtml(e: {
  shop: { name: string; phone?: string; email?: string; logoUrl?: string };
  chip: { text: string; tone: Chip }; head: string; big?: string; hi?: string; lines?: string[];
  job?: { title: string; sub: string; pic?: string };
  rows?: [string, string][]; button?: { label: string; url: string }; after?: string; foot?: string;
}) {
  const sh = e.shop, site = siteUrl();
  const logo = sh.logoUrl ? (/^https?:/.test(sh.logoUrl) ? sh.logoUrl : `${site}${sh.logoUrl.startsWith("/") ? "" : "/"}${sh.logoUrl}`) : "";
  const [cb, cf] = CHIP[e.chip.tone];
  const contact = [fmtPhone(sh.phone || ""), sh.email].filter(Boolean).map((x) => esc(String(x))).join(" · ");
  const job = e.job ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F6F7F9;border-radius:8px;margin:4px 0 12px"><tr>${e.job.pic ? `<td style="width:60px;padding:10px 0 10px 10px;vertical-align:middle">${emailThumb(e.job.pic, 52)}</td>` : ""}<td style="padding:10px 12px;vertical-align:middle"><div style="font-size:14px;font-weight:700;color:#141D2B">${esc(e.job.title)}</div><div style="font-size:12px;color:#6B7686">${esc(e.job.sub)}</div></td></tr></table>` : "";
  const rows = (e.rows || []).length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:2px 0 8px">${(e.rows || []).map(([k, v], i, a) => `<tr><td style="padding:7px 0;font-size:13px;color:#6B7686;${i < a.length - 1 ? "border-bottom:1px solid #EEF1F5;" : ""}">${esc(k)}</td><td style="padding:7px 0;font-size:13px;color:#141D2B;font-weight:700;text-align:right;${i < a.length - 1 ? "border-bottom:1px solid #EEF1F5;" : ""}">${v}</td></tr>`).join("")}</table>` : "";
  return `<div style="background:#F3F5F8;padding:24px 12px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #E3E7EE;border-radius:10px;border-collapse:separate">
${emailBrandBar(site, sh.name, logo)}
<tr><td style="padding:22px 24px 6px;color:#141D2B">
<div><span style="display:inline-block;background:${cb};color:${cf};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:4px 10px;border-radius:99px">${esc(e.chip.text)}</span></div>
<div style="font-size:20px;font-weight:700;margin:10px 0 ${e.big ? "2" : "10"}px">${esc(e.head)}</div>
${e.big ? `<div style="font-size:30px;font-weight:700;margin:0 0 10px">${esc(e.big)}</div>` : ""}
${e.hi ? `<div style="font-size:15px;line-height:1.5;color:#3C475A;margin-bottom:8px">${esc(e.hi)}</div>` : ""}
${(e.lines || []).map((l) => `<div style="font-size:15px;line-height:1.5;color:#3C475A;margin-bottom:8px">${esc(l)}</div>`).join("")}
${job}${rows}
</td></tr>
${e.button ? `<tr><td style="padding:6px 24px 8px;text-align:center">${emailButton(e.button.url, e.button.label)}</td></tr>` : ""}
${e.after ? `<tr><td style="padding:4px 24px 16px;text-align:center;font-size:12px;color:#6B7686">${esc(e.after)}</td></tr>` : `<tr><td style="padding:0 0 10px"></td></tr>`}
<tr><td style="padding:12px 24px;border-top:1px solid #EEF1F5;font-size:12px;color:#6B7686">${esc(sh.name)}${contact ? ` · ${contact}` : ""}${e.foot ? ` · ${esc(e.foot)}` : ""}</td></tr>
</table></div>`;
}

type Ctx = { o: Order & { flags?: Flag[]; delivery_method?: string | null; tracking?: string | null; ship_method?: string | null }; shop: { name: string; phone?: string; email?: string; logoUrl?: string; address?: string }; first: string; company: string; pic: string; pcs: number };
async function ctxOf(admin: SupabaseClient, orderId: string): Promise<Ctx | null> {
  const [{ data: od }, { data: s }] = await Promise.all([admin.from("orders").select("*").eq("id", orderId).maybeSingle(), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
  if (!od) return null;
  const o = od as Ctx["o"];
  const shop = mergeSettings((s as { data?: unknown } | null)?.data).shop;
  const { data: c } = o.customer_id ? await admin.from("customers").select("name, company").eq("id", o.customer_id).maybeSingle() : { data: null };
  const cu = (c || {}) as { name?: string; company?: string };
  // the order's first mockup picture, signed for a week (mail programs open it later)
  let pic = "";
  const thumb = orderGroups(o).map((g) => g.mockupThumbs?.[0] || "").find(Boolean);
  if (thumb) { const { data: u } = await admin.storage.from("proofs").createSignedUrl(thumb, 7 * 86400); pic = u?.signedUrl || ""; }
  const pcs = o.qty || orderGroups(o).reduce((a, g) => a + (g.lines || []).reduce((b, l) => b + Object.values(l.sizes || {}).reduce((x, q) => x + (+(q || 0)), 0), 0), 0);
  return { o, shop, first: ((cu.name || "").trim().split(/\s+/)[0]) || "there", company: (cu.company || "").trim(), pic, pcs };
}
const hiOf = (c: Ctx) => `Hi ${c.first}${c.company && c.company.toLowerCase() !== c.first.toLowerCase() ? ` with ${c.company}` : ""},`;
const jobOf = (c: Ctx, extra = "") => ({ title: c.o.nickname || `Order #${c.o.number}`, sub: [`Order #${c.o.number}`, c.pcs ? `${c.pcs} pcs` : "", extra].filter(Boolean).join(" · "), pic: c.pic || undefined });
const portal = (orderId: string) => `${siteUrl()}/portal/orders/${orderId}`;

/** On hold: what the customer may see (customerHold), when the shop let them see it */
export async function emailOnHold(admin: SupabaseClient, orderId: string, actor = "Automatic") {
  const c = await ctxOf(admin, orderId);
  if (!c) return null;
  const h = customerHold(c.o.flags || []);
  if (!h) return null;
  const pay = h.fix === "pay";
  const html = customerEmailHtml({ shop: c.shop, chip: { text: "On hold", tone: "amber" }, head: `Your order is on hold`, hi: hiOf(c), lines: [h.reason], job: jobOf(c),
    button: { label: pay ? "Pay now" : h.fix === "art" ? "Send a new file" : "Open your order", url: pay ? `${portal(orderId)}?view=1&pay=1` : portal(orderId) },
    after: "As soon as it's sorted out, your order goes right back into the line." });
  return sendCustomerEmail(admin, { customerId: c.o.customer_id, kind: "hold", orderId, subject: orderSubject(c.o.number, "On hold", c.o.nickname), html, once: `${h.key}:${h.since}`, actor });
}

/** shipped, with tracking (one per shipment) */
export async function emailShipped(admin: SupabaseClient, shipmentId: string, actor = "Automatic") {
  const { data: sp } = await admin.from("shipments").select("*").eq("id", shipmentId).maybeSingle();
  const s = sp as { id: string; order_id: string | null; carrier: string; service: string; boxes: { tracking?: string }[] } | null;
  if (!s?.order_id) return null;
  const c = await ctxOf(admin, s.order_id);
  if (!c) return null;
  const nums = (s.boxes || []).map((b) => (b.tracking || "").trim()).filter(Boolean);
  const carrier = (s.carrier || "").trim();
  const link = (t: string) => { const u = trackingUrl(carrier, t); return u ? `<a href="${u}" style="color:#0B6E99;text-decoration:none">${esc(t)}</a>` : esc(t); };
  const html = customerEmailHtml({ shop: c.shop, chip: { text: "On the way", tone: "blue" }, head: "Your order shipped", hi: hiOf(c), lines: ["Your order is on its way."], job: jobOf(c, `${(s.boxes || []).length} box${(s.boxes || []).length === 1 ? "" : "es"}`),
    rows: [["Carrier", esc([carrier, s.service].filter(Boolean).join(" ") || "—")], ...nums.slice(0, 6).map((t, i): [string, string] => [nums.length > 1 ? `Tracking, box ${i + 1}` : "Tracking", link(t)])],
    button: nums[0] && trackingUrl(carrier, nums[0]) ? { label: "Track your package", url: trackingUrl(carrier, nums[0]) } : { label: "Open your order", url: portal(s.order_id) } });
  return sendCustomerEmail(admin, { customerId: c.o.customer_id, kind: "shipped", orderId: s.order_id, subject: orderSubject(c.o.number, "Shipped", c.o.nickname), html, once: `ship:${s.id}`, actor });
}

/** ready for pickup (pickup orders, when they go Ready) */
export async function emailReady(admin: SupabaseClient, orderId: string, actor = "Automatic") {
  const c = await ctxOf(admin, orderId);
  if (!c || (c.o.delivery_method && c.o.delivery_method !== "pickup")) return null;
  const html = customerEmailHtml({ shop: c.shop, chip: { text: "Ready", tone: "green" }, head: "Your order is ready for pickup", hi: hiOf(c), lines: ["It's packed and waiting for you."], job: jobOf(c),
    rows: [["Where", esc(c.shop.address || c.shop.name).replace(/\n/g, ", ")], ...(c.shop.phone ? [["Questions", esc(fmtPhone(c.shop.phone))] as [string, string]] : [])],
    button: c.shop.address ? { label: "Get directions", url: `https://maps.google.com/?q=${encodeURIComponent(c.shop.address.replace(/\n/g, ", "))}` } : { label: "Open your order", url: portal(orderId) }, foot: "Thank you for your business" });
  return sendCustomerEmail(admin, { customerId: c.o.customer_id, kind: "ready", orderId, subject: orderSubject(c.o.number, "Ready for pickup", c.o.nickname), html, once: "ready", actor });
}

/** delivered: by us (a delivery order completed), or by the carrier (from tracking) */
export async function emailDelivered(admin: SupabaseClient, orderId: string, by: "fbs" | "carrier", when = "", shipmentId = "", actor = "Automatic") {
  const c = await ctxOf(admin, orderId);
  if (!c) return null;
  const day = when ? new Date(when).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const html = customerEmailHtml({ shop: c.shop, chip: { text: "Delivered", tone: "green" }, head: "Your order was delivered", hi: hiOf(c),
    lines: [`Your order ${day ? `arrived ${day}` : "was delivered"}. Thank you for choosing ${c.shop.name}.`], job: jobOf(c),
    after: "Something not right? Reply on your order and we'll make it right.", button: { label: "Order these again", url: `${siteUrl()}/portal?area=orders` }, foot: "Thank you for your business" });
  return sendCustomerEmail(admin, { customerId: c.o.customer_id, kind: by === "fbs" ? "delivered" : "carrier_delivered", orderId, subject: orderSubject(c.o.number, "Delivered", c.o.nickname), html, once: by === "fbs" ? "delivered" : `delivered:${shipmentId}`, actor });
}

/** a carrier problem on its way to them (an exception, return, failed delivery) */
export async function emailShipIssue(admin: SupabaseClient, orderId: string, shipmentId: string, status: string, detail: string) {
  const c = await ctxOf(admin, orderId);
  if (!c) return null;
  const html = customerEmailHtml({ shop: c.shop, chip: { text: "Delivery problem", tone: "red" }, head: "There's a problem with your delivery", hi: hiOf(c),
    lines: [`The carrier reported a problem${detail ? `: ${detail}` : "."}`, "We're on it and will let you know what happens next."], job: jobOf(c), button: { label: "Open your order", url: portal(orderId) } });
  return sendCustomerEmail(admin, { customerId: c.o.customer_id, kind: "ship_issue", orderId, subject: orderSubject(c.o.number, "Delivery problem", c.o.nickname), html, once: `issue:${shipmentId}:${status}` });
}

/** an order's status changed: Ready (pickup) → ready email; Completed (our delivery) → delivered email */
export async function emailForStatus(admin: SupabaseClient, orderId: string, status: string, actor = "Automatic") {
  if (status === "ready") return emailReady(admin, orderId, actor);
  if (status === "completed") {
    const { data: o } = await admin.from("orders").select("delivery_method, type").eq("id", orderId).maybeSingle();
    if ((o as { delivery_method?: string; type?: string } | null)?.delivery_method === "deliver" && (o as { type?: string }).type === "invoice") return emailDelivered(admin, orderId, "fbs", new Date().toISOString(), "", actor);
  }
  return null;
}

/**
 * Our own shipments on their way to the customer (hourly, with the goods tracking): their tracking is followed, and the
 * customer hears when the carrier delivers it or reports a problem, if they asked for those (both off by default).
 */
export async function outboundCheck(admin: SupabaseClient, deadline: number) {
  const { readTracker, startTracker } = await import("@/lib/goodsTrack");
  const since = new Date(Date.now() - 21 * 864e5).toISOString();
  const { data } = await admin.from("shipments").select("id, order_id, carrier, boxes, tracker_id, track_status, track_updated_at, delivered_at, notified").eq("status", "shipped").gte("shipped_at", since).not("order_id", "is", null).limit(200);
  let n = 0;
  for (const s of (data || []) as { id: string; order_id: string; carrier: string; boxes: { tracking?: string }[]; tracker_id: string | null; track_status: string | null; track_updated_at: string | null; delivered_at: string | null; notified: Record<string, string> }[]) {
    if (Date.now() > deadline) break;
    if (s.track_status === "delivered" && s.notified?.delivered) continue;
    if (s.track_updated_at && Date.now() - Date.parse(s.track_updated_at) < 50 * 60000) continue;
    const trk = (s.boxes || []).map((b) => (b.tracking || "").trim()).find(Boolean);
    if (!trk) continue;
    const f = s.tracker_id ? await readTracker(s.tracker_id) : await startTracker(trk, s.carrier);
    if (!f) continue;
    const notified = { ...(s.notified || {}) };
    if (f.track_status === "delivered" && !notified.delivered) {
      await emailDelivered(admin, s.order_id, "carrier", f.delivered_at || "", s.id).catch(() => null);
      notified.delivered = new Date().toISOString();
    } else if (["failure", "return_to_sender", "error", "cancelled"].includes(String(f.track_status)) && !notified[String(f.track_status)]) {
      await emailShipIssue(admin, s.order_id, s.id, String(f.track_status), f.track_detail || "").catch(() => null);
      notified[String(f.track_status)] = new Date().toISOString();
    }
    await admin.from("shipments").update({ tracker_id: f.tracker_id, track_status: f.track_status, track_detail: f.track_detail, delivered_at: f.delivered_at, track_updated_at: f.track_updated_at, notified }).eq("id", s.id);
    n++;
  }
  return { outbound: n };
}

/** a payment's receipt for the customer, and the shop's own "payment received" (one look with the other emails) */
export function receiptEmailHtml(r: {
  shop: { name: string; phone?: string; email?: string; logoUrl?: string }; customer: string; date: string; method: string; txn: string;
  lines: { number: number; nickname: string; amount: number; balanceAfter: number }[]; subtotal: number; fee: number; total: number; url: string; forShop?: boolean;
}) {
  const m = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const rows: [string, string][] = [
    ...r.lines.map((l): [string, string] => [`#${l.number}${l.nickname ? ` ${l.nickname}` : ""}`, `${m(l.amount)}${l.balanceAfter > 0.004 ? `<div style="font-size:11px;font-weight:400;color:#6B7686">${m(l.balanceAfter)} still due</div>` : `<div style="font-size:11px;font-weight:400;color:#1E7B47">Paid in full</div>`}`]),
    ...(r.fee > 0.004 ? [["Card fee", m(r.fee)] as [string, string]] : []),
    ["Total paid", m(r.total)],
    [`${r.method} · ${r.date}`, r.txn ? `<span style="font-weight:400;color:#6B7686">Ref ${esc(r.txn.slice(0, 8))}</span>` : ""],
  ];
  return customerEmailHtml({
    shop: r.shop, chip: { text: "Paid", tone: "green" }, head: r.forShop ? `${r.customer} paid` : "Thanks, we got your payment", big: m(r.total),
    hi: r.forShop ? undefined : `Thank you, ${r.customer}. Here's what your payment covered.`, rows,
    button: { label: r.forShop ? "Open orders" : "View your payments", url: r.url }, foot: r.forShop ? "" : "Keep this email for your records",
  });
}

/** "We got your order": a request or reorder sent from the portal (once per order) */
export async function emailReceived(admin: SupabaseClient, orderId: string, actor = "Automatic") {
  const c = await ctxOf(admin, orderId);
  if (!c) return null;
  const re = !!(c.o as { simple_order?: { reorder?: unknown } | null }).simple_order?.reorder;
  const html = customerEmailHtml({ shop: c.shop, chip: { text: "Received", tone: "blue" }, head: re ? "We got your reorder" : "We got your order", hi: hiOf(c),
    lines: ["Thanks! We're checking it now. You'll get your quote and proof to approve before anything is made."], job: jobOf(c), button: { label: "See it in your portal", url: portal(orderId) } });
  return sendCustomerEmail(admin, { customerId: c.o.customer_id, kind: "received", orderId, subject: orderSubject(c.o.number, re ? "Reorder received" : "Order received", c.o.nickname), html, once: "received", actor });
}

/** who gets proofs and approvals at the order's customer (the given email when there's no customer or nobody set) */
export async function approvalsList(admin: SupabaseClient, customerId: string | null | undefined, fallback: string) {
  if (!customerId) return fallback ? [fallback] : [];
  const { people, prefs } = await peopleOf(admin, customerId);
  const to = recipientsOf(prefs, "approvals", people);
  return to.length ? to : fallback ? [fallback] : [];
}
