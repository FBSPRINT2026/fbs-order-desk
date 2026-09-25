import "server-only";
import { redirect } from "next/navigation";
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
      const m = next.match(/^\/portal\/orders\/([\w-]+)/);
      redirect(m ? `/shop/orders/${m[1]}` : "/shop");
    }
    const { data: c } = await admin.from("customers").select("*").eq("id", as).maybeSingle();
    if (!c) redirect("/shop/customers");
    return { db: admin, email, isStaff, preview: c as Customer, customerIds: [c.id], customers: [c as Customer], settings };
  }
  const { data: cs } = await supabase.from("customers").select("*");
  const customers = (cs || []) as Customer[];
  return { db: supabase as unknown as SupabaseClient, email, isStaff, preview: null, customerIds: customers.map((c) => c.id), customers, settings };
}

/** Signed links for proof files, valid for one hour. */
export async function signProofs<T extends { file_path: string }>(proofs: T[]) {
  if (!proofs.length) return [] as (T & { url: string | null })[];
  const { data } = await createAdminClient().storage.from("proofs").createSignedUrls(proofs.map((p) => p.file_path), 3600);
  return proofs.map((p, i) => ({ ...p, url: data?.[i]?.signedUrl ?? null }));
}
