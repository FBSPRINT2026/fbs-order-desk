import "server-only";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { EMP_COOKIE, employeeFor } from "@/lib/workServer";
import type { Perms } from "@/lib/roles";
import { shopNetwork } from "@/lib/shopNetwork";

/**
 * Who's using the job's phone menu (after scanning a work order or box label): a staff member signed in to the portal,
 * or an employee signed in to the employee app (/work) with their number and PIN. Employees can read the job, add
 * notes and photos, print box labels, count goods in (check-in) and log time; shipping needs a staff login with that
 * permission.
 */
export type JobActor = { kind: "staff" | "employee"; name: string; email: string; employeeId: string | null; perms: Perms | null; can: { ship: boolean; checkin: boolean; open: boolean } };

export async function jobActor(): Promise<JobActor | null> {
  return (await jobGate()).who;
}

/**
 * Who it is, and whether the shop tools open for them here: staff portal logins anywhere; crew PIN sign-ins only on
 * the shop's network (once its address is saved), so a PIN used from home, or a customer, can't change a job.
 */
export async function jobGate(): Promise<{ who: JobActor | null; offNetwork: boolean; onShopNet: boolean; netConfigured: boolean; customer: boolean }> {
  const admin = createAdminClient();
  const [v, net] = await Promise.all([getViewer().catch(() => null), shopNetwork(admin)]);
  const staff = await staffActor(v);
  if (staff) return { who: staff, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: false };
  const e = await employeeFor(admin, (await cookies()).get(EMP_COOKIE)?.value).catch(() => null);
  if (e) {
    const who: JobActor = { kind: "employee", name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || `#${e.code}`, email: "", employeeId: e.id, perms: null, can: { ship: false, checkin: true, open: false } };
    if (net.configured && !net.on) return { who: null, offNetwork: true, onShopNet: false, netConfigured: true, customer: false };
    return { who, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: false };
  }
  return { who: null, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: !!v?.user };
}

async function staffActor(v: Awaited<ReturnType<typeof getViewer>> | null): Promise<JobActor | null> {
  if (v?.user && v.isStaff) {
    const [perms, { data }] = await Promise.all([viewerPerms(v.supabase, v.email, v.role), v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle()]);
    return { kind: "staff", name: (data?.name as string) || v.email.split("@")[0], email: v.email, employeeId: null, perms, can: { ship: !!perms.shipping, checkin: !!perms.receiving, open: true } };
  }
  return null;
}
