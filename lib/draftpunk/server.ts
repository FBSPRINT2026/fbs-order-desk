import "server-only";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Brewer = { user_id: string; name: string; club_role: "member" | "admin" };

/**
 * Who is using DraftPunk. A brewer is anyone in dp_brewers (added by a club admin). The shop's owner is let in as the
 * club's first admin the first time he opens it, so the club has someone to invite the rest.
 */
export async function getBrewer(): Promise<{ email: string; userId: string; brewer: Brewer | null }> {
  const { user, email, role, staff } = await getViewer("name");
  if (!user) return { email: "", userId: "", brewer: null };
  const admin = createAdminClient();
  const { data } = await admin.from("dp_brewers").select("user_id, name, club_role").eq("user_id", user.id).maybeSingle();
  if (data) return { email, userId: user.id, brewer: data as Brewer };
  if (role === "owner") {
    const row = { user_id: user.id, name: String(staff?.name || email.split("@")[0]), club_role: "admin" as const };
    await admin.from("dp_brewers").insert(row);
    return { email, userId: user.id, brewer: row };
  }
  return { email, userId: user.id, brewer: null };
}

/** for DraftPunk's inside pages: a signed-in brewer, or back to the front door */
export async function requireBrewer() {
  const b = await getBrewer();
  if (!b.brewer) redirect("/draftpunk");
  return b as { email: string; userId: string; brewer: Brewer };
}

/** is this signed-in person only a brewer (not staff, no customer account)? The customer portal sends them to DraftPunk. */
export async function brewerOnly(userId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("dp_brewers").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}
