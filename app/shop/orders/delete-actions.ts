"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { printavoOrderStill } from "@/lib/printavo";

/**
 * Before an order is deleted here: is it in Printavo? (Nov 1, Nick, after #40201 and #40202 were sent to Printavo and
 * then deleted here, so they ran on in Printavo where nobody here could see them: "create a rule so that can't happen")
 *   - never sent: fine to delete
 *   - still in Printavo: not deleted here. Delete it in Printavo first (we never delete in Printavo), then here
 *   - sent, but Printavo says it's gone: the link is cleared, then it can be deleted
 * The database holds the same rule (migration 258: an order linked to Printavo can't be deleted), so no other way of
 * deleting (bulk delete, a script) can leave one behind in Printavo either.
 */
export async function printavoDeleteCheck(orderId: string): Promise<{ ok: true; still: { visualId: string; url: string } | null } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Not allowed." };
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, printavo_id").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false, error: "Order not found." };
    if (!o.printavo_id) return { ok: true, still: null };
    const still = await printavoOrderStill(String(o.printavo_id));
    if (still) return { ok: true, still };
    // gone from Printavo: unlink it so it can be deleted here
    const { error } = await admin.from("orders").update({ printavo_id: null }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, still: null };
  } catch (e) {
    return { ok: false, error: `Couldn't check Printavo, so it wasn't deleted: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * An order the customer sent in (a simple order from their portal, or a ClickUp job brought in as one) goes back to Portal
 * requests instead of being deleted (Nov 3, Nick: "after it comes into our system… ClickUp is dead to this order… send it
 * back to the job center under customer requests… the status still as order request"). Same number; what they sent (their
 * words and files) stays; what was built from it (garments, prints, prices) is cleared so Process starts fresh. Its art is
 * left as the delete box chose.
 */
export async function backToRequests(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Not allowed." };
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, simple_order, printavo_id, status").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false, error: "Order not found." };
    if (!o.simple_order) return { ok: false, error: "This order wasn't sent in by the customer." };
    if (o.printavo_id) return { ok: false, error: "It's in Printavo: it can't go back to the requests." };
    const blank = [{ id: crypto.randomUUID(), lines: [{ id: crypto.randomUUID(), cost: "", brand: "", color: "", sizes: {}, style: "", garment: "", priceOverride: null }], imprints: [], customerMockups: [] }];
    const { error } = await admin.from("orders").update({ status: "request", type: "quote", groups: blank, lines: [], fees: [], total: 0, qty: 0, sent_at: null, approved_at: null, approved_name: null, declined_at: null, declined_reason: "" }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: "request", actor: v.user.email || "shop" });
    await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: "Sent back to Portal requests (instead of deleted): what was built from it was cleared; what the customer sent stays.", actor: v.user.email || "shop" });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
