import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePending } from "@/lib/manifest";

/**
 * Look for goods for an order the moment it goes out (Nov 2, Nick: "the signal would be anytime we send it to the
 * customer for approval, anytime we send it to Printavo… or we turn it into an invoice… it should automatically try to
 * find a match"): the shipments waiting for an order are matched again right after the answer goes back, instead of on
 * the next 20-minute round. Never waited on, never fails the send.
 */
export function matchGoodsSoon() {
  const work = () => resolvePending(createAdminClient(), Date.now() + 45_000).catch((e) => console.warn("goods match", e));
  try { after(work); } catch { void work(); }
}
