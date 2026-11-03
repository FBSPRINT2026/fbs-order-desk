import "server-only";
import { redirect } from "next/navigation";
import { allRows } from "@/lib/readAll";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, type Customer } from "@/lib/pricing";

export type PortalCtx = {
  db: SupabaseClient;           // client to read with
  email: string;
  isStaff: boolean;
  preview: Customer | null;     // staff previewing a customer's portal
  customerIds: string[];        // customers this view is scoped to
  customers: Customer[];
  settings: ReturnType<typeof mergeSettings>;
};

/**
 * Works out whose portal is being shown.
 * Customers read through their own session, so row security limits them to their records.
 * Staff can preview a customer with ?as=<customerId>; that view is read-only.
 */
export async function getPortalCtx(as?: string, next = "/portal"): Promise<PortalCtx> {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const admin = createAdminClient();
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(s?.data);

  if (isStaff) {
    if (!as) {
      const m = next.match(/^\/portal\/(orders|archive)\/([\w-]+)/);
      redirect(m ? `/shop/${m[1]}/${m[2]}` : "/shop");
    }
    const { data: c } = await admin.from("customers").select("*").eq("id", as).maybeSingle();
    if (!c) redirect("/shop/customers");
    return { db: admin, email, isStaff, preview: c as Customer, customerIds: [c.id], customers: [c as Customer], settings };
  }
  const { data: cs } = await allRows((a, b) => supabase.from("customers").select("*").order("id").range(a, b));
  const customers = (cs || []) as Customer[];
  // on more than one account and none picked yet: pick one first (Nov 3, Nick); my_customer_ids() answers with the pick
  if (customers.length > 1) redirect("/portal/choose");
  return { db: supabase as unknown as SupabaseClient, email, isStaff, preview: null, customerIds: customers.map((c) => c.id), customers, settings };
}

/** Signed links for proof files, valid for one hour. */
export async function signProofs<T extends { file_path: string }>(proofs: T[]) {
  if (!proofs.length) return [] as (T & { url: string | null })[];
  const { data } = await createAdminClient().storage.from("proofs").createSignedUrls(proofs.map((p) => p.file_path), 3600);
  return proofs.map((p, i) => ({ ...p, url: data?.[i]?.signedUrl ?? null }));
}

/**
 * Whether this login sees the wholesale price list (the portal's Pricing tab). Retail clients never do (Nov 2, Nick: "if
 * you're a client marked as retail, then you can't see the pricing tab… only retail clients that would see pricing would be
 * if they had program pricing"): so it shows only when every company on the login is wholesale. A program's own pricing
 * shows to anyone who has one, retail or not.
 */
export const seesPriceList = (customers: { price_type?: string | null }[]) => customers.length > 0 && customers.every((c) => c.price_type === "wholesale");
