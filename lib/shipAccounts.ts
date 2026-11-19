import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carrierAccountsCached } from "@/lib/easypost";

/**
 * Which carrier accounts a shipment is rated and bought on (Oct 30): a customer who ships on its own account
 * (customers.ship_on: Nine18 FEDEX) is rated on that one only, and it pays the carrier, so nothing is billed to them through
 * us; everyone else on FBS's accounts, never on an account that's a customer's own. Shared by the rates and the buy
 * (app/api/shipping/rates, app/api/shipping/buy), so a label is always bought where it was priced.
 */
export async function shipAccounts(sb: SupabaseClient, b: { shipOn?: unknown; customerId?: unknown }): Promise<{ shipOn: string; carrierAccounts?: string[] }> {
  const { data: owned } = await sb.from("customers").select("id, ship_on").neq("ship_on", "");
  const theirs = new Set((owned || []).map((c) => c.ship_on as string));
  const wanted = typeof b.shipOn === "string" ? b.shipOn : b.customerId ? ((owned || []).find((c) => c.id === b.customerId)?.ship_on as string) || "" : "";
  const shipOn = wanted && wanted !== "fbs" ? wanted : "";
  if (shipOn) return { shipOn, carrierAccounts: [shipOn] };
  if (theirs.size) return { shipOn, carrierAccounts: (await carrierAccountsCached()).map((a) => a.id).filter((id) => !theirs.has(id)) };
  return { shipOn };
}
