"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERMS, roleDefaults, type Perms, type Role } from "@/lib/roles";

/**
 * Settings → User Access: save one person's permissions (only the ones that differ from their role's defaults are
 * kept, in settings.data.access by email) and their role. Owners and admins only; only an owner changes an owner.
 */
export async function saveAccess(email: string, role: Role, perms: Perms): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer();
  if (!v.user || !["owner", "admin"].includes(v.role)) return { ok: false, error: "Only the owner or an admin can change user access." };
  const who = String(email || "").trim().toLowerCase();
  const admin = createAdminClient();
  const { data: target } = await admin.from("staff").select("email, role").eq("email", who).maybeSingle();
  if (!target) return { ok: false, error: "That person isn't on the shop staff." };
  if ((target.role === "owner" || role === "owner") && v.role !== "owner") return { ok: false, error: "Only the owner can change an owner." };
  if (who === v.email && v.role === "owner" && role !== "owner") return { ok: false, error: "You can't take the owner role off yourself." };
  if (target.role !== role) {
    const r = await admin.from("staff").update({ role }).eq("email", who);
    if (r.error) return { ok: false, error: r.error.message };
  }
  const base = roleDefaults(role), own: Partial<Perms> = {};
  for (const p of PERMS) if (typeof perms?.[p.k] === "boolean" && perms[p.k] !== base[p.k]) own[p.k] = perms[p.k];
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const data = (st?.data || {}) as Record<string, unknown>;
  const access = { ...((data.access as Record<string, unknown>) || {}) };
  if (Object.keys(own).length && role !== "owner") access[who] = own; else delete access[who];
  const r = await admin.from("settings").upsert({ id: 1, data: { ...data, access }, updated_at: new Date().toISOString() });
  if (r.error) return { ok: false, error: r.error.message };
  // the database lets someone read pay rates only from their staff record (the settings row is writable by any staff
  // member, so it can't be what the database trusts): keep staff.sees_pay in step with the "pay" permission
  const sp = await admin.from("staff").update({ sees_pay: role !== "owner" && role !== "admin" && !!(own.pay ?? base.pay) }).eq("email", who);
  if (sp.error && !/sees_pay/.test(sp.error.message)) return { ok: false, error: sp.error.message };
  if (sp.error) return { ok: true, error: "Saved. Pay rates will show for them once the database update (staff.sees_pay) is run." };
  return { ok: true };
}
