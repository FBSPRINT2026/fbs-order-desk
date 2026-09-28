"use client";
import { createClient } from "@/lib/supabase/client";
import type { Project, ProjectSummary } from "@/lib/projects";

/** Projects with order counts, totals and open tasks (staff see everything). */
export async function loadSummaries(customerId?: string): Promise<ProjectSummary[]> {
  const sb = createClient();
  let q = sb.from("projects").select("*").order("event_date", { ascending: true, nullsFirst: false });
  if (customerId) q = q.eq("customer_id", customerId);
  const { data: ps } = await q;
  const projects = (ps || []) as Project[];
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [{ data: os }, { data: ar }, { data: ts }] = await Promise.all([
    sb.from("orders").select("project_id, total").in("project_id", ids),
    sb.from("archived_orders").select("project_id, total").in("project_id", ids),
    sb.from("project_tasks").select("project_id, title, due_date").in("project_id", ids).is("done_at", null).order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  return projects.map((p) => {
    const o = [...(os || []), ...(ar || [])].filter((x) => x.project_id === p.id);
    const t = (ts || []).filter((x) => x.project_id === p.id);
    return { ...p, orders: o.length, total: o.reduce((s, x) => s + (+x.total || 0), 0), openTasks: t.length, nextTask: t[0] ? { title: t[0].title, due_date: t[0].due_date } : null };
  });
}

export async function createProjectAsStaff(f: { name: string; event_date: string | null; in_hands_date: string | null; requests: string; customer_id?: string }) {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!f.customer_id) return { ok: false, error: "Choose the customer." };
  const { data, error } = await sb.from("projects").insert({ customer_id: f.customer_id, name: f.name.trim().slice(0, 120), event_date: f.event_date, in_hands_date: f.in_hands_date, requests: f.requests, created_by: u.user?.email || "shop", status: "planning" }).select("id").single();
  return error ? { ok: false, error: error.message } : { ok: true, id: data.id as string };
}
