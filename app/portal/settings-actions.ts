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

export async function saveMySettings(p: { address: string; ship_address: string }): Promise<Result> {
  try {
    const { cust, admin } = await me();
    const { error } = await admin.from("customers").update({ address: clip(p.address, 600), ship_address: clip(p.ship_address, 600) }).eq("id", cust.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

/** Our messages by email too, or only in their portal's message center (Oct 24, Nick). */
export async function setMessageEmail(on: boolean): Promise<Result> {
  try {
    const { cust, admin } = await me();
    const { error } = await admin.from("customers").update({ message_email: on }).eq("id", cust.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal/settings");
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

/**
 * The people at the company (Oct 24, Nick: "you need to be able to add people and you need to be able to see everyone…
 * anybody… who's on the company… we need to remove Jake… if they change their email, they need to be able to do that…
 * ask, are you sure you want to change your sign-in email"). Everyone on the list signs in with their own email and sees
 * the company's orders. The main contact is the account's own email; it can't be removed here.
 */
export type Person = { id: string; name: string; email: string; phone: string; title: string; main: boolean; you: boolean };
type Row = { id: string; name: string | null; email: string | null; phone: string | null; title: string | null; is_primary: boolean | null };
const low = (s: string | null | undefined) => String(s || "").trim().toLowerCase();

async function company() {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) throw new Error("Please sign in again.");
  const { data: cs } = await supabase.from("customers").select("id, name, email, phone, contact2_name, contact2_email, contact2_phone");
  const c = (cs || [])[0] as { id: string; name: string | null; email: string | null; phone: string | null; contact2_name: string | null; contact2_email: string | null; contact2_phone: string | null } | undefined;
  if (!c) throw new Error("We couldn't find your account.");
  return { c, me: low(email), isStaff, admin: createAdminClient() };
}

export async function myPeople(customerId?: string): Promise<{ ok: true; people: Person[] } | { ok: false; error: string }> {
  try {
    const { c: c0, me, isStaff, admin } = await company();
    // staff previewing a customer's portal see that customer
    const c = isStaff && customerId ? ((await admin.from("customers").select("id, name, email, phone, contact2_name, contact2_email, contact2_phone").eq("id", customerId).maybeSingle()).data || c0) : c0;
    const { data } = await admin.from("customer_contacts").select("id, name, email, phone, title, is_primary").eq("customer_id", c.id).is("removed_at", null).eq("portal_access", true).order("is_primary", { ascending: false }).order("name");
    const rows = (data || []) as Row[];
    const people: Person[] = rows.map((r) => ({ id: r.id, name: r.name || "", email: r.email || "", phone: r.phone || "", title: r.title || "", main: !!r.is_primary || (!!r.email && low(r.email) === low(c.email)), you: !!r.email && low(r.email) === me }));
    // the account's own email and second contact sign in too: listed even when they aren't on the contact list yet
    if (c.email && !people.some((p) => low(p.email) === low(c.email))) people.unshift({ id: "main", name: c.name || "", email: c.email, phone: c.phone || "", title: "", main: true, you: low(c.email) === me });
    if (c.contact2_email && !people.some((p) => low(p.email) === low(c.contact2_email))) people.push({ id: "c2", name: c.contact2_name || "", email: c.contact2_email, phone: c.contact2_phone || "", title: "", main: false, you: low(c.contact2_email) === me });
    people.sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name));
    return { ok: true, people };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't load the people." }; }
}

export async function savePerson(p: { id: string; name: string; email: string; phone: string; title: string }): Promise<Result> {
  try {
    const { c, isStaff, admin } = await company();
    if (isStaff) return { ok: false, error: "This is a preview. Customers change their people from their own login." };
    const email = low(p.email).slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email doesn't look right." };
    const row = { name: clip(p.name, 120), email, phone: fmtPhone(clip(p.phone, 40)), title: clip(p.title, 80) };
    const { data: others } = await admin.from("customer_contacts").select("id, email").eq("customer_id", c.id).is("removed_at", null);
    if (((others || []) as { id: string; email: string }[]).some((o) => low(o.email) === email && o.id !== p.id)) return { ok: false, error: "Someone on your list already has that email." };
    let oldEmail = "";
    if (p.id === "new") {
      const { error } = await admin.from("customer_contacts").insert({ customer_id: c.id, ...row, portal_access: true });
      if (error) return { ok: false, error: error.message };
    } else if (p.id === "main" || p.id === "c2") {
      oldEmail = low(p.id === "main" ? c.email : c.contact2_email);
      const { error } = await admin.from("customer_contacts").insert({ customer_id: c.id, ...row, portal_access: true, is_primary: p.id === "main" });
      if (error) return { ok: false, error: error.message };
    } else {
      const { data: cur } = await admin.from("customer_contacts").select("email").eq("id", p.id).eq("customer_id", c.id).maybeSingle();
      if (!cur) return { ok: false, error: "We couldn't find that person." };
      oldEmail = low(cur.email);
      const { error } = await admin.from("customer_contacts").update(row).eq("id", p.id).eq("customer_id", c.id);
      if (error) return { ok: false, error: error.message };
    }
    // the account's own fields follow the person they belong to, so the old email stops signing in
    if (oldEmail && oldEmail === low(c.email)) await admin.from("customers").update({ name: row.name || c.name, email, phone: row.phone || c.phone }).eq("id", c.id);
    if (oldEmail && oldEmail === low(c.contact2_email)) await admin.from("customers").update({ contact2_name: row.name, contact2_email: email, contact2_phone: row.phone }).eq("id", c.id);
    revalidatePath("/portal/settings");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}

/** Take someone off the company: they can't sign in any more. Kept on file, not deleted. The main contact stays. */
export async function removePerson(id: string): Promise<Result> {
  try {
    const { c, me, isStaff, admin } = await company();
    if (isStaff) return { ok: false, error: "This is a preview." };
    if (id === "main") return { ok: false, error: "The main contact can't be removed here. Send us a message to change it." };
    if (id === "c2") {
      await admin.from("customers").update({ contact2_name: "", contact2_email: "", contact2_phone: "" }).eq("id", c.id);
      revalidatePath("/portal/settings");
      return { ok: true };
    }
    const { data: cur } = await admin.from("customer_contacts").select("email, is_primary").eq("id", id).eq("customer_id", c.id).maybeSingle();
    if (!cur) return { ok: false, error: "We couldn't find that person." };
    if (cur.is_primary || low(cur.email) === low(c.email)) return { ok: false, error: "The main contact can't be removed here. Send us a message to change it." };
    const { error } = await admin.from("customer_contacts").update({ portal_access: false, removed_at: new Date().toISOString(), removed_by: me }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    if (low(cur.email) === low(c.contact2_email)) await admin.from("customers").update({ contact2_name: "", contact2_email: "", contact2_phone: "" }).eq("id", c.id);
    revalidatePath("/portal/settings");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't remove them." }; }
}
