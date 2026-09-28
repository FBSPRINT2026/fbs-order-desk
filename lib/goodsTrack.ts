import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { mergeSettings } from "@/lib/pricing";
import { carrierOf, supplierLabel, TRACK } from "@/lib/goods";

/**
 * Customer supplied goods, watched automatically:
 *   - every inbound tracking number gets an EasyPost tracker (status, latest scan, estimated delivery);
 *   - delivered → goods move to "Arrived, checking in";
 *   - delays, delivery problems, and goods arriving too close to (or after) the in-hands date → a message in the
 *     order's goods conversation, and an email to the customer and the shop;
 *   - no tracking yet when the in-hands date is getting close → a reminder.
 * Each alert goes out once (order_goods.alerted remembers).
 */

const EP = "https://api.easypost.com/v2";
const auth = () => ({ "Content-Type": "application/json", Authorization: "Basic " + Buffer.from((process.env.EASYPOST_API_KEY || "").trim() + ":").toString("base64") });
const EP_CARRIER: Record<string, string> = { UPS: "UPS", FedEx: "FedEx", USPS: "USPS", DHL: "DHLExpress" };

type EpTracker = { id: string; status: string; status_detail?: string; est_delivery_date: string | null; carrier: string; tracking_details?: { message: string; status: string; datetime: string; tracking_location?: { city?: string | null; state?: string | null } }[] };

function fromTracker(t: EpTracker) {
  const last = (t.tracking_details || [])[(t.tracking_details || []).length - 1];
  const where = [last?.tracking_location?.city, last?.tracking_location?.state].filter(Boolean).join(", ");
  const delivered = t.status === "delivered" ? (t.tracking_details || []).filter((d) => d.status === "delivered").pop()?.datetime || new Date().toISOString() : null;
  return {
    tracker_id: t.id, track_status: t.status || "unknown", track_detail: [last?.message, where].filter(Boolean).join(" · ").slice(0, 200),
    est_delivery: t.est_delivery_date || null, delivered_at: delivered, track_updated_at: new Date().toISOString(),
  };
}

/** Start watching a tracking number (costs a cent or two). Returns the fields to save on the shipment, or null. */
export async function startTracker(tracking: string, carrier: string) {
  if (!process.env.EASYPOST_API_KEY?.trim() || !tracking) return null;
  const c = EP_CARRIER[carrier || carrierOf(tracking)] || "";
  const r = await fetch(`${EP}/trackers`, { method: "POST", headers: auth(), cache: "no-store", body: JSON.stringify({ tracker: { tracking_code: tracking.replace(/\s+/g, ""), ...(c ? { carrier: c } : {}) } }) });
  const j = await r.json().catch(() => null) as EpTracker | null;
  return r.ok && j?.id ? fromTracker(j) : null;
}
export async function readTracker(id: string) {
  const r = await fetch(`${EP}/trackers/${id}`, { headers: auth(), cache: "no-store" });
  const j = await r.json().catch(() => null) as EpTracker | null;
  return r.ok && j?.id ? fromTracker(j) : null;
}

const day = (d: string | Date) => new Date(typeof d === "string" && d.length === 10 ? d + "T12:00" : d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
/** `n` business days before a date (the day the goods need to be here by). */
function businessDaysBefore(date: string, n: number) {
  const d = new Date(date.slice(0, 10) + "T12:00");
  while (n > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
  return d;
}

type Ctx = { admin: SupabaseClient; shop: string; leadDays: number };

/** Post in the goods conversation, and email the customer and/or the shop. */
async function tell(ctx: Ctx, o: { id: string; number: number; customer_id: string | null }, body: string, subject: string, opts: { customer?: boolean; shop?: boolean }) {
  await ctx.admin.from("messages").insert({ order_id: o.id, topic: "goods", author_type: "staff", author_email: "", author_name: ctx.shop, body });
  if (opts.customer && o.customer_id) {
    const { data: c } = await ctx.admin.from("customers").select("email").eq("id", o.customer_id).maybeSingle();
    if (c?.email) await sendEmail({ to: c.email, replyTo: SHOP_NOTIFY_EMAIL, subject, html: emailLayout(ctx.shop, subject, body, "Open your portal", `${siteUrl()}/portal?area=messages&c=${o.id}:goods`) }).catch(() => false);
  }
  if (opts.shop && SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `[Goods] ${subject}`, html: emailLayout(ctx.shop, subject, body, "Open order", `${siteUrl()}/shop/orders/${o.id}`) }).catch(() => false);
}

/** One pass: refresh trackers, move delivered goods along, and send the alerts that are due. Stops at `deadline`. */
export async function goodsCheck(admin: SupabaseClient, deadline: number) {
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(st?.data);
  const ctx: Ctx = { admin, shop: s.shop.name, leadDays: s.ship.goodsLeadDays };
  const done = { trackers: 0, updated: 0, alerts: 0 };

  // our own blanks on the way: refresh tracking; tell the shop about delays, problems and late arrivals
  {
    const { data: bs } = await admin.from("blank_shipments").select("*, orders(id, number, due_date, production_date, status)").neq("track_status", "delivered").neq("tracking", "").limit(300);
    for (const x of (bs || []) as { id: string; tracking: string; carrier: string; tracker_id: string; track_status: string; est_delivery: string | null; track_updated_at: string | null; alerted: Record<string, string>; orders: { id: string; number: number; due_date: string | null; production_date: string | null; status: string } | null }[]) {
      if (Date.now() > deadline - 20000) break;
      if (!x.orders || x.orders.status === "completed") continue;
      if (x.track_updated_at && Date.now() - Date.parse(x.track_updated_at) < 25 * 60000) continue;
      const before = { status: x.track_status, est: x.est_delivery };
      const f = x.tracker_id ? await readTracker(x.tracker_id) : await startTracker(x.tracking, x.carrier);
      if (!f) continue;
      const alerted = { ...(x.alerted || {}) };
      const o = x.orders, label = `${x.carrier} ${x.tracking}`.trim();
      const need = o.production_date || (o.due_date ? businessDaysBefore(o.due_date, ctx.leadDays).toISOString().slice(0, 10) : null);
      const shopMail = async (subject: string, body: string) => { if (SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `[Blanks] ${subject}`, html: emailLayout(ctx.shop, subject, body, "Open Goods & receiving", `${siteUrl()}/shop/receiving`) }).catch(() => false); };
      if (["failure", "return_to_sender", "error"].includes(f.track_status) && alerted.problem !== f.track_status) { await shopMail(`Delivery problem: blanks for #${o.number}`, `${label}: ${TRACK[f.track_status] || f.track_status}${f.track_detail ? `, ${f.track_detail}` : ""}.`); alerted.problem = f.track_status; done.alerts++; }
      if (before.est && f.est_delivery && Date.parse(f.est_delivery) - Date.parse(before.est) > 12 * 3600000 && alerted.delay !== f.est_delivery.slice(0, 10)) { await shopMail(`Blanks for #${o.number} delayed`, `${label} is now expected ${day(f.est_delivery)} (was ${day(before.est)}).`); alerted.delay = f.est_delivery.slice(0, 10); done.alerts++; }
      if (need && f.est_delivery && f.track_status !== "delivered" && Date.parse(f.est_delivery) > Date.parse(need + "T23:59") && alerted.late !== f.est_delivery.slice(0, 10)) { await shopMail(`Blanks for #${o.number} arrive too late`, `${label} is expected ${day(f.est_delivery)}, but we need them by ${day(need)}${o.due_date ? ` (in-hands ${day(o.due_date)})` : ""}.`); alerted.late = f.est_delivery.slice(0, 10); done.alerts++; }
      await admin.from("blank_shipments").update({ ...f, alerted }).eq("id", x.id);
      done.updated++;
    }
  }

  // open wholesale jobs and their goods
  const { data: os } = await admin.from("orders").select("id, number, nickname, status, due_date, customer_id, price_type, submitted_at").eq("price_type", "wholesale").not("status", "in", "(completed,quote)").limit(500);
  const orders = ((os || []) as { id: string; number: number; nickname: string; status: string; due_date: string | null; customer_id: string | null; submitted_at: string | null }[]).filter((o) => !(o.status === "request" && !o.submitted_at));
  if (!orders.length) return done;
  const ids = orders.map((o) => o.id);
  const [{ data: gs }, { data: sh }] = await Promise.all([
    admin.from("order_goods").select("*").in("order_id", ids),
    admin.from("goods_shipments").select("*").in("order_id", ids),
  ]);
  const goods = new Map(((gs || []) as { order_id: string; status: string; supplier: string; alerted: Record<string, string> }[]).map((g) => [g.order_id, g]));
  const ships = (sh || []) as { id: string; order_id: string; carrier: string; tracking: string; eta: string | null; tracker_id: string; track_status: string; est_delivery: string | null; delivered_at: string | null; track_updated_at: string | null }[];

  for (const o of orders) {
    if (Date.now() > deadline) break;
    const g = goods.get(o.id);
    const alerted = { ...(g?.alerted || {}) };
    const mine = ships.filter((x) => x.order_id === o.id && x.tracking);
    const status = g?.status || "waiting";
    if (["received", "issue"].includes(status)) continue;

    // 1. refresh the trackers (start one where there isn't one yet)
    for (const x of mine) {
      if (Date.now() > deadline) break;
      if (x.track_status === "delivered") continue;
      if (x.track_updated_at && Date.now() - Date.parse(x.track_updated_at) < 25 * 60000) continue;
      const before = { status: x.track_status, est: x.est_delivery };
      const f = x.tracker_id ? await readTracker(x.tracker_id) : await startTracker(x.tracking, x.carrier);
      if (!x.tracker_id && f) done.trackers++;
      if (!f) continue;
      await admin.from("goods_shipments").update(f).eq("id", x.id);
      Object.assign(x, f); done.updated++;
      const label = `${x.carrier || carrierOf(x.tracking)} ${x.tracking}`.trim();
      if (f.track_status !== before.status && ["failure", "return_to_sender", "error"].includes(f.track_status) && alerted[`problem:${x.id}`] !== f.track_status) {
        await tell(ctx, o, `⚠️ There's a delivery problem with your goods for #${o.number} (${label}): ${TRACK[f.track_status] || f.track_status}${f.track_detail ? `, ${f.track_detail}` : ""}. We're keeping an eye on it; please check with the supplier too.`, `Delivery problem with the goods for #${o.number}`, { customer: true, shop: true });
        alerted[`problem:${x.id}`] = f.track_status; done.alerts++;
      }
      if (before.est && f.est_delivery && Date.parse(f.est_delivery) - Date.parse(before.est) > 12 * 3600000 && alerted[`delay:${x.id}`] !== f.est_delivery.slice(0, 10)) {
        await tell(ctx, o, `🕒 The shipment of your goods for #${o.number} (${label}) is running late. New estimate: ${day(f.est_delivery)} (was ${day(before.est)}).`, `Goods for #${o.number} are delayed`, { customer: true, shop: true });
        alerted[`delay:${x.id}`] = f.est_delivery.slice(0, 10); done.alerts++;
      }
    }

    // 2. everything delivered → arrived, we're counting them in
    if (mine.length && mine.every((x) => x.track_status === "delivered") && ["waiting", "on_way"].includes(status)) {
      await admin.from("order_goods").upsert({ order_id: o.id, status: "arrived", updated_by: "tracking", updated_at: new Date().toISOString() }, { onConflict: "order_id" });
      await tell(ctx, o, `📦 Your goods for #${o.number} were delivered to us. We're counting them in now and will let you know once everything checks out.`, `Goods delivered for #${o.number}`, { customer: false, shop: false });
      done.alerts++;
    } else if (mine.some((x) => x.track_status === "delivered") && mine.some((x) => x.track_status !== "delivered") && ["waiting", "on_way"].includes(status) && !alerted.partial) {
      await admin.from("order_goods").upsert({ order_id: o.id, status: "partial", updated_by: "tracking", updated_at: new Date().toISOString() }, { onConflict: "order_id" });
      await tell(ctx, o, `📦 Part of your goods for #${o.number} were delivered. We're still waiting on the rest.`, `Part of the goods arrived for #${o.number}`, { customer: false, shop: false });
      alerted.partial = "1"; done.alerts++;
    }

    // 3. timing against the in-hands date
    if (o.due_date && ["waiting", "on_way"].includes(status)) {
      const needBy = businessDaysBefore(o.due_date, ctx.leadDays);
      const open = mine.filter((x) => x.track_status !== "delivered");
      const latest = open.map((x) => x.est_delivery || (x.eta ? x.eta + "T12:00" : null)).filter(Boolean).sort().pop() as string | undefined;
      if (latest && Date.parse(latest) > needBy.getTime() + 12 * 3600000 && alerted.late !== latest.slice(0, 10)) {
        const after = Date.parse(latest) > Date.parse(o.due_date + "T23:59");
        await tell(ctx, o, `⚠️ Heads up: your goods for #${o.number} are now expected ${day(latest)}. ${after ? `That's after your in-hands date (${day(o.due_date)}), so this order will ship late unless the goods arrive sooner.` : `We need them by ${day(needBy)} to have the order ready by ${day(o.due_date)}, so it may be delayed.`} Reply here if the date can change or the goods can arrive sooner.`,
          `Goods for #${o.number} may arrive too late`, { customer: true, shop: true });
        alerted.late = latest.slice(0, 10); done.alerts++;
      }
      // no tracking yet and the need-by date is within a few business days
      const soon = businessDaysBefore(o.due_date, ctx.leadDays + 3);
      if (!mine.length && Date.now() >= soon.getTime() && !alerted.noTracking) {
        await tell(ctx, o, `📦 We don't have tracking yet for the goods on #${o.number}${g?.supplier ? ` (coming from ${supplierLabel(g.supplier)})` : ""}. We need them by ${day(needBy)} to have your order ready by ${day(o.due_date)}. Can you add the tracking here?`,
          `Tracking needed for the goods on #${o.number}`, { customer: true, shop: true });
        alerted.noTracking = "1"; done.alerts++;
      }
    }
    if (JSON.stringify(alerted) !== JSON.stringify(g?.alerted || {})) await admin.from("order_goods").upsert({ order_id: o.id, alerted, updated_at: new Date().toISOString() }, { onConflict: "order_id" });
  }
  return done;
}
