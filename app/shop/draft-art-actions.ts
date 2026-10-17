"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Draft art (Oct 17, Nick: "you made the wrong art and now we have a ton of bad art in there… art should only be saved
 * once an order is sent to the customer or saved"). Logos and mockups the portal makes by itself for an order are drafts
 * (designs.draft / mockups.draft, migration 166): they show on the order but not in the customer's library. They become
 * real when the order leaves quote (a database trigger), when someone clicks Keep, or when a logo is saved in Edit logo.
 * Deleting an order offers to take its art off too (archived, so it can be put back).
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  return v;
}

type G = { imprints?: { design_id?: string | null }[] }[];
const designIdsOf = (groups: unknown) => [...new Set(((groups || []) as G).flatMap((g) => (g.imprints || []).map((im) => im.design_id || "")).filter(Boolean))];

export type ArtItem = { id: string; label: string; url: string; draft: boolean; elsewhere: number };

/** what deleting this order could take off with it: its logos (drafts first) and its mockups */
export async function orderArtForDelete(orderId: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, groups, customer_id").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false as const, error: "Order not found." };
    const ids = designIdsOf(o.groups);
    const { data: ds } = ids.length ? await admin.from("designs").select("id, number, name, preview_path, file_path, draft").in("id", ids).is("archived_at", null) : { data: [] };
    const { data: ms } = await admin.from("mockups").select("id, title, file_path, draft").eq("order_id", orderId).is("archived_at", null);
    const logos: ArtItem[] = [];
    for (const d of ds || []) {
      // used on another order (or one of its mockups): never offered checked
      const { count: n1 } = await admin.from("orders").select("id", { count: "exact", head: true }).neq("id", orderId).contains("groups", JSON.stringify([{ imprints: [{ design_id: d.id }] }]));
      const { count: n2 } = await admin.from("mockups").select("id", { count: "exact", head: true }).is("archived_at", null).contains("design_ids", [d.id]).or(`order_id.is.null,order_id.neq.${orderId}`);
      logos.push({ id: d.id, label: `D-${d.number} ${d.name || ""}`.trim(), url: (d.preview_path || d.file_path || "") as string, draft: !!d.draft, elsewhere: (n1 || 0) + (n2 || 0) });
    }
    const mockups: ArtItem[] = (ms || []).map((m) => ({ id: m.id, label: m.title || "Mockup", url: m.file_path || "", draft: !!m.draft, elsewhere: 0 }));
    const paths = [...logos, ...mockups].map((x) => x.url).filter(Boolean);
    const { data: signed } = paths.length ? await admin.storage.from("proofs").createSignedUrls(paths, 1800) : { data: [] };
    const url = new Map((signed || []).map((s, i) => [paths[i], s.signedUrl || ""]));
    for (const x of [...logos, ...mockups]) x.url = url.get(x.url) || "";
    return { ok: true as const, logos, mockups };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** take the chosen logos and mockups off (archived: kept, and can be put back), before the order is deleted */
export async function archiveOrderArt(orderId: string, designIds: string[], mockupIds: string[]) {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, groups, customer_id, number").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false as const, error: "Order not found." };
    // only this order's own art
    const mine = new Set(designIdsOf(o.groups));
    const dIds = designIds.filter((id) => mine.has(id));
    const at = new Date().toISOString();
    if (dIds.length) await admin.from("designs").update({ archived_at: at }).in("id", dIds).eq("customer_id", o.customer_id);
    if (mockupIds.length) await admin.from("mockups").update({ archived_at: at }).in("id", mockupIds).eq("order_id", orderId);
    if (dIds.length || mockupIds.length) await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `Deleting the order: took off ${dIds.length} logo${dIds.length === 1 ? "" : "s"} and ${mockupIds.length} mockup${mockupIds.length === 1 ? "" : "s"} (archived)`, actor: v.email });
    return { ok: true as const, logos: dIds.length, mockups: mockupIds.length };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** Keep: this order's draft logos and mockups go into the customer's library now */
export async function keepOrderArt(orderId: string) {
  try {
    const v = await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, groups").eq("id", orderId).maybeSingle();
    if (!o) return { ok: false as const, error: "Order not found." };
    const ids = designIdsOf(o.groups);
    const { data: d } = ids.length ? await admin.from("designs").update({ draft: false }).in("id", ids).eq("draft", true).select("id") : { data: [] };
    const { data: m } = await admin.from("mockups").update({ draft: false }).eq("order_id", orderId).eq("draft", true).select("id");
    const n = (d || []).length + (m || []).length;
    if (n) await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `Kept the order's art in the customer's library (${(d || []).length} logos, ${(m || []).length} mockups)`, actor: v.email });
    return { ok: true as const, logos: (d || []).length, mockups: (m || []).length };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}

/** how much of this order's art is still a draft (for the order's "Keep in their library" note) */
export async function draftArtCount(orderId: string) {
  try {
    await staff();
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("groups").eq("id", orderId).maybeSingle();
    const ids = designIdsOf(o?.groups);
    const { count: d } = ids.length ? await admin.from("designs").select("id", { count: "exact", head: true }).in("id", ids).eq("draft", true).is("archived_at", null) : { count: 0 };
    const { count: m } = await admin.from("mockups").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("draft", true).is("archived_at", null);
    return { ok: true as const, logos: d || 0, mockups: m || 0 };
  } catch { return { ok: false as const, logos: 0, mockups: 0 }; }
}

/** the Artwork page's Drafts: every draft logo and mockup, with its order */
export async function listDrafts() {
  try {
    await staff();
    const admin = createAdminClient();
    const { data: ds } = await admin.from("designs").select("id, number, name, preview_path, file_path, customer_id, created_at").eq("draft", true).is("archived_at", null).order("created_at", { ascending: false }).limit(200);
    const { data: ms } = await admin.from("mockups").select("id, title, file_path, customer_id, order_id, created_at").eq("draft", true).is("archived_at", null).order("created_at", { ascending: false }).limit(200);
    // which order each draft logo is on
    const { data: os } = await admin.from("orders").select("id, number, groups, updated_at").in("status", ["quote", "request"]).limit(1000);
    const onOrder = new Map<string, { id: string; number: number; updated_at: string }>();
    for (const o of os || []) for (const id of designIdsOf(o.groups)) if (!onOrder.has(id)) onOrder.set(id, { id: o.id, number: o.number, updated_at: o.updated_at });
    const mOrders = new Map((os || []).map((o) => [o.id as string, { id: o.id as string, number: o.number as number, updated_at: o.updated_at as string }]));
    const items = [
      ...(ds || []).map((d) => ({ kind: "logo" as const, id: d.id as string, label: `D-${d.number} ${d.name || ""}`.trim(), path: (d.preview_path || d.file_path || "") as string, customer_id: d.customer_id as string | null, created_at: d.created_at as string, order: onOrder.get(d.id) || null })),
      ...(ms || []).map((m) => ({ kind: "mockup" as const, id: m.id as string, label: (m.title || "Mockup") as string, path: (m.file_path || "") as string, customer_id: m.customer_id as string | null, created_at: m.created_at as string, order: m.order_id ? mOrders.get(m.order_id) || null : null })),
    ];
    const paths = items.map((x) => (x.kind === "mockup" ? x.path.replace(/\.png$/, "-thumb.png") : x.path)).filter(Boolean);
    const { data: sg } = paths.length ? await admin.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    const url = new Map((sg || []).map((s, i) => [paths[i], s.signedUrl || ""]));
    return { ok: true as const, items: items.map(({ path, ...x }) => ({ ...x, url: url.get(x.kind === "mockup" ? path.replace(/\.png$/, "-thumb.png") : path) || "" })) };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e), items: [] }; }
}

/** one draft: keep it (into the library) or take it off (archived) */
export async function setDraft(kind: "logo" | "mockup", id: string, keep: boolean) {
  try {
    await staff();
    const admin = createAdminClient();
    const t = kind === "logo" ? "designs" : "mockups";
    const { error } = await admin.from(t).update(keep ? { draft: false } : { archived_at: new Date().toISOString() }).eq("id", id).eq("draft", true);
    return error ? { ok: false as const, error: error.message } : { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
