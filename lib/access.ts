import type { SupabaseClient } from "@supabase/supabase-js";
import { accessOf, permsFor, type Perms } from "@/lib/roles";

/** on the server: a staff member's permissions (their role's defaults + their changes in Settings → User Access) */
export async function viewerPerms(sb: SupabaseClient, email: string, role: string): Promise<Perms> {
  if (role === "owner") return permsFor("owner");
  const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
  return permsFor(role, accessOf(data?.data)[email.toLowerCase()]);
}
