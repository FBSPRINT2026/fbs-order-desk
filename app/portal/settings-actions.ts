"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fmtPhone } from "@/lib/phone";

/**
 * The customer's own Settings in the portal (Oct 24, Nick: "a settings button so that they can update their address, their
 * contact information… a company name should be locked once we give them a company, but be able to update their contacts,
 * be able to update their logo on file so that… it can put their company on there… to share with their clients").
 * Only their own account; the company name and their sign-in email aren't changed here.
 */
type Result = { ok: boolean; error?: string };
async function me() {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  if (isStaff) throw new Error("This is a preview. Customers change their settings from their own login.");
  const { data: cs } = await supabase.from("customers").select("id, company, name, email, phone, brand_logo");
  const cust = (cs || [])[0] as { id: string; company: string | null; name: string | null; email: string | null; phone: string | null; brand_logo: string | null } | undefined;
  if (!cust) throw new Error("We couldn't find your account.");
  return { cust, email, admin: createAdminClient() };
}
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function saveMySettings(p: { name: string; phone: string; contact2_name: string; contact2_email: string; contact2_phone: string; address: string; ship_address: string }): Promise<Result> {
  try {
    const { cust, admin } = await me();
    const e2 = clip(p.contact2_email, 200);
    if (e2 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e2)) return { ok: false, error: "The second contact's email doesn't look right." };
    const { error } = await admin.from("customers").update({
      name: clip(p.name, 120), phone: fmtPhone(clip(p.phone, 40)),
      contact2_name: clip(p.contact2_name, 120), contact2_email: e2, contact2_phone: fmtPhone(clip(p.contact2_phone, 40)),
      address: clip(p.address, 600), ship_address: clip(p.ship_address, 600),
    }).eq("id", cust.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

/** A one-time upload link for their company logo. */
export async function brandLogoUploadUrl(fileName: string) {
  try {
    const { cust, admin } = await me();
    const ext = (fileName.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
    if (!["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) return { ok: false as const, error: "Use a PNG, JPG, WebP or SVG picture of your logo." };
    const path = `brand/${cust.id}/logo-${Date.now()}.${ext}`;
    const { data, error } = await admin.storage.from("proofs").createSignedUploadUrl(path);
    if (error || !data) return { ok: false as const, error: "Uploading isn't available right now." };
    return { ok: true as const, path, token: data.token };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Uploading failed." }; }
}

/** Their company logo set (or taken off with null). */
export async function saveBrandLogo(path: string | null): Promise<Result & { url?: string }> {
  try {
    const { cust, admin } = await me();
    if (path && !path.startsWith(`brand/${cust.id}/`)) return { ok: false, error: "Bad upload." };
    const { error } = await admin.from("customers").update({ brand_logo: path }).eq("id", cust.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    const url = path ? (await admin.storage.from("proofs").createSignedUrl(path, 3600)).data?.signedUrl : undefined;
    return { ok: true, url: url || undefined };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

/**
 * Their company for the sales sheet in their Mockup Creator: their name, phone and email on the bottom line and their logo
 * (wholesale customers share these with their own clients, so it's their brand, not ours).
 */
export async function mySheetBrand() {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user) throw new Error("Please sign in again.");
    const { data: cs } = await supabase.from("customers").select("id, company, name, email, phone, brand_logo");
    const c = (cs || [])[0] as { company: string | null; name: string | null; email: string | null; phone: string | null; brand_logo: string | null } | undefined;
    if (!c || isStaff) return { ok: true as const, name: "", line: "", logoUrl: "" };
    const name = c.company || c.name || "";
    const logoUrl = c.brand_logo ? (await createAdminClient().storage.from("proofs").createSignedUrl(c.brand_logo, 3600)).data?.signedUrl || "" : "";
    return { ok: true as const, name, line: [name, fmtPhone(c.phone), c.email].filter(Boolean).join("  ·  "), logoUrl };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't load your company." }; }
}
