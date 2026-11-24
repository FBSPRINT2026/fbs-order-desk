import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decide, type AutoState, type Reading } from "@/lib/draftpunk/autopilot";
import { inkbirdSet, inkbirdStatus, tuyaReady } from "@/lib/draftpunk/tuya";
import { normalize } from "@/lib/draftpunk/defaults";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/config";
import type { Recipe } from "@/lib/draftpunk/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * DraftPunk's fermentation autopilot, every 15 minutes (Vercel Cron, vercel.json; CRON_SECRET like the others):
 * 1. reads every chamber's Inkbird through the Tuya cloud (when TUYA_* is set) into dp_readings;
 * 2. for each brew with autopilot on, moves it to its next fermentation step when the step's trigger is met and sets
 *    that chamber's Inkbird to the new step's temperature (only on a step change, so a brewer's own change by hand isn't
 *    fought: a mismatch is an alarm instead);
 * 3. emails the brewer each alarm, at most once every 6 hours per kind.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const out: string[] = [];

  // 1. chamber logging
  const { data: chambers } = await admin.from("dp_chambers").select("id, owner_id, name, device_id");
  const live = new Map<string, { tempF?: number; setF?: number }>();
  if (tuyaReady()) for (const ch of chambers || []) {
    if (!ch.device_id) continue;
    try {
      const s = await inkbirdStatus(ch.device_id as string);
      live.set(ch.id as string, s);
      if (s.tempF != null) await admin.from("dp_readings").insert({ owner_id: ch.owner_id, chamber_id: ch.id, source: "inkbird", color: ch.name, temp_f: Math.round(s.tempF * 10) / 10, set_f: s.setF != null ? Math.round(s.setF * 10) / 10 : null });
    } catch (e) { out.push(`${ch.name}: ${(e as Error).message}`); }
  }

  // 2 and 3. autopilot
  const { data: brews } = await admin.from("dp_brews").select("id, owner_id, recipe_snapshot, measured").eq("measured->autopilot->>on", "true");
  for (const b of brews || []) {
    const m = (b.measured || {}) as { og?: number; chamberId?: string; tiltColor?: string; autopilot: AutoState; alarmsOff?: string[]; beerTolF?: number };
    const r = normalize(b.recipe_snapshot as Recipe);
    const since = new Date(Date.now() - 8 * 86400000).toISOString();
    const [{ data: tilt }, { data: cham }] = await Promise.all([
      admin.from("dp_readings").select("sg, temp_f, source, read_at").eq("brew_id", b.id).eq("source", "tilt").gte("read_at", since).order("read_at").limit(5000),
      m.chamberId ? admin.from("dp_readings").select("sg, temp_f, set_f, source, read_at").eq("chamber_id", m.chamberId).gte("read_at", new Date(Date.now() - 6 * 3600000).toISOString()).order("read_at") : Promise.resolve({ data: [] }),
    ]);
    const st: AutoState = { ...m.autopilot, events: m.autopilot.events || [], lastAlert: m.autopilot.lastAlert || {} };
    const d = decide(r, st, (tilt || []) as Reading[], (cham || []) as Reading[], { og: m.og, beerTolF: m.beerTolF });
    const ch = (chambers || []).find((c) => c.id === m.chamberId);
    if (d.advanced) {
      st.stage = d.stage; st.stageStart = now;
      st.events = [{ at: now, text: d.advanced }, ...st.events].slice(0, 100);
      if (ch?.device_id && tuyaReady() && d.targetF != null) {
        try { await inkbirdSet(ch.device_id as string, d.targetF); st.events.unshift({ at: now, text: `Set ${ch.name} to ${d.targetF}°F` }); }
        catch (e) { st.events.unshift({ at: now, text: `Couldn't set ${ch.name}: ${(e as Error).message}` }); d.alarms.push({ key: "set-failed", text: `Couldn't set ${ch.name} to ${d.targetF}°F. Set it by hand.` }); }
      } else if (d.targetF != null) d.alarms.push({ key: `step-${d.stage}`, text: `${d.advanced}. Set the chamber to ${d.targetF}°F now.` });
    }
    // a chamber set by hand to something other than the step's temperature
    const cs = ch ? live.get(ch.id as string) : undefined;
    if (cs?.setF != null && d.targetF != null && Math.abs(cs.setF - d.targetF) > 1 && !d.advanced) d.alarms.push({ key: "set-mismatch", text: `${ch!.name} is set to ${cs.setF}°F; ${d.step?.name} wants ${d.targetF}°F.` });
    // alarms: email the brewer, once per 6 hours per kind
    const fresh = d.alarms.filter((a) => !(m.alarmsOff || []).includes(a.key) && (!st.lastAlert?.[a.key] || Date.now() - new Date(st.lastAlert[a.key]).getTime() > 6 * 3600000));
    if (fresh.length) {
      const { data: u } = await admin.auth.admin.getUserById(b.owner_id as string);
      const to = u?.user?.email;
      const link = `${SITE_URL}/draftpunk/brews/${b.id}`;
      if (to) await sendEmail({ to, subject: `DraftPunk: ${r.name}: ${fresh[0].text.slice(0, 60)}`, html: `<p><b>${esc(r.name)}</b></p><ul>${fresh.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ul><p><a href="${link}">Open the brew log</a></p>` });
      for (const a of fresh) { st.lastAlert = { ...(st.lastAlert || {}), [a.key]: now }; st.events = [{ at: now, text: `Alarm: ${a.text}` }, ...st.events].slice(0, 100); }
    }
    await admin.from("dp_brews").update({ measured: { ...m, autopilot: st, alarms: d.alarms, lastCheck: now } }).eq("id", b.id);
    out.push(`${r.name}: step ${d.stage + 1}${d.advanced ? " (moved on)" : ""}, ${d.alarms.length} alarms`);
  }
  return NextResponse.json({ ok: true, ran: out });
}
