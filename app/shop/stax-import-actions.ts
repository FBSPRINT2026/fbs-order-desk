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
