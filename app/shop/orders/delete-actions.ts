"use server";
import { backToPrintavo } from "@/app/shop/archive/edit-actions";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * An order that was sent to Printavo, about to be deleted: its Printavo link is cleared first (Printavo closed Nov 14 2026,
 * so nothing can run on there unseen any more), so the database's old rule (migration 258: an order linked to Printavo
 * can't be deleted) lets it go. Called from the order page's delete, right before the delete itself.
 */
export async function unlinkPrintavo(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Not allowed." };
    // an old job made editable here goes back to being Printavo's copy first (app/shop/archive/edit-actions.ts)
    const back = await backToPrintavo(orderId);
    if (!back.ok) return back;
    const { error } = await createAdminClient().from("orders").update({ printavo_id: null }).eq("id", orderId);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
        const og = (o.request_original || null) as Record<string, unknown> | null;
    const blank = [{ id: crypto.randomUUID(), lines: [{ id: crypto.randomUUID(), cost: "", brand: "", color: "", sizes: {}, style: "", garment: "", priceOverride: null }], imprints: [], customerMockups: [] }];
    const back: Record<string, unknown> = og
      ? { groups: og.groups ?? blank, lines: og.lines ?? [], fees: og.fees ?? [], nickname: og.nickname ?? "", due_date: og.due_date ?? null, po_number: og.po_number ?? "", delivery_method: og.delivery_method ?? "pickup", ship_to: og.ship_to ?? "", notes: og.notes ?? "", qty: og.qty ?? 0, ...(og.price_type ? { price_type: og.price_type } : {}) }
      : o.simple_order ? { groups: blank, lines: [], fees: [], qty: 0 } : {};
    const { error } = await admin.from("orders").update({ ...back, status: "request", type: "quote", total: 0, sent_at: null, approved_at: null, approved_name: null, declined_at: null, declined_reason: "" }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    // a fresh start: the AI order helper's conversation about it goes, and it's back to its normal mode (Nov 3, Nick: "when
    // you… put it back in the queue, you should purge the message history… It's like I deleted you so that we could start
    // again")
    await admin.from("order_internal").update({ check_thread: null }).eq("order_id", orderId);
    await admin.from("orders").update({ helper_plain: false }).eq("id", orderId);
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
