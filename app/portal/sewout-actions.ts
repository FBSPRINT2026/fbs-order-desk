"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideSewout, type Sewout } from "@/lib/sewouts";
import type { Order } from "@/lib/pricing";

/** The customer approves their sew-out (their typed name) or asks for changes (lib/sewouts.ts). Row security checks
 *  the sew-out is theirs; staff previews can't answer for them. */
export async function answerSewout(id: string, decision: "approved" | "changes", name: string, comment: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "This is a preview. Customers answer from their own login." };
    const { data: sw } = await supabase.from("sewouts").select("*").eq("id", id).maybeSingle();
    if (!sw) return { ok: false, error: "We couldn't find that sew-out." };
    const { data: od } = await supabase.from("orders").select("*").eq("id", sw.order_id).maybeSingle();
    if (!od) return { ok: false, error: "We couldn't find that order." };
    const r = await decideSewout(createAdminClient(), sw as Sewout, od as Order, decision, name, comment, email);
    revalidatePath(`/portal/orders/${sw.order_id}`);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." }; }
}
