"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clickupToken, importClickUpTask, type ClickUpTaskRow, type ClickUpTeamRow } from "@/lib/clickup";

/** ClickUp Jobs (app/shop/clickup/page.tsx): the customers' ClickUp jobs, read by lib/clickup.ts */

/** every staff member sees every workspace for now (Oct 22, Nick: "just for now, make everyone see all the accounts") */
async function who() {
  const v = await getViewer();
  return v.user && v.isStaff ? v : null;
}
const NO = { ok: false as const, error: "Staff only." };

export type ClickUpState = { setup_at: string | null; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; user_email: string | null };
export type ClickUpTask = Omit<ClickUpTaskRow, "description"> & { description: string };

export async function listClickUp(): Promise<{ ok: true; connected: boolean; state: ClickUpState | null; teams: ClickUpTeamRow[]; tasks: ClickUpTask[]; customers: { id: string; label: string }[] } | { ok: false; error: string }> {
  const v = await who(); if (!v) return NO;
  const admin = createAdminClient();
  const since = new Date(Date.now() - 45 * 864e5).toISOString();
  const [st, teams, open, made, cs] = await Promise.all([
    admin.from("clickup_state").select("setup_at, last_run_at, last_ok_at, last_error, user_email").eq("id", 1).maybeSingle(),
    admin.from("clickup_teams").select("*").order("name"),
    admin.from("clickup_tasks").select("*").not("status_type", "in", "(closed,done)").is("parent", null).order("created_at_cu", { ascending: false }).limit(600),
    admin.from("clickup_tasks").select("*").not("order_id", "is", null).gte("synced_at", since).limit(200),
    admin.from("customers").select("id, company, name").limit(5000),
  ]);
  if (st.error) return { ok: false, error: "ClickUp Jobs needs its database update (migration 185)." };
  const byId = new Map<string, ClickUpTaskRow>();
  for (const t of [...((open.data || []) as ClickUpTaskRow[]), ...((made.data || []) as ClickUpTaskRow[])]) byId.set(t.id, t);
  const customers = ((cs.data || []) as { id: string; company: string | null; name: string | null }[])
    .map((c) => ({ id: c.id, label: String(c.company || c.name || "").trim() })).filter((c) => c.label).sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, connected: !!clickupToken(), state: (st.data as ClickUpState | null) || null, teams: (teams.data || []) as ClickUpTeamRow[], tasks: [...byId.values()], customers };
}

/** which customer a workspace is (its jobs become their orders) */
export async function setClickUpCustomer(teamId: string, customerId: string | null) {
  const v = await who(); if (!v) return NO;
  const { error } = await createAdminClient().from("clickup_teams").update({ customer_id: customerId || null, guessed: false }).eq("id", teamId);
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** a workspace that isn't a customer's jobs (hidden) or back again; its jobs' waiting is worked out again */
export async function hideClickUpTeam(teamId: string, hidden: boolean) {
  const v = await who(); if (!v) return NO;
  const admin = createAdminClient();
  const { error } = await admin.from("clickup_teams").update({ hidden }).eq("id", teamId);
  if (error) return { ok: false as const, error: error.message };
  if (hidden) await admin.from("clickup_tasks").update({ waiting: false }).eq("team_id", teamId);
  else await admin.from("clickup_tasks").update({ waiting: true }).eq("team_id", teamId).is("parent", null).not("status_type", "in", "(closed,done)").eq("in_printavo", false).is("order_id", null).is("dismissed_at", null);
  return { ok: true as const };
}

/** not an order (or back to the list) */
export async function dismissClickUpTask(id: string, dismiss: boolean) {
  const v = await who(); if (!v) return NO;
  const admin = createAdminClient();
  const { data: t } = await admin.from("clickup_tasks").select("team_id, parent, status_type, in_printavo, order_id").eq("id", id).maybeSingle();
  if (!t) return { ok: false as const, error: "That ClickUp job isn't on file." };
  const { data: team } = await admin.from("clickup_teams").select("hidden").eq("id", t.team_id).maybeSingle();
  const waiting = !dismiss && !team?.hidden && !t.parent && !/^(closed|done)$/i.test(String(t.status_type)) && !t.in_printavo && !t.order_id;
  const { error } = await admin.from("clickup_tasks").update(dismiss ? { dismissed_at: new Date().toISOString(), dismissed_by: v.email, waiting: false } : { dismissed_at: null, dismissed_by: null, waiting }).eq("id", id);
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** Process: the job is read fresh from ClickUp and brought in like an email (its files too), for the order maker */
export async function processClickUpTask(id: string) {
  const v = await who(); if (!v) return NO;
  return importClickUpTask(createAdminClient(), id, v.email);
}
