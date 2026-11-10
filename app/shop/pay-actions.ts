"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { mergeSettings } from "@/lib/pricing";
import { money } from "@/lib/format";
import { allocateOldest } from "@/lib/paySelect";
import { openInvoices } from "@/lib/statementServer";

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}

/**
 * One check or ACH that covers many invoices: applied to the oldest open invoices first (the last one partly),
 * or only to the invoices picked. Worked out here from the database, never from the browser.
 */
export async function recordLumpPayment(customerId: string, p: { amount: number; method: string; paid_on: string; note: string; orderIds?: string[]; preview?: boolean }):
  Promise<{ ok: boolean; error?: string; applied?: { number: number; amount: number; full: boolean }[]; total?: number }> {
  try {
    const { email } = await staff();
    const admin = createAdminClient();
    // every open invoice: ours and the old Printavo ones (Nov 10, Nick: Creative Apparel's open invoices were all old
    // ones, "pv:" ids from the payments list); the ones checked, if any
    const ours = (await openInvoices(admin, [customerId])).map((o) => ({ id: o.id, number: o.number, balance: o.balance, created_at: o.created_at, old: false }));
    const { data: arch } = await admin.from("archived_orders").select("id, visual_id, balance, order_date, imported_at").eq("customer_id", customerId).eq("kind", "invoice").is("removed_at", null).gt("balance", 0.004).order("id").limit(1000);
    const olds = ((arch || []) as { id: string; visual_id: string; balance: number; order_date: string | null; imported_at: string | null }[])
      .map((a) => ({ id: `pv:${a.id}`, number: +a.visual_id || 0, balance: Math.round(+a.balance * 100) / 100, created_at: a.order_date || a.imported_at || "", old: true }));
    let open = [...olds, ...ours];
    if (p.orderIds?.length) open = open.filter((o) => p.orderIds!.includes(o.id));
    const owed = Math.round(open.reduce((a, o) => a + o.balance, 0) * 100) / 100;
    const amt = Math.round(+p.amount * 100) / 100;
    if (!(amt > 0)) return { ok: false, error: "Enter the amount received." };
    if (amt > owed + 0.004) return { ok: false, error: `That's more than ${p.orderIds?.length ? "the invoices checked" : "the open invoices"} total (${money(owed)}). Record the extra separately.` };
    const parts = allocateOldest(open, amt);
    const applied = parts.map((x) => ({ number: x.item.number, amount: x.amount, full: x.amount >= x.item.balance - 0.004 }));
    if (p.preview) return { ok: true, applied, total: amt };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.paid_on) ? p.paid_on : new Date().toISOString().slice(0, 10);
    const method = (p.method || "Check").slice(0, 40);
    const note = `${p.note ? p.note.slice(0, 160) + " · " : ""}${money(amt)} ${method} applied to ${parts.length} invoice${parts.length === 1 ? "" : "s"}`;
    // one id for the whole check: QuickBooks gets it as ONE payment applied to each invoice it paid, so it matches the
    // deposit (lib/qbo/push.ts chargePayment), and the payment history shows it as one line
    const rec = `rec:${crypto.randomUUID()}`;
    const { error } = await admin.from("payments").insert(parts.map((x) => ({ ...(x.item.old ? { order_id: null, archived_order_id: x.item.id.slice(3) } : { order_id: x.item.id }), amount: x.amount, method, paid_on: day, note, processor_id: rec })));
    if (error) return { ok: false, error: error.message };
    const newParts = parts.filter((x) => !x.item.old);
    if (newParts.length) await admin.from("order_events").insert(newParts.map((x) => ({ order_id: x.item.id, kind: "payment", detail: `${money(x.amount)} ${method} (part of ${money(amt)})`, actor: email })));
    for (const x of newParts) await (await import("@/lib/autoSeps")).autoSeparations(admin, x.item.id, "paid");
    return { ok: true, applied, total: amt };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Email the customer a link to their statement (open invoices, aging, and a Pay this statement button). */
export async function emailStatement(customerId: string): Promise<{ ok: boolean; error?: string; emailed?: boolean }> {
  try {
    await staff();
    const admin = createAdminClient();
    const [{ data: c }, { data: s }] = await Promise.all([
      admin.from("customers").select("id, name, company, email").eq("id", customerId).maybeSingle(),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    if (!c?.email) return { ok: false, error: "This customer has no email address." };
    const open = await openInvoices(admin, [customerId]);
    if (!open.length) return { ok: false, error: "Nothing is owed right now." };
    const shop = mergeSettings(s?.data).shop.name;
    const total = open.reduce((a, o) => a + o.balance, 0);
    // to whoever at the customer gets invoices (lib/customerEmails.ts); sent by hand, so the main email if nobody does
    const m = await import("@/lib/customerEmailServer"); const { recipientsOf } = await import("@/lib/customerEmails");
    const pp = await m.peopleOf(admin, customerId);
    const to = recipientsOf({ ...pp.prefs, invoices: { ...(pp.prefs.invoices || {}), on: true } }, "invoices", pp.people);
    const html = m.customerEmailHtml({ shop: mergeSettings(s?.data).shop, chip: { text: "Statement", tone: "blue" }, head: `Your statement`, big: money(total),
      lines: [`${c.company || c.name}, you have ${open.length} open invoice${open.length === 1 ? "" : "s"}. See them all, print the statement, and pay everything at once in your portal.`],
      rows: open.slice(0, 8).map((o): [string, string] => [`#${o.number}${(o as { nickname?: string }).nickname ? ` ${(o as { nickname?: string }).nickname}` : ""}`, money(o.balance)]),
      button: { label: "View and pay statement", url: `${siteUrl()}/portal/statement` } });
    let emailed = false;
    for (const t of to.length ? to : [c.email]) if (await sendEmail({ to: t, replyTo: SHOP_NOTIFY_EMAIL, subject: `Your statement from ${shop}: ${money(total)}`, html })) emailed = true;
    return { ok: true, emailed };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
