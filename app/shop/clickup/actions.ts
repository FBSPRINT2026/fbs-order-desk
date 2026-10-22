"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clickupTokens, ensureClickUpFiles, importClickUpTask, type ClickUpTaskRow, type ClickUpTeamRow, type CuFile } from "@/lib/clickup";

/** ClickUp Jobs (app/shop/clickup/page.tsx): the customers' ClickUp jobs, read by lib/clickup.ts */

/** every staff member sees every workspace for now (Oct 22, Nick: "just for now, make everyone see all the accounts") */
async function who() {
  const v = await getViewer();
  return v.user && v.isStaff ? v : null;
}
const NO = { ok: false as const, error: "Staff only." };

export type ClickUpState = { setup_at: string | null; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; user_email: string | null };
export type ClickUpTask = Omit<ClickUpTaskRow, "description"> & { description: string };
/** the job already on file: its Printavo job and/or our order (matched by the numbers in the task's name) */
export type ClickUpKnown = { pv?: { id: string; number: string; status: string; name: string }; ours?: { id: string; number: number } };

/**
 * Jobs already entered (Oct 22, Nick: "attempt to match orders already in Printavo to their numbers… in Tiger Blue,
 * it has order number 2842. We know that that's order 34668 in Printavo"): the numbers in a task's name ("#2842 Leaps &
 * Bounds", "PO 92464 SRYG Sweatshirts", "JAC 100826") are looked for, as whole numbers, in the PO and job name of the
 * same customer's Printavo jobs and our orders (Printavo 34668's PO is "2842 Leaps & Bounds"). The best match wins:
 * most numbers found, then most words in common, then the newest.
 */
async function knownJobs(admin: ReturnType<typeof createAdminClient>, tasks: ClickUpTaskRow[], teams: ClickUpTeamRow[]) {
  const custOf = new Map(teams.map((t) => [t.id, t.customer_id]));
  const custs = [...new Set(tasks.map((t) => custOf.get(t.team_id)).filter((x): x is string => !!x))];
  const out: Record<string, ClickUpKnown> = {};
  if (!custs.length) return out;
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const [{ data: pv }, { data: ord }] = await Promise.all([
    admin.from("archived_orders").select("id, visual_id, nickname, po_number, status_name, order_date, customer_id").in("customer_id", custs).gte("order_date", since).limit(4000),
    admin.from("orders").select("id, number, nickname, po_number, customer_id, created_at").in("customer_id", custs).gte("created_at", since).limit(4000),
  ]);
  const nums = (s: string) => [...new Set((s.match(/\d{3,10}/g) || []).filter((n) => !/^20[2-3]\d$/.test(n)))];
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  const score = (task: string, text: string) => {
    const hit = nums(task).filter((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(text)).length;
    if (!hit) return 0;
    const a = words(task), b = words(text);
    return hit * 100 + [...a].filter((w) => b.has(w)).length;
  };
  for (const t of tasks) {
    const c = custOf.get(t.team_id);
    if (!c || !nums(t.name).length) continue;
    let best: { s: number; at: string; pv: ClickUpKnown["pv"] } | null = null;
    for (const o of (pv || []).filter((x) => x.customer_id === c)) {
      const sc = score(t.name, `${o.po_number || ""} ${o.nickname || ""}`);
      if (sc && (!best || sc > best.s || (sc === best.s && String(o.order_date) > best.at))) best = { s: sc, at: String(o.order_date || ""), pv: { id: o.id as string, number: String(o.visual_id || ""), status: String(o.status_name || ""), name: String(o.nickname || o.po_number || "") } };
    }
    let mine: { s: number; at: string; o: { id: string; number: number } } | null = null;
    for (const o of (ord || []).filter((x) => x.customer_id === c)) {
      const sc = score(t.name, `${o.po_number || ""} ${o.nickname || ""}`);
      if (sc && (!mine || sc > mine.s || (sc === mine.s && String(o.created_at) > mine.at))) mine = { s: sc, at: String(o.created_at || ""), o: { id: o.id as string, number: Number(o.number) } };
    }
    if (best || mine) out[t.id] = { ...(best ? { pv: best.pv } : {}), ...(mine ? { ours: mine.o } : {}) };
  }
  return out;
}

export async function listClickUp(): Promise<{ ok: true; connected: boolean; tokens: number; state: ClickUpState | null; teams: ClickUpTeamRow[]; tasks: ClickUpTask[]; known: Record<string, ClickUpKnown>; customers: { id: string; label: string }[] } | { ok: false; error: string }> {
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
  const tasks = [...byId.values()], teamRows = (teams.data || []) as ClickUpTeamRow[];
  const known = await knownJobs(admin, tasks, teamRows).catch(() => ({} as Record<string, ClickUpKnown>));
  return { ok: true, connected: clickupTokens().length > 0, tokens: clickupTokens().length, state: (st.data as ClickUpState | null) || null, teams: teamRows, tasks, known, customers };
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

/** the job panel opened: its files, copied into storage if the reader hasn't yet (so they open like email attachments) */
export async function clickUpFiles(id: string): Promise<{ ok: true; files: CuFile[] } | { ok: false; error: string }> {
  const v = await who(); if (!v) return NO;
  try {
    const t = await ensureClickUpFiles(createAdminClient(), id);
    return t ? { ok: true, files: t.attachments } : { ok: false, error: "That ClickUp job isn't on file." };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
