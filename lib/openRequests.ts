import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A customer's requests still waiting to be made into an order (portal requests, simple orders, portal reorders).
 * Any tool that makes an order for that customer offers to fill one in where it is (keeping its number), so the request
 * doesn't stay in the Job Center's Incoming after the job is made (Nov 19, Amanda: #50149 stayed after its reorder was
 * made as #50170).
 */
export type OpenRequest = { id: string; number: number; nickname: string; about: string; at: string };

export async function openRequests(admin: SupabaseClient, customerId: string | null | undefined): Promise<OpenRequest[]> {
  if (!customerId) return [];
  const { data } = await admin.from("orders").select("id, number, nickname, simple_order, created_at")
    .eq("customer_id", customerId).eq("status", "request").eq("draft", false).is("discarded_at", null)
    .order("created_at", { ascending: false }).limit(20);
  return ((data || []) as { id: string; number: number; nickname: string | null; simple_order: { about?: string } | null; created_at: string }[])
    .filter((r) => r.number > 0)
    .map((r) => ({ id: r.id, number: r.number, nickname: String(r.nickname || "").trim(), about: String(r.simple_order?.about || "").trim().slice(0, 200), at: r.created_at }));
}

/** the request a new order fills in, checked: the same customer, still waiting. Null when it isn't */
export async function requestToFill(admin: SupabaseClient, id: string | null | undefined, customerId: string) {
  if (!id) return null;
  const { data: rq } = await admin.from("orders").select("id, number, customer_id, status, simple_order, nickname, po_number, discarded_at").eq("id", id).maybeSingle();
  if (!rq || rq.customer_id !== customerId || rq.status !== "request" || rq.discarded_at) return null;
  return rq as { id: string; number: number; simple_order: { about?: string } | null; nickname: string | null; po_number: string | null };
}
