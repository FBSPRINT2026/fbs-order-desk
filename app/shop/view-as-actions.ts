"use server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";

const VIEW_AS_COOKIE = "fbs_view_as"; // read by app/shop/layout.tsx

/**
 * Owner only: see the shop the way someone else does ("View as"). `who` is a staff email (their name and role) or a
 * bare role (production, receiving…); "" goes back to your own view. It only changes what the pages show; you stay
 * signed in as yourself.
 */
export async function setViewAs(who: string): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") return { ok: false, error: "Only the owner can view as someone else." };
  const jar = await cookies();
  const w = String(who || "").trim().toLowerCase().slice(0, 200);
  if (!w || w === v.email) jar.delete(VIEW_AS_COOKIE);
  else jar.set(VIEW_AS_COOKIE, w, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 12 });
  return { ok: true };
}
