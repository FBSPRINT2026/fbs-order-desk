"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** The customer's credit in their portal (lib/credits.ts): see it, put it on an invoice, or ask for it back. */
async function who(customerId: string) {
  const v = await getViewer();
  if (!v.user) throw new Error("Please sign in again.");
  const admin = createAdminClient();
  if (!v.isStaff) {
    const { data } = await v.supabase.from("customers").select("id").eq("id", customerId).maybeSingle();
    if (!data) throw new Error("We couldn't find your account.");
  }
  return { admin, email: v.email, staff: v.isStaff };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function myCredit(customerId: string) {
  try {
    const { admin } = await who(customerId);
    const { creditsOf } = await import("@/lib/credits");
    const { openInvoices } = await import("@/lib/statementServer");
    const [cr, open] = await Promise.all([creditsOf(admin, customerId), openInvoices(admin, [customerId])]);
    return { ok: true as const, total: cr.total, pending: cr.pending, from: cr.list, open: open.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, balance: o.balance })) };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

export async function applyMyCredit(customerId: string, orderId: string, amount: number) {
  try {
    const { admin, email, staff } = await who(customerId);
    if (staff) return { ok: false as const, error: "This is a preview." };
    const r = await (await import("@/lib/credits")).applyCredit(admin, customerId, orderId, amount, email);
    revalidatePath("/portal");
    return r;
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** their credit back to the card it was paid with: $20 or less right away, more after FBS approves */
export async function refundMyCredit(customerId: string, amount: number) {
  try {
    const { admin, email, staff } = await who(customerId);
    if (staff) return { ok: false as const, error: "This is a preview." };
    const lib = await import("@/lib/credits");
    const cr = await lib.creditsOf(admin, customerId);
    const want = r2(Math.min(+amount || 0, cr.total));
    if (!(want > 0.004)) return { ok: false as const, error: "There's no credit to refund." };
    const now = want <= lib.AUTO_REFUND_MAX + 0.004;
    let left = want, done = 0, waiting = 0;
    for (const c of cr.list) {
      if (left <= 0.004) break;
      const take = r2(Math.min(c.credit, left));
      const r = now ? await lib.refundCredit(admin, customerId, c.id, take, email) : await lib.requestRefund(admin, customerId, c.id, take, email);
      if (!r.ok) { if (!done && !waiting) return r; break; }
      if (now) done = r2(done + take); else waiting = r2(waiting + take);
      left = r2(left - take);
    }
    if (waiting) {
      const { SHOP_NOTIFY_EMAIL } = await import("@/lib/config");
      const { sendEmail, emailLayout, siteUrl } = await import("@/lib/email");
      if (SHOP_NOTIFY_EMAIL) await sendEmail({ to: SHOP_NOTIFY_EMAIL, subject: `Refund to approve: $${waiting.toFixed(2)}`, html: emailLayout("FBS Print", `A customer asked for $${waiting.toFixed(2)} of their credit back`, "It's waiting in Receive a Payment for you or Amanda to approve.", "Open Receive a Payment", `${siteUrl()}/shop/receive-payment?customer=${customerId}`) }).catch(() => false);
    }
    revalidatePath("/portal");
    return { ok: true as const, refunded: done, waiting };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
