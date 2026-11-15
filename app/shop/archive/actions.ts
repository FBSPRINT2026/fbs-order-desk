"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * An old Printavo job's status, changed here (Nick, Nov 15 2026: Printavo closed Nov 14 with some jobs still open: "we
 * gotta be able to go in and change the statuses… there's some jobs that are left open"). The choices are Printavo's own
 * statuses (the names and colors its jobs carried), so every list that reads them (Outbound, the dashboard, My Day, the
 * calendar, search) keeps working as before. Each change is kept on the job (data.statusChanges: when, who, from, to).
 * Jobs before 2026 are locked (migration 082) and keep theirs.
 */
type Choice = { name: string; color: string };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") };
}

/** Printavo's statuses as its 2026 jobs used them, with their colors, most used first. */
export async function archivedStatuses(): Promise<{ ok: true; list: Choice[] } | { ok: false; error: string }> {
  try {
    const { admin } = await staff();
    const { data, error } = await admin.from("archived_orders").select("status_name, status_color").gte("order_date", "2026-01-01").not("status_name", "is", null).order("id").limit(1000);
    if (error) return { ok: false, error: error.message };
    const seen = new Map<string, Choice & { n: number }>();
    for (const r of (data || []) as { status_name: string; status_color: string | null }[]) {
      const name = r.status_name.trim(); if (!name) continue;
      const c = seen.get(name) || { name, color: r.status_color || "#888", n: 0 };
      c.n++; seen.set(name, c);
    }
    return { ok: true, list: [...seen.values()].sort((a, b) => b.n - a.n).map(({ name, color }) => ({ name, color })) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function setArchivedStatus(id: string, name: string): Promise<{ ok: true; status: Choice } | { ok: false; error: string }> {
  try {
    const { admin, by } = await staff();
    const want = String(name || "").trim();
    if (!want) return { ok: false, error: "Pick a status." };
    const { data: row, error } = await admin.from("archived_orders").select("id, status_name, data, locked").eq("id", id).maybeSingle();
    if (error || !row) return { ok: false, error: error?.message || "Job not found." };
    if (row.locked) return { ok: false, error: "Jobs from before 2026 are locked and keep their status." };
    // the color Printavo gave that status
    const { data: c } = await admin.from("archived_orders").select("status_color").eq("status_name", want).not("status_color", "is", null).limit(1).maybeSingle();
    const color = String(c?.status_color || "#888");
    const d = { ...((row.data as Record<string, unknown>) || {}) };
    const log = Array.isArray(d.statusChanges) ? (d.statusChanges as unknown[]) : [];
    d.status = { ...((d.status as Record<string, unknown>) || {}), name: want, color };
    d.statusChanges = [...log, { at: new Date().toISOString(), by, from: row.status_name || "", to: want }];
    const { error: e2 } = await admin.from("archived_orders").update({ status_name: want, status_color: color, data: d }).eq("id", id);
    if (e2) return { ok: false, error: e2.message };
    return { ok: true, status: { name: want, color } };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
