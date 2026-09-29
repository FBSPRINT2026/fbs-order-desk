import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobAction, jobsToday, runningJob, timeSettings, validPin } from "@/lib/timeclockServer";
import { EMP_COOKIE, employeeFor, employeeLogin, lookupJob, myDay, sessionMaxAge } from "@/lib/workServer";
import { sha } from "@/lib/timeclockServer";

export const dynamic = "force-dynamic";

/**
 * The employee app. GET: who's signed in on this phone, the job they're on, and today's job log.
 * (Job time only: the shift clock is separate.) POST actions: login { code, pin } · logout · lang { lang } · lookup { text } ·
 * job_start { job, task } · job_stop { pieces }.
 */
export async function GET() {
  const admin = createAdminClient();
  const me = await employeeFor(admin, (await cookies()).get(EMP_COOKIE)?.value);
  if (!me) return NextResponse.json({ signedIn: false });
  const s = await timeSettings(admin);
  return NextResponse.json({ signedIn: true, name: me.first_name, lang: me.lang || "en", code: me.code, tasks: s.tasks, ...(await jobState(admin, me.id)) });
}

export async function POST(req: Request) {
  const admin = createAdminClient();
  const jar = await cookies();
  const b = await req.json().catch(() => ({}));
  if (b.action === "login") {
    const code = parseInt(String(b.code || ""), 10), pin = String(b.pin || "");
    if (!code || !validPin(pin)) return NextResponse.json({ error: "bad" }, { status: 400 });
    const r = await employeeLogin(admin, code, pin);
    if (!r.token) return NextResponse.json({ error: r.error }, { status: r.error === "locked" ? 429 : 401 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(EMP_COOKIE, r.token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: sessionMaxAge });
    return res;
  }
  const token = jar.get(EMP_COOKIE)?.value;
  const me = await employeeFor(admin, token);
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (b.action === "logout") {
    if (token) await admin.from("employee_sessions").update({ revoked: true }).eq("token_hash", sha(token));
    const res = NextResponse.json({ ok: true }); res.cookies.delete(EMP_COOKIE); return res;
  }
  if (b.action === "lang") { await admin.from("employees").update({ lang: b.lang === "es" ? "es" : "en" }).eq("id", me.id); return NextResponse.json({ ok: true }); }
  if (b.action === "lookup") {
    const job = await lookupJob(admin, String(b.text || ""));
    return job ? NextResponse.json({ job }) : NextResponse.json({ error: "notfound" }, { status: 404 });
  }
  if (b.action === "job_start" || b.action === "job_stop") {
    const r = await jobAction(admin, me.id, b, null, "app");
    // "the whole job is done" marks it done on today's plan
    if (!r.error && b.action === "job_stop" && b.done && typeof b.assignment === "string") await admin.from("job_assignments").update({ done_at: new Date().toISOString() }).eq("id", b.assignment).eq("employee_id", me.id);
    if (r.error) return NextResponse.json({ error: r.error === "You're not on a job." ? "nojob" : r.error }, { status: 409 });
    return NextResponse.json({ ok: true, message: r.message, ...(await jobState(admin, me.id)) });
  }
  return NextResponse.json({ error: "bad" }, { status: 400 });
}

async function jobState(admin: ReturnType<typeof createAdminClient>, employeeId: string) {
  const [job, today, day] = await Promise.all([runningJob(admin, employeeId), jobsToday(admin, employeeId), myDay(admin, employeeId)]);
  return { job, today, ...day };
}
