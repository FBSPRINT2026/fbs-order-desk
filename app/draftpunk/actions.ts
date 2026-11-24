"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrewer } from "@/lib/draftpunk/server";

/**
 * A club admin adds a member: their sign-in is made (confirmed, no email sent from here) and they're put in the club.
 * They then sign in at /draftpunk with their email and the code it sends. Someone who already has a sign-in (a portal
 * customer, staff) is just added to the club.
 */
export async function addMember(rawEmail: string, rawName: string, role: "member" | "admin" = "member"): Promise<{ ok: boolean; msg: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, msg: "ONLY A CLUB ADMIN CAN ADD MEMBERS" };
  const email = rawEmail.trim().toLowerCase(), name = rawName.trim() || email.split("@")[0];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, msg: "THAT EMAIL DOESN'T LOOK RIGHT" };
  const admin = createAdminClient();
  let userId = "";
  const made = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (made.data.user) userId = made.data.user.id;
  else {
    // already has a sign-in: find it
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const hit = data?.users.find((u) => (u.email || "").toLowerCase() === email);
      if (hit) userId = hit.id;
      if (!data || data.users.length < 1000) break;
    }
  }
  if (!userId) return { ok: false, msg: made.error?.message?.toUpperCase() || "COULDN'T ADD THEM" };
  const { error } = await admin.from("dp_brewers").upsert({ user_id: userId, name, club_role: role });
  return error ? { ok: false, msg: error.message } : { ok: true, msg: `${name.toUpperCase()} IS IN. THEY SIGN IN AT PORTAL.FBSPRINT.COM/DRAFTPUNK WITH ${email.toUpperCase()}.` };
}

/** a club admin takes someone out of the club (their recipes stay with their sign-in) */
export async function removeMember(userId: string): Promise<{ ok: boolean; msg: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, msg: "ONLY A CLUB ADMIN CAN DO THAT" };
  if (userId === me.userId) return { ok: false, msg: "YOU CAN'T REMOVE YOURSELF" };
  const { error } = await createAdminClient().from("dp_brewers").delete().eq("user_id", userId);
  return error ? { ok: false, msg: error.message } : { ok: true, msg: "REMOVED FROM THE CLUB" };
}

/** the signed-in brewer's private Tilt logging address (made the first time it's asked for) */
export async function tiltUrl(): Promise<string> {
  const me = await getBrewer();
  if (!me.brewer) return "";
  const admin = createAdminClient();
  const { data } = await admin.from("dp_brewers").select("tilt_key").eq("user_id", me.userId).maybeSingle();
  let key = (data?.tilt_key as string) || "";
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
    await admin.from("dp_brewers").update({ tilt_key: key }).eq("user_id", me.userId);
  }
  const { SITE_URL } = await import("@/lib/config");
  return `${SITE_URL}/api/draftpunk/tilt?k=${key}`;
}
