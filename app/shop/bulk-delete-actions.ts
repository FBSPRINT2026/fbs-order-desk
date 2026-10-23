"use server";
import { ownedFiles } from "@/lib/ownedFiles";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reopenClickUpTask } from "@/lib/clickup";

/**
 * Bulk delete orders from the Orders list (Oct 15, Nick: "a bulk delete button… only for me… select a bunch and
 * click delete"). Only Nick. Orders made in the portal only (Printavo's history is never touched), and never one
 * with a payment or one sent to Printavo: those are skipped and named.
 */
const BULK_DELETERS = ["nicholas@fbsprint.com"];

export async function bulkDeleteOrders(ids: string[]): Promise<{ ok: true; deleted: number[]; skipped: string[] } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff || !BULK_DELETERS.includes(String(v.email || "").toLowerCase())) return { ok: false, error: "Only Nick can delete orders in bulk." };
    const want = [...new Set(ids)].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
    if (!want.length) return { ok: false, error: "No orders picked." };
    const admin = createAdminClient();
    const [{ data: os }, { data: pays }] = await Promise.all([
      admin.from("orders").select("id, number, printavo_id").in("id", want),
      admin.from("payments").select("order_id").in("order_id", want),
    ]);
    const paid = new Set(((pays || []) as { order_id: string }[]).map((p) => p.order_id));
    const skipped: string[] = [], go: { id: string; number: number }[] = [];
    for (const o of (os || []) as { id: string; number: number; printavo_id: string | null }[]) {
      if (o.printavo_id) skipped.push(`#${o.number} (sent to Printavo)`);
      else if (paid.has(o.id)) skipped.push(`#${o.number} (has a payment)`);
      else go.push(o);
    }
    if (!go.length) return { ok: true, deleted: [], skipped };
    const gids = go.map((o) => o.id);
    // their files (proofs and production files), as the order page's own Delete does
    const [{ data: pr }, { data: af }] = await Promise.all([
      admin.from("proofs").select("file_path, order_id").in("order_id", gids),
      admin.from("art_files").select("file_path, order_id").in("order_id", gids),
    ]);
    // only files an order owns (not the Printavo archive's copies, logos, mockups or email attachments it pointed at)
    const paths = gids.flatMap((id) => ownedFiles(id, [...((pr || []) as { file_path: string; order_id?: string }[]), ...((af || []) as { file_path: string; order_id?: string }[])].filter((x) => x.order_id === id).map((x) => x.file_path)));
    for (let i = 0; i < paths.length; i += 100) await admin.storage.from("proofs").remove(paths.slice(i, i + 100));
    // an order made from a ClickUp job: the job goes back on the New list (Oct 22, Nick: Hudson Band was lost that way)
    const { data: cus } = await admin.from("clickup_tasks").select("id").or(`order_id.in.(${gids.join(",")}),order_number.in.(${go.map((o) => o.number).join(",")})`);
    for (const t of (cus || []) as { id: string }[]) await reopenClickUpTask(admin, t.id).catch(() => null);
    const { error } = await admin.from("orders").delete().in("id", gids);
    if (error) return { ok: false, error: error.message };
    return { ok: true, deleted: go.map((o) => o.number).sort((a, b) => a - b), skipped };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
