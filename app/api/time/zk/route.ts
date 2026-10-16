import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAtt, zkProcess, zkQueueUsers } from "@/lib/zkteco";

export const dynamic = "force-dynamic";

async function boss() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const { data } = await v.supabase.from("staff").select("role").eq("email", v.email).maybeSingle();
  return ["owner", "admin"].includes((data?.role as string) || "") ? v : null;
}

/** The ZKTeco clocks: when each last checked in, who's enrolled on it, its latest scans and anything not matched. */
export async function GET() {
  const v = await boss();
  if (!v) return NextResponse.json({ error: "Owners and admins only." }, { status: 403 });
  const admin = createAdminClient();
  const { data: devs } = await admin.from("timeclock_devices").select("id, name, active, serial, info, last_seen_at, created_at").eq("kind", "zk").order("created_at");
  const out = [];
  for (const d of (devs || []) as { id: string; name: string; active: boolean; serial: string; info: Record<string, unknown>; last_seen_at: string | null; created_at: string }[]) {
    const { data: raw } = await admin.from("timeclock_raw").select("line, received_at, done, note").eq("device_id", d.id).eq("kind", "att").order("id", { ascending: false }).limit(15);
    const { count: waiting } = await admin.from("timeclock_raw").select("id", { count: "exact", head: true }).eq("device_id", d.id).eq("kind", "att").eq("done", false);
    const { count: cmdsOpen } = await admin.from("timeclock_cmds").select("id", { count: "exact", head: true }).eq("device_id", d.id).is("done_at", null);
    out.push({ id: d.id, name: d.name, active: d.active, serial: d.serial, last_seen_at: d.last_seen_at, created_at: d.created_at,
      users: (d.info?.users as Record<string, string>) || {}, usersAt: (d.info?.usersAt as string) || "", about: (d.info?.about as string) || "",
      waiting: waiting || 0, cmdsOpen: cmdsOpen || 0,
      scans: ((raw || []) as { line: string; received_at: string; done: boolean; note: string }[]).map((r) => { const p = parseAtt(r.line); return { pin: p?.pin || "", wall: p?.wall || r.line.slice(0, 40), done: r.done, note: r.note }; }) });
  }
  const { data: emps } = await admin.from("employees").select("first_name, last_name, code").eq("active", true).not("code", "is", null).order("code");
  return NextResponse.json({ clocks: out, employees: emps || [] });
}

/** Turn a clock on or off, send it our employee list, or bring over scans waiting on an employee ID. */
export async function POST(req: Request) {
  const v = await boss();
  if (!v) return NextResponse.json({ error: "Owners and admins only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || "");
  const admin = createAdminClient();
  const { data: d } = await admin.from("timeclock_devices").select("id, kind, active").eq("id", id).maybeSingle();
  if (!d || d.kind !== "zk") return NextResponse.json({ error: "That clock wasn't found." }, { status: 404 });
  if (b.action === "on" || b.action === "off") {
    await admin.from("timeclock_devices").update({ active: b.action === "on" }).eq("id", id);
    if (b.action === "on") {
      const r = await zkProcess(admin, id);
      return NextResponse.json({ ok: true, message: `Clock turned on.${r.added ? ` ${r.added} scan${r.added === 1 ? "" : "s"} brought over.` : ""}${r.waiting ? ` ${r.waiting} waiting on an employee ID.` : ""}` });
    }
    return NextResponse.json({ ok: true, message: "Clock turned off. Its scans are kept but don't count until it's back on." });
  }
  if (b.action === "rename") { await admin.from("timeclock_devices").update({ name: String(b.name || "").slice(0, 60) || "ZKTeco clock" }).eq("id", id); return NextResponse.json({ ok: true }); }
  if (b.action === "users") {
    if (!d.active) return NextResponse.json({ error: "Turn the clock on first." }, { status: 400 });
    const r = await zkQueueUsers(admin, id, v.email || "");
    if (r.waiting) return NextResponse.json({ ok: true, message: "Asking the clock who's already on it (so your admin account is left alone). Press Send Employee List again in a minute." });
    return NextResponse.json({ ok: true, message: r.sent ? `Sending ${r.sent} employees to the clock. It picks them up within a minute; then add each face at the clock.` : "Everyone is already on the clock." });
  }
  if (b.action === "process") {
    const r = await zkProcess(admin, id);
    return NextResponse.json({ ok: true, message: `${r.added} brought over.${r.waiting ? ` ${r.waiting} still waiting on an employee ID.` : ""}` });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
