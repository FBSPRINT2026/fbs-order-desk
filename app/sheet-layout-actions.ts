"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saved sales sheet layouts (components/SalesSheet.tsx; Oct 24, Nick: "if a customer… like how they have it and got all
 * the fields exactly how they want it, then they should be able to save a layout and name it… select it… make it
 * easy"). A customer's are their company's; staff each have their own. Never deleted: Remove sets removed_at.
 */
export type SheetLayout = { id: string; name: string; data: Record<string, unknown>; updated_at: string };

async function owner(): Promise<{ owner: string; by: string } | null> {
  const { supabase, user, email, isStaff } = await getViewer();
  if (!user) return null;
  if (isStaff) return { owner: `staff:${(email || "").toLowerCase()}`, by: email || "" };
  const { data: cs } = await supabase.from("customers").select("id").limit(1);
  const c = (cs || [])[0];
  return c ? { owner: `customer:${c.id}`, by: email || "" } : null;
}

export async function mySheetLayouts(): Promise<SheetLayout[]> {
  try {
    const o = await owner(); if (!o) return [];
    const { data } = await createAdminClient().from("sheet_layouts").select("id, name, data, updated_at").eq("owner", o.owner).is("removed_at", null).order("updated_at", { ascending: false }).limit(50);
    return (data || []) as SheetLayout[];
  } catch { return []; }
}

export async function saveSheetLayout(name: string, data: Record<string, unknown>, id?: string): Promise<{ ok: boolean; error?: string; layout?: SheetLayout }> {
  try {
    const o = await owner(); if (!o) return { ok: false, error: "Please sign in again." };
    const nm = String(name || "").trim().slice(0, 80);
    if (!nm) return { ok: false, error: "Give the layout a name." };
    const json = JSON.stringify(data || {});
    if (json.length > 200_000) return { ok: false, error: "That layout is too big to save." };
    const admin = createAdminClient();
    const row = { owner: o.owner, name: nm, data: JSON.parse(json), created_by: o.by, updated_at: new Date().toISOString() };
    const q = id
      ? admin.from("sheet_layouts").update(row).eq("id", id).eq("owner", o.owner).is("removed_at", null)
      : admin.from("sheet_layouts").insert(row);
    const { data: saved, error } = await q.select("id, name, data, updated_at").single();
    if (error || !saved) return { ok: false, error: error?.message || "Couldn't save it." };
    return { ok: true, layout: saved as SheetLayout };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't save it." }; }
}

export async function removeSheetLayout(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const o = await owner(); if (!o) return { ok: false, error: "Please sign in again." };
    const { error } = await createAdminClient().from("sheet_layouts").update({ removed_at: new Date().toISOString() }).eq("id", id).eq("owner", o.owner);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't remove it." }; }
}
