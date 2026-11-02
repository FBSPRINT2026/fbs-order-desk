import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectSummary } from "@/lib/projects";
import { customerStatus } from "@/lib/orderStages";

/** Projects with their order counts, totals and next open task (for lists). Caller checks the viewer may see these customers. */
export async function projectSummaries(admin: SupabaseClient, customerIds: string[], customerView = true): Promise<ProjectSummary[]> {
  if (!customerIds.length) return [];
  const { data: ps } = await admin.from("projects").select("*").in("customer_id", customerIds).order("event_date", { ascending: true, nullsFirst: false });
  const projects = (ps || []) as Project[];
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [{ data: os }, { data: ar }, { data: ts }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, project_id, total, status, type, flags, delivery_method, due_date, discarded_at").in("project_id", ids).is("discarded_at", null),
    admin.from("archived_orders").select("project_id, total").is("removed_at", null).in("project_id", ids),
    admin.from("project_tasks").select("project_id, title, due_date, done_at, shop_only, position").in("project_id", ids).order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  return projects.map((p) => {
    const o = (os || []).filter((x) => x.project_id === p.id && !(customerView && x.status === "quote"));
    const a = (ar || []).filter((x) => x.project_id === p.id);
    const all = (ts || []).filter((x) => x.project_id === p.id && !(customerView && x.shop_only));
    const t = all.filter((x) => !x.done_at);
    return { ...p, orders: o.length + a.length, total: [...o, ...a].reduce((s, x) => s + (+x.total || 0), 0), openTasks: t.length, nextTask: t[0] ? { title: t[0].title, due_date: t[0].due_date } : null,
      items: o.map((x) => ({ id: x.id, number: x.number, nickname: x.nickname || "", status: customerStatus(x as never, {}).label, total: +x.total || 0, due_date: x.due_date || null })),
      tasks: all.map((x) => ({ title: x.title, due_date: x.due_date, done: !!x.done_at })) };
  });
}
