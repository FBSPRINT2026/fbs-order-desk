"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A card or bank account already saved in our Stax account, put on the customer here (Nov 3, Nick: "I have their cards
 * saved online in Stax… 3 or 4 clients… add their card to the list"). It's on file and OK to charge when they ask, as
 * it was in Stax; the note says it came from Stax and who brought it in. Owner and admins only. Nothing changes in Stax.
 */
const STAX = "https://apiprod.fattlabs.com";
export async function importStaxMethod(customerId: string, staxPmId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    if (!(await (await import("@/lib/access")).viewerPerms(createAdminClient(), v.email, v.role)).takePayments) return { ok: false, error: "Only Nick and Amanda can bring in cards." };
    const key = process.env.STAX_API_KEY?.trim();
    if (!key) return { ok: false, error: "Stax isn't connected." };
    const r = await fetch(`${STAX}/payment-method/${encodeURIComponent(staxPmId)}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store" });
    const pm = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || !pm.id) return { ok: false, error: "Stax didn't find that card." };
    const admin = createAdminClient();
    const { data: had } = await admin.from("saved_payment_methods").select("id").eq("customer_id", customerId).eq("stax_pm_id", staxPmId).is("removed_at", null).limit(1);
    if ((had || []).length) return { ok: true };
    const method = pm.method === "bank" ? "bank" : "card";
    const exp = String(pm.card_exp || "");
    const by = String((v.staff as { name?: string } | null)?.name || v.email);
    const note = `Saved in FBS Print's Stax account and charged there at the customer's request; brought onto their account by ${by} on ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`;
    const { error } = await admin.from("saved_payment_methods").insert({
      customer_id: customerId, stax_pm_id: staxPmId, method,
      brand: method === "bank" ? String(pm.bank_name || "Bank") : String(pm.card_type || "Card"),
      last4: String(pm.card_last_four || "").slice(-4), exp: /^\d{6}$/.test(exp) ? `${exp.slice(0, 2)}/${exp.slice(4)}` : "",
      holder: String(pm.person_name || ""), consent_text: note, consented_by: v.email,
      staff_charge_ok: true, staff_charge_consent: note, staff_charge_at: new Date().toISOString(), staff_charge_by: v.email,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** the customer's cards and bank accounts on file, for the shop (no numbers: brand, last four, expiry) */
export async function cardsOnFile(customerId: string): Promise<{ ok: true; list: { id: string; method: string; brand: string; last4: string; exp: string; holder: string; ok: boolean; from: string }[] } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    if (!(await (await import("@/lib/access")).viewerPerms(createAdminClient(), v.email, v.role)).takePayments) return { ok: false, error: "Only Nick and Amanda see cards." };
    const { data } = await createAdminClient().from("saved_payment_methods").select("id, method, brand, last4, exp, holder, staff_charge_ok, consent_text").eq("customer_id", customerId).is("removed_at", null).order("created_at", { ascending: false });
    return { ok: true, list: ((data || []) as { id: string; method: string; brand: string; last4: string; exp: string; holder: string; staff_charge_ok: boolean; consent_text: string }[]).map((m) => ({ id: m.id, method: m.method, brand: m.brand, last4: m.last4, exp: m.exp || "", holder: m.holder || "", ok: !!m.staff_charge_ok, from: /Stax account/.test(m.consent_text || "") ? "Brought in from Stax" : /phone/.test(m.consent_text || "") ? "Given on the phone" : "Saved by the customer" })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** take a card off the customer (it stays in Stax; it's just not on file here any more) */
export async function removeCardOnFile(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const admin = createAdminClient();
    if (!(await (await import("@/lib/access")).viewerPerms(admin, v.email, v.role)).takePayments) return { ok: false, error: "Only Nick and Amanda can remove cards." };
    const { error } = await admin.from("saved_payment_methods").update({ removed_at: new Date().toISOString(), removed_by: v.email }).eq("id", id).is("removed_at", null);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
