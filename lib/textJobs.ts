import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which job each customer text is about (Oct 15, Nick: "invoice 27166… emails and texts that correspond to this
 * order"). Texts come in conversations, so they're filed a stretch at a time (a "session": texts less than 6 hours
 * apart). A session goes to:
 *  1. the job it names, even misspelled ("Matellica" = MATTEL-ICA: letters only, doubled letters as one);
 *  2. else the only job open at the time (from 2 days before it was ordered to 6 days after it was due);
 *  3. else, when several jobs were open, the AI picks from those (or none).
 * Staff can say "Not this job" (job_not); it isn't filed there again.
 */

export type Job = { ref: string; number: string; name: string; start: number; end: number; due: string };
const DAY = 864e5;
/** letters and digits only, a doubled letter as one: "MATTEL-ICA" and "Matellica" both → "matelica" */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(.)\1+/g, "$1");
const GENERIC = new Set(["shirt", "shirts", "tee", "tees", "hoodie", "hoodies", "tote", "totes", "onesie", "onesies", "reprint", "reprints", "order", "new", "art", "tag", "apparel", "no", "the", "and", "with"]);
/** the words of a job's name worth looking for in a text (4+ letters, not "shirts"), squashed; plus the whole name */
export function jobKeys(name: string): string[] {
  const words = name.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w)).map(squash);
  const whole = squash(name.replace(/\(.*?\)/g, " ").replace(/\b(no apparel tag|new tag art|shirts?|tees?|hoodies?|totes?|onesies?|reprints?)\b/gi, " "));
  return [...new Set([...(whole.length >= 5 ? [whole] : []), ...words.filter((w) => w.length >= 4)])];
}

export async function customerJobs(admin: SupabaseClient, customerId: string): Promise<Job[]> {
  const [{ data: pv }, { data: os }] = await Promise.all([
    admin.from("archived_orders").select("id, visual_id, nickname, order_date, due_date, kind").eq("customer_id", customerId).limit(3000),
    admin.from("orders").select("id, number, nickname, created_at, due_date, status").eq("customer_id", customerId).limit(2000),
  ]);
  const t = (d: string | null | undefined) => (d ? Date.parse(d.length === 10 ? d + "T12:00:00Z" : d) : NaN);
  const out: Job[] = [];
  for (const r of (pv || []) as { id: string; visual_id: string; nickname: string | null; order_date: string | null; due_date: string | null; kind: string }[]) {
    const s = t(r.order_date); if (!Number.isFinite(s)) continue;
    const e = Number.isFinite(t(r.due_date)) ? t(r.due_date) : s + 30 * DAY;
    out.push({ ref: `pv:${r.id}`, number: String(r.visual_id), name: (r.nickname || "").trim(), start: s - 2 * DAY, end: Math.max(e, s) + 6 * DAY, due: r.due_date || "" });
  }
  for (const o of (os || []) as { id: string; number: number; nickname: string | null; created_at: string; due_date: string | null; status: string }[]) {
    if (/cancel/i.test(o.status)) continue;
    const s = t(o.created_at), e = Number.isFinite(t(o.due_date)) ? t(o.due_date) : s + 30 * DAY;
    out.push({ ref: `o:${o.id}`, number: String(o.number), name: (o.nickname || "").trim(), start: s - 2 * DAY, end: Math.max(e, s) + 6 * DAY, due: o.due_date || "" });
  }
  return out;
}

type T = { id: string; body: string; sent_at: string; from_me: boolean; job_ref: string | null; job_not: string[] | null; files: unknown[] };

/** file a customer's texts not filed yet; `ai` lets the AI pick when several jobs were open */
export async function fileCustomerTexts(admin: SupabaseClient, customerId: string, ai?: (session: T[], jobs: Job[], around: string) => Promise<string | null>) {
  const { data } = await admin.from("text_messages").select("id, body, sent_at, from_me, job_ref, job_not, files").eq("customer_id", customerId).is("job_ref", null).is("job_checked_at", null).order("sent_at").limit(3000);
  const texts = (data || []) as T[];
  if (!texts.length) return 0;
  const jobs = await customerJobs(admin, customerId);
  const keyed = jobs.map((j) => ({ j, keys: [...jobKeys(j.name), j.number] }));
  // sessions: texts less than 6 hours apart
  const sessions: T[][] = [];
  for (const x of texts) { const s = sessions[sessions.length - 1]; if (s && Date.parse(x.sent_at) - Date.parse(s[s.length - 1].sent_at) < 6 * 3600e3) s.push(x); else sessions.push([x]); }
  let filed = 0;
  const now = new Date().toISOString();
  for (const s of sessions) {
    const at = Date.parse(s[0].sent_at), not = new Set(s.flatMap((x) => x.job_not || []));
    const said = squash(s.map((x) => x.body).join(" "));
    const named = keyed.filter(({ j, keys }) => !not.has(j.ref) && keys.some((k) => k.length >= 4 && said.includes(k)));
    const open = jobs.filter((j) => !not.has(j.ref) && at >= j.start && at <= j.end);
    let ref: string | null = null, how = "";
    // a job named and open then wins; else the one named (none open) or the one open (none named); else the AI
    const namedOpen = named.filter(({ j }) => open.some((o) => o.ref === j.ref)).map((n) => n.j);
    const pool = namedOpen.length > 1 ? namedOpen : [...new Map([...open, ...named.map((n) => n.j)].map((j) => [j.ref, j])).values()];
    if (namedOpen.length === 1) { ref = namedOpen[0].ref; how = "named, and open then"; }
    else if (named.length === 1 && !open.length) { ref = named[0].j.ref; how = "named"; }
    else if (open.length === 1 && !named.length) { ref = open[0].ref; how = "the only job open then"; }
    else if (pool.length > 1) {
      if (!ai) continue; // left for the AI (when a job's texts are opened)
      // the texts a few days either side, for context ("can I pick up Matellica?" a week later)
      const k = sessions.indexOf(s), near = [sessions[k - 1], sessions[k + 1]].filter((x) => x && Math.abs(Date.parse(x[0].sent_at) - at) < 8 * DAY);
      const around = near.map((x) => `${x![0].sent_at.slice(0, 10)}: ${x!.map((y) => `${y.from_me ? "Shop" : "Customer"}: ${y.body || "(a picture)"}`).join(" / ")}`).join("\n").slice(0, 2000);
      ref = await ai(s, pool, around).catch(() => null);
      if (ref && !pool.some((p) => p.ref === ref)) ref = null;
      how = ref ? "the AI, from the jobs open then" : "";
    }
    const ids = s.map((x) => x.id);
    await admin.from("text_messages").update(ref ? { job_ref: ref, job_how: how, job_checked_at: now } : { job_checked_at: now }).in("id", ids);
    if (ref) filed += ids.length;
  }
  return filed;
}
