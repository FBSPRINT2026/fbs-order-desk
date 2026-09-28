import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectSummary } from "@/lib/projects";

/** Projects with their order counts, totals and next open task (for lists). Caller checks the viewer may see these customers. */
export async function projectSummaries(admin: SupabaseClient, customerIds: string[], customerView = true): Promise<ProjectSummary[]> {
  if (!customerIds.length) return [];
  const { data: ps } = await admin.from("projects").select("*").in("customer_id", customerIds).order("event_date", { ascending: true, nullsFirst: false });
  const projects = (ps || []) as Project[];
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [{ data: os }, { data: ar }, { data: ts }] = await Promise.all([
    admin.from("orders").select("project_id, total, status").in("project_id", ids),
    admin.from("archived_orders").select("project_id, total").in("project_id", ids),
    admin.from("project_tasks").select("project_id, title, due_date, done_at, shop_only").in("project_id", ids).is("done_at", null).order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  return projects.map((p) => {
    const o = (os || []).filter((x) => x.project_id === p.id && !(customerView && x.status === "quote"));
    const a = (ar || []).filter((x) => x.project_id === p.id);
    const t = (ts || []).filter((x) => x.project_id === p.id && !(customerView && x.shop_only));
    return { ...p, orders: o.length + a.length, total: [...o, ...a].reduce((s, x) => s + (+x.total || 0), 0), openTasks: t.length, nextTask: t[0] ? { title: t[0].title, due_date: t[0].due_date } : null };
  });
}
