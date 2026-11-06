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

/** the files on what Create order was opened on (an email, a request, a ClickUp job), for the Order helper's steps; and
 *  the order it fills in, when it's a request that keeps its number (meta.into_order) */
export async function activityFiles(activityId: string): Promise<{ ok: true; files: { name: string; path: string; type: string; kind: string }[]; about: string; orderId: string | null } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    const { data: a } = await admin.from("activities").select("body, meta").eq("id", activityId).maybeSingle();
    if (!a) return { ok: false, error: "Couldn't find it." };
    const meta = (a.meta || {}) as { attachments?: { name?: string; path?: string; type?: string }[]; into_order?: string };
    const orderId = meta.into_order || null;
    const cats = new Map<string, string>();
    if (orderId) {
      const { data: af } = await admin.from("art_files").select("file_path, category").eq("order_id", orderId);
      for (const r of (af || []) as { file_path: string; category: string | null }[]) cats.set(r.file_path, r.category || "");
    }
    const files = (meta.attachments || []).filter((f) => f?.path).map((f) => ({ name: String(f.name || f.path!.split("/").pop()), path: String(f.path), type: String(f.type || ""), kind: cats.get(String(f.path)) || "" }));
    return { ok: true, files, about: String(a.body || "").slice(0, 4000), orderId };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/** a file added in the Order helper (the sizes sheet they forgot): on the email or request it's read with, and on the
 *  request's own files when it fills one in */
export async function addActivityFile(activityId: string, f: { name: string; path: string; type: string; size: number }): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    const { data: a } = await admin.from("activities").select("meta").eq("id", activityId).maybeSingle();
    if (!a) return { ok: false, error: "Couldn't find it." };
    const meta = (a.meta || {}) as { attachments?: unknown[]; into_order?: string };
    const { error } = await admin.from("activities").update({ meta: { ...meta, attachments: [...(meta.attachments || []), { name: f.name.slice(0, 200), path: f.path, type: f.type, size: f.size }] } }).eq("id", activityId);
    if (error) return { ok: false, error: error.message };
    if (meta.into_order) await admin.from("art_files").insert({ order_id: meta.into_order, name: f.name.slice(0, 200), file_path: f.path, file_type: f.type || null, category: null });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't add it." }; }
}
