"use server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Is this email one we know (Nov 2, Nick: "if I made a typo, it still said check your email… return back something and
 * say no customer on file, contact FBS")? The same emails the portal lets in (public.my_customer_ids): a customer's
 * email or second contact, a contact with portal access, or staff.
 */
export async function emailOnFile(raw: string): Promise<boolean> {
  const email = String(raw || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
  const admin = createAdminClient();
  // matched whole, ignoring case ("_" and "%" are letters here, not wildcards)
  const like = email.replace(/[\\%_]/g, (m) => `\\${m}`);
  const [a, b, c, d] = await Promise.all([
    admin.from("customers").select("id", { count: "exact", head: true }).ilike("email", like),
    admin.from("customers").select("id", { count: "exact", head: true }).ilike("contact2_email", like),
    admin.from("customer_contacts").select("id", { count: "exact", head: true }).ilike("email", like).eq("portal_access", true),
    admin.from("staff").select("email", { count: "exact", head: true }).ilike("email", like),
  ]);
  return !!((a.count || 0) + (b.count || 0) + (c.count || 0) + (d.count || 0));
}
