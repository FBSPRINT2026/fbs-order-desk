import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openInvoices, type OpenInvoice } from "@/lib/statementServer";
import { customerEmailHtml, peopleOf } from "@/lib/customerEmailServer";
import { recipientsOf } from "@/lib/customerEmails";
import { mergeSettings, PAY_TERMS, type PayTerms } from "@/lib/pricing";
import { sendEmail, siteUrl } from "@/lib/email";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { fmtDateLong, money } from "@/lib/format";

/**
 * Send a bill (Nick, Nov 16 2026: "when we finalize an invoice… we need to be able to just send them a bill… individual
 * bills or grouped… not everybody's going into the portal every day"). One email for one invoice or several: the total,
 * each invoice, and one Pay button that opens their portal with exactly those invoices picked (`?area=payments&pay=<ids>`,
 * AccountAreas). Each bill is kept (`bills`), logged on each order, and gets one reminder 7 days later for whatever of it
 * is still unpaid then (`billReminders`, the daily cron). The tool is components/tools/SendBillTool.tsx.
 */
export type BillInvoice = OpenInvoice & { ready: boolean };
export const REMIND_DAYS = 7;

/** a customer's open invoices, ready to pay (finished: it has a pay date) or still being made */
export async function billInvoices(admin: SupabaseClient, customerId: string): Promise<BillInvoice[]> {
  return (await openInvoices(admin, [customerId])).map((o) => ({ ...o, ready: !!o.pay_due }));
}

/** who gets a bill: whoever at the customer gets invoices (Settings on their account), else their main email */
export async function billPeople(admin: SupabaseClient, customerId: string) {
  const pp = await peopleOf(admin, customerId);
  const to = recipientsOf({ ...pp.prefs, invoices: { ...(pp.prefs.invoices || {}), on: true } }, "invoices", pp.people);
  return { people: pp.people, to: to.length ? to : pp.people.filter((p) => p.main).map((p) => p.email), name: pp.name, company: pp.company };
}

function billHtml(shop: ReturnType<typeof mergeSettings>["shop"], who: { name: string; company: string }, inv: BillInvoice[], note: string, reminder: boolean, terms: string) {
  const total = inv.reduce((a, o) => a + o.balance, 0);
  const first = (who.name || "").trim().split(/\s+/)[0];
  const ids = inv.map((o) => o.id).join(",");
  return customerEmailHtml({
    shop, chip: { text: reminder ? "Reminder" : "Ready to pay", tone: reminder ? "amber" : "blue" },
    head: reminder ? "A reminder: your bill" : "Your bill", big: money(total),
    hi: first ? `Hi ${first}${who.company && who.company.toLowerCase() !== first.toLowerCase() ? ` with ${who.company}` : ""},` : undefined,
    lines: [
      ...(note.trim() ? [note.trim()] : []),
      reminder ? `${inv.length === 1 ? "This invoice is" : `These ${inv.length} invoices are`} still open. You can pay ${inv.length === 1 ? "it" : "them all at once"} in your portal.`
        : `Here ${inv.length === 1 ? "is your invoice" : `are ${inv.length} invoices`}, ready to pay.${inv.length > 1 ? " You can pay them all at once, or one at a time." : ""}`,
    ],
    rows: inv.map((o): [string, string] => [`#${o.number}${o.nickname ? ` ${o.nickname}` : ""}${o.po_number ? ` · PO ${o.po_number}` : ""}`, money(o.balance)]),
    button: { label: `Pay ${money(total)} now`, url: `${siteUrl()}/portal?area=payments&pay=${ids}` },
    after: terms ? `Terms: ${terms}. Opens your portal with ${inv.length === 1 ? "this invoice" : `these ${inv.length} invoices`} picked, by card or bank.` : undefined,
  });
}

/** send it: the invoices still open of those picked; one email to each person; kept and logged */
export async function sendBill(admin: SupabaseClient, b: { customerId: string; orderIds: string[]; to: string[]; note: string; remind: boolean; by: string }) {
  const [all, { data: s }, { data: c }, who] = await Promise.all([
    billInvoices(admin, b.customerId),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("customers").select("payment_terms").eq("id", b.customerId).maybeSingle(),
    billPeople(admin, b.customerId),
  ]);
  const want = new Set(b.orderIds);
  const inv = all.filter((o) => want.has(o.id));
  if (!inv.length) return { ok: false as const, error: "Nothing picked is still owed." };
  const to = [...new Set(b.to.map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))];
  if (!to.length) return { ok: false as const, error: "Add who it goes to." };
  const shop = mergeSettings(s?.data).shop;
  const terms = PAY_TERMS[((c as { payment_terms?: string } | null)?.payment_terms || "receipt") as PayTerms] || "";
  const total = Math.round(inv.reduce((a, o) => a + o.balance, 0) * 100) / 100;
  const html = billHtml(shop, who, inv, b.note, false, terms);
  const subject = `Your bill from ${shop.name}: ${money(total)}${inv.length > 1 ? ` for ${inv.length} invoices` : ` · #${inv[0].number}`}`;
  const sent: string[] = [];
  for (const t of to) if (await sendEmail({ to: t, subject, html, replyTo: SHOP_NOTIFY_EMAIL || undefined })) sent.push(t);
  if (!sent.length) return { ok: false as const, error: "The email didn't go out. Check Settings → Site email." };
  await admin.from("bills").insert({ customer_id: b.customerId, order_ids: inv.map((o) => o.id), total, sent_to: sent, note: b.note.trim(), sent_by: b.by, remind_at: b.remind ? new Date(Date.now() + REMIND_DAYS * 86400000).toISOString() : null });
  // a bill is asking to be paid: each order on it is open to pay online now, finished or not, whatever the terms (Nick, Nov 19
  // 2026, #50135: Fossil's bill went out while it was in production on due-on-receipt terms, and the link wouldn't take her
  // payment). Send a bill asks first when any isn't done yet (SendBillTool); this is the order page's Online payment → Ready.
  await admin.from("orders").update({ pay_mode: "ready" }).in("id", inv.map((o) => o.id)).or("pay_mode.is.null,pay_mode.neq.ready");
  await admin.from("order_events").insert(inv.map((o) => ({ order_id: o.id, kind: "customer_email", detail: `bill · Bill sent to ${sent.join(", ")}${inv.length > 1 ? ` (with ${inv.length - 1} other invoice${inv.length > 2 ? "s" : ""}, ${money(total)} in all)` : ""}`, actor: b.by })));
  return { ok: true as const, sent, total, count: inv.length };
}

/** the daily reminders: a bill sent 7 days ago with anything still unpaid gets one reminder for what's left, then stops */
export async function billReminders(admin: SupabaseClient) {
  const { data } = await admin.from("bills").select("id, customer_id, order_ids, sent_to, remind_at").is("reminded_at", null).not("remind_at", "is", null).lte("remind_at", new Date().toISOString()).order("remind_at").limit(50);
  let n = 0;
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const shop = mergeSettings(s?.data).shop;
  for (const b of (data || []) as { id: string; customer_id: string; order_ids: string[]; sent_to: string[] }[]) {
    await admin.from("bills").update({ reminded_at: new Date().toISOString() }).eq("id", b.id);
    const left = (await billInvoices(admin, b.customer_id)).filter((o) => b.order_ids.includes(o.id));
    if (!left.length) continue;
    const [who, { data: c }] = await Promise.all([billPeople(admin, b.customer_id), admin.from("customers").select("payment_terms").eq("id", b.customer_id).maybeSingle()]);
    const terms = PAY_TERMS[((c as { payment_terms?: string } | null)?.payment_terms || "receipt") as PayTerms] || "";
    const total = left.reduce((a, o) => a + o.balance, 0);
    const html = billHtml(shop, who, left, "", true, terms);
    const sent: string[] = [];
    for (const t of b.sent_to) if (await sendEmail({ to: t, subject: `Reminder: ${money(total)} open with ${shop.name}`, html, replyTo: SHOP_NOTIFY_EMAIL || undefined })) sent.push(t);
    if (sent.length) { n++; await admin.from("order_events").insert(left.map((o) => ({ order_id: o.id, kind: "customer_email", detail: `bill-reminder · Bill reminder sent to ${sent.join(", ")}`, actor: "Automatic" }))); }
  }
  return n;
}

/** the bills sent to a customer lately, for the tool's history line */
export async function recentBills(admin: SupabaseClient, customerId: string) {
  const { data } = await admin.from("bills").select("id, order_ids, total, sent_to, sent_by, sent_at, remind_at, reminded_at").eq("customer_id", customerId).order("sent_at", { ascending: false }).limit(5);
  return ((data || []) as { id: string; order_ids: string[]; total: number; sent_to: string[]; sent_by: string; sent_at: string; remind_at: string | null; reminded_at: string | null }[])
    .map((b) => ({ ...b, when: fmtDateLong(b.sent_at.slice(0, 10)) }));
}
