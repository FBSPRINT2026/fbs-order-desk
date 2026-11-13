import "server-only";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { EMP_COOKIE, employeeFor } from "@/lib/workServer";
import type { Perms } from "@/lib/roles";
import { shopNetwork } from "@/lib/shopNetwork";
import { mergeProduction } from "@/lib/production";
import { crewViewOf, parseViews, phoneViewsOf, type CrewExtra, type CrewView } from "@/lib/crewView";

/**
 * Who's using the job's phone menu (after scanning a work order or box label): a staff member signed in to the portal,
 * or an employee signed in to the employee app (/work) with their number and PIN. Employees can read the job, add
 * notes and photos, print box labels, count goods in (check-in) and log time; shipping needs a staff login with that
 * permission.
 */
export type JobActor = { kind: "staff" | "employee"; name: string; email: string; employeeId: string | null; perms: Perms | null; can: { ship: boolean; checkin: boolean; open: boolean };
  /** what their phone shows first (lib/crewView.ts); staff portal logins are Office */ view: CrewView;
  /** extras on their main menu (Deliveries) */ also?: CrewExtra[];
  /** the owner looking at the phone as this employee (View as; look only, nothing saves): the owner's name */ viewAs?: string;
  /** may use View as (the owner's own portal login) */ canViewAs?: boolean };

/**
 * View as (Nick, Nov 13 2026: "log in as any employee… so I can see on my phone exactly what they see"): the owner, signed
 * in to the portal as himself, picks an employee and the crew pages show that person's phone. No PIN: it rides on the
 * owner's own login, so nobody else can use it. Look only: while it's on, the phone tools save nothing (middleware.ts
 * refuses their changes). It ends after 2 hours or with Stop.
 */
export const VIEWAS_COOKIE = "fbs_viewas";

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
  if (staff) {
    // the owner viewing as an employee: that employee's phone, look only
    const as = staff.canViewAs ? (await cookies()).get(VIEWAS_COOKIE)?.value : "";
    if (as && /^[0-9a-f-]{36}$/i.test(as)) {
      const { data: e } = await admin.from("employees").select("*").eq("id", as).maybeSingle();
      if (e) return { who: { ...(await employeeActor(admin, e as Emp)), viewAs: staff.name }, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: false };
    }
    return { who: staff, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: false };
  }
  const e = await employeeFor(admin, (await cookies()).get(EMP_COOKIE)?.value).catch(() => null);
  if (e) {
    const who = await employeeActor(admin, e as Emp);
    if (net.configured && !net.on) return { who: null, offNetwork: true, onShopNet: false, netConfigured: true, customer: false };
    return { who, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: false };
  }
  return { who: null, offNetwork: false, onShopNet: net.on, netConfigured: net.configured, customer: !!v?.user };
}

type Emp = { id: string; first_name?: string | null; last_name?: string | null; code?: number | null; department?: string | null; phone_view?: string | null };
/** an employee as the phone sees them: their view (Receiving, Press operator…) and extras */
async function employeeActor(admin: ReturnType<typeof createAdminClient>, e: Emp): Promise<JobActor> {
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const set = phoneViewsOf(st?.data)[e.id] || e.phone_view || null;
  const view = crewViewOf(set, e.id, mergeProduction((st?.data as { production?: unknown } | null)?.production).crews, e.department || "");
  // shipping (rates, labels) is staff-only for now: a phone login sees where the job goes, not the Ship tool
  return { kind: "employee", name: `${e.first_name || ""} ${e.last_name || ""}`.trim() || `#${e.code}`, email: "", employeeId: e.id, perms: null, can: { ship: false, checkin: true, open: false }, view, also: parseViews(set).also };
}

async function staffActor(v: Awaited<ReturnType<typeof getViewer>> | null): Promise<JobActor | null> {
  if (v?.user && v.isStaff) {
    const [perms, { data }] = await Promise.all([viewerPerms(v.supabase, v.email, v.role), v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle()]);
    return { kind: "staff", name: (data?.name as string) || v.email.split("@")[0], email: v.email, employeeId: null, perms, can: { ship: !!perms.shipping, checkin: !!perms.receiving, open: true }, view: "office", canViewAs: v.role === "owner" };
  }
  return null;
}
