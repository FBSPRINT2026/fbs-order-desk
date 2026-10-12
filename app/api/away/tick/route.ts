import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { watchInbox } from "@/lib/away";
import { bizBetween, ctToday, watchJobs, type JobAction } from "@/lib/jobWatch";
import { pushTo } from "@/lib/push";
import { organizerFor } from "@/lib/mail/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Away mode + the Job watcher, every 5 minutes (away_tick, migration 133, with the sync token):
 *  1. Away mode: new email in an away person's Inbox is read for "does something have to happen today?" (lib/away).
 *  2. The Job watcher (every 30 minutes): every open job's next steps from its in-hands date (lib/jobWatch) become
 *     to-dos on My Day for the owners, closing themselves when done; steps due today become alerts.
 *  3. Alerts go to the person's phone: email alerts 6 am–10 pm, job alerts weekdays 7 am–7 pm (any day while away);
 *     outside those hours they wait for the morning. Several at once go as one notification.
 */
type Staff = { email: string; name: string | null; role: string | null; away_on: boolean; away_since: string | null; alerts: { jobs?: boolean; push?: boolean } | null };

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (req.headers.get("x-sync-token") !== (ps as { token: string } | null)?.token) {
    const { user, isStaff } = await getViewer();
    if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const deadline = Date.now() + 52000, out: Record<string, unknown> = {};
  const { data: st } = await admin.from("staff").select("email, name, role, away_on, away_since, alerts");
  const staff = ((st || []) as Staff[]).map((s) => ({ ...s, email: s.email.toLowerCase() }));
  const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hour = ct.getHours() + ct.getMinutes() / 60, weekday = ct.getDay() >= 1 && ct.getDay() <= 5;

  // 1. Away mode
  for (const p of staff.filter((x) => x.away_on)) {
    try { out[`away ${p.email}`] = await watchInbox(admin, { email: p.email, name: p.name || "", away_since: p.away_since }, deadline); }
    catch (e) { out[`away ${p.email}`] = e instanceof Error ? e.message : String(e); }
  }

  // 2. the Job watcher: every 30 minutes (and on demand from Settings)
  const who = staff.filter((p) => organizerFor(p.email, String(p.role || "")) && p.alerts?.jobs !== false);
  const { data: last } = await admin.from("app_keys").select("value").eq("name", "jobwatch").maybeSingle();
  const lastAt = Date.parse(String((last?.value as { at?: string } | null)?.at || "")) || 0;
  const force = new URL(req.url).searchParams.get("jobs") === "1";
  if (who.length && (force || Date.now() - lastAt > 29 * 60000) && Date.now() < deadline - 20000) {
    await admin.from("app_keys").upsert({ name: "jobwatch", value: { at: new Date().toISOString() } }, { onConflict: "name" });
    try {
      const o = { deadline: deadline - 12000, cut: false };
      const acts = await watchJobs(admin, o);
      out.jobs = acts.length; if (o.cut) out.jobsCut = true;
      for (const p of who) out[`jobs ${p.email}`] = await syncTasks(admin, p.email, acts, !o.cut);
    } catch (e) { out.jobs = e instanceof Error ? e.message : String(e); }
  }

  // 3. push what's waiting
  for (const p of staff) {
    const jobsOk = (weekday || p.away_on) && hour >= 7 && hour < 19, emailOk = hour >= 6 && hour < 22;
    if (!jobsOk && !emailOk) continue;
    const { data: wait } = await admin.from("alerts").select("id, kind, title, body, url").eq("owner", p.email).is("pushed_at", null).gte("created_at", new Date(Date.now() - 36 * 3600e3).toISOString()).order("created_at").limit(20);
    const ready = ((wait || []) as { id: string; kind: string; title: string; body: string; url: string }[]).filter((a) => (a.kind === "job" ? jobsOk : emailOk));
    if (!ready.length) continue;
    const one = ready.length === 1 ? ready[0] : null;
    const r = await pushTo(admin, p.email, one ? { title: one.title, body: one.body, url: one.url, tag: one.id }
      : { title: `${ready.length} things need you today`, body: ready.map((a) => `• ${a.title}`).join("\n"), url: ready.every((a) => a.kind === "job") ? "/shop" : "/shop/alerts", tag: "today" });
    await admin.from("alerts").update({ pushed_at: new Date().toISOString(), push_result: r.devices ? `${r.sent}/${r.devices}${r.errors.length ? ` ${r.errors[0]}` : ""}` : "no devices" }).in("id", ready.map((a) => a.id));
    out[`pushed ${p.email}`] = `${ready.length} → ${r.sent}/${r.devices}`;
  }
  return NextResponse.json({ ok: true, ...out });
}

/**
 * One person's Job watcher to-dos: new steps added (due the step's date), changed ones updated, finished ones closed.
 * A step the person ticked off isn't added back for 2 business days; after that it comes back as "Still: …".
 * Steps due today also become an alert (once a day).
 */
async function syncTasks(admin: ReturnType<typeof createAdminClient>, owner: string, acts: JobAction[], complete: boolean) {
  const today = ctToday();
  const { data: mine } = await admin.from("tasks").select("id, ref, title, notes, due, status, done_at, done_by").eq("owner", owner).eq("source", "jobs").or(`status.eq.open,status.eq.dismissed,done_at.gte.${new Date(Date.now() - 6 * 864e5).toISOString()}`);
  const rows = (mine || []) as { id: string; ref: string | null; title: string; notes: string; due: string | null; status: string; done_at: string | null; done_by: string | null }[];
  // a job with an owner: only theirs
  acts = acts.filter((a) => !a.owner || a.owner === owner);
  const want = new Map(acts.map((a) => [a.ref, a]));
  // "Not a to-do" on one: never again for that job + step
  const dismissed = new Set(rows.filter((t) => t.status === "dismissed" && t.ref).map((t) => t.ref!));
  let added = 0, closed = 0, alerted = 0;
  // done by itself (the step isn't needed any more)
  const gone = complete ? rows.filter((t) => t.status === "open" && t.ref && !want.has(t.ref)) : [];
  if (gone.length) { await admin.from("tasks").update({ status: "done", done_at: new Date().toISOString(), done_by: "Job watcher: done" }).in("id", gone.map((t) => t.id)); closed = gone.length; }
  for (const a of acts) {
    if (dismissed.has(a.ref)) continue;
    const open = rows.find((t) => t.ref === a.ref && t.status === "open");
    const ticked = rows.filter((t) => t.ref === a.ref && t.status === "done" && t.done_by && !t.done_by.startsWith("Job watcher")).sort((x, y) => String(y.done_at).localeCompare(String(x.done_at)))[0];
    const title = ticked && !open ? `Still: ${a.title.charAt(0).toLowerCase()}${a.title.slice(1)}` : a.title;
    // ticked off in the last 2 business days: left alone (no to-do, no alert)
    if (!open && ticked && bizBetween(String(ticked.done_at).slice(0, 10), today) < 2) continue;
    if (open) {
      if ((open.title !== a.title && !open.title.startsWith("Still:")) || open.notes !== a.notes || open.due !== a.by) await admin.from("tasks").update({ title: open.title.startsWith("Still:") ? open.title : a.title, notes: a.notes, due: a.by, url: a.url }).eq("id", open.id);
    } else {
      const { error } = await admin.from("tasks").insert({ owner, title: title.slice(0, 200), notes: a.notes.slice(0, 1000), area: "shop", due: a.by, source: "jobs", order_id: a.archived ? null : a.orderId, url: a.url, ref: a.ref, created_by: "ai" });
      if (!error) added++;
    }
    if (a.today) {
      const { error } = await admin.from("alerts").insert({ owner, kind: "job", title: a.title.slice(0, 120), body: a.notes.slice(0, 400), url: a.url, dedupe_key: `${a.ref}:${today}:${owner}`, order_id: a.archived ? null : a.orderId });
      if (!error) alerted++;
    }
  }
  return { added, closed, alerted };
}
