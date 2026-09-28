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
    let open = await openInvoices(admin, [customerId]);
    if (p.orderIds?.length) open = open.filter((o) => p.orderIds!.includes(o.id));
    const owed = Math.round(open.reduce((a, o) => a + o.balance, 0) * 100) / 100;
    const amt = Math.round(+p.amount * 100) / 100;
    if (!(amt > 0)) return { ok: false, error: "Enter the amount received." };
    if (amt > owed + 0.004) return { ok: false, error: `That's more than the open invoices total (${money(owed)}). Record the extra separately.` };
    const parts = allocateOldest(open, amt);
    const applied = parts.map((x) => ({ number: x.item.number, amount: x.amount, full: x.amount >= x.item.balance - 0.004 }));
    if (p.preview) return { ok: true, applied, total: amt };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.paid_on) ? p.paid_on : new Date().toISOString().slice(0, 10);
    const method = (p.method || "Check").slice(0, 40);
    const note = `${p.note ? p.note.slice(0, 160) + " · " : ""}${money(amt)} ${method} applied to ${parts.length} invoice${parts.length === 1 ? "" : "s"}`;
    const { error } = await admin.from("payments").insert(parts.map((x) => ({ order_id: x.item.id, amount: x.amount, method, paid_on: day, note })));
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert(parts.map((x) => ({ order_id: x.item.id, kind: "payment", detail: `${money(x.amount)} ${method} (part of ${money(amt)})`, actor: email })));
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
    const emailed = await sendEmail({ to: c.email, replyTo: SHOP_NOTIFY_EMAIL, subject: `Your statement from ${shop}: ${money(total)}`,
      html: emailLayout(shop, `Statement for ${c.company || c.name}`, `You have ${open.length} open invoice${open.length === 1 ? "" : "s"} totaling ${money(total)}. You can see them all, print the statement, and pay everything at once in your portal.`, "View and pay statement", `${siteUrl()}/portal/statement`) });
    return { ok: true, emailed };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
