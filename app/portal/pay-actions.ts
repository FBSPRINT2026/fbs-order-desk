"use server";
import { termsPct } from "@/lib/payTerms";
import { allRows } from "@/lib/readAll";
import { revalidatePath } from "next/cache";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, receiptHtml, sendEmail, siteUrl } from "@/lib/email";
import { calcOrder, mergeSettings, r2, type Order, type Payment, type PayTerms } from "@/lib/pricing";
import { money } from "@/lib/format";
import { allocateOldest } from "@/lib/paySelect";
import { payState } from "@/lib/payReady";

type Result = { receiptTo?: string; ok: boolean; error?: string; paid?: number; fee?: number };
const STAX_API = "https://apiprod.fattlabs.com";
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

/**
 * The signed-in customer's orders (row security checks they're theirs) with what's owed on each,
 * worked out here from the order and its payments — never taken from the browser.
 */
async function owed(items: { orderId: string; kind: "deposit" | "balance" }[], applyAmount?: number) {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Customers pay from their own login.");
  if (!items.length) throw new Error("Pick at least one order to pay.");
  // "pv:<id>": an invoice from our old system (Printavo), paid here once the account has moved (Nov 2, Nick)
  const oldIds = [...new Set(items.filter((i) => i.orderId.startsWith("pv:")).map((i) => i.orderId.slice(3)))];
  const ids = [...new Set(items.filter((i) => !i.orderId.startsWith("pv:")).map((i) => i.orderId))];
  const { data: os } = ids.length ? await supabase.from("orders").select("*").in("id", ids) : { data: [] };
  const orders = (os || []) as Order[];
  if (orders.length !== ids.length) throw new Error("We couldn't find one of those orders.");
  const admin = createAdminClient();
  const [{ data: pays }, { data: s }, { data: cs }] = await Promise.all([
    ids.length ? admin.from("payments").select("*").in("order_id", ids) : Promise.resolve({ data: [] }),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    allRows((ra, rb) => supabase.from("customers").select("*").order("id").range(ra, rb)),
  ]);
  const settings = mergeSettings(s?.data);
  // old invoices: only their own (row security above lists only their customers), only once the account has moved
  const mine = ((cs || []) as { id: string; moved_at?: string | null }[]);
  const { data: olds } = oldIds.length ? await admin.from("archived_orders").select("id, visual_id, nickname, order_date, balance, customer_id, kind").is("removed_at", null).in("id", oldIds) : { data: [] };
  const oldLines = ((olds || []) as { id: string; visual_id: string; nickname: string | null; order_date: string | null; balance: number; customer_id: string; kind: string }[]).map((a) => {
    const c = mine.find((x) => x.id === a.customer_id);
    if (!c) throw new Error("We couldn't find one of those orders.");
    if (!c.moved_at) throw new Error(`#${a.visual_id} is from our old system: pay it on its own invoice for now.`);
    if (a.kind !== "invoice" || !(+a.balance > 0.004)) throw new Error(`#${a.visual_id} is already paid.`);
    return { o: { id: a.id, number: +a.visual_id || 0, nickname: a.nickname || "", created_at: a.order_date || "", type: "invoice", total: +a.balance, customer_id: a.customer_id } as unknown as Order, amount: r2(+a.balance), old: true };
  });
  if (oldLines.length !== oldIds.length) throw new Error("We couldn't find one of those orders.");
  const lines0 = items.filter((it) => !it.orderId.startsWith("pv:")).map((it) => {
    const o = orders.find((x) => x.id === it.orderId)!;
    const c = calcOrder(o, settings, ((pays || []) as Payment[]).filter((p) => p.order_id === o.id));
    // only what the shop has opened up for paying (lib/payReady.ts): never the whole balance before it's ready
    // the customer's payment terms decide what's paid up front (lib/payTerms.ts)
    const terms = ((cs || []) as { id: string; payment_terms?: PayTerms }[]).find((x) => x.id === o.customer_id)?.payment_terms || "receipt";
    const tPct = termsPct(terms, settings.depositPct);
    const ps = payState(o as Order & { pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }, { paid: c.paid, depositPct: settings.depositPct, terms });
    if (ps.can === "none") throw new Error(`#${o.number} isn't ready to pay yet. ${ps.why}`);
    const deposit = Math.min(c.balance, r2((c.total * (tPct > 0 && tPct < 100 ? tPct : settings.depositPct)) / 100));
    const amount = r2(ps.can === "deposit" || (it.kind === "deposit" && c.paid < 0.005) ? deposit : c.balance);
    if (amount <= 0.004) throw new Error(`#${o.number} is already paid.`);
    return { o, amount, old: false };
  });
  const lines = [...lines0, ...oldLines];
  // "pay an amount": oldest orders first, the last one partly
  let use = lines;
  if (applyAmount !== undefined) {
    const total = r2(lines.reduce((a, l) => a + l.amount, 0));
    const amt = r2(+applyAmount);
    if (!(amt >= 1)) throw new Error("Enter an amount of at least $1.");
    if (amt > total + 0.004) throw new Error(`That's more than these orders owe (${money(total)}).`);
    use = allocateOldest(lines.map((l) => ({ ...l, balance: l.amount, created_at: l.o.created_at, number: l.o.number })), amt).map((x) => ({ o: x.item.o, amount: x.amount, old: x.item.old }));
  }
  return { admin, email, settings, lines: use, customer: (cs || [])[0] as { id: string; name: string; company: string; email: string } | undefined };
}

/** Card fee on a credit card payment (a setting; never on ACH, Zelle or Venmo). */
const cardFee = (sum: number, pct: number) => r2((sum * Math.max(0, pct)) / 100);

/**
 * Pay one or more orders together with a card or bank account the customer entered in Stax's secure fields.
 * paymentMethodId comes from Stax.js tokenize(); the card or bank numbers never touch our server.
 */
export async function payOrders(input: { items: { orderId: string; kind: "deposit" | "balance" }[]; method: "card" | "bank"; paymentMethodId: string; applyAmount?: number; receiptTo?: string;
  /** keep this card / bank account on file (they ticked the box and saw the authorization) */ save?: boolean;
  /** pay with one of their saved ones (our id; the server looks up Stax's) */ savedId?: string;
  /** a bank transfer through QuickBooks Payments (Nov 3): the account typed in, charged once, never kept */ bank?: import("@/lib/qbo/payments").BankIn }): Promise<Result> {
  try {
    const viaQbo = input.method === "bank" && !!input.bank && !input.savedId;
    if (!viaQbo && !process.env.STAX_API_KEY) return { ok: false, error: "Online payments aren't set up yet. Please contact the shop." };
    const { admin, email, settings, lines, customer } = await owed(input.items, input.applyAmount);
    // a run of failed tries locks the pay form for a while (a bot testing stolen cards)
    const since = new Date(Date.now() - 30 * 60000).toISOString();
    const { count: fails } = await admin.from("pay_attempts").select("id", { count: "exact", head: true }).eq("email", email).eq("ok", false).gte("created_at", since);
    if ((fails || 0) >= 5) return { ok: false, error: "Too many payment tries in a row. Please wait 30 minutes, or call us and we'll help." };
    let pmId = input.paymentMethodId || "", saved: { id: string; method: string } | null = null;
    if (input.savedId) {
      // only their own saved card or account (row security), and not one they removed
      const { supabase } = await getViewer();
      const { data: sp } = await supabase.from("saved_payment_methods").select("id, stax_pm_id, method").eq("id", input.savedId).is("removed_at", null).maybeSingle();
      if (!sp) return { ok: false, error: "That saved payment method isn't available any more. Choose another or enter a new one." };
      pmId = sp.stax_pm_id; saved = { id: sp.id, method: sp.method };
      input.method = sp.method === "bank" ? "bank" : "card";
    }
    if (!viaQbo && !/^[\w-]{6,}$/.test(pmId)) return { ok: false, error: "Enter your payment details again." };
    if (viaQbo && (!/^\d{9}$/.test(input.bank!.routing) || !/^\d{4,17}$/.test(input.bank!.account) || !input.bank!.name.trim())) return { ok: false, error: "Check the name, routing number and account number." };
    const sum = r2(lines.reduce((a, l) => a + l.amount, 0));
    const fee = input.method === "card" ? cardFee(sum, settings.pay.cardFeePct) : 0;
    const total = r2(sum + fee);
    const ref = lines.map((l) => `#${l.o.number}`).join(", ");
    let txn: Record<string, unknown> = {};
    if (viaQbo) {
      // the bank transfer through QuickBooks Payments
      const { qboEcheck } = await import("@/lib/qbo/payments");
      const r = await qboEcheck(admin, total, { ...input.bank!, phone: input.bank!.phone || (customer as { phone?: string } | undefined)?.phone || "" }, `${settings.shop.name} ${ref}`);
      if (!r.ok) {
        await admin.from("pay_attempts").insert({ customer_id: customer?.id || null, email, ok: false, amount: total, error: r.error.slice(0, 300) });
        return { ok: false, error: r.error };
      }
      txn = { id: `qbo-echeck:${r.id}`, status: r.status };
    } else {
      const res = await fetch(`${STAX_API}/charge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.STAX_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          payment_method_id: pmId,
          total,
          pre_auth: 0,
          meta: {
            reference: ref.slice(0, 200),
            memo: `${settings.shop.name} ${lines.length > 1 ? "orders" : "order"} ${ref}`.slice(0, 200),
            subtotal: sum,
            ...(fee ? { surcharge: fee } : {}),
            lineItems: lines.map((l) => ({ item: `Order #${l.o.number}`, details: l.o.nickname || "", quantity: 1, price: l.amount })),
            transaction_initiation_type: "CIT",
            transaction_schedule_type: "unscheduled",
          },
        }),
      });
      txn = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || !txn || txn.success === false) {
        const why = (txn && (txn.message || (Array.isArray(txn.error) ? txn.error.join(" ") : txn.error))) || `The payment didn't go through (${res.status}).`;
        await admin.from("pay_attempts").insert({ customer_id: customer?.id || null, email, ok: false, amount: total, error: String(why).slice(0, 300) });
        return { ok: false, error: String(why) };
      }
    }
    await admin.from("pay_attempts").insert({ customer_id: customer?.id || null, email, ok: true, amount: total });
    if (saved) await admin.from("saved_payment_methods").update({ last_used_at: new Date().toISOString() }).eq("id", saved.id);
    // kept on file: Stax's id and what's on a receipt (brand, last 4, expiry), read from Stax itself
    if (input.save && !saved && !viaQbo && customer?.id) await keepOnFile(admin, customer.id, pmId, input.method, email, settings.shop.name).catch(() => null);
    // record it on each order; the card fee is split across them so the order balances stay exact
    const methodName = input.method === "card" ? "Credit card" : viaQbo ? "ACH (QuickBooks)" : "ACH";
    let feeLeft = fee;
    const today = new Date().toISOString().slice(0, 10);
    const rows = lines.map((l, i) => {
      const f = i === lines.length - 1 ? r2(feeLeft) : r2((fee * l.amount) / (sum || 1));
      feeLeft = r2(feeLeft - f);
      return { ...(l.old ? { order_id: null, archived_order_id: l.o.id } : { order_id: l.o.id }), amount: l.amount, method: methodName, paid_on: today, fee: f, processor_id: String(txn.id || ""), note: lines.length > 1 ? `Paid together: ${ref}` : null };
    });
    const { error } = await admin.from("payments").insert(rows);
    // paying a quote approves it (the customer saw "Paying approves the quote and our terms")
    const quotes = lines.filter((l) => !l.old && l.o.type === "quote");
    if (!error && quotes.length) {
      const who = customer?.name || email;
      await admin.from("orders").update({ type: "invoice", status: "approved", approved_at: new Date().toISOString(), approved_name: `${who} (paid online)` }).in("id", quotes.map((l) => l.o.id));
      await admin.from("order_events").insert(quotes.map((l) => ({ order_id: l.o.id, kind: "status", detail: "approved (paid online)", actor: email })));
    }
    if (error) return { ok: false, error: `Your payment went through, but we couldn't record it (${error.message}). Please contact us so we can mark it paid.` };
    const newLines = lines.filter((l) => !l.old);
    // paid: anything now ready asks for its separations (lib/autoSeps.ts)
    for (const l of newLines) await (await import("@/lib/autoSeps")).autoSeparations(admin, l.o.id, "paid");
    if (newLines.length) await admin.from("order_events").insert(newLines.map((l) => ({ order_id: l.o.id, kind: "payment", detail: `${money(l.amount)} ${methodName}${fee ? ` + ${money(rows.find((r) => r.order_id === l.o.id)?.fee)} card fee` : ""}`, actor: email })));
    const { receiptEmailHtml } = await import("@/lib/customerEmailServer");
    const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    // a detailed receipt for their records (every invoice it paid, what's still owed on each): to who they typed in the pay
    // window, and to whoever at the customer gets receipts (lib/customerEmails.ts)
    let to = (input.receiptTo || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 3);
    if (customer?.id) {
      const { peopleOf } = await import("@/lib/customerEmailServer"); const { recipientsOf } = await import("@/lib/customerEmails");
      const pp = await peopleOf(admin, customer.id);
      to = [...new Set([...to, ...recipientsOf(pp.prefs, "receipts", pp.people)])].slice(0, 6);
    }
    let receiptTo = "";
    let shopLines: { number: number; nickname: string; amount: number; balanceAfter: number }[] = lines.map((l) => ({ number: l.o.number, nickname: l.o.nickname || "", amount: l.amount, balanceAfter: 0 }));
    if (to.length || SHOP_NOTIFY_EMAIL) {
      const nIds = lines.filter((l) => !l.old).map((l) => l.o.id), oIds = lines.filter((l) => l.old).map((l) => l.o.id);
      const [{ data: pays2 }, { data: olds2 }] = await Promise.all([
        nIds.length ? admin.from("payments").select("order_id, amount").in("order_id", nIds) : Promise.resolve({ data: [] }),
        oIds.length ? admin.from("archived_orders").select("id, balance").in("id", oIds) : Promise.resolve({ data: [] }),
      ]);
      const paidNow: Record<string, number> = {};
      ((pays2 || []) as { order_id: string; amount: number }[]).forEach((p) => { paidNow[p.order_id] = (paidNow[p.order_id] || 0) + (+p.amount || 0); });
      const oldLeft = Object.fromEntries(((olds2 || []) as { id: string; balance: number }[]).map((a) => [a.id, +a.balance || 0]));
      shopLines = lines.map((l) => ({ number: l.o.number, nickname: l.o.nickname || "", amount: l.amount, balanceAfter: l.old ? r2(oldLeft[l.o.id] || 0) : r2((+l.o.total || 0) - (paidNow[l.o.id] || 0)) }));
      const html = receiptEmailHtml({
        shop: settings.shop, customer: customer?.company || customer?.name || email, date: day,
        method: methodName, txn: String(txn.id || ""), subtotal: sum, fee, total, url: `${siteUrl()}/portal?area=payments`, lines: shopLines,
      });
      const sent = await Promise.all(to.map((addr) => sendEmail({ to: addr, replyTo: SHOP_NOTIFY_EMAIL, subject: `Receipt: ${money(total)} paid to ${settings.shop.name}`, html })));
      receiptTo = to.filter((_, i) => sent[i]).join(", ");
    }
    // the shop's own heads-up, in the same look (Nov 3, Nick: "the payment received is pretty plain")
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `Payment received: ${money(total)} for ${ref}`,
      html: receiptEmailHtml({ shop: settings.shop, customer: customer?.company || customer?.name || email, date: day, method: methodName, txn: String(txn.id || ""), subtotal: sum, fee, total, url: `${siteUrl()}/shop`, lines: shopLines, forShop: true }),
    });
    revalidatePath("/portal");
    lines.forEach((l) => revalidatePath(l.old ? `/portal/archive/${l.o.id}` : `/portal/orders/${l.o.id}`));
    return { ok: true, paid: total, fee, receiptTo };
  } catch (e) { return fail(e); }
}

/** The words they agree to when they tick "Keep this on file". */
const consentText = (shop: string, method: "card" | "bank") =>
  `I authorize ${shop} to keep this ${method === "bank" ? "bank account" : "card"} on file and charge it only for payments I choose in this portal. I can remove it any time in Settings.`;

/** The words they agree to when they let the shop charge it when they ask (Oct 24, Nick: "can you go in and run my card?"). */
const staffConsentText = (shop: string, method: "card" | "bank") =>
  `I authorize ${shop} to charge this ${method === "bank" ? "bank account" : "card"} for my orders when I ask them to (by phone, email or message). I can turn this off or remove it any time in Settings.`;

async function keepOnFile(admin: ReturnType<typeof createAdminClient>, customerId: string, pmId: string, method: "card" | "bank", email: string, shop: string, staffOk = false) {
  const r = await fetch(`${STAX_API}/payment-method/${encodeURIComponent(pmId)}`, { headers: { Authorization: `Bearer ${process.env.STAX_API_KEY}`, Accept: "application/json" } });
  const pm = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const exp = String(pm.card_exp || ""); // "112027"
  const row = {
    customer_id: customerId, stax_pm_id: pmId, method,
    brand: method === "bank" ? String(pm.bank_name || "Bank") : String(pm.card_type || "Card"),
    last4: String(pm.card_last_four || "").slice(-4), exp: /^\d{6}$/.test(exp) ? `${exp.slice(0, 2)}/${exp.slice(4)}` : "",
    holder: String(pm.person_name || ""), consent_text: consentText(shop, method), consented_by: email,
    ...(staffOk ? { staff_charge_ok: true, staff_charge_consent: staffConsentText(shop, method), staff_charge_at: new Date().toISOString(), staff_charge_by: email } : {}),
  };
  // the same card saved again replaces the old entry
  if (row.last4) await admin.from("saved_payment_methods").update({ removed_at: new Date().toISOString(), removed_by: "replaced" }).eq("customer_id", customerId).eq("method", method).eq("last4", row.last4).eq("brand", row.brand).is("removed_at", null);
  await admin.from("saved_payment_methods").insert(row);
}

/** Their saved cards and bank accounts (only the brand, last 4 and expiry). */
export async function mySavedMethods() {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user || isStaff) return { ok: true as const, list: [] as SavedPM[], consent: { card: "", bank: "" } };
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from("saved_payment_methods").select("id, method, brand, last4, exp, holder, last_used_at, staff_charge_ok").is("removed_at", null).order("last_used_at", { ascending: false, nullsFirst: false }),
      createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const shop = mergeSettings(s?.data).shop.name;
    return { ok: true as const, list: (data || []) as SavedPM[], consent: { card: consentText(shop, "card"), bank: consentText(shop, "bank") } };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't load your saved payment methods.", list: [] as SavedPM[], consent: { card: "", bank: "" } }; }
}
export type SavedPM = { id: string; method: string; brand: string; last4: string; exp: string; holder: string; /** they let the shop charge it when they ask */ staff_charge_ok?: boolean };

/** Take a saved card or bank account off file: it can't be used again (kept in our records, marked removed). */
export async function removeSavedMethod(id: string): Promise<Result> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview." };
    const { data: sp } = await supabase.from("saved_payment_methods").select("id").eq("id", id).is("removed_at", null).maybeSingle();
    if (!sp) return { ok: false, error: "We couldn't find that one." };
    const { error } = await createAdminClient().from("saved_payment_methods").update({ removed_at: new Date().toISOString(), removed_by: email }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Customer says they sent a Zelle or Venmo payment. Staff confirm it and record the payment. */
export async function sentPaymentNotice(input: { items: { orderId: string; kind: "deposit" | "balance" }[]; method: "Zelle" | "Venmo"; note: string; applyAmount?: number }): Promise<Result> {
  try {
    const { admin, email, settings, lines, customer } = await owed(input.items, input.applyAmount);
    const sum = r2(lines.reduce((a, l) => a + l.amount, 0));
    const ref = lines.map((l) => `#${l.o.number}`).join(", ");
    const { error } = await admin.from("payment_notices").insert({ customer_id: customer?.id || null, order_ids: lines.map((l) => l.o.id), method: input.method, amount: sum, note: input.note.slice(0, 500), created_by: email });
    if (error) return { ok: false, error: error.message };
    const nl = lines.filter((l) => !l.old);
    if (nl.length) await admin.from("order_events").insert(nl.map((l) => ({ order_id: l.o.id, kind: "payment_notice", detail: `${input.method} ${money(l.amount)} sent (to confirm)`, actor: email })));
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `${input.method} payment sent: ${money(sum)} for ${ref}`,
      html: emailLayout(settings.shop.name, `${customer?.company || customer?.name || email} says they sent ${money(sum)} by ${input.method}`, `For ${ref}.${input.note ? `\n\nNote: ${input.note}` : ""}\n\nCheck your ${input.method} account, then record the payment on the order.`, "Open orders", `${siteUrl()}/shop`),
    });
    revalidatePath("/portal");
    return { ok: true, paid: sum };
  } catch (e) { return fail(e); }
}

/**
 * Add a card or bank account in Settings without paying (Oct 24, Nick: "manage it and click like delete or add new
 * payment"). paymentMethodId comes from Stax.js tokenize(): the numbers never touch our server.
 */
export async function addSavedMethod(input: { paymentMethodId: string; method: "card" | "bank"; staffOk?: boolean }): Promise<Result> {
  try {
    if (!process.env.STAX_API_KEY) return { ok: false, error: "Saving payment methods isn't set up yet. Please contact the shop." };
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview." };
    if (!/^[\w-]{6,}$/.test(input.paymentMethodId || "")) return { ok: false, error: "Enter the details again." };
    const { data: cs } = await supabase.from("customers").select("id").limit(1);
    const cid = (cs || [])[0]?.id as string | undefined;
    if (!cid) return { ok: false, error: "We couldn't find your account." };
    const admin = createAdminClient();
    const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    await keepOnFile(admin, cid, input.paymentMethodId, input.method === "bank" ? "bank" : "card", email, mergeSettings(s?.data).shop.name, !!input.staffOk);
    revalidatePath("/portal/settings");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Let the shop charge a saved one when they ask, or stop it (the words they agreed to are kept). */
export async function setStaffCharge(id: string, on: boolean): Promise<Result> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview." };
    const { data: sp } = await supabase.from("saved_payment_methods").select("id, method").eq("id", id).is("removed_at", null).maybeSingle();
    if (!sp) return { ok: false, error: "We couldn't find that one." };
    const admin = createAdminClient();
    const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const shop = mergeSettings(s?.data).shop.name;
    const { error } = await admin.from("saved_payment_methods").update(on
      ? { staff_charge_ok: true, staff_charge_consent: staffConsentText(shop, sp.method === "bank" ? "bank" : "card"), staff_charge_at: new Date().toISOString(), staff_charge_by: email }
      : { staff_charge_ok: false, staff_charge_at: new Date().toISOString(), staff_charge_by: email }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function staffConsentWords(): Promise<{ card: string; bank: string }> {
  const { data: s } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  const shop = mergeSettings(s?.data).shop.name;
  return { card: staffConsentText(shop, "card"), bank: staffConsentText(shop, "bank") };
}

/** the billing address on file, to fill in the card form (their own account; staff previewing: the previewed one) */
export async function myBillAddress(as?: string): Promise<import("@/lib/billAddress").BillAddr> {
  const { parseBill } = await import("@/lib/billAddress");
  try {
    const { supabase, isStaff } = await getViewer();
    if (isStaff) {
      if (!as) return parseBill("");
      const { data } = await createAdminClient().from("customers").select("address").eq("id", as).maybeSingle();
      return parseBill((data as { address?: string } | null)?.address);
    }
    const { data } = await supabase.from("customers").select("address").order("id").limit(1);
    return parseBill(((data || [])[0] as { address?: string } | undefined)?.address);
  } catch { return parseBill(""); }
}
