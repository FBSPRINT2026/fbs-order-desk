import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPin, newDeviceToken, sha } from "@/lib/timeclockServer";
import { localDay, localToIso, type OpenJob } from "@/lib/timeclock";

/** The employee app (/work): employee number + PIN on their own phone, signed in for 120 days. */
export const EMP_COOKIE = "fbs_emp";
const DAYS = 120;

export async function employeeLogin(admin: SupabaseClient, code: number, pin: string): Promise<{ token?: string; error?: string }> {
  const { data: e } = await admin.from("employees").select("id, active").eq("code", code).maybeSingle();
  if (!e || !e.active) return { error: "bad" };
  const { data: p } = await admin.from("employee_pins").select("pin_hash, fails, locked_until").eq("employee_id", e.id).maybeSingle();
  if (!p) return { error: "nopin" };
  if (p.locked_until && Date.parse(p.locked_until as string) > Date.now()) return { error: "locked" };
  if (!checkPin(pin, p.pin_hash as string)) {
    const fails = ((p.fails as number) || 0) + 1;
    await admin.from("employee_pins").update({ fails: fails >= 5 ? 0 : fails, locked_until: fails >= 5 ? new Date(Date.now() + 5 * 60000).toISOString() : null }).eq("employee_id", e.id);
    return { error: fails >= 5 ? "locked" : "bad" };
  }
  await admin.from("employee_pins").update({ fails: 0, locked_until: null }).eq("employee_id", e.id);
  const token = newDeviceToken();
  await admin.from("employee_sessions").insert({ employee_id: e.id, token_hash: sha(token), expires_at: new Date(Date.now() + DAYS * 86400000).toISOString() });
  return { token };
}
export const sessionMaxAge = DAYS * 86400;

export async function employeeFor(admin: SupabaseClient, token: string | undefined) {
  if (!token) return null;
  const { data: s } = await admin.from("employee_sessions").select("id, employee_id, expires_at, revoked").eq("token_hash", sha(token)).maybeSingle();
  if (!s || s.revoked || Date.parse(s.expires_at as string) < Date.now()) return null;
  const { data: e } = await admin.from("employees").select("id, first_name, last_name, active, lang, code").eq("id", s.employee_id).maybeSingle();
  if (!e || !e.active) return null;
  await admin.from("employee_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
  return { sessionId: s.id as string, ...(e as { id: string; first_name: string; last_name: string; lang: string; code: number }) };
}

export type WorkJob = OpenJob & { spots: string[] };
/** A scanned or typed job ticket ("1004", "#1004", or a box label "1004-2") → the order, and what can be worked on it. */
export async function lookupJob(admin: SupabaseClient, text: string, by?: { kind: "o" | "a"; id: string }): Promise<WorkJob | null> {
  const m = by ? null : text.trim().match(/#?(\d{3,7})/);
  if (!by && !m) return null;
  const n = m ? m[1] : "";
  const { data: o } = by?.kind === "a" ? { data: null } : by ? await admin.from("orders").select("id, number, nickname, due_date, qty, status, customer_id, groups").eq("id", by.id).maybeSingle() : await admin.from("orders").select("id, number, nickname, due_date, qty, status, customer_id, groups").eq("number", +n).maybeSingle();
  if (o) {
    const spots: string[] = [];
    for (const g of ((o.groups || []) as { imprints?: { location?: string; method?: string }[] }[])) for (const i of g.imprints || []) {
      const s = [i.location, i.method === "embroidery" ? "(Embroidery)" : i.method === "dtf" ? "(DTF)" : i.method === "dtg" ? "(DTG)" : ""].filter(Boolean).join(" ");
      if (s && !spots.includes(s)) spots.push(s);
    }
    const { data: c } = o.customer_id ? await admin.from("customers").select("company, name").eq("id", o.customer_id).maybeSingle() : { data: null };
    return { kind: "o", id: o.id, number: String(o.number), name: o.nickname || "", customer: c?.company || c?.name || "", due: o.due_date, qty: o.qty || 0, status: o.status, spots };
  }
  if (by?.kind === "o") return null;
  const q = admin.from("archived_orders").select("id, visual_id, nickname, due_date, qty, status_name, customer_id");
  const { data: a } = by ? await q.eq("id", by.id).maybeSingle() : await q.eq("visual_id", n).maybeSingle();
  if (a) {
    const { data: c } = a.customer_id ? await admin.from("customers").select("company, name").eq("id", a.customer_id).maybeSingle() : { data: null };
    return { kind: "a", id: a.id, number: a.visual_id, name: a.nickname || "", customer: c?.company || c?.name || "", due: a.due_date, qty: a.qty || 0, status: a.status_name, spots: ["Full Front", "Full Back", "Left Chest", "Sleeve"] };
  }
  return null;
}

/** Someone's plan for today: their shift and the jobs assigned to them, in order, with the time logged on each so far. */
export async function myDay(admin: SupabaseClient, employeeId: string) {
  const today = localDay(new Date());
  const [{ data: sh }, { data: as }] = await Promise.all([
    admin.from("shifts").select("starts_at, ends_at, station").eq("employee_id", employeeId).gte("starts_at", localToIso(today, 0)).lt("starts_at", localToIso(today, 1439)).order("starts_at").limit(1),
    admin.from("job_assignments").select("id, order_id, archived_order_id, job_label, position, note, station, done_at").eq("employee_id", employeeId).eq("day", today).order("position"),
  ]);
  const plan = [];
  for (const a of (as || []) as { id: string; order_id: string | null; archived_order_id: string | null; job_label: string; note: string; station: string; done_at: string | null }[]) {
    const job = await lookupJob(admin, "", { kind: a.order_id ? "o" : "a", id: (a.order_id || a.archived_order_id)! });
    if (job) plan.push({ assignment: a.id, note: a.note, station: a.station, done: !!a.done_at, ...job });
  }
  return { shift: (sh || [])[0] || null, plan };
}
