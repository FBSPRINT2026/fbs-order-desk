"use server";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailLayout, sendEmail, siteUrl } from "@/lib/email";

/**
 * A customer's "Get help" (Oct 24, Nick: "if a customer is having an issue, they should be able to go and say like, hey,
 * the mockup creator is having this problem… take a screenshot, kind of like our support tool"): saved with the screenshot
 * for the owner's Support page, under Customers, and the shop is emailed.
 */
async function me() {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Use Report an issue in the shop menu.");
  const { data: cs } = await supabase.from("customers").select("id, company, name");
  const c = (cs || [])[0] as { id: string; company: string | null; name: string | null } | undefined;
  if (!c) throw new Error("We couldn't find your account.");
  return { c, email, admin: createAdminClient() };
}

export async function supportUploadUrl(png: boolean) {
  try {
    const { c, admin } = await me();
    const path = `support/cust-${c.id}-${Date.now()}.${png ? "png" : "jpg"}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false as const, error: "Couldn't attach the screenshot." };
    return { ok: true as const, path, token: data.token };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't attach the screenshot." }; }
}

export async function customerSupport(p: { message: string; page: string; title: string; screenshot: string | null; context: Record<string, unknown> }) {
  try {
    const { c, email, admin } = await me();
    if (p.screenshot && !p.screenshot.startsWith(`support/cust-${c.id}-`)) return { ok: false as const, error: "Bad screenshot." };
    const who = c.company || c.name || email;
    const { error } = await admin.from("support_issues").insert({
      by: email, page: p.page.slice(0, 500), page_title: p.title.slice(0, 200), message: p.message.trim().slice(0, 5000), screenshot: p.screenshot,
      context: p.context, source: "customer", customer_id: c.id, customer_name: who,
    });
    if (error) return { ok: false as const, error: error.message };
    if (SHOP_NOTIFY_EMAIL) await sendEmail({
      to: SHOP_NOTIFY_EMAIL,
      subject: `Help request from ${who}`,
      html: emailLayout("FBS Print", `${who} asked for help`, `${p.message.trim() || "(nothing typed)"}\n\nPage: ${p.title || p.page}`, "Open Support", `${siteUrl()}/shop/support`),
    });
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't send it." }; }
}
