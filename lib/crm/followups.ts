// The follow-up engine: looks across orders, proofs, payments and messages and lists what
// needs a nudge today. Plain rules, no AI, so it works now. The same list feeds the Assistant
// page, the nav badge, the daily digest and (later) the AI, which can rewrite the drafts.
//
// Every item has a stable `key`. Dismissing or snoozing an item saves that key in ai_suggestions,
// so it stays hidden until the situation changes (e.g. the quote is sent again gives a new key).

import type { SupabaseClient } from "@supabase/supabase-js";
import { payDueDate, ST, type Customer, type Order, type Settings, type StatusKey } from "@/lib/pricing";
import { custLabel, fmtDateLong, money } from "@/lib/format";
import { firstName, renderTemplate, type TemplateKey } from "@/lib/crm/templates";

export type FollowUpKind =
  | "reply_needed" | "price_request" | "quote_followup" | "quote_unsent" | "proof_changes" | "proof_waiting"
  | "deposit" | "overdue" | "late" | "at_risk" | "pickup" | "customer_followup" | "annual_reorder" | "idle_customer";

export const KIND_INFO: Record<FollowUpKind, { group: "Reply" | "Quotes" | "Artwork" | "Money" | "Production" | "Relationships"; label: string }> = {
  reply_needed: { group: "Reply", label: "Customer waiting on a reply" },
  price_request: { group: "Quotes", label: "Order request to price" },
  quote_followup: { group: "Quotes", label: "Quote follow-up" },
  quote_unsent: { group: "Quotes", label: "Quote never sent" },
  proof_changes: { group: "Artwork", label: "Proof changes requested" },
  proof_waiting: { group: "Artwork", label: "Proof waiting on customer" },
  deposit: { group: "Money", label: "No deposit yet" },
  overdue: { group: "Money", label: "Payment overdue" },
  late: { group: "Production", label: "Past in-hands date" },
  at_risk: { group: "Production", label: "At risk of missing date" },
  pickup: { group: "Production", label: "Waiting for pickup" },
  customer_followup: { group: "Relationships", label: "Scheduled follow-up" },
  annual_reorder: { group: "Relationships", label: "Annual reorder" },
  idle_customer: { group: "Relationships", label: "Check in" },
};

export type FollowUp = {
  key: string;
  kind: FollowUpKind;
  priority: 1 | 2 | 3;
  title: string;
  body: string;
  order_id: string | null;
  customer_id: string | null;
  number?: number;
  customer: string;
  /** where to go to handle it */
  href: string;
  /** a message to send, when one makes sense */
  template?: TemplateKey;
  draft?: { subject: string; body: string };
  /** which thread a sent draft goes to */
  channel: "order" | "customer" | "none";
  /** how old the situation is, for sorting */
  since: string;
};

type O = Pick<Order, "id" | "number" | "nickname" | "status" | "type" | "due_date" | "total" | "customer_id" | "created_at" | "updated_at" | "sent_at" | "approved_at" | "submitted_at" | "completed_at" | "tracking" | "delivery_method">;
export type AssistantData = {
  orders: O[];
  customers: Customer[];
  payments: { order_id: string; amount: number }[];
  proofs: { order_id: string; status: string; created_at: string; decided_at: string | null }[];
  messages: { order_id: string | null; customer_id: string | null; author_type: string; created_at: string }[];
  readyEvents: { order_id: string; created_at: string }[];
};

/** Loads what the rules need. Works with the browser client (staff session) or the admin client (cron). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadAssistantData(sb: SupabaseClient<any, any, any>): Promise<AssistantData> {
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const [o, c, p, pr, m, ev] = await Promise.all([
    sb.from("orders").select("id,number,nickname,status,type,due_date,total,customer_id,created_at,updated_at,sent_at,approved_at,submitted_at,completed_at,tracking,delivery_method").order("number", { ascending: false }).limit(2000),
    sb.from("customers").select("*"),
    sb.from("payments").select("order_id,amount"),
    sb.from("proofs").select("order_id,status,created_at,decided_at"),
    sb.from("messages").select("order_id,customer_id,author_type,created_at").gte("created_at", since).order("created_at"),
    sb.from("order_events").select("order_id,created_at").eq("kind", "status").eq("detail", "ready").gte("created_at", since),
  ]);
  return {
    orders: (o.data || []) as O[],
    customers: (c.data || []) as Customer[],
    payments: ((p.data || []) as { order_id: string; amount: number }[]).map((x) => ({ ...x, amount: +x.amount || 0 })),
    proofs: (pr.data || []) as AssistantData["proofs"],
    messages: (m.data || []) as AssistantData["messages"],
    readyEvents: (ev.data || []) as AssistantData["readyEvents"],
  };
}

const DAY = 86400000;
const ageDays = (iso: string | null | undefined, now: number) => (iso ? (now - new Date(iso).getTime()) / DAY : 0);
const dayDiff = (dateISO: string, now: number) => {
  // whole days from today (local) to a yyyy-mm-dd date; negative = past
  const [y, m, d] = dateISO.slice(0, 10).split("-").map(Number);
  const t = new Date(now); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((new Date(y, m - 1, d).getTime() - today) / DAY);
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const EARLY: StatusKey[] = ["approved", "art", "blanks"];

/** Everything that needs a follow-up right now, most urgent first. */
export function computeFollowUps(data: AssistantData, s: Settings, now = Date.now()): FollowUp[] {
  const a = s.assistant;
  const out: FollowUp[] = [];
  const cust = new Map(data.customers.map((c) => [c.id, c]));
  const paid = new Map<string, number>();
  data.payments.forEach((p) => paid.set(p.order_id, (paid.get(p.order_id) || 0) + p.amount));
  const shop = s.shop.name;

  const vars = (o: O) => {
    const c = cust.get(o.customer_id || "");
    const bal = Math.round(((+o.total || 0) - (paid.get(o.id) || 0)) * 100) / 100;
    return {
      first: firstName(c?.name), number: o.number, job: o.nickname ? `"${o.nickname}"` : "your order", total: money(o.total), balance: money(bal),
      due: o.due_date ? fmtDateLong(o.due_date) : "", tracking: o.tracking || "", shop, phone: s.shop.phone,
    };
  };
  const push = (o: O | null, c: Customer | undefined, f: Omit<FollowUp, "order_id" | "customer_id" | "customer" | "number" | "href"> & { href?: string }) => {
    out.push({
      ...f,
      order_id: o?.id || null,
      customer_id: o?.customer_id || c?.id || null,
      number: o?.number,
      customer: custLabel(c || cust.get(o?.customer_id || "")),
      href: f.href || (o ? `/shop/orders/${o.id}` : c ? `/shop/customers/${c.id}` : "/shop"),
    });
  };

  // ---- customer messages nobody has answered ----
  const threads = new Map<string, AssistantData["messages"][number]>();
  data.messages.forEach((m) => threads.set(m.order_id ? "o:" + m.order_id : "c:" + m.customer_id, m)); // last one wins (sorted by time)
  const byId = new Map(data.orders.map((o) => [o.id, o]));
  threads.forEach((m, k) => {
    if (m.author_type !== "customer") return;
    const o = m.order_id ? byId.get(m.order_id) || null : null;
    const c = cust.get(o?.customer_id || m.customer_id || "");
    const hrs = (now - new Date(m.created_at).getTime()) / 3600000;
    push(o, c, {
      key: `reply:${k}:${m.created_at}`, kind: "reply_needed", priority: hrs >= a.replyWithinHours ? 1 : 2,
      title: o ? `Reply to ${custLabel(c)} about #${o.number}` : `Reply to ${custLabel(c)}`,
      body: `Their last message was ${hrs < 1 ? "just now" : hrs < 48 ? `${Math.round(hrs)} hours ago` : `${Math.round(hrs / 24)} days ago`} and hasn't been answered.`,
      href: o ? `/shop/orders/${o.id}#messages` : `/shop/customers/${c?.id}?area=messages`, channel: "none", since: m.created_at,
    });
  });

  for (const o of data.orders) {
    const c = cust.get(o.customer_id || "");
    if (!c) continue;
    const v = vars(o);
    const bal = Math.round(((+o.total || 0) - (paid.get(o.id) || 0)) * 100) / 100;
    const due = o.due_date ? dayDiff(o.due_date, now) : null;

    // ---- quotes ----
    if (o.status === "request" && o.submitted_at && ageDays(o.submitted_at, now) >= a.priceRequestDays) {
      const d = Math.floor(ageDays(o.submitted_at, now));
      push(o, c, { key: `price:${o.id}:${o.submitted_at}`, kind: "price_request", priority: d >= a.priceRequestDays * 2 || (due !== null && due <= 10) ? 1 : 2,
        title: `Price ${custLabel(c)}'s order request #${o.number}`, body: `Sent in ${plural(d, "day")} ago${o.due_date ? `, needed by ${fmtDateLong(o.due_date)}` : ""}. Check it, price it and send it back for approval.`,
        template: "request_received", draft: renderTemplate("request_received", v), channel: "order", since: o.submitted_at });
    }
    if (o.status === "quote_sent" && o.sent_at && ageDays(o.sent_at, now) >= a.quoteFollowUpDays) {
      const d = Math.floor(ageDays(o.sent_at, now));
      const soon = due !== null && due <= 14;
      const tk: TemplateKey = soon ? "quote_followup_soon" : "quote_followup";
      push(o, c, { key: `quote:${o.id}:${o.sent_at}`, kind: "quote_followup", priority: soon ? 1 : d >= a.quoteFollowUpDays * 3 ? 3 : 2,
        title: `Follow up on quote #${o.number} (${money(o.total)})`, body: `Sent ${plural(d, "day")} ago to ${custLabel(c)} with no answer yet.${soon ? ` In-hands date is ${fmtDateLong(o.due_date)}.` : ""}`,
        template: tk, draft: renderTemplate(tk, v), channel: "order", since: o.sent_at });
    }
    if (o.status === "quote" && +o.total > 0 && ageDays(o.created_at, now) >= 2) {
      push(o, c, { key: `unsent:${o.id}`, kind: "quote_unsent", priority: 3,
        title: `Quote #${o.number} for ${custLabel(c)} was never sent`, body: `Created ${plural(Math.floor(ageDays(o.created_at, now)), "day")} ago (${money(o.total)}). Send it, or delete it if it's not needed.`,
        channel: "none", since: o.created_at });
    }

    // ---- artwork ----
    const ps = data.proofs.filter((p) => p.order_id === o.id);
    const lastUpload = ps.reduce((x, p) => (p.created_at > x ? p.created_at : x), "");
    const changes = ps.filter((p) => p.status === "changes" && p.decided_at && p.decided_at >= lastUpload);
    if (changes.length && o.status !== "completed") {
      const at = changes.map((p) => p.decided_at!).sort().pop()!;
      push(o, c, { key: `proofchg:${o.id}:${at}`, kind: "proof_changes", priority: 1,
        title: `Revise the proof for #${o.number}`, body: `${custLabel(c)} asked for changes ${plural(Math.floor(ageDays(at, now)), "day")} ago. Upload a new proof and ask for approval.`,
        href: `/shop/orders/${o.id}#proofs`, channel: "none", since: at });
    }
    const pending = ps.filter((p) => p.status === "pending");
    if (pending.length && o.status !== "completed") {
      const oldest = pending.map((p) => p.created_at).sort()[0];
      const d = Math.floor(ageDays(oldest, now));
      if (d >= a.proofFollowUpDays) {
        push(o, c, { key: `proof:${o.id}:${oldest}`, kind: "proof_waiting", priority: due !== null && due <= 7 ? 1 : 2,
          title: `Nudge ${custLabel(c)} to approve the proof for #${o.number}`, body: `${plural(pending.length, "proof")} waiting ${plural(d, "day")}.${o.due_date ? ` Due ${fmtDateLong(o.due_date)}.` : ""}`,
          template: "proof_followup", draft: renderTemplate("proof_followup", { ...v, days: d, dueLine: o.due_date ? ` Your in-hands date is ${fmtDateLong(o.due_date)}.` : "" }), channel: "order", since: oldest });
      }
    }

    // ---- money ----
    if (o.type === "invoice" && bal > 0.004) {
      const terms = c.payment_terms || "receipt";
      const payBy = payDueDate(o, terms);
      const late = payBy ? -dayDiff(payBy, now) : 0;
      if (payBy && late > 0) {
        push(o, c, { key: `overdue:${o.id}:${payBy}`, kind: "overdue", priority: late > 14 ? 1 : 2,
          title: `Collect ${money(bal)} on #${o.number}`, body: `${custLabel(c)} was due ${fmtDateLong(payBy)} (${plural(late, "day")} ago).`,
          template: "payment_reminder", draft: renderTemplate("payment_reminder", { ...v, dueText: ` (it was due ${fmtDateLong(payBy)})` }), channel: "order", since: payBy });
      } else if (terms === "receipt" && s.depositPct > 0 && EARLY.includes(o.status) && (paid.get(o.id) || 0) < 0.005 && +o.total > 0 && ageDays(o.approved_at || o.updated_at, now) >= 1) {
        push(o, c, { key: `deposit:${o.id}`, kind: "deposit", priority: 3,
          title: `No deposit on #${o.number} yet`, body: `Approved${o.approved_at ? ` ${fmtDateLong(o.approved_at.slice(0, 10))}` : ""}, ${money(o.total)} total. Your terms ask for ${s.depositPct}% to start.`,
          template: "deposit_request", draft: renderTemplate("deposit_request", v), channel: "order", since: o.approved_at || o.updated_at });
      }
    }

    // ---- production dates ----
    if (o.type === "invoice" && o.due_date && due !== null && !["ready", "completed"].includes(o.status)) {
      if (due < 0) {
        push(o, c, { key: `late:${o.id}:${o.due_date}`, kind: "late", priority: 1,
          title: `#${o.number} is past its in-hands date`, body: `Was due ${fmtDateLong(o.due_date)} and is still at "${ST[o.status]?.label || o.status}". Update the customer or the date.`, channel: "none", since: o.due_date });
      } else if (due <= a.atRiskDays && EARLY.includes(o.status)) {
        const why = o.status === "art" ? (pending.length ? "artwork isn't approved" : "artwork isn't done") : o.status === "blanks" ? "garments are still on order" : "it hasn't started";
        push(o, c, { key: `risk:${o.id}:${o.due_date}`, kind: "at_risk", priority: due <= 2 ? 1 : 2,
          title: `#${o.number} due in ${plural(due, "day")} and ${why}`, body: `${custLabel(c)} · ${o.nickname || "Untitled job"} · in hands ${fmtDateLong(o.due_date)}.`, channel: "none", since: o.due_date });
      }
    }
    if (o.status === "ready") {
      const at = data.readyEvents.filter((e) => e.order_id === o.id).map((e) => e.created_at).sort().pop();
      const d = at ? Math.floor(ageDays(at, now)) : 0;
      if (at && d >= a.pickupRemindDays) {
        const tk: TemplateKey = o.delivery_method === "ship" && o.tracking ? "shipped" : "ready_pickup";
        push(o, c, { key: `pickup:${o.id}:${at}`, kind: "pickup", priority: 3,
          title: `#${o.number} has been ready for ${plural(d, "day")}`, body: o.delivery_method === "pickup" ? `Remind ${custLabel(c)} to pick it up.` : "Mark it completed once it's delivered.",
          template: tk, draft: renderTemplate(tk, { ...v, balanceLine: bal > 0.004 ? ` The balance is ${money(bal)}, and you can pay online in your portal or when you pick up.` : "" }), channel: "order", since: at });
      }
    }
  }

  // ---- relationships ----
  const today = new Date(now); const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  for (const c of data.customers) {
    if (c.next_follow_up && c.next_follow_up <= todayISO) {
      push(null, c, { key: `cfu:${c.id}:${c.next_follow_up}`, kind: "customer_followup", priority: 2,
        title: `Follow up with ${custLabel(c)}`, body: `You set a follow-up for ${fmtDateLong(c.next_follow_up)}.${c.notes ? ` Notes: ${c.notes.slice(0, 160)}` : ""}`, channel: "none", since: c.next_follow_up });
    }
    const theirs = data.orders.filter((o) => o.customer_id === c.id && o.status !== "request" && o.status !== "quote");
    if (!theirs.length) continue;
    const open = theirs.some((o) => o.status !== "completed");
    const recent = theirs.some((o) => ageDays(o.created_at, now) < 60);
    if (open || recent) continue;
    const invoices = theirs.filter((o) => o.type === "invoice");
    const lastYear = invoices.find((o) => { const d = ageDays(o.created_at, now); return d >= 330 && d <= 380; });
    const vc = { first: firstName(c.name), shop };
    if (lastYear) {
      const v = { ...vc, lastJob: lastYear.nickname ? `"${lastYear.nickname}"` : `order #${lastYear.number}`, lastDate: fmtDateLong(lastYear.created_at.slice(0, 10)) };
      push(null, c, { key: `annual:${c.id}:${lastYear.id}`, kind: "annual_reorder", priority: 2,
        title: `${custLabel(c)} ordered ${v.lastJob} about a year ago`, body: `Ask if they're doing it again this year (last time: ${money(lastYear.total)}).`,
        template: "annual_reorder", draft: renderTemplate("annual_reorder", v), channel: "customer", since: lastYear.created_at });
      continue;
    }
    const last = invoices.sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
    if (last && ageDays(last.created_at, now) >= a.reorderAfterDays) {
      const v = { ...vc, lastJob: last.nickname ? `"${last.nickname}"` : `order #${last.number}`, lastDate: fmtDateLong(last.created_at.slice(0, 10)) };
      push(null, c, { key: `idle:${c.id}:${last.id}`, kind: "idle_customer", priority: 3,
        title: `Check in with ${custLabel(c)}`, body: `No orders in ${plural(Math.floor(ageDays(last.created_at, now)), "day")}. Last: ${v.lastJob} (${money(last.total)}).`,
        template: "reorder_checkin", draft: renderTemplate("reorder_checkin", v), channel: "customer", since: last.created_at });
    }
  }

  return out.sort((x, y) => x.priority - y.priority || x.since.localeCompare(y.since));
}

/** Hides items staff dismissed, finished or snoozed (by key). */
export function applyDecisions(items: FollowUp[], decided: { dedupe_key: string | null; status: string; snoozed_until: string | null }[], now = Date.now()) {
  const m = new Map(decided.filter((d) => d.dedupe_key).map((d) => [d.dedupe_key!, d]));
  const open: FollowUp[] = [], snoozed: (FollowUp & { until: string })[] = [];
  for (const it of items) {
    const d = m.get(it.key);
    if (!d || d.status === "open") open.push(it);
    else if (d.status === "snoozed") {
      if (d.snoozed_until && new Date(d.snoozed_until).getTime() <= now) open.push(it);
      else snoozed.push({ ...it, until: d.snoozed_until || "" });
    }
  }
  return { open, snoozed };
}
