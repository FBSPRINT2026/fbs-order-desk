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
 * Reset an order the customer sent in back to what they sent (Nov 3, Nick: "you just can't delete anymore. You can reset it.
 * It can go back on the list as a customer request… we can't delete a customer's request"). Same number. Their order comes
 * back exactly as they sent it (orders.request_original, kept when it was sent in: migration 278); one sent in before that
 * was kept goes back to their words and files only (a simple order) or as it is now (a form they filled in). Its status is
 * Order request again, so it's back in the Job Center's Portal requests. ClickUp is never touched. The database won't let a
 * customer's order be deleted at all.
 */
export async function resetToRequest(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Not allowed." };
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, submitted_at, simple_order, printavo_id, request_original").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false, error: "Order not found." };
    if (!o.submitted_at) return { ok: false, error: "This order wasn't sent in by the customer." };
    if (o.printavo_id) return { ok: false, error: "It's in Printavo: it can't go back to the requests." };
    const og = (o.request_original || null) as Record<string, unknown> | null;
    const blank = [{ id: crypto.randomUUID(), lines: [{ id: crypto.randomUUID(), cost: "", brand: "", color: "", sizes: {}, style: "", garment: "", priceOverride: null }], imprints: [], customerMockups: [] }];
    const back: Record<string, unknown> = og
      ? { groups: og.groups ?? blank, lines: og.lines ?? [], fees: og.fees ?? [], nickname: og.nickname ?? "", due_date: og.due_date ?? null, po_number: og.po_number ?? "", delivery_method: og.delivery_method ?? "pickup", ship_to: og.ship_to ?? "", notes: og.notes ?? "", qty: og.qty ?? 0, ...(og.price_type ? { price_type: og.price_type } : {}) }
      : o.simple_order ? { groups: blank, lines: [], fees: [], qty: 0 } : {};
    const { error } = await admin.from("orders").update({ ...back, status: "request", type: "quote", total: 0, sent_at: null, approved_at: null, approved_name: null, declined_at: null, declined_reason: "" }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    // the files it picked up while it was being made (pictures the reader cut from their PDF, files staff dropped in) are
    // set aside, not deleted (art_files_set_aside, migration 279): only what the customer sent stays on their request
    const theirs = new Set(((o.simple_order as { files?: { path?: string }[] } | null)?.files || []).map((f) => String(f.path || "")));
    const { data: af } = await admin.from("art_files").select("*").eq("order_id", orderId);
    const extra = ((af || []) as { id: string; file_path: string; created_at: string }[]).filter((f) => !theirs.has(f.file_path) && !f.file_path.startsWith("requests/") && f.created_at > String(o.submitted_at));
    if (extra.length) {
      const { error: se } = await admin.from("art_files_set_aside").insert(extra.map((f) => ({ ...f, set_aside_by: v.user!.email || "shop", reason: "Reset to the customer's request" })));
      if (!se) await admin.from("art_files").delete().in("id", extra.map((f) => f.id));
    }
    await admin.from("order_events").insert([
      { order_id: orderId, kind: "status", detail: "request", actor: v.user.email || "shop" },
      { order_id: orderId, kind: "note", detail: og ? "Reset to the customer's request, as they sent it." : o.simple_order ? "Reset to the customer's request: their words and files; what was built from it was cleared." : "Reset to an order request (as it is now: it was sent in before the original was kept).", actor: v.user.email || "shop" },
    ]);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
