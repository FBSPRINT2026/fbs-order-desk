"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clickupTokens, ensureClickUpFiles, importClickUpTask, reopenClickUpTask, setClickUpBox, setClickUpDone, type ClickUpTaskRow, type ClickUpTeamRow, type CuFile } from "@/lib/clickup";
import { allRows } from "@/lib/readAll";

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
const TOOL_ONLY_FROM = Date.parse("2026-10-22T20:00:00Z");

async function knownJobs(admin: ReturnType<typeof createAdminClient>, tasks: ClickUpTaskRow[], teams: ClickUpTeamRow[]) {
  const custOf = new Map(teams.map((t) => [t.id, t.customer_id]));
  const custs = [...new Set(tasks.map((t) => custOf.get(t.team_id)).filter((x): x is string => !!x))];
  const out: Record<string, ClickUpKnown> = {};
  if (!custs.length) return out;
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const [{ data: pv }, { data: ord }] = await Promise.all([
    allRows((r0, r1) => admin.from("archived_orders").select("id, visual_id, nickname, po_number, status_name, order_date, customer_id").in("customer_id", custs).gte("order_date", since).order("id").range(r0, r1), 4000),
    allRows((r0, r1) => admin.from("orders").select("id, number, nickname, po_number, customer_id, created_at").in("customer_id", custs).gte("created_at", since).order("id").range(r0, r1), 4000),
  ]);
  const nums = (s: string) => [...new Set((s.match(/\d{3,10}/g) || []).filter((n) => !/^20[2-3]\d$/.test(n)))];
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  // a job code ("HUD 102026", "JAC 100826", "AMS 43142") must match whole, letters and number together: McKenna's codes
  // are the school + the date, so "HUD 102026" and "LCHS 102026" share the number (Oct 22: Hudson Band was taken for
  // Printavo 34716, LCHS Band State). "PO" / "SO" before a number is just the label, not a code.
  const codes = (s: string) => [...s.matchAll(/\b([A-Za-z]{2,5})[\s-]?(\d{5,}[A-Za-z]?)\b/g)].filter((m) => !/^(po|so|no|inv)$/i.test(m[1])).map((m) => (m[1] + m[2]).toUpperCase());
  // a 6-digit number that reads as a date (MMDDYY) isn't enough on its own
  const dateLike = (n: string) => /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{2}$/.test(n);
  const score = (task: string, text: string) => {
    const a = words(task), b = words(text), common = [...a].filter((w) => b.has(w)).length;
    const tc = codes(task);
    if (tc.length) {
      const xc = new Set(codes(text));
      const hit = tc.filter((c) => xc.has(c)).length;
      return hit ? hit * 100 + common : 0;
    }
    const hits = nums(task).filter((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(text));
    if (!hits.length || (hits.every(dateLike) && !common)) return 0;
    return hits.length * 100 + common;
  };
  // each order's numbers and codes, indexed (Oct 27, Nick: Mark complete "just kind of spins": a big workspace compared
  // every job with every order, a regex each time, on every refresh). A number "matches" when it's a whole run of digits
  // in the order's text, as before.
  type Ix = { nums: Map<string, number[]>; codes: Map<string, number[]> };
  const index = (rows: { customer_id: unknown; po_number?: unknown; nickname?: unknown }[]) => {
    const by = new Map<string, Ix>();
    rows.forEach((o, i) => {
      const c = String(o.customer_id || ""); if (!by.has(c)) by.set(c, { nums: new Map(), codes: new Map() });
      const ix = by.get(c)!, text = `${o.po_number || ""} ${o.nickname || ""}`;
      for (const n of new Set(text.match(/\d+/g) || [])) { const a = ix.nums.get(n) || []; a.push(i); ix.nums.set(n, a); }
      for (const k of new Set(codes(text))) { const a = ix.codes.get(k) || []; a.push(i); ix.codes.set(k, a); }
    });
    return by;
  };
  const pvIx = index(pv || []), ordIx = index(ord || []);
  const candidates = (ix: Ix | undefined, name: string) => {
    if (!ix) return [];
    const tc = codes(name);
    const keys = tc.length ? tc.map((k) => ix.codes.get(k) || []) : nums(name).map((n) => ix.nums.get(n) || []);
    return [...new Set(keys.flat())];
  };
  for (const t of tasks) {
    const c = custOf.get(t.team_id);
    if (!c || !nums(t.name).length) continue;
    // from Oct 22 2026, 3 PM Central on, ClickUp jobs are only entered through this tool, so a new one is never
    // looked for in Printavo: it's New until it's made into an order here (Nick: "anything that comes over from here
    // on out is going to be new")
    if (t.created_at_cu && Date.parse(t.created_at_cu) >= TOOL_ONLY_FROM) continue;
    let best: { s: number; at: string; pv: ClickUpKnown["pv"] } | null = null;
    for (const o of candidates(pvIx.get(c), t.name).map((i) => (pv || [])[i])) {
      const sc = score(t.name, `${o.po_number || ""} ${o.nickname || ""}`);
      if (sc && (!best || sc > best.s || (sc === best.s && String(o.order_date) > best.at))) best = { s: sc, at: String(o.order_date || ""), pv: { id: o.id as string, number: String(o.visual_id || ""), status: String(o.status_name || ""), name: String(o.nickname || o.po_number || "") } };
    }
    let mine: { s: number; at: string; o: { id: string; number: number } } | null = null;
    for (const o of candidates(ordIx.get(c), t.name).map((i) => (ord || [])[i])) {
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
    allRows((r0, r1) => admin.from("customers").select("id, company, name").order("id").range(r0, r1), 5000),
  ]);
  if (st.error) return { ok: false, error: "ClickUp Jobs needs its database update (migration 185)." };
  const byId = new Map<string, ClickUpTaskRow>();
  for (const t of [...((open.data || []) as ClickUpTaskRow[]), ...((made.data || []) as ClickUpTaskRow[])]) byId.set(t.id, t);
  const customers = ((cs.data || []) as { id: string; company: string | null; name: string | null }[])
    .map((c) => ({ id: c.id, label: String(c.company || c.name || "").trim() })).filter((c) => c.label).sort((a, b) => a.label.localeCompare(b.label));
  const tasks = [...byId.values()], teamRows = (teams.data || []) as ClickUpTeamRow[];
  const known = await knownJobs(admin, tasks, teamRows).catch(() => ({} as Record<string, ClickUpKnown>));
  // a job matched to a Printavo job is already entered: kept on it, and not new (Oct 22, Nick: "we have the Printavo
  // number already in there, so I'm not sure why that one's under new")
  for (const t of tasks) {
    const pv = known[t.id]?.pv;
    // a match made before that no longer holds is undone, and the job is new again if it otherwise would be
    if (!pv && t.pv_number) {
      const hidden = !!teamRows.find((x) => x.id === t.team_id)?.hidden;
      const waiting = !hidden && !t.parent && !/^(closed|done)$/i.test(t.status_type) && !t.in_printavo && !t.order_id && !t.dismissed_at
        && !/(^|›\s*)personal list$/i.test(String(t.where_text || "").trim()) && !(t.created_at_cu && Date.now() - Date.parse(t.created_at_cu) > 120 * 864e5);
      await admin.from("clickup_tasks").update({ pv_id: null, pv_number: null, waiting }).eq("id", t.id);
      t.pv_id = null; t.pv_number = null; t.waiting = waiting;
      continue;
    }
    if (!pv || t.pv_number === pv.number) continue;
    await admin.from("clickup_tasks").update({ pv_id: pv.id, pv_number: pv.number, waiting: false }).eq("id", t.id);
    t.pv_id = pv.id; t.pv_number = pv.number; t.waiting = false;
  }
  return { ok: true, connected: clickupTokens().length > 0, tokens: clickupTokens().length, state: (st.data as ClickUpState | null) || null, teams: teamRows, tasks, known, customers };
}

/** which customer a workspace is (its jobs become their orders) */
export async function setClickUpCustomer(teamId: string, customerId: string | null) {
  const v = await who(); if (!v) return NO;
  const { error } = await createAdminClient().from("clickup_teams").update({ customer_id: customerId || null, guessed: false }).eq("id", teamId);
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/** a ClickUp field (column) this workspace doesn't keep or show, or back again (Oct 27, Nick: McKenna's "PO RECEIVED", "we
 *  don't need to sync that column. It shouldn't show"). Hiding it clears it from the jobs here; ClickUp isn't touched.
 *  Showing it again brings it back on the next read of each job. */
export async function hideClickUpField(teamId: string, name: string, hide: boolean) {
  const v = await who(); if (!v) return NO;
  const n = String(name || "").trim();
  if (!n || /printavo/i.test(n)) return { ok: false as const, error: "The In Printavo box is always kept." };
  const admin = createAdminClient();
  const { data: t } = await admin.from("clickup_teams").select("hidden_fields").eq("id", teamId).maybeSingle();
  if (!t) return { ok: false as const, error: "That workspace isn't here." };
  const was = ((t.hidden_fields || []) as string[]).filter((x) => x.toLowerCase() !== n.toLowerCase());
  const { error } = await admin.from("clickup_teams").update({ hidden_fields: hide ? [...was, n] : was }).eq("id", teamId);
  if (error) return { ok: false as const, error: error.message };
  if (hide) {
    const { data: rows } = await admin.from("clickup_tasks").select("id, fields, field_ids").eq("team_id", teamId);
    for (const r of (rows || []) as { id: string; fields: Record<string, string> | null; field_ids: Record<string, string> | null }[]) {
      const drop = (m: Record<string, string> | null) => Object.fromEntries(Object.entries(m || {}).filter(([k]) => k.trim().toLowerCase() !== n.toLowerCase()));
      if (Object.keys(r.fields || {}).some((k) => k.trim().toLowerCase() === n.toLowerCase()) || Object.keys(r.field_ids || {}).some((k) => k.trim().toLowerCase() === n.toLowerCase()))
        await admin.from("clickup_tasks").update({ fields: drop(r.fields), field_ids: drop(r.field_ids) }).eq("id", r.id);
    }
  }
  return { ok: true as const };
}

/** a workspace that isn't a customer's jobs (hidden) or back again; its jobs' waiting is worked out again */
export async function hideClickUpTeam(teamId: string, hidden: boolean) {
  const v = await who(); if (!v) return NO;
  const admin = createAdminClient();
  const { error } = await admin.from("clickup_teams").update({ hidden }).eq("id", teamId);
  if (error) return { ok: false as const, error: error.message };
  if (hidden) await admin.from("clickup_tasks").update({ waiting: false }).eq("team_id", teamId);
  else await admin.from("clickup_tasks").update({ waiting: true }).eq("team_id", teamId).is("parent", null).not("status_type", "in", "(closed,done)").eq("in_printavo", false).is("pv_number", null).is("order_id", null).is("dismissed_at", null);
  return { ok: true as const };
}

/** not an order (or back to the list) */
export async function dismissClickUpTask(id: string, dismiss: boolean) {
  const v = await who(); if (!v) return NO;
  const admin = createAdminClient();
  const { data: t } = await admin.from("clickup_tasks").select("team_id, parent, status_type, in_printavo, pv_number, order_id").eq("id", id).maybeSingle();
  if (!t) return { ok: false as const, error: "That ClickUp job isn't on file." };
  const { data: team } = await admin.from("clickup_teams").select("hidden").eq("id", t.team_id).maybeSingle();
  const waiting = !dismiss && !team?.hidden && !t.parent && !/^(closed|done)$/i.test(String(t.status_type)) && !t.in_printavo && !t.pv_number && !t.order_id;
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

/**
 * A customer's whole workspace (Oct 22, Nick: "click on their workspace and view it kind of like you do in ClickUp…
 * everything that's in there, all that's completed, not completed"): every job on file, open and completed (completed
 * ones of the last 3 years are read in by the reader, a few hundred a run), with the Printavo / our order matches.
 */
export async function clickUpWorkspace(teamId: string): Promise<{ ok: true; team: ClickUpTeamRow | null; tasks: ClickUpTask[]; known: Record<string, ClickUpKnown>; reading: boolean } | { ok: false; error: string }> {
  const v = await who(); if (!v) return NO;
  const admin = createAdminClient();
  const [{ data: team }, { data: tasks, error }] = await Promise.all([
    admin.from("clickup_teams").select("*").eq("id", teamId).maybeSingle(),
    allRows((r0, r1) => admin.from("clickup_tasks").select("*").eq("team_id", teamId).is("parent", null).order("created_at_cu", { ascending: false }).order("id").range(r0, r1), 3000),
  ]);
  if (error) return { ok: false, error: error.message };
  const rows = (tasks || []) as ClickUpTaskRow[];
  const known = team ? await knownJobs(admin, rows, [team as ClickUpTeamRow]).catch(() => ({} as Record<string, ClickUpKnown>)) : {};
  return { ok: true, team: (team as ClickUpTeamRow | null) || null, tasks: rows.map((t) => ({ ...t, description: t.description.slice(0, 2000) })), known, reading: !!team && !(team as { backfill_done_at?: string | null }).backfill_done_at };
}

/** Mark complete / Reopen: the job's status in ClickUp (its board's own complete / open status) */
export async function markClickUpDone(id: string, done: boolean) {
  const v = await who(); if (!v) return NO;
  return setClickUpDone(createAdminClient(), id, done);
}

/** tick / untick one of the job's check boxes in ClickUp (In Printavo, PO Ready…) */
export async function tickClickUpBox(id: string, name: string, on: boolean) {
  const v = await who(); if (!v) return NO;
  return setClickUpBox(createAdminClient(), id, String(name).slice(0, 120), !!on);
}

/** the ClickUp job an order was made from (asked when the order is deleted) */
export async function clickUpJobOfOrder(orderId: string, number: number): Promise<{ id: string; name: string; team: string } | null> {
  const v = await who(); if (!v) return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId))) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("clickup_tasks").select("id, name, team_id").or(`order_id.eq.${orderId},order_number.eq.${Math.floor(+number || 0)}`).limit(1);
  const t = data?.[0] as { id: string; name: string; team_id: string } | undefined;
  if (!t) return null;
  const { data: team } = await admin.from("clickup_teams").select("name").eq("id", t.team_id).maybeSingle();
  return { id: t.id, name: t.name, team: String(team?.name || "ClickUp") };
}

/** an order made from a ClickUp job was deleted: the job back on the New list (In Printavo unticked in ClickUp) */
export async function reopenClickUpJob(taskId: string) {
  const v = await who(); if (!v) return NO;
  return reopenClickUpTask(createAdminClient(), String(taskId).slice(0, 40));
}
