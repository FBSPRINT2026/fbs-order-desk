/** Projects: a customer's bigger effort (a conference, a season, an event) with several orders, key dates, tasks and a conversation. */
export type ProjectStatus = "planning" | "active" | "delivered" | "closed";
export const PROJECT_STATUS: Record<ProjectStatus, { label: string; c: string }> = {
  planning: { label: "Planning", c: "#7C3AED" },
  active: { label: "In progress", c: "#2563EB" },
  delivered: { label: "Delivered", c: "#15803D" },
  closed: { label: "Closed", c: "#64748B" },
};
export type Project = {
  id: string; customer_id: string; name: string; status: ProjectStatus; event_date: string | null; in_hands_date: string | null;
  delivery: string; requests: string; created_by: string; created_at: string; updated_at: string;
};
export type ProjectTask = { id: string; project_id: string; title: string; due_date: string | null; who: "shop" | "customer"; shop_only: boolean; done_at: string | null; done_by: string; position: number };
export type ProjectOrder = { id: string; number: number; nickname: string; statusLabel: string; statusColor?: string; type: string; total: number; balance: number; due_date: string | null; href: string; archived?: boolean };
export type ProjectSummary = Project & { company?: string; orders: number; total: number; openTasks: number; nextTask?: { title: string; due_date: string | null } | null };

/** Days from today to a date (negative = past). */
export function daysTo(d?: string | null): number | null {
  if (!d) return null;
  const t = new Date(); t.setHours(12, 0, 0, 0);
  return Math.round((Date.parse(d + "T12:00:00") - t.getTime()) / 86400000);
}
export const countdown = (d?: string | null) => {
  const n = daysTo(d);
  if (n === null) return "";
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`;
};
