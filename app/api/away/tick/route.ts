import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { watchInbox } from "@/lib/away";
import { ctToday, watchJobs, type AtRisk } from "@/lib/jobWatch";
import { watchEmailOrders } from "@/lib/emailDeadlines";
import { pushTo } from "@/lib/push";
import { organizerFor } from "@/lib/mail/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Away mode + the Job watcher, every 5 minutes (away_tick, migration 133, with the sync token):
 *  1. Away mode: new email in an away person's Inbox is read for "does something have to happen today?" (lib/away).
 *  2. Needs you today (every 30 minutes): job steps due today or late (lib/jobWatch) and orders still in email whose
 *     goods have to be ordered today (lib/emailDeadlines), for the dashboard and as alerts. No to-dos.
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

  // 2. "Needs you today": every 30 minutes (and on demand), what has to happen today or is late on the jobs
  //    (lib/jobWatch) and on orders still in email (lib/emailDeadlines). No to-dos (Oct 12, Nick: jobs flow on their
  //    own); kept as one list for the dashboard, and each new one is an alert for its owner (none: the owners).
  const who = staff.filter((p) => organizerFor(p.email, String(p.role || "")) && p.alerts?.jobs !== false);
  const { data: last } = await admin.from("app_keys").select("value").eq("name", "jobwatch").maybeSingle();
  const prev = (last?.value || {}) as { at?: string; items?: AtRisk[] };
  const lastAt = Date.parse(String(prev.at || "")) || 0;
  const force = new URL(req.url).searchParams.get("jobs") === "1";
  if (who.length && (force || Date.now() - lastAt > 29 * 60000) && Date.now() < deadline - 20000) {
    await admin.from("app_keys").upsert({ name: "jobwatch", value: { ...prev, at: new Date().toISOString() } }, { onConflict: "name" });
    try {
      const o = { deadline: deadline - 14000, cut: false };
      const acts = [...await watchJobs(admin, o), ...await watchEmailOrders(admin, o)];
      const today = ctToday();
      const items: AtRisk[] = acts.map((a) => ({ key: a.ref, title: a.title, notes: a.notes, url: a.url, by: a.by, owner: a.owner || null, step: a.step }));
      // a cut-short run keeps what it didn't get to from last time
      const keep = o.cut ? (prev.items || []).filter((x) => !items.some((y) => y.key === x.key)) : [];
      await admin.from("app_keys").upsert({ name: "jobwatch", value: { at: new Date().toISOString(), today, items: [...items, ...keep] } }, { onConflict: "name" });
      out.jobs = items.length; if (o.cut) out.jobsCut = true;
      let alerted = 0;
      for (const a of acts) for (const p of who.filter((x) => !a.owner || a.owner === x.email)) {
        const { error } = await admin.from("alerts").insert({ owner: p.email, kind: "job", title: a.title.slice(0, 120), body: a.notes.slice(0, 400), url: a.url, dedupe_key: `${a.ref}:${today}:${p.email}`, order_id: a.archived ? null : a.orderId });
        if (!error) alerted++;
      }
      out.alerted = alerted;
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
