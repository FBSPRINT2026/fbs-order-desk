"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessOf, seesMoney } from "@/lib/roles";
import { monthlyPnl, type Fin } from "@/lib/qbo/finance";

/** My Day's sales numbers from QuickBooks, for whoever sees the money (owners, admins, anyone given "money") */
export async function qboMonthly(year: number): Promise<Fin | null> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const admin = createAdminClient();
  const { data: s } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const own = accessOf(s?.data)[v.email] as Parameters<typeof seesMoney>[1];
  if (!seesMoney(v.role, own)) return null;
  return monthlyPnl(admin, year);
}
