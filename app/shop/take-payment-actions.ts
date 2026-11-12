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
export type TPInvoice = { /** an old Printavo invoice ("pv:<id>"): a check / ACH / cash can pay it here; a card can't */ old?: boolean; id: string; number: number; nickname: string; po_number: string; created_at: string; total: number; paid: number; balance: number; pay_due: string | null; /** the card fee already in it (lib/cardFeeIn.ts) */ cardFeeIn?: number };
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
      invoices: [...(await oldOpen(admin, [customerId])), ...inv.map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, po_number: o.po_number, created_at: o.created_at, total: o.total, paid: o.paid, balance: o.balance, pay_due: o.pay_due, cardFeeIn: o.cardFeeIn }))].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.number - b.number),
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
      // no second card fee on an invoice that already has one (lib/cardFeeIn.ts; Nov 4, Nick)
      const feeBase = r2(g.filter((o) => !(o.cardFeeIn > 0.004)).reduce((a, o) => a + o.balance, 0));
      const fee = r2((feeBase * pct) / 100), total = r2(sum + fee);
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
      const feeG = g.filter((o) => !(o.cardFeeIn > 0.004)), lastF = feeG[feeG.length - 1];
      const rows = g.map((o) => { const f = !fee || o.cardFeeIn > 0.004 ? 0 : o === lastF ? r2(feeLeft) : r2((fee * o.balance) / (feeBase || 1)); feeLeft = r2(feeLeft - f); return { order_id: o.id, amount: o.balance, method: methodName, paid_on: day, fee: f, processor_id: String(txn.id || ""), note: `${label}, run by ${by}${g.length > 1 ? ` · paid together: ${ref}` : ""}` }; });
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

/** the customer's credit, and refunds waiting for approval (lib/credits.ts) */
export async function shopCredit(customerId: string) {
  try {
    const { admin } = await allowed();
    const { creditsOf } = await import("@/lib/credits");
    const [cr, { data: rq }] = await Promise.all([creditsOf(admin, customerId), admin.from("refund_requests").select("id, order_id, amount, requested_by, requested_at").eq("customer_id", customerId).eq("status", "pending").order("requested_at")]);
    return { ok: true as const, total: cr.total, from: cr.list, pending: (rq || []) as { id: string; order_id: string; amount: number; requested_by: string; requested_at: string }[] };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** put their credit on invoices (no money moves; no PIN: nothing is charged) */
export async function shopApplyCredit(customerId: string, orderIds: string[]) {
  try {
    const { admin, v } = await allowed();
    const lib = await import("@/lib/credits");
    let applied = 0;
    for (const id of orderIds) {
      const r = await lib.applyCredit(admin, customerId, id, 1e9, v.email);
      if (r.ok) applied += r.applied; else if (!applied) return r;
    }
    return { ok: true as const, applied: Math.round(applied * 100) / 100 };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** a refund that was waiting: approve (with your PIN) or decline */
export async function decideRefund(requestId: string, approve: boolean, pin: string) {
  try {
    const { admin, v } = await allowed();
    const { data: rq } = await admin.from("refund_requests").select("*").eq("id", requestId).eq("status", "pending").maybeSingle();
    if (!rq) return { ok: false as const, error: "That refund was already handled." };
    if (!approve) {
      await admin.from("refund_requests").update({ status: "declined", decided_by: v.email, decided_at: new Date().toISOString() }).eq("id", requestId);
      return { ok: true as const };
    }
    const pc = await (await import("@/lib/payPin")).checkPin(admin, v.email, pin);
    if (!pc.ok) return { ok: false as const, error: pc.error, pin: true };
    // the request itself no longer holds the credit back while it's refunded
    await admin.from("refund_requests").update({ status: "done", decided_by: v.email, decided_at: new Date().toISOString() }).eq("id", requestId);
    const r = await (await import("@/lib/credits")).refundCredit(admin, rq.customer_id, rq.order_id, +rq.amount, v.email);
    if (!r.ok) { await admin.from("refund_requests").update({ status: "pending", error: r.error }).eq("id", requestId); return r; }
    await admin.from("refund_requests").update({ stax_refund_id: r.ids.join(",") }).eq("id", requestId);
    return { ok: true as const, refunded: r.refunded };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** refund some of their credit to the card it was paid with, from the shop (PIN) */
export async function shopRefundCredit(customerId: string, amount: number, pin: string) {
  try {
    const { admin, v } = await allowed();
    const pc = await (await import("@/lib/payPin")).checkPin(admin, v.email, pin);
    if (!pc.ok) return { ok: false as const, error: pc.error, pin: true };
    const lib = await import("@/lib/credits");
    const cr = await lib.creditsOf(admin, customerId);
    let left = Math.round(Math.min(+amount || 0, cr.total) * 100) / 100, done = 0;
    for (const c of cr.list) {
      if (left <= 0.004) break;
      const take = Math.round(Math.min(c.credit, left) * 100) / 100;
      const r = await lib.refundCredit(admin, customerId, c.id, take, v.email);
      if (!r.ok) { if (!done) return r; break; }
      done += r.refunded; left = Math.round((left - r.refunded) * 100) / 100;
    }
    return { ok: true as const, refunded: Math.round(done * 100) / 100 };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}


/** old Printavo invoices still owed (archived_orders), as invoices a check, ACH or cash can pay ("pv:<id>", as recordLumpPayment takes them) */
async function oldOpen(admin: ReturnType<typeof createAdminClient>, customerIds: string[]): Promise<(TPInvoice & { customer_id: string })[]> {
  if (!customerIds.length) return [];
  const { data } = await admin.from("archived_orders").select("id, visual_id, nickname, po_number, total, balance, order_date, due_date, imported_at, customer_id").in("customer_id", customerIds).eq("kind", "invoice").is("removed_at", null).gt("balance", 0.004).order("id").limit(1000);
  return ((data || []) as { id: string; visual_id: string; nickname: string | null; po_number: string | null; total: number; balance: number; order_date: string | null; due_date: string | null; imported_at: string | null; customer_id: string }[])
    .map((a) => ({ old: true, id: `pv:${a.id}`, number: +a.visual_id || 0, nickname: a.nickname || "Printavo invoice", po_number: a.po_number || "", created_at: a.order_date || a.imported_at || "", total: r2(+a.total || 0), paid: r2((+a.total || 0) - (+a.balance || 0)), balance: r2(+a.balance || 0), pay_due: a.due_date || null, customer_id: a.customer_id }));
}

export type PayerHit = { kind: "customer"; id: string; name: string; balance: number; open: number } | { kind: "invoice"; id: string; customerId: string; customer: string; number: number; nickname: string; balance: number };

/**
 * Receive a payment's search (Nov 11, Nick: "I should be able to search up top, just type in invoices… or a customer,
 * and it should bring up their balance"): customers by name, and invoices by number or PO, each with what's owed.
 */
export async function findPayers(q0: string): Promise<{ ok: true; hits: PayerHit[] } | { ok: false; error: string }> {
  try {
    const { admin } = await allowed();
    const q = q0.trim().replace(/^#/, "").slice(0, 60);
    if (q.length < 2 && !/^\d+$/.test(q)) return { ok: true, hits: [] };
    const like = `%${q.replace(/[%_,()]/g, " ")}%`;
    const num = /^\d{3,6}$/.test(q) ? +q : null;
    const [{ data: cs }, { data: os }, { data: ar }] = await Promise.all([
      admin.from("customers").select("id, name, company").or(`company.ilike.${like},name.ilike.${like}`).limit(8),
      admin.from("orders").select("id, number, nickname, customer_id").eq("type", "invoice").is("discarded_at", null).or(num ? `number.eq.${num},po_number.ilike.${like}` : `po_number.ilike.${like}`).limit(6),
      admin.from("archived_orders").select("id, visual_id, nickname, customer_id, balance").eq("kind", "invoice").is("removed_at", null).gt("balance", 0.004).or(num ? `visual_id.eq.${num},po_number.ilike.${like}` : `po_number.ilike.${like}`).limit(6),
    ]);
    const custs = (cs || []) as { id: string; name: string | null; company: string | null }[];
    const ords = (os || []) as { id: string; number: number; nickname: string | null; customer_id: string | null }[];
    const arcs = (ar || []) as { id: string; visual_id: string; nickname: string | null; customer_id: string | null; balance: number }[];
    const ids = [...new Set([...custs.map((c) => c.id), ...ords.map((o) => o.customer_id || ""), ...arcs.map((a) => a.customer_id || "")].filter(Boolean))];
    const { openInvoices } = await import("@/lib/statementServer");
    const [inv, old, { data: names }] = await Promise.all([openInvoices(admin, ids), oldOpen(admin, ids), admin.from("customers").select("id, name, company").in("id", ids)]);
    const nameOf = new Map(((names || []) as { id: string; name: string | null; company: string | null }[]).map((c) => [c.id, c.company || c.name || "Customer"]));
    const owed = new Map<string, { b: number; n: number }>();
    for (const o of [...inv, ...old]) { const x = owed.get(o.customer_id) || { b: 0, n: 0 }; x.b += o.balance; x.n++; owed.set(o.customer_id, x); }
    const bal = new Map<string, number>(inv.map((o) => [o.id, o.balance]));
    const hits: PayerHit[] = [
      ...custs.map((c) => ({ kind: "customer" as const, id: c.id, name: c.company || c.name || "Customer", balance: r2(owed.get(c.id)?.b || 0), open: owed.get(c.id)?.n || 0 })).sort((a, b) => b.balance - a.balance),
      ...ords.filter((o) => o.customer_id).map((o) => ({ kind: "invoice" as const, id: o.id, customerId: o.customer_id!, customer: nameOf.get(o.customer_id!) || "", number: o.number, nickname: o.nickname || "", balance: r2(Number(bal.get(o.id) || 0)) })),
      ...arcs.filter((a) => a.customer_id).map((a) => ({ kind: "invoice" as const, id: `pv:${a.id}`, customerId: a.customer_id!, customer: nameOf.get(a.customer_id!) || "", number: +a.visual_id || 0, nickname: a.nickname || "Printavo invoice", balance: r2(+a.balance || 0) })),
    ];
    return { ok: true, hits: hits.slice(0, 12) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export type TodayPay = { key: string; customer: string; customerId?: string; numbers: number[]; amount: number; method: string; note: string; at: string };
/** payments recorded or charged today (shop time), one line per check or charge: the running list under Receive a payment */
export async function receivedToday(): Promise<{ ok: true; rows: TodayPay[] } | { ok: false; error: string }> {
  try {
    const { admin } = await allowed();
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const start = new Date(`${day}T00:00:00-06:00`).toISOString();
    const { data } = await admin.from("payments").select("id, order_id, archived_order_id, amount, method, note, processor_id, created_at").gte("created_at", start).order("created_at", { ascending: false }).limit(300);
    const ps = (data || []) as { id: string; order_id: string | null; archived_order_id: string | null; amount: number; method: string; note: string | null; processor_id: string | null; created_at: string }[];
    const oIds = [...new Set(ps.map((p) => p.order_id).filter(Boolean))] as string[], aIds = [...new Set(ps.map((p) => p.archived_order_id).filter(Boolean))] as string[];
    const [{ data: os }, { data: as }] = await Promise.all([
      oIds.length ? admin.from("orders").select("id, number, customer_id").in("id", oIds) : Promise.resolve({ data: [] }),
      aIds.length ? admin.from("archived_orders").select("id, visual_id, customer_id").in("id", aIds) : Promise.resolve({ data: [] }),
    ]);
    const ord = new Map(((os || []) as { id: string; number: number; customer_id: string }[]).map((o) => [o.id, o]));
    const arc = new Map(((as || []) as { id: string; visual_id: string; customer_id: string }[]).map((a) => [a.id, { number: +a.visual_id || 0, customer_id: a.customer_id }]));
    const cIds = [...new Set([...ord.values(), ...arc.values()].map((x) => x.customer_id).filter(Boolean))];
    const { data: cs } = cIds.length ? await admin.from("customers").select("id, name, company").in("id", cIds) : { data: [] };
    const cn = new Map(((cs || []) as { id: string; name: string | null; company: string | null }[]).map((c) => [c.id, c.company || c.name || ""]));
    const rows = new Map<string, TodayPay>();
    for (const p of ps) {
      const o = p.order_id ? ord.get(p.order_id) : p.archived_order_id ? arc.get(p.archived_order_id) : null;
      const key = p.processor_id || p.id;
      const r = rows.get(key) || { key, customer: o ? cn.get(o.customer_id) || "" : "", customerId: o?.customer_id || "", numbers: [], amount: 0, method: p.method, note: (p.note || "").replace(/ · \$[\d,.]+ .*applied to.*$/, "").replace(/^\$[\d,.]+ .*applied to.*$/, ""), at: p.created_at };
      r.amount = r2(r.amount + (+p.amount || 0)); if (o?.number && !r.numbers.includes(o.number)) r.numbers.push(o.number);
      rows.set(key, r);
    }
    return { ok: true, rows: [...rows.values()] };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}


export type Waiting = { id: string; name: string; owed: number; pastDue: number; open: number; late: number };
/**
 * Who owes us, for Receive a Payment with nobody picked (Nov 11, Nick: "something that looks a little different when
 * it's open, nothing selected"): every customer with open invoices (ours and the old Printavo ones), most past due first.
 */
export async function waitingOnPayment(): Promise<{ ok: true; rows: Waiting[]; pastDue: number; owed: number } | { ok: false; error: string }> {
  try {
    const { admin } = await allowed();
    const { allRows } = await import("@/lib/readAll");
    const [os, { data: ar }] = await Promise.all([
      allRows((r0, r1) => admin.from("orders").select("customer_id").eq("type", "invoice").is("discarded_at", null).is("declined_at", null).gt("total", 0).not("customer_id", "is", null).order("id").range(r0, r1)),
      admin.from("archived_orders").select("customer_id").eq("kind", "invoice").is("removed_at", null).gt("balance", 0.004).not("customer_id", "is", null).order("id").limit(1000),
    ]);
    const ids = [...new Set([...((os || []) as { customer_id: string }[]), ...((ar || []) as { customer_id: string }[])].map((x) => x.customer_id).filter(Boolean))];
    const { openInvoices } = await import("@/lib/statementServer");
    // in batches: a long list of ids is too long for one request
    const inv: Awaited<ReturnType<typeof openInvoices>> = [], old: Awaited<ReturnType<typeof oldOpen>> = [], names: unknown[] = [];
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80);
      const [a, b, { data: c }] = await Promise.all([openInvoices(admin, part), oldOpen(admin, part), admin.from("customers").select("id, name, company, is_test").in("id", part)]);
      inv.push(...a); old.push(...b); names.push(...(c || []));
    }
    const nm = new Map(((names || []) as { id: string; name: string | null; company: string | null; is_test?: boolean }[]).filter((c) => !c.is_test).map((c) => [c.id, c.company || c.name || "Customer"]));
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const by = new Map<string, Waiting>();
    for (const o of [...inv, ...old] as { customer_id: string; balance: number; pay_due?: string | null; created_at?: string }[]) {
      if (!nm.has(o.customer_id)) continue;
      const w = by.get(o.customer_id) || { id: o.customer_id, name: nm.get(o.customer_id)!, owed: 0, pastDue: 0, open: 0, late: 0 };
      const due = o.pay_due || (o.created_at ? new Date(Date.parse(o.created_at) + 30 * 86400000).toISOString().slice(0, 10) : "");
      const late = due ? Math.floor((Date.parse(day) - Date.parse(due.slice(0, 10))) / 86400000) : 0;
      w.owed = r2(w.owed + o.balance); w.open++;
      if (late > 0) { w.pastDue = r2(w.pastDue + o.balance); w.late = Math.max(w.late, late); }
      by.set(o.customer_id, w);
    }
    const rows = [...by.values()].sort((a, b) => b.pastDue - a.pastDue || b.owed - a.owed);
    return { ok: true, rows, pastDue: r2(rows.reduce((a, w) => a + w.pastDue, 0)), owed: r2(rows.reduce((a, w) => a + w.owed, 0)) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
