"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";

/**
 * The Order helper's answers about a request's files (Nov 6, Nick: "where are the sizes… what are the other files…
 * a vendor order confirmation… it gives us who it was ordered from, when it's coming… but it's not good to take the
 * sizes off of"). Each file's answer is saved as its art_files category, so it's kept with the order (Production files
 * show it by that name) and the order reader is told what each file is (app/shop/actions.ts simpleOrderActivity), for
 * every way the request is made into an order, not just this one.
 */
export async function setRequestFileKinds(orderId: string, files: { path: string; name: string; kind: string; type?: string }[], said?: { sizesIn?: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    const { data: had } = await admin.from("art_files").select("id, file_path").eq("order_id", orderId);
    const rows = (had || []) as { id: string; file_path: string }[];
    for (const f of files) {
      const kind = f.kind.slice(0, 40);
      const row = rows.find((r) => r.file_path === f.path);
      const { error } = row
        ? await admin.from("art_files").update({ category: kind }).eq("id", row.id)
        : await admin.from("art_files").insert({ order_id: orderId, name: f.name.slice(0, 200), file_path: f.path, file_type: f.type || null, category: kind });
      if (error) return { ok: false, error: error.message };
    }
    // where the sizes are and anything staff told it: kept on the request, read with it (simpleOrderActivity)
    if (said) {
      const { data: o } = await admin.from("orders").select("simple_order").eq("id", orderId).maybeSingle();
      const so = { ...((o?.simple_order as Record<string, unknown>) || {}), sizes_in: said.sizesIn || null, helper_note: (said.note || "").trim().slice(0, 2000) || null };
      const { error } = await admin.from("orders").update({ simple_order: so }).eq("id", orderId);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." }; }
}
