import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ClickUp Jobs (Oct 22, Nick: "When you click the clickup tool, it would basically show you, hey, McKenna uploaded…
 * would you like to process this order? …let's create a new order or let's create a reorder. And then you go through
 * the same process like you did before. The only thing at the end is you would go back and click the In Printavo
 * button in ClickUp").
 *
 * Phenomenal, Nine18, Cedar Promos (Peter Sleiman), Logotology, TCA, Cowboy Cool, Tigerblue and The McKenna Group each
 * have a ClickUp workspace ("Space / Purchase Orders"). A job is a task: its name ("PO 92464 SRYG Sweatshirts",
 * "Jackson Athletics Hoodie - JAC 100826"), a due date, notes, fields ("In Printavo", "PO Ready", "Customer Name"),
 * the PO / work order / art attached, and comments ("Blanks tracking 1Z…").
 *
 *  - syncClickUp (every 3 minutes, clickup_tick, migration 185): reads every workspace the token's owner is in and
 *    keeps clickup_teams / clickup_tasks. A job is waiting when it's open, its "In Printavo" box isn't ticked, no order
 *    was made from it and nobody dismissed it. A task is left alone until nobody has touched it for 2 minutes
 *    (customers make the task, then attach the PO).
 *  - importClickUpTask: Process → the task (notes, fields, comments) and its files are read into the portal as an
 *    email (activities, kind "clickup"), so the Inbox's order maker (OrderStartPick / QuickOrder) runs on it unchanged.
 *  - tickInPrintavo: once the order is made (lib/emailOrderCreate.ts), the task's "In Printavo" box is ticked. That is
 *    the only thing ever written to ClickUp.
 */

const API = "https://api.clickup.com/api/v2";
/**
 * The tokens: every Vercel variable whose name starts with CLICKUP_API_TOKEN (Oct 22, Nick: "Looks like I need an API
 * for each workspace": a token sees only the workspace it was made in). A variable may hold several, comma-separated.
 * `key` is the variable's name (kept with the workspace; the token itself never leaves the server).
 */
export function clickupTokens(): { key: string; token: string }[] {
  const out: { key: string; token: string }[] = [];
  for (const [k, v] of Object.entries(process.env as Record<string, string | undefined>)) {
    if (!/^CLICKUP_API_TOKEN/i.test(k) || !v) continue;
    String(v).split(/[\s,;]+/).filter((x) => x.length > 8).forEach((t, i) => { if (!out.some((o) => o.token === t)) out.push({ key: i ? `${k}#${i + 1}` : k, token: t }); });
  }
  return out.sort((a, b) => (a.key === "CLICKUP_API_TOKEN" ? -1 : b.key === "CLICKUP_API_TOKEN" ? 1 : a.key.localeCompare(b.key)));
}
export const clickupToken = () => clickupTokens()[0]?.token || "";
/** the token that reads a workspace */
async function tokenFor(admin: SupabaseClient, teamId: string) {
  const all = clickupTokens();
  const { data } = teamId ? await admin.from("clickup_teams").select("token_key").eq("id", teamId).maybeSingle() : { data: null };
  return (all.find((t) => t.key === data?.token_key) || all[0])?.token || "";
}
const QUIET_MS = 2 * 60_000;
const BACKFILL_MS = 3 * 365.25 * 864e5; // the workspace view keeps 3 years of completed jobs

type CuUser = { id?: number; username?: string | null; email?: string | null };
type CuField = { id: string; name: string; type: string; value?: unknown; type_config?: { options?: { id: string; name?: string; label?: string; orderindex?: number }[] } };
type CuAtt = { id: string; title?: string; url?: string; size?: number | string; extension?: string; mimetype?: string; deleted?: boolean; hidden?: boolean; is_folder?: boolean | null };
type CuTask = {
  id: string; name: string; text_content?: string | null; description?: string | null; status?: { status?: string; type?: string; color?: string };
  date_created?: string; date_updated?: string; due_date?: string | null; creator?: CuUser; url?: string; parent?: string | null;
  list?: { id: string; name?: string }; folder?: { name?: string; hidden?: boolean }; space?: { id: string };
  custom_fields?: CuField[]; attachments?: CuAtt[]; priority?: { priority?: string } | null;
};
type CuComment = { id: string; comment_text?: string; user?: CuUser; date?: string };
type Team = { id: string; name: string; members?: { user?: CuUser }[] };
/** a file on the task; `path` once it's copied into storage (proofs/clickup/…), so it opens like an email's attachment */
export type CuFile = { id: string; name: string; url: string; size: number; ext: string; type: string; path?: string };
export type CuNote = { who: string; email: string; at: string; text: string };
export type ClickUpTaskRow = {
  id: string; team_id: string; where_text: string; name: string; url: string; parent: string | null; status: string; status_type: string; status_color: string;
  due_at: string | null; created_at_cu: string | null; updated_at_cu: string | null; creator_name: string; creator_email: string; description: string;
  fields: Record<string, string>; printavo_field: string | null; in_printavo: boolean; attachments: CuFile[]; comments: CuNote[];
  activity_id: string | null; order_id: string | null; order_number: number | null; ticked_at: string | null; tick_error: string | null;
  dismissed_at: string | null; dismissed_by: string | null; waiting: boolean; synced_at: string;
  /** the Printavo job it was matched to (already entered: not new) */ pv_id: string | null; pv_number: string | null;
  /** the ClickUp list (board) it's on */ list_id: string | null;
  /** ClickUp priority: urgent | high | normal | low | "" */ priority: string;
  /** its check box fields by name → ClickUp field id */ field_ids: Record<string, string>;
};
export type ClickUpTeamRow = { id: string; name: string; members: string[]; customer_id: string | null; guessed: boolean; hidden: boolean; seen_at: string; token_key: string };
export type ClickUpRun = { ok: boolean; waiting?: string; error?: string; teams?: number; read?: number; newJobs?: string[]; later?: number; backfilled?: number };

/** ClickUp calls per token this run (ClickUp allows 100 a minute per token) */
const calls = new Map<string, number>();
const used = (tok: string) => calls.get(tok) || 0;
async function cu<T>(tok: string, path: string, init?: { method: "POST" | "PUT"; body: unknown }): Promise<T> {
  calls.set(tok, used(tok) + 1);
  const r = await fetch(API + path, {
    method: init?.method || "GET", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { Authorization: tok, ...(init ? { "Content-Type": "application/json" } : {}) }, body: init ? JSON.stringify(init.body) : undefined,
  });
  if (r.status === 429) throw new Error("ClickUp asked us to slow down; the next run picks up from here.");
  if (r.status === 401) throw new Error("ClickUp didn't accept a token (CLICKUP_API_TOKEN… in Vercel): make a new one in that workspace's ClickUp → Settings → Apps.");
  if (!r.ok) throw new Error(`ClickUp ${path.split("?")[0]}: ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

const ms = (s?: string | null) => (s ? Number(s) || 0 : 0);
const iso = (t: number) => (t ? new Date(t).toISOString() : null);
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const ours = (e?: string | null) => /@fbsprint\.com$/i.test(String(e || ""));
const isDone = (type?: string | null) => /^(closed|done)$/i.test(String(type || ""));
const safe = (s: string) => s.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

/** a custom field as words ("✓", "Stephanie Foster", "Mon, Oct 26, 2026"); null when empty */
function fieldText(f: CuField): string | null {
  const v = f.value;
  if (f.type === "checkbox") return v === true || v === "true" ? "✓" : "—";
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  const opts = f.type_config?.options || [];
  if (f.type === "drop_down") { const o = opts.find((x) => x.id === v || x.orderindex === Number(v)); return o?.name || String(v); }
  if (f.type === "labels" && Array.isArray(v)) return v.map((id) => { const o = opts.find((x) => x.id === id); return o?.label || o?.name || String(id); }).join(", ");
  if (f.type === "date") return day(Number(v));
  if (f.type === "users" && Array.isArray(v)) return (v as CuUser[]).map((u) => u.username || u.email || "").filter(Boolean).join(", ");
  if (f.type === "attachment" && Array.isArray(v)) return `${v.length} file${v.length === 1 ? "" : "s"}`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
  return String(v).slice(0, 500);
}
const printavoBox = (t: CuTask) => (t.custom_fields || []).find((f) => f.type === "checkbox" && /printavo/i.test(f.name));

/** a task (read in full) as its row; the portal's own columns (order, dismissed, activity) aren't touched */
function rowOf(t: CuTask, teamId: string, comments: CuComment[], myEmail: string) {
  const box = printavoBox(t);
  const fields = Object.fromEntries((t.custom_fields || []).map((f) => [f.name.trim(), fieldText(f)] as const).filter((x): x is [string, string] => x[1] != null));
  return {
    id: t.id, team_id: teamId, list_id: t.list?.id || null, priority: String(t.priority?.priority || "").toLowerCase(), where_text: [t.folder && !t.folder.hidden ? t.folder.name : "", t.list?.name].filter(Boolean).join(" › "), name: String(t.name || "").slice(0, 300),
    url: t.url || `https://app.clickup.com/t/${t.id}`, parent: t.parent || null, status: String(t.status?.status || ""), status_type: String(t.status?.type || ""), status_color: String(t.status?.color || ""),
    due_at: iso(ms(t.due_date)), created_at_cu: iso(ms(t.date_created)), updated_at_cu: iso(ms(t.date_updated)),
    creator_name: String(t.creator?.username || ""), creator_email: String(t.creator?.email || "").toLowerCase(), description: String(t.text_content || t.description || "").trim().slice(0, 20000),
    fields, printavo_field: box?.id || null,
    field_ids: Object.fromEntries((t.custom_fields || []).filter((f) => f.type === "checkbox").map((f) => [f.name.trim(), f.id])), in_printavo: !!box && (box.value === true || box.value === "true"),
    attachments: (t.attachments || []).filter((a) => a.id && a.url && !a.deleted && !a.hidden && !a.is_folder).slice(0, 30)
      .map((a): CuFile => ({ id: a.id, name: String(a.title || `file${a.extension ? "." + a.extension : ""}`), url: String(a.url), size: Number(a.size) || 0, ext: String(a.extension || "").toLowerCase(), type: String(a.mimetype || "") })),
    comments: comments.filter((c) => String(c.comment_text || "").trim()).sort((a, b) => ms(a.date) - ms(b.date)).slice(-30)
      .map((c) => ({ who: String(c.user?.username || c.user?.email || "Someone"), email: String(c.user?.email || "").toLowerCase(), at: iso(ms(c.date)) || "", text: String(c.comment_text || "").trim().slice(0, 4000), mine: String(c.user?.email || "").toLowerCase() === myEmail })),
    synced_at: new Date().toISOString(),
  };
}
/**
 * A new job to process. Not: a subtask, done, ticked In Printavo or matched to a Printavo job, made into an order, marked
 * not an order, in a "Personal List" (ClickUp's own scratch list: McKenna's "test" / "tbd" from Mar 2024), or made more
 * than 4 months ago (a forgotten task, not a job coming in).
 */
const STALE_MS = 120 * 864e5;
const waitingOf = (r: { parent: string | null; status_type: string; in_printavo: boolean; order_id?: string | null; dismissed_at?: string | null; pv_number?: string | null; where_text?: string; created_at_cu?: string | null }, hidden: boolean) =>
  !hidden && !r.parent && !isDone(r.status_type) && !r.in_printavo && !r.pv_number && !r.order_id && !r.dismissed_at
  && !/(^|›\s*)personal list$/i.test(String(r.where_text || "").trim()) && !(r.created_at_cu && Date.now() - Date.parse(r.created_at_cu) > STALE_MS);

/** a workspace's customer, when exactly one fits (its name, or the email domain of the people in it) */
async function guessCustomer(admin: SupabaseClient, name: string, members: string[]) {
  const GENERIC = /^(gmail|yahoo|hotmail|outlook|icloud|aol|live|me|msn|comcast|att|sbcglobal)\./i;
  const norm = (s: string) => ` ${s.toLowerCase().replace(/&/g, " and ").replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|llc|inc|co|company|team|group|printing|solutions|apparel|promos?|promotions|workspace|and|fbs)\b/g, " ").replace(/\s+/g, " ").trim()} `;
  const doms = new Set(members.map((e) => e.split("@")[1]).filter((d) => d && !GENERIC.test(d)));
  const [{ data: cs }, { data: cc }] = await Promise.all([
    admin.from("customers").select("id, company, name, email").limit(5000),
    doms.size ? admin.from("customer_contacts").select("customer_id, email").limit(10000) : Promise.resolve({ data: [] as { customer_id: string; email: string }[] }),
  ]);
  const hits = new Set<string>();
  const tn = norm(name);
  for (const c of (cs || []) as { id: string; company: string | null; name: string | null; email: string | null }[]) {
    const cn = norm(c.company || c.name || "");
    if (cn.trim().length >= 4 && (tn.includes(cn) || cn.includes(tn.trim().length >= 4 ? tn : "\u0000"))) hits.add(c.id);
    const d = String(c.email || "").toLowerCase().split("@")[1];
    if (d && doms.has(d)) hits.add(c.id);
  }
  for (const c of (cc || []) as { customer_id: string; email: string }[]) { const d = String(c.email || "").toLowerCase().split("@")[1]; if (d && doms.has(d)) hits.add(c.customer_id); }
  return hits.size === 1 ? [...hits][0] : null;
}

/** keep the storage copies of files already brought in (a task read again lists its files without them) */
const keepPaths = (files: CuFile[], old: CuFile[] | null | undefined) => files.map((f) => ({ ...f, ...(old || []).find((o) => o.id === f.id && o.path) ? { path: (old || []).find((o) => o.id === f.id)!.path } : {} }));

/** read one task in full (and its comments) and save it; returns the row */
export async function readClickUpTask(admin: SupabaseClient, id: string): Promise<ClickUpTaskRow | null> {
  const { data: st } = await admin.from("clickup_state").select("user_email").eq("id", 1).maybeSingle();
  const { data: old } = await admin.from("clickup_tasks").select("team_id, order_id, dismissed_at, attachments, pv_number").eq("id", id).maybeSingle();
  const tok = await tokenFor(admin, String(old?.team_id || ""));
  const t = await cu<CuTask & { team_id?: string }>(tok, `/task/${encodeURIComponent(id)}?include_markdown_description=true`);
  const comments = (await cu<{ comments: CuComment[] }>(tok, `/task/${encodeURIComponent(id)}/comment`).catch(() => ({ comments: [] }))).comments || [];
  const teamId = String(old?.team_id || t.team_id || "");
  const { data: team } = teamId ? await admin.from("clickup_teams").select("hidden").eq("id", teamId).maybeSingle() : { data: null };
  const row = rowOf(t, teamId, comments, String(st?.user_email || ""));
  row.attachments = keepPaths(row.attachments, old?.attachments as CuFile[] | null);
  await admin.from("clickup_tasks").upsert({ ...row, waiting: waitingOf({ ...row, order_id: old?.order_id, dismissed_at: old?.dismissed_at, pv_number: old?.pv_number }, !!team?.hidden) });
  const { data } = await admin.from("clickup_tasks").select("*").eq("id", id).maybeSingle();
  return (data as ClickUpTaskRow | null) || null;
}

/**
 * Copy a task's files into storage (proofs/clickup/<task>/<file id>-<name>) so they open in the portal like an email's
 * attachments (Oct 22, Nick: "the attachments are the most important part… Email attachment, same thing"). Files
 * already copied are kept; stops at `bytes` or the deadline (the rest next time).
 */
async function saveFiles(admin: SupabaseClient, taskId: string, files: CuFile[], tok: string, o: { bytes: number; deadline: number }) {
  let left = o.bytes, changed = false;
  const out: CuFile[] = [];
  for (const f of files) {
    if (f.path || f.size > 40 * 1024 * 1024 || left <= 0 || Date.now() > o.deadline) { out.push(f); continue; }
    const buf = await grab(f.url, tok);
    if (!buf) { out.push(f); continue; }
    const path = `clickup/${taskId}/${f.id}-${safe(f.name)}`;
    const up = await admin.storage.from("proofs").upload(path, buf, { contentType: f.type || MIME[f.ext] || "application/octet-stream", upsert: true });
    if (up.error) { out.push(f); continue; }
    left -= buf.length; changed = true;
    out.push({ ...f, path, size: f.size || buf.length });
  }
  return { files: out, changed, used: o.bytes - left };
}

/** the job panel opened: its files copied into storage now, if the reader hasn't yet */
export async function ensureClickUpFiles(admin: SupabaseClient, id: string): Promise<ClickUpTaskRow | null> {
  const { data: t } = await admin.from("clickup_tasks").select("*").eq("id", id).maybeSingle();
  if (!t) return null;
  const row = t as ClickUpTaskRow;
  if (!row.attachments.some((f) => !f.path)) return row;
  const r = await saveFiles(admin, id, row.attachments, await tokenFor(admin, row.team_id), { bytes: 120 * 1024 * 1024, deadline: Date.now() + 45_000 });
  if (r.changed) await admin.from("clickup_tasks").update({ attachments: r.files }).eq("id", id);
  return { ...row, attachments: r.files };
}

export async function syncClickUp(admin: SupabaseClient, deadline: number): Promise<ClickUpRun> {
  const tokens = clickupTokens();
  if (!tokens.length) return { ok: false, waiting: "Add CLICKUP_API_TOKEN in Vercel (ClickUp → Settings → Apps → API Token)." };
  const { data: st, error: stErr } = await admin.from("clickup_state").select("*").eq("id", 1).maybeSingle();
  if (stErr || !st) return { ok: false, error: "The ClickUp tables aren't in the database yet (migration 185)." };
  const now = Date.now();
  calls.clear();
  const out: ClickUpRun & { newJobs: string[]; problems: string[] } = { ok: true, teams: 0, read: 0, newJobs: [], later: 0, problems: [] };
  const cursors = { ...((st.cursors || {}) as Record<string, number>) };
  let fileBytes = 60 * 1024 * 1024; // files copied into storage this run
  await admin.from("clickup_state").update({ last_run_at: new Date(now).toISOString() }).eq("id", 1);
  try {
    // jobs already on the boards count too unless they're ticked In Printavo (Oct 22, Nick: the ticked ones "are in the
    // works right now… some of them still need to be entered")
    if (!st.setup_at) await admin.from("clickup_state").update({ setup_at: new Date(now).toISOString() }).eq("id", 1);
    // every token's workspaces (a workspace seen by two tokens is read with the first)
    const seen: { team: Team; tok: string; key: string; me: string }[] = [];
    let myEmail = String(st.user_email || "");
    for (const t of tokens) {
      try {
        const me = await cu<{ user: CuUser }>(t.token, "/user");
        const email = String(me.user?.email || "").toLowerCase();
        if (t.key === tokens[0].key) myEmail = email;
        const { teams } = await cu<{ teams: Team[] }>(t.token, "/team");
        for (const team of teams || []) if (!seen.some((x) => x.team.id === team.id)) seen.push({ team, tok: t.token, key: t.key, me: email });
      } catch (e) { out.problems.push(`${t.key}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    if (myEmail && myEmail !== st.user_email) await admin.from("clickup_state").update({ user_email: myEmail }).eq("id", 1);
    out.teams = seen.length;
    const { data: had } = await admin.from("clickup_teams").select("id, customer_id, hidden").in("id", seen.map((x) => x.team.id));
    const teamRow = new Map(((had || []) as { id: string; customer_id: string | null; hidden: boolean }[]).map((r) => [r.id, r]));
    for (const { team, key, me } of seen) {
      const members = (team.members || []).map((m) => String(m.user?.email || "").toLowerCase()).filter((e) => e && !ours(e) && e !== me && e !== myEmail).slice(0, 50);
      if (!teamRow.get(team.id)) {
        const guess = await guessCustomer(admin, team.name, members).catch(() => null);
        await admin.from("clickup_teams").upsert({ id: team.id, name: team.name, members, customer_id: guess, guessed: !!guess, token_key: key, seen_at: new Date().toISOString() });
        teamRow.set(team.id, { id: team.id, customer_id: guess, hidden: false });
      } else await admin.from("clickup_teams").update({ name: team.name, members, token_key: key, seen_at: new Date().toISOString() }).eq("id", team.id);
    }
    // each workspace gets its turn (a big first read of one doesn't hold the others up)
    // each workspace is read side by side (each has its own token and ClickUp limit), so a big first read doesn't hold
    // the others up
    const perTeam = 18;
    await Promise.all(seen.map((ws) => (async ({ team, tok, me }: typeof ws) => {
      if (Date.now() > deadline || used(tok) > 60) { out.later!++; return; }
      const hidden = !!teamRow.get(team.id)?.hidden;
      // once per workspace: the priority of the open jobs read before priorities were kept (a list call or two)
      if (!cursors[`prio:${team.id}`]) {
        for (let page = 0; page < 5; page++) {
          const r = await cu<{ tasks: CuTask[]; last_page?: boolean }>(tok, `/team/${team.id}/task?${new URLSearchParams({ page: String(page), subtasks: "true", include_closed: "false" })}`);
          for (const x of (r.tasks || []).filter((y) => y.priority?.priority)) await admin.from("clickup_tasks").update({ priority: String(x.priority!.priority).toLowerCase() }).eq("id", x.id);
          if (r.last_page === true || (r.tasks || []).length < 100) break;
        }
        cursors[`prio:${team.id}`] = 1;
      }
      const since = cursors[team.id];
      // tasks changed since the last run (the first time: every open task)
      const tasks: CuTask[] = [];
      for (let page = 0; page < 10; page++) {
        const qs = new URLSearchParams({ page: String(page), subtasks: "true", include_closed: since ? "true" : "false", order_by: "updated" });
        if (since) qs.set("date_updated_gt", String(since));
        const r = await cu<{ tasks: CuTask[]; last_page?: boolean }>(tok, `/team/${team.id}/task?${qs}`);
        tasks.push(...(r.tasks || []));
        if (r.last_page === true || (r.tasks || []).length < 100) break;
      }
      tasks.sort((a, b) => ms(a.date_updated) - ms(b.date_updated));
      const known = new Map<string, { id: string; order_id: string | null; dismissed_at: string | null; updated_at_cu: string | null; waiting: boolean; attachments: CuFile[]; pv_number: string | null; priority: string }>();
      for (let i = 0; i < tasks.length; i += 200) {
        const { data } = await admin.from("clickup_tasks").select("id, order_id, dismissed_at, updated_at_cu, waiting, attachments, pv_number, priority").in("id", tasks.slice(i, i + 200).map((t) => t.id));
        for (const r of data || []) known.set(r.id as string, r as never);
      }
      let cur = since || 0, n = 0;
      for (const t0 of tasks) {
        const upd = ms(t0.date_updated);
        if (now - upd < QUIET_MS) { out.later!++; break; } // still being filled in: the next run
        if (Date.now() > deadline || used(tok) > 70 || n >= perTeam) { out.later!++; break; }
        const k = known.get(t0.id);
        if (k?.updated_at_cu && Date.parse(k.updated_at_cu) >= upd) {
          // read before priorities were kept: just the priority, from the list (no extra call)
          const pr = String(t0.priority?.priority || "").toLowerCase();
          if (pr !== (k.priority || "")) await admin.from("clickup_tasks").update({ priority: pr }).eq("id", t0.id);
          cur = Math.max(cur, upd); continue;
        }
        n++;
        // a closed task only needs its status; an open one is read in full (files, fields, comments)
        const full = isDone(t0.status?.type) ? null : await cu<CuTask>(tok, `/task/${t0.id}?include_markdown_description=true`);
        const comments = full ? (await cu<{ comments: CuComment[] }>(tok, `/task/${t0.id}/comment`).catch(() => ({ comments: [] }))).comments || [] : [];
        const row = rowOf(full || t0, team.id, comments, me || myEmail);
        row.attachments = keepPaths(row.attachments, k?.attachments);
        const waiting = waitingOf({ ...row, order_id: k?.order_id, dismissed_at: k?.dismissed_at, pv_number: k?.pv_number }, hidden);
        // a new job's files come into storage now, so they're there when it's opened
        if (waiting && fileBytes > 0 && row.attachments.some((f) => !f.path)) {
          const r = await saveFiles(admin, row.id, row.attachments, tok, { bytes: fileBytes, deadline: deadline - 8000 });
          row.attachments = r.files; fileBytes -= r.used;
        }
        if (full) await admin.from("clickup_tasks").upsert({ ...row, waiting });
        else { const { attachments: _a, comments: _c, ...info } = row; void _a; void _c; await admin.from("clickup_tasks").upsert({ ...info, waiting: false }); }
        if (waiting && !k?.waiting) out.newJobs.push(`${team.name}: ${row.name}`);
        out.read!++;
        cur = Math.max(cur, upd);
      }
      cursors[team.id] = cur || now;
      // the workspace view: completed jobs of the last 3 years read in, 2 pages (200 jobs) a run, job info only (files
      // open from ClickUp when one is opened); open ones are the reader's above
      if (!teamRow.get(team.id)?.hidden && Date.now() < deadline - 10000) {
        const { data: bf } = await admin.from("clickup_teams").select("backfill_page, backfill_done_at").eq("id", team.id).maybeSingle();
        if (bf && !bf.backfill_done_at) {
          let page = Number(bf.backfill_page) || 0, done = false;
          for (let k = 0; k < 2 && Date.now() < deadline - 8000; k++, page++) {
            const qs = new URLSearchParams({ page: String(page), subtasks: "false", include_closed: "true", order_by: "created", date_created_gt: String(Math.round(now - BACKFILL_MS)) });
            const r = await cu<{ tasks: CuTask[]; last_page?: boolean }>(tok, `/team/${team.id}/task?${qs}`);
            const shut = (r.tasks || []).filter((x) => isDone(x.status?.type));
            if (shut.length) {
              const { data: have } = await admin.from("clickup_tasks").select("id").in("id", shut.map((x) => x.id));
              const got = new Set((have || []).map((x) => x.id as string));
              const fresh = shut.filter((x) => !got.has(x.id)).map((x) => { const { attachments: _a, comments: _c, ...info } = rowOf(x, team.id, [], me || myEmail); void _a; void _c; return { ...info, waiting: false }; });
              if (fresh.length) await admin.from("clickup_tasks").upsert(fresh);
              out.backfilled = (out.backfilled || 0) + fresh.length;
            }
            if (r.last_page === true || (r.tasks || []).length < 100) { done = true; page++; break; }
          }
          await admin.from("clickup_teams").update({ backfill_page: page, ...(done ? { backfill_done_at: new Date().toISOString() } : {}) }).eq("id", team.id);
        }
      }
    })(ws).catch((e) => { out.problems.push(`${ws.team.name}: ${e instanceof Error ? e.message : String(e)}`); })));
    const stats = { at: new Date().toISOString(), calls: Object.fromEntries([...calls].map(([t, c]) => [tokens.find((x) => x.token === t)?.key || "?", c])), ...out };
    await admin.from("clickup_state").update({ last_ok_at: new Date().toISOString(), last_error: out.problems.length ? out.problems.join(" · ").slice(0, 500) : null, cursors, stats }).eq("id", 1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.ok = false; out.error = msg;
    await admin.from("clickup_state").update({ last_error: msg, cursors, stats: { at: new Date().toISOString(), ...out } }).eq("id", 1);
  }
  return out;
}

/** a file from ClickUp (the token is only ever sent to ClickUp's own hosts) */
async function grab(url: string, tok: string): Promise<Buffer | null> {
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  const cuHost = /(^|\.)clickup(-attachments)?\.com$/i.test(host);
  const tries: Record<string, string>[] = cuHost && tok ? [{ Authorization: tok }, {}] : [{}];
  for (const h of tries) {
    try {
      const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(30000) });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length) return b; }
    } catch { /* next */ }
  }
  return null;
}
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ai: "application/postscript", eps: "application/postscript", svg: "image/svg+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" };
const when = (s: string) => (s ? new Date(s).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/**
 * Process: the task, read fresh, goes into the portal as an email from the customer (kind "clickup"): the notes,
 * fields and comments as its text and every file in storage, so the Inbox's order maker reads it like any email.
 */
export async function importClickUpTask(admin: SupabaseClient, id: string, by: string): Promise<{ ok: true; activityId: string } | { ok: false; error: string }> {
  if (!clickupTokens().length) return { ok: false, error: "ClickUp isn't connected yet (CLICKUP_API_TOKEN in Vercel)." };
  const { data: old } = await admin.from("clickup_tasks").select("team_id, activity_id").eq("id", id).maybeSingle();
  if (!old) return { ok: false, error: "That ClickUp job isn't on file." };
  const { data: team } = await admin.from("clickup_teams").select("name, customer_id, members").eq("id", old.team_id).maybeSingle();
  if (!team?.customer_id) return { ok: false, error: `Pick which customer the "${team?.name || "ClickUp"}" workspace is first.` };
  let t: ClickUpTaskRow | null;
  try { t = await readClickUpTask(admin, id); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  if (!t) return { ok: false, error: "Couldn't read the job from ClickUp." };
  // the files: the storage copies (made by the reader, or now)
  const { data: act } = t.activity_id ? await admin.from("activities").select("id, meta").eq("id", t.activity_id).maybeSingle() : { data: null };
  if (t.attachments.some((f) => !f.path)) {
    const r = await saveFiles(admin, t.id, t.attachments, await tokenFor(admin, t.team_id), { bytes: 150 * 1024 * 1024, deadline: Date.now() + 60_000 });
    if (r.changed) await admin.from("clickup_tasks").update({ attachments: r.files }).eq("id", t.id);
    t = { ...t, attachments: r.files };
  }
  const atts = t.attachments.filter((f) => f.path).slice(0, 12).map((f) => ({ name: f.name, path: f.path!, type: f.type || MIME[f.ext] || "application/octet-stream", size: f.size, clickup_id: f.id }));
  const missing = t.attachments.filter((f) => !f.path).map((f) => `${f.name} (${f.size > 40 * 1024 * 1024 ? "too big to bring in" : "couldn't be downloaded"}; open it in ClickUp)`);
  const theirComments = t.comments.filter((c) => !ours(c.email) && !(c as { mine?: boolean }).mine);
  const body = [
    `This job came from ${team.name}'s ClickUp board (their job list${t.where_text ? `: ${t.where_text}` : ""}), not an email. The task's name is the job: "${t.name}".`,
    t.due_at ? `Due date on the task: ${day(Date.parse(t.due_at))}.` : "",
    /^(urgent|high)$/.test(t.priority || "") ? `The customer flagged it ${t.priority === "urgent" ? "URGENT" : "high priority"} in ClickUp.` : "",
    `Made by ${t.creator_name || "the customer"}${t.created_at_cu ? ` on ${when(t.created_at_cu)}` : ""}.`,
    t.description ? `Notes on the task:\n${t.description}` : "",
    Object.keys(t.fields).length ? `Fields on the task:\n${Object.entries(t.fields).map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : "",
    theirComments.length ? `Comments on the task:\n${theirComments.map((c) => `- ${c.who} (${when(c.at)}): ${c.text}`).join("\n")}` : "",
    missing.length ? `Files not brought in:\n- ${missing.join("\n- ")}` : "",
    `Open it in ClickUp: ${t.url}`,
  ].filter(Boolean).join("\n\n");
  const fromEmail = t.creator_email && !ours(t.creator_email) ? t.creator_email : String(((team.members || []) as string[])[0] || "");
  const meta = { ...((act?.meta || {}) as Record<string, unknown>), source: "clickup", from_name: t.creator_name || team.name, attachments: atts, att_checked: true, clickup: { id: t.id, url: t.url, team: team.name, where: t.where_text } };
  const row = { customer_id: team.customer_id, kind: "clickup", direction: "in", subject: t.name, body, from_email: fromEmail, to_email: "", external_id: `clickup:${t.id}`, thread_id: `clickup:${t.id}`,
    occurred_at: t.created_at_cu || new Date().toISOString(), meta, created_by: by };
  if (act) {
    const { error } = await admin.from("activities").update(row).eq("id", act.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, activityId: act.id as string };
  }
  const { data: made, error } = await admin.from("activities").insert(row).select("id").single();
  if (error || !made) return { ok: false, error: error?.message || "Couldn't bring the job in." };
  await admin.from("clickup_tasks").update({ activity_id: made.id }).eq("id", t.id);
  return { ok: true, activityId: made.id as string };
}

/** the order is made: note it on the job and tick the task's "In Printavo" box in ClickUp (the only write to ClickUp) */
export async function tickInPrintavo(admin: SupabaseClient, taskId: string, order: { id: string; number: number }) {
  await admin.from("clickup_tasks").update({ order_id: order.id, order_number: order.number, waiting: false }).eq("id", taskId);
  if (!clickupTokens().length) return { ok: false as const, error: "ClickUp isn't connected." };
  try {
    let { data: t } = await admin.from("clickup_tasks").select("printavo_field, team_id").eq("id", taskId).maybeSingle();
    if (!t?.printavo_field) { await readClickUpTask(admin, taskId); ({ data: t } = await admin.from("clickup_tasks").select("printavo_field, team_id").eq("id", taskId).maybeSingle()); }
    if (!t?.printavo_field) throw new Error("This task has no In Printavo box to tick.");
    await cu(await tokenFor(admin, String(t.team_id || "")), `/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(t.printavo_field)}`, { method: "POST", body: { value: true } });
    await admin.from("clickup_tasks").update({ in_printavo: true, ticked_at: new Date().toISOString(), tick_error: null }).eq("id", taskId);
    return { ok: true as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("clickup_tasks").update({ tick_error: msg.slice(0, 300) }).eq("id", taskId);
    return { ok: false as const, error: msg };
  }
}

/**
 * Mark complete / Reopen from the workspace view (Oct 22, Nick: "if we mark something complete, it auto-completes" in
 * ClickUp): the task is set to its board's own closed status (or its first open one), the way ClickUp's Mark Complete
 * does. Writes only the status.
 */
export async function setClickUpDone(admin: SupabaseClient, taskId: string, done: boolean): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  try {
    let { data: t } = await admin.from("clickup_tasks").select("team_id, list_id, order_id, dismissed_at, pv_number, in_printavo, parent, where_text, created_at_cu").eq("id", taskId).maybeSingle();
    if (!t) return { ok: false, error: "That ClickUp job isn't on file." };
    if (!t.list_id) { await readClickUpTask(admin, taskId); ({ data: t } = await admin.from("clickup_tasks").select("team_id, list_id, order_id, dismissed_at, pv_number, in_printavo, parent, where_text, created_at_cu").eq("id", taskId).maybeSingle()); }
    if (!t?.list_id) return { ok: false, error: "Couldn't tell which ClickUp board this job is on." };
    const tok = await tokenFor(admin, String(t.team_id));
    const list = await cu<{ statuses?: { status: string; type: string; color?: string; orderindex?: number }[] }>(tok, `/list/${encodeURIComponent(t.list_id)}`);
    const sts = [...(list.statuses || [])].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));
    const to = done ? sts.find((x) => x.type === "closed") || sts.find((x) => x.type === "done") : sts.find((x) => x.type === "open") || sts[0];
    if (!to) return { ok: false, error: `That ClickUp board has no ${done ? "complete" : "open"} status.` };
    await cu(tok, `/task/${encodeURIComponent(taskId)}`, { method: "PUT", body: { status: to.status } });
    const { data: team } = await admin.from("clickup_teams").select("hidden").eq("id", t.team_id).maybeSingle();
    const row = { status: to.status, status_type: to.type, status_color: to.color || "", updated_at_cu: new Date().toISOString() };
    await admin.from("clickup_tasks").update({ ...row, waiting: done ? false : waitingOf({ ...(t as never as { parent: string | null; in_printavo: boolean }), ...row, order_id: t.order_id, dismissed_at: t.dismissed_at, pv_number: t.pv_number, where_text: t.where_text, created_at_cu: t.created_at_cu }, !!team?.hidden) }).eq("id", taskId);
    return { ok: true, status: to.status };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/**
 * An order made from a ClickUp job was deleted: the job goes back on the New list (Oct 22, Nick: "if there's a ClickUp
 * task and you make it into an order… and you delete it, then it needs to go back into new"; Hudson Band was lost that
 * way). The link to the order is cleared and the job's In Printavo box unticked in ClickUp (making the order ticked it),
 * so the next read of ClickUp doesn't take it off again.
 */
export async function reopenClickUpTask(admin: SupabaseClient, taskId: string): Promise<{ ok: true; note?: string } | { ok: false; error: string }> {
  const { data: t0 } = await admin.from("clickup_tasks").select("id, field_ids, fields").eq("id", taskId).maybeSingle();
  if (!t0) return { ok: false, error: "That ClickUp job isn't on file." };
  await admin.from("clickup_tasks").update({ order_id: null, order_number: null }).eq("id", taskId);
  const names = [...Object.keys((t0.field_ids || {}) as Record<string, string>), ...Object.keys((t0.fields || {}) as Record<string, string>)];
  const box = names.find((k) => /printavo/i.test(k));
  let note = "";
  if (box && clickupTokens().length) {
    const r = await setClickUpBox(admin, taskId, box, false);
    if (r.ok) return { ok: true };
    note = `Its ${box} box couldn't be unticked in ClickUp (${r.error}): untick it there, or ClickUp's next read takes the job off New again.`;
  }
  // no box, or ClickUp couldn't be reached: back on New here
  const { data: t } = await admin.from("clickup_tasks").select("team_id, parent, status_type, order_id, dismissed_at, pv_number, where_text, created_at_cu").eq("id", taskId).maybeSingle();
  const { data: team } = t ? await admin.from("clickup_teams").select("hidden").eq("id", t.team_id).maybeSingle() : { data: null };
  if (t) await admin.from("clickup_tasks").update({ in_printavo: false, waiting: waitingOf({ parent: t.parent as string | null, status_type: String(t.status_type), in_printavo: false, order_id: null, dismissed_at: t.dismissed_at as string | null, pv_number: t.pv_number as string | null, where_text: String(t.where_text || ""), created_at_cu: t.created_at_cu as string | null }, !!team?.hidden) }).eq("id", taskId);
  return { ok: true, ...(note ? { note } : {}) };
}

/**
 * Tick or untick one of a job's ClickUp check boxes from the workspace view (Oct 22, Nick: "can we check like in
 * Printavo here? And it'll check in ClickUp"): In Printavo, PO Ready, High Profile… Writes only that field.
 */
export async function setClickUpBox(admin: SupabaseClient, taskId: string, name: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const cols = "team_id, field_ids, fields, parent, status_type, order_id, dismissed_at, pv_number, where_text, created_at_cu";
    let { data: t } = await admin.from("clickup_tasks").select(cols).eq("id", taskId).maybeSingle();
    if (!t) return { ok: false, error: "That ClickUp job isn't on file." };
    if (!(t.field_ids as Record<string, string> | null)?.[name]) { await readClickUpTask(admin, taskId); ({ data: t } = await admin.from("clickup_tasks").select(cols).eq("id", taskId).maybeSingle()); }
    const fid = (t?.field_ids as Record<string, string> | null)?.[name];
    if (!t || !fid) return { ok: false, error: `This job has no "${name}" box in ClickUp.` };
    await cu(await tokenFor(admin, String(t.team_id)), `/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fid)}`, { method: "POST", body: { value: on } });
    const fields = { ...((t.fields || {}) as Record<string, string>), [name]: on ? "✓" : "—" };
    const isPv = /printavo/i.test(name);
    const { data: team } = await admin.from("clickup_teams").select("hidden").eq("id", t.team_id).maybeSingle();
    const next = { fields, ...(isPv ? { in_printavo: on } : {}) };
    const inPv = isPv ? on : Object.entries(fields).some(([k, v]) => /printavo/i.test(k) && v === "✓");
    await admin.from("clickup_tasks").update({ ...next, waiting: waitingOf({ parent: t.parent as string | null, status_type: String(t.status_type), in_printavo: inPv, order_id: t.order_id as string | null, dismissed_at: t.dismissed_at as string | null, pv_number: t.pv_number as string | null, where_text: String(t.where_text || ""), created_at_cu: t.created_at_cu as string | null }, !!team?.hidden) }).eq("id", taskId);
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/**
 * How big a 3-year backup of the files would be (Oct 22, Nick: "pulling all the info from ClickUp from the last 3 years,
 * what that would take size-wise"): per workspace, a random sample of its jobs of the last 3 years is opened and their
 * file lists read (names and sizes only; nothing is downloaded or changed), then scaled up to all of its jobs.
 */
export async function sizeClickUp(admin: SupabaseClient, perTeam: number, deadline: number) {
  const since = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString();
  const { data: teams } = await admin.from("clickup_teams").select("id, name, hidden").eq("hidden", false);
  const out = await Promise.all(((teams || []) as { id: string; name: string }[]).map(async (t) => {
    const tok = await tokenFor(admin, t.id);
    const { count } = await admin.from("clickup_tasks").select("id", { count: "exact", head: true }).eq("team_id", t.id).is("parent", null).gte("created_at_cu", since);
    const { data: ids } = await admin.from("clickup_tasks").select("id").eq("team_id", t.id).is("parent", null).gte("created_at_cu", since).limit(3000);
    const pool = ((ids || []) as { id: string }[]).map((x) => x.id).sort(() => Math.random() - 0.5).slice(0, perTeam);
    let sampled = 0, files = 0, bytes = 0, biggest = 0, withFiles = 0;
    const types: Record<string, number> = {};
    for (const id of pool) {
      if (Date.now() > deadline) break;
      const d = await cu<CuTask>(tok, `/task/${encodeURIComponent(id)}`).catch(() => null);
      if (!d) continue;
      sampled++;
      const fs = (d.attachments || []).filter((a) => !a.deleted && !a.is_folder);
      if (fs.length) withFiles++;
      for (const a of fs) { const n = Number(a.size) || 0; files++; bytes += n; biggest = Math.max(biggest, n); const e = String(a.extension || "?").toLowerCase(); types[e] = (types[e] || 0) + n; }
    }
    const jobs = count || 0, k = sampled ? jobs / sampled : 0;
    return { workspace: t.name, jobs3y: jobs, sampled, sampleFiles: files, sampleMB: Math.round(bytes / 1e5) / 10, withFilesPct: sampled ? Math.round((withFiles / sampled) * 100) : 0,
      estFiles: Math.round(files * k), estGB: Math.round((bytes * k) / 1e8) / 10, biggestMB: Math.round(biggest / 1e5) / 10,
      byType: Object.fromEntries(Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e, n]) => [e, Math.round(n / 1e5) / 10])) };
  }));
  return { at: new Date().toISOString(), perTeam, workspaces: out, jobs3y: out.reduce((s, x) => s + x.jobs3y, 0), estFiles: out.reduce((s, x) => s + x.estFiles, 0), estGB: Math.round(out.reduce((s, x) => s + x.estGB, 0) * 10) / 10 };
}
