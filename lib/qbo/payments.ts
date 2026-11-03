import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qboEnv } from "@/lib/qbo/config";
import { qboAccess } from "@/lib/qbo/client";

/**
 * A bank transfer (ACH / eCheck) through QuickBooks Payments (Nov 3, Nick: "I can take ACH through QuickBooks Payments…
 * option 2": the bank details in our own pay form, charged through QuickBooks). The account and routing numbers go
 * straight to Intuit over HTTPS for this one charge; they're never kept. ACH settles over a few days: Intuit answers
 * PENDING, and a return comes back later as a declined status on the same id.
 */
export type BankIn = { name: string; routing: string; account: string; type: "checking" | "savings"; holder: "personal" | "business"; phone?: string };
export type EcheckOut = { ok: true; id: string; status: string } | { ok: false; error: string };

export async function qboEcheck(admin: SupabaseClient, amount: number, bank: BankIn, description: string): Promise<EcheckOut> {
  const env = qboEnv();
  if (!env.configured) return { ok: false, error: "Bank payments aren't set up yet. Please pay by card, Zelle or Venmo." };
  let token = "";
  try { token = (await qboAccess(admin)).token; } catch { return { ok: false, error: "Bank payments aren't connected right now. Please pay by card, Zelle or Venmo, or call us." }; }
  const base = env.env === "sandbox" ? "https://sandbox.api.intuit.com" : "https://api.intuit.com";
  const accountType = `${bank.holder === "business" ? "BUSINESS" : "PERSONAL"}_${bank.type === "savings" ? "SAVINGS" : "CHECKING"}`;
  const phone = (bank.phone || "").replace(/\D/g, "").slice(-10);
  const res = await fetch(`${base}/quickbooks/v4/payments/echecks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "Request-Id": randomUUID() },
    body: JSON.stringify({
      amount: amount.toFixed(2),
      paymentMode: "WEB",
      description: description.slice(0, 100),
      bankAccount: { name: bank.name.slice(0, 64), routingNumber: bank.routing, accountNumber: bank.account, accountType, ...(phone.length === 10 ? { phone } : {}) },
    }),
  }).catch(() => null);
  if (!res) return { ok: false, error: "We couldn't reach QuickBooks Payments. Please try again in a minute." };
  const j = await res.json().catch(() => ({} as Record<string, unknown>));
  if (res.status === 401 || res.status === 403) return { ok: false, error: "Bank payments aren't turned on for our QuickBooks connection yet. Please pay by card, Zelle or Venmo for now." };
  const errs = (j as { errors?: { message?: string; detail?: string; moreInfo?: string }[] }).errors;
  if (!res.ok || errs?.length) {
    const e = errs?.[0];
    return { ok: false, error: [e?.message, e?.detail, e?.moreInfo].filter(Boolean).join(": ").slice(0, 300) || `The bank payment didn't go through (${res.status}).` };
  }
  const id = String((j as { id?: string }).id || ""), status = String((j as { status?: string }).status || "PENDING").toUpperCase();
  if (/DECLINED|CANCELLED|FAILED/.test(status)) return { ok: false, error: "Your bank turned the payment down. Check the account and routing numbers, or pay another way." };
  return { ok: true, id, status };
}
