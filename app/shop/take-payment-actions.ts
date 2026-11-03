"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { mergeSettings, r2 } from "@/lib/pricing";
import { money } from "@/lib/format";

/**
 * Take a Payment (Nov 3, Nick: "if somebody says… clear out their balance… run my card… for the individual invoices…
 * only available to Amanda and I… select the customer, view their… statement, run their card… some clients we agree to
 * not… pay the 3.25%… some clients want to charge… individually… 20 invoices, they want a charge for each one").
 *
 * The customer's open invoices (lib/statementServer.ts), the cards and bank accounts they let us charge (or a new card
 * typed in on the phone, through Stax's own fields), one charge or one per invoice, the card fee on or off (waived
 * customers remembered on the customer). Each charge is recorded on its invoices, a receipt goes to whoever gets receipts
 * at the customer, and anything now paid asks for its separations. Only people with "Take a Payment" (Settings → User
 * Access: Nick, and Amanda).
 */
const STAX = "https://apiprod.fattlabs.com";
export type TPInvoice = { id: string; number: number; nickname: string; po_number: string; created_at: string; total: number; paid: number; balance: number; pay_due: string | null };
export type TPMethod = { id: string; method: string; brand: string; last4: string; exp: string; holder: string; ok: boolean };
export type TPResult = { orderIds: string[]; numbers: number[]; amount: number; fee: number; ok: boolean; ref?: string; error?: string };

async function allowed() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  const admin = createAdminClient();
  const perms = await viewerPerms(admin, v.email, v.role);
  if (!perms.takePayments) throw new Error("Only Nick and Amanda can take payments.");
  return { v, admin, by: String((v.staff as { name?: string } | null)?.name || v.email) };
}

export async function paymentContext(customerId: string): Promise<{ ok: true; customer: { id: string; name: string; company: string; no_card_fee: boolean; charge_split: boolean }; invoices: TPInvoice[]; methods: TPMethod[]; feePct: number } | { ok: false; error: string }> {
  try {
    const { admin } = await allowed();
    const [{ data: c }, { data: s }, { data: pms }] = await Promise.all([
      admin.from("customers").select("id, name, company, no_card_fee, charge_split").eq("id", customerId).maybeSingle(),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
      admin.from("saved_payment_methods").select("id, method, brand, last4, exp, holder, staff_charge_ok").eq("customer_id", customerId).is("removed_at", null).order("last_used_at", { ascending: false, nullsFirst: false }),
    ]);
    if (!c) return { ok: false, error: "Customer not found." };
    const { openInvoices } = await import("@/lib/statementServer");
    const inv = await openInvoices(admin, [customerId]);
    return {
      ok: true, customer: c as { id: string; name: string; company: string; no_card_fee: boolean; charge_split: boolean },
      invoices: inv.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, po_number: o.po_number, created_at: o.created_at, total: o.total, paid: o.paid, balance: o.balance, pay_due: o.pay_due })),
      methods: ((pms || []) as { id: string; method: string; brand: string; last4: string; exp: string; holder: string; staff_charge_ok: boolean }[]).map((m) => ({ id: m.id, method: m.method, brand: m.brand, last4: m.last4, exp: m.exp || "", holder: m.holder || "", ok: !!m.staff_charge_ok })),
      feePct: mergeSettings(s?.data).pay.cardFeePct,
    };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** the customer's standing choices: no card fee, and one charge per invoice */
export async function setPayOptions(customerId: string, p: { no_card_fee?: boolean; charge_split?: boolean }) {
  try {
    const { admin } = await allowed();
    const patch: Record<string, boolean> = {};
    if (typeof p.no_card_fee === "boolean") patch.no_card_fee = p.no_card_fee;
    if (typeof p.charge_split === "boolean") patch.charge_split = p.charge_split;
    const { error } = await admin.from("customers").update(patch).eq("id", customerId);
    return error ? { ok: false as const, error: error.message } : { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** run it: `savedId` (on file, OK to charge) or `newPmId` (a card just typed into Stax's fields) */
export async function takePayment(input: { customerId: string; orderIds: string[]; savedId?: string; newPmId?: string; newMethod?: "card" | "bank"; split: boolean; fee: boolean; save?: boolean; pin: string }): Promise<{ ok: true; results: TPResult[] } | { ok: false; error: string; pin?: boolean }> {
  try {
    const { v, admin, by } = await allowed();
    // the person's PIN, every charge (lib/payPin.ts)
    const pc = await (await import("@/lib/payPin")).checkPin(admin, v.email, input.pin);
    if (!pc.ok) return { ok: false, error: pc.error, pin: true };
    const key = process.env.STAX_API_KEY?.trim();
    if (!key) return { ok: false, error: "Stax isn't connected." };
    const [{ data: c }, { data: s }] = await Promise.all([
      admin.from("customers").select("id, name, company").eq("id", input.customerId).maybeSingle(),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    if (!c) return { ok: false, error: "Customer not found." };
    const settings = mergeSettings(s?.data);
    const { openInvoices } = await import("@/lib/statementServer");
    const open = (await openInvoices(admin, [input.customerId])).filter((o) => input.orderIds.includes(o.id));
    if (!open.length) return { ok: false, error: "Pick at least one invoice with a balance." };
    // what's charged
    let pmId = "", method: "card" | "bank" = "card", label = "", saved: { id: string } | null = null;
    if (input.savedId) {
      const { data: sp } = await admin.from("saved_payment_methods").select("id, stax_pm_id, method, brand, last4, customer_id, staff_charge_ok").eq("id", input.savedId).is("removed_at", null).maybeSingle();
      if (!sp || sp.customer_id !== input.customerId) return { ok: false, error: "That card isn't on this customer." };
      if (!sp.staff_charge_ok) return { ok: false, error: "The customer hasn't OK'd us charging that one. They can turn it on in their portal Settings." };
      pmId = sp.stax_pm_id; method = sp.method === "bank" ? "bank" : "card"; label = `${sp.brand} ${sp.last4}`; saved = { id: sp.id };
    } else if (input.newPmId && /^[\w-]{6,}$/.test(input.newPmId)) {
      pmId = input.newPmId; method = input.newMethod === "bank" ? "bank" : "card"; label = method === "bank" ? "bank account" : "card";
    } else return { ok: false, error: "Pick a card, or type a new one." };
    const pct = method === "card" && input.fee ? Math.max(0, settings.pay.cardFeePct) : 0;
    const groups = input.split ? open.map((o) => [o]) : [open];
    const results: TPResult[] = [];
    const methodName = method === "bank" ? "ACH" : "Credit card";
    for (const g of groups) {
      const sum = r2(g.reduce((a, o) => a + o.balance, 0));
      const fee = r2((sum * pct) / 100), total = r2(sum + fee);
      const ref = g.map((o) => `#${o.number}`).join(", ");
      const res = await fetch(`${STAX}/charge`, {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ payment_method_id: pmId, total, pre_auth: 0, meta: {
          reference: ref.slice(0, 100), memo: `${settings.shop.name} ${ref}${saved ? " (charged at the customer's request)" : " (phone payment)"}`.slice(0, 200), subtotal: sum, ...(fee ? { surcharge: fee } : {}),
          lineItems: g.map((o) => ({ item: `Invoice #${o.number}`, details: o.nickname || "", quantity: 1, price: o.balance })),
          ...(saved ? { transaction_initiation_type: "MIT", transaction_schedule_type: "unscheduled" } : {}),
        } }),
      });
      const txn = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || txn.success === false) {
        const why = String(txn.message || (Array.isArray(txn.error) ? (txn.error as string[]).join(" ") : txn.error) || `The charge didn't go through (${res.status}).`);
        await admin.from("order_events").insert(g.map((o) => ({ order_id: o.id, kind: "payment", detail: `Take a Payment failed (${label}): ${why.slice(0, 200)}`, actor: v.email })));
        results.push({ orderIds: g.map((o) => o.id), numbers: g.map((o) => o.number), amount: sum, fee, ok: false, error: why });
        continue;
      }
      const day = new Date().toISOString().slice(0, 10);
      // the fee split over the invoices in the charge, the last one taking what's left
      let feeLeft = fee;
      const rows = g.map((o, i) => { const f = i === g.length - 1 ? r2(feeLeft) : r2((fee * o.balance) / (sum || 1)); feeLeft = r2(feeLeft - f); return { order_id: o.id, amount: o.balance, method: methodName, paid_on: day, fee: f, processor_id: String(txn.id || ""), note: `${label}, run by ${by}${g.length > 1 ? ` · paid together: ${ref}` : ""}` }; });
      const { error } = await admin.from("payments").insert(rows);
      if (error) { results.push({ orderIds: g.map((o) => o.id), numbers: g.map((o) => o.number), amount: sum, fee, ok: false, error: `Charged, but not recorded (${error.message}). Record ${money(total)} by hand.` }); continue; }
      await admin.from("order_events").insert(g.map((o) => ({ order_id: o.id, kind: "payment", detail: `${money(o.balance)} ${methodName} (${label})${fee ? ` + card fee` : ""}, Take a Payment`, actor: v.email })));
      for (const o of g) await (await import("@/lib/autoSeps")).autoSeparations(admin, o.id, "paid");
      // the receipt, to whoever gets receipts at the customer
      try {
        const m = await import("@/lib/customerEmailServer");
        const html = m.receiptEmailHtml({ shop: settings.shop, customer: c.company || c.name || "", date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), method: `${methodName} (${label})`, txn: String(txn.id || ""), subtotal: sum, fee, total, url: `${(await import("@/lib/email")).siteUrl()}/portal?area=payments`, lines: g.map((o) => ({ number: o.number, nickname: o.nickname, amount: o.balance, balanceAfter: 0 })) });
        await m.sendCustomerEmail(admin, { customerId: input.customerId, kind: "receipts", orderId: g[0].id, subject: `Receipt: ${money(total)} paid to ${settings.shop.name}`, html, actor: v.email });
      } catch { /* the payment stands without its receipt */ }
      results.push({ orderIds: g.map((o) => o.id), numbers: g.map((o) => o.number), amount: sum, fee, ok: true, ref: String(txn.id || "") });
    }
    if (saved) await admin.from("saved_payment_methods").update({ last_used_at: new Date().toISOString() }).eq("id", saved.id);
    // a new card they asked us to keep: on file, OK to charge when they ask (they said so on the phone)
    if (!saved && input.save && results.some((r) => r.ok)) {
      const r = await fetch(`${STAX}/payment-method/${encodeURIComponent(pmId)}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
      const pm = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      const exp = String(pm.card_exp || "");
      const note = `Given to ${by} on the phone and kept at the customer's request, ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`;
      await admin.from("saved_payment_methods").insert({ customer_id: input.customerId, stax_pm_id: pmId, method, brand: method === "bank" ? String(pm.bank_name || "Bank") : String(pm.card_type || "Card"), last4: String(pm.card_last_four || "").slice(-4), exp: /^\d{6}$/.test(exp) ? `${exp.slice(0, 2)}/${exp.slice(4)}` : "", holder: String(pm.person_name || ""), consent_text: note, consented_by: v.email, staff_charge_ok: true, staff_charge_consent: note, staff_charge_at: new Date().toISOString(), staff_charge_by: v.email });
    }
    revalidatePath(`/shop/customers/${input.customerId}`);
    return { ok: true, results };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** the PINs: whether you have one; the owner sees everyone who can take payments and can set theirs */
export async function pinInfo(): Promise<{ ok: true; mine: boolean; owner: boolean; people: { email: string; name: string; has: boolean }[] } | { ok: false; error: string }> {
  try {
    const { v, admin } = await allowed();
    const { hasPin } = await import("@/lib/payPin");
    const mine = await hasPin(admin, v.email);
    if (v.role !== "owner") return { ok: true, mine, owner: false, people: [] };
    const [{ data: st }, { data: s }, { data: pins }] = await Promise.all([
      admin.from("staff").select("email, name, role"), admin.from("settings").select("data").eq("id", 1).maybeSingle(), admin.from("staff_pay_pins").select("email"),
    ]);
    const { permsFor, accessOf } = await import("@/lib/roles");
    const acc = accessOf(s?.data), have = new Set(((pins || []) as { email: string }[]).map((p) => p.email));
    const people = ((st || []) as { email: string; name: string; role: string }[]).filter((p) => permsFor(p.role, acc[p.email.toLowerCase()]).takePayments).map((p) => ({ email: p.email.toLowerCase(), name: p.name || p.email, has: have.has(p.email.toLowerCase()) }));
    return { ok: true, mine, owner: true, people };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** set a PIN: your own (with your old one, once you have one), or, for the owner, anyone who can take payments */
export async function savePin(p: { email?: string; pin: string; old?: string }) {
  try {
    const { v, admin, by } = await allowed();
    const lib = await import("@/lib/payPin");
    const target = (p.email || v.email).toLowerCase();
    if (target !== v.email.toLowerCase()) {
      if (v.role !== "owner") return { ok: false as const, error: "Only the owner sets someone else's PIN." };
      const { data: st } = await admin.from("staff").select("role").eq("email", target).maybeSingle();
      if (!st) return { ok: false as const, error: "That person isn't on staff." };
    } else if (await lib.hasPin(admin, target) && v.role !== "owner") {
      const c = await lib.checkPin(admin, target, p.old || "");
      if (!c.ok) return { ok: false as const, error: c.error === "That PIN isn't right." ? "Your current PIN isn't right." : c.error };
    }
    return await lib.setPin(admin, target, p.pin, by);
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
