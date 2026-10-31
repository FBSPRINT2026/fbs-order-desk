"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { zkQueueUsers } from "@/lib/zkteco";
import { addDays, dayLabel, fullName, localDay, localToIso, mergeTime, punchLabel, timeLabel, timecard, withLunch, type Employee, type Punch } from "@/lib/timeclock";
import { allRows } from "@/lib/readAll";

/**
 * The time clock's helpers for the people who run it (Nick, and Jose with "Runs the time clock"): tell it what to fix
 * in plain words (Oct 20, Nick: "XYZ didn't clock out for lunch today, please give them a 30 minute lunch… on Monday
 * Joanna worked from 10:32 to 4:35 with a 30 minute lunch… I just wanna be able to talk to it that way"), and send a
 * new employee to the face clock. Claude only proposes: the changes are shown with the hours before and after, and
 * nothing is written until someone clicks Apply. Punches are never deleted (voided), edits keep the original time.
 */
async function manager() {
  const v = await getViewer(", sees_pay, name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  if (!(["owner", "admin"].includes(v.role) || v.staff?.sees_pay)) throw new Error("Only the people who run the time clock can do that.");
  return v;
}

export type TimeOp = {
  action: "add" | "move" | "void" | "unvoid";
  employee_id: string;
  punch_id?: string;
  kind?: Punch["kind"];
  /** the new time (add / move) */
  at?: string;
  /** what it was (move / void), for the preview and Undo */
  was?: { at: string; kind: Punch["kind"] };
  why: string;
};
export type DayPreview = { employee_id: string; name: string; day: string; before: { text: string; minutes: number }; after: { text: string; minutes: number } };

const KINDS = ["in", "out", "break_start", "break_end"] as const;
const t12 = (iso: string) => timeLabel(iso).replace(" ", "").toLowerCase();
const dayLine = (ps: (Punch & { lunch?: boolean })[]) => ps.map((p) => `${punchLabel(p)} ${timeLabel(p.at)}`).join(" · ") || "no punches";

/** a person's punches with some changes made (in memory), for the before / after */
function applyOps(ps: Punch[], ops: TimeOp[]): Punch[] {
  let out = ps.map((p) => ({ ...p }));
  ops.forEach((o, i) => {
    if (o.action === "add" && o.at && o.kind) out.push({ id: `new-${i}`, employee_id: o.employee_id, kind: o.kind, at: o.at, source: "manual" });
    else if (o.action === "move" && o.punch_id) out = out.map((p) => (p.id === o.punch_id ? { ...p, at: o.at || p.at, kind: o.kind || p.kind } : p));
    else if (o.action === "void" && o.punch_id) out = out.map((p) => (p.id === o.punch_id ? { ...p, voided: true } : p));
    else if (o.action === "unvoid" && o.punch_id) out = out.map((p) => (p.id === o.punch_id ? { ...p, voided: false } : p));
  });
  return out;
}

/** before / after for every person-day the changes touch */
function previews(settings: ReturnType<typeof mergeTime>, emps: Map<string, Employee>, punches: Punch[], ops: TimeOp[]): DayPreview[] {
  const keys = new Map<string, { emp: string; day: string }>();
  for (const o of ops) {
    const days = [o.at, o.was?.at].filter(Boolean).map((t) => localDay(t!));
    for (const day of days) keys.set(`${o.employee_id}|${day}`, { emp: o.employee_id, day });
  }
  const out: DayPreview[] = [];
  for (const { emp, day } of keys.values()) {
    const mine = punches.filter((p) => p.employee_id === emp);
    const after = applyOps(mine, ops.filter((o) => o.employee_id === emp));
    const on = (ps: Punch[]) => withLunch(ps.filter((p) => !p.voided && localDay(p.at) === day)).sort((a, b) => a.at.localeCompare(b.at));
    const mins = (ps: Punch[]) => timecard(settings, emp, ps, [], day, day, new Date().toISOString()).days[day]?.worked || 0;
    const e = emps.get(emp);
    out.push({ employee_id: emp, name: e ? fullName(e) : "?", day, before: { text: dayLine(on(mine)), minutes: mins(mine) }, after: { text: dayLine(on(after)), minutes: mins(after) } });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.day.localeCompare(b.day));
}

/**
 * Plain words → proposed punch changes. `said` is what was typed or spoken (English or Spanish).
 * Claude sees everyone's punches for the last five weeks (each with a short reference) and answers with
 * add / move / void steps, or a question when it isn't sure who or when.
 */
export async function timeAsk(said: string): Promise<{ ok: true; understood: string; question: string; ops: TimeOp[]; preview: DayPreview[] } | { ok: false; error: string }> {
  try {
    const v = await manager();
    const text = String(said || "").trim().slice(0, 1500);
    if (!text) return { ok: false, error: "Say what to fix." };
    const admin = createAdminClient();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false, error: st.reason };
    const { data: sd } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const settings = mergeTime((sd?.data as { time?: unknown } | null)?.time);
    const now = new Date(), today = localDay(now), from = addDays(today, -35);
    const [{ data: es }, { data: ps }] = await Promise.all([
      admin.from("employees").select("*").order("last_name"),
      allRows((r0, r1) => admin.from("time_punches").select("id, employee_id, kind, at, source, note, original_at, voided").eq("voided", false).gte("at", localToIso(from, 0)).order("at").order("id").range(r0, r1)),
    ]);
    const punches = (ps || []) as Punch[];
    const withPunches = new Set(punches.map((p) => p.employee_id));
    const emps = ((es || []) as Employee[]).filter((e) => e.active || withPunches.has(e.id));
    const empRef = new Map<string, string>(), refEmp = new Map<string, string>();
    emps.forEach((e, i) => { empRef.set(e.id, `E${i + 1}`); refEmp.set(`E${i + 1}`, e.id); });
    const pRef = new Map<string, Punch>();
    const lines: string[] = [];
    for (const e of emps) {
      const mine = withLunch(punches.filter((p) => p.employee_id === e.id));
      if (!mine.length) continue;
      const byDay = new Map<string, typeof mine>();
      for (const p of mine) { const d = localDay(p.at); (byDay.get(d) || byDay.set(d, []).get(d)!).push(p); }
      for (const [d, dps] of byDay) {
        lines.push(`${empRef.get(e.id)} ${dayLabel(d)} ${d}: ` + dps.map((p) => { const r = `p${pRef.size + 1}`; pRef.set(r, p); return `${r} ${p.lunch ? (p.kind === "break_start" ? "lunch_out(out)" : "lunch_in(in)") : p.kind} ${t12(p.at)}`; }).join(", "));
      }
    }
    const prompt = [
      `Today is ${now.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric", year: "numeric" })} (${today}), ${timeLabel(now)} shop time (America/Chicago).`,
      "",
      "Employees (ref, name, department, active or former):",
      ...emps.map((e) => `${empRef.get(e.id)} ${fullName(e)}${e.department ? ` (${e.department})` : ""}${e.active ? "" : " [former]"}`),
      "",
      `Punches, last 5 weeks (ref, kind, time). A day of exactly in, out, in, out is read as in, lunch out, lunch in, out:`,
      ...lines,
      "",
      `What ${(v.staff?.name as string) || v.email} said: """${text}"""`,
    ].join("\n");
    const r = await askClaude<{ understood: string; question?: string; changes?: { action: string; employee: string; punch?: string; kind?: string; date?: string; time?: string; why?: string }[] }>({
      task: "time_assist", model: st.settings.assistant.ai.model || "claude-sonnet-5", maxTokens: 2000, admin, ctx: { by: v.email },
      system: [
        "You fix employee time cards at FBS Print, a screen printing shop in Texas. A manager tells you, in plain words (English or Spanish), what to change. You answer with the exact punch changes; a person checks them and clicks Apply.",
        "Punch kinds: in (clock in), out (clock out), break_start (lunch/break out), break_end (lunch/break back in). All times are shop time; give time as 24-hour HH:MM and date as YYYY-MM-DD.",
        "Names: match loosely (misspellings like Joanna for Johana, first name only, nicknames, Spanish names without accents). If two employees fit about equally, don't guess: return no changes and ask which one in `question`.",
        "Days: 'Monday' means the most recent Monday on or before today; 'yesterday' and 'today' are relative to the date given.",
        "Change only what was asked. Use the punch refs (p12) to move or void an existing punch; never invent refs.",
        "Lunch: 'give X a 30 minute lunch' (they didn't punch lunch) = add break_start and break_end inside a stretch they were clocked in that day. If no time is given, start at 12:00 when they were on the clock then (and 12:30+ before their clock-out), otherwise the middle of their shift on the half hour. If the day already has a lunch or break, say so and change nothing unless told to.",
        "A whole day ('on Monday Maria worked 10:32 to 4:35 with a 30 minute lunch'): the day must end up as in 10:32, break_start, break_end, out 16:35. Prefer moving the punches that are already there (move the first in, the last out, the lunch pair) over voiding and adding; add what's missing; void extras that day only.",
        "Missed clock-out: add an out at the time given. If no time is given, ask for it (don't guess a clock-out).",
        "If the request isn't about time cards or you can't tell what to do, return no changes and ask a short question.",
        "`understood`: one short sentence in the manager's language saying what you'll do, with the employee's full name, the day and times (e.g. 'Add a 30 minute lunch for Johana Rodriguez today, 12:00–12:30 PM').",
      ].join("\n"),
      prompt,
      tool: {
        name: "time_changes",
        description: "The punch changes to make, or a question.",
        input_schema: {
          type: "object",
          properties: {
            understood: { type: "string" },
            question: { type: "string", description: "Only when you need an answer before changing anything." },
            changes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string", enum: ["add", "move", "void"] },
                  employee: { type: "string", description: "Employee ref, e.g. E7" },
                  punch: { type: "string", description: "Punch ref for move / void, e.g. p12" },
                  kind: { type: "string", enum: [...KINDS], description: "For add (required) and move (only to change the kind)" },
                  date: { type: "string", description: "YYYY-MM-DD, for add and move" },
                  time: { type: "string", description: "HH:MM 24-hour, for add and move" },
                  why: { type: "string", description: "A few words, e.g. 'lunch out'" },
                },
                required: ["action", "employee"],
              },
            },
          },
          required: ["understood"],
        },
      },
    });
    if (!r.ok) return { ok: false, error: r.error };
    const ops: TimeOp[] = [];
    const bad: string[] = [];
    for (const c of r.data.changes || []) {
      const emp = refEmp.get(String(c.employee || "").toUpperCase());
      if (!emp) { bad.push(`unknown employee ${c.employee}`); continue; }
      const at = (() => { const d = String(c.date || ""), t = String(c.time || ""); const m = t.match(/^(\d{1,2}):(\d{2})$/); return /^\d{4}-\d{2}-\d{2}$/.test(d) && m ? localToIso(d, +m[1] * 60 + +m[2]) : undefined; })();
      const kind = (KINDS as readonly string[]).includes(String(c.kind)) ? (c.kind as Punch["kind"]) : undefined;
      if (c.action === "add") {
        if (!at || !kind) { bad.push("an added punch without a time or kind"); continue; }
        if (Date.parse(at) > Date.now() + 5 * 60000) { bad.push(`a punch in the future (${timeLabel(at)})`); continue; }
        ops.push({ action: "add", employee_id: emp, kind, at, why: c.why || "" });
      } else if (c.action === "move" || c.action === "void") {
        const p = pRef.get(String(c.punch || ""));
        if (!p || p.employee_id !== emp) { bad.push(`punch ${c.punch} isn't ${c.employee}'s`); continue; }
        if (c.action === "move") {
          if (!at && !kind) continue;
          if (at && Date.parse(at) > Date.now() + 5 * 60000) { bad.push(`a punch moved into the future (${timeLabel(at)})`); continue; }
          ops.push({ action: "move", employee_id: emp, punch_id: p.id, at: at || p.at, kind: kind || p.kind, was: { at: p.at, kind: p.kind }, why: c.why || "" });
        } else ops.push({ action: "void", employee_id: emp, punch_id: p.id, was: { at: p.at, kind: p.kind }, why: c.why || "" });
      }
    }
    const byId = new Map(emps.map((e) => [e.id, e]));
    const question = [r.data.question || "", bad.length && !ops.length ? `I couldn't work that out (${bad.join("; ")}). Can you say it another way?` : ""].filter(Boolean).join(" ");
    return { ok: true, understood: r.data.understood || "", question, ops, preview: previews(settings, byId, punches, ops) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/**
 * Make the changes (after Apply). Every change is checked again here: the punch must be that person's, times can't be
 * in the future. Added punches are "manual" with what was said in the note; moved ones keep their original time.
 * Returns the steps that put it all back (Undo).
 */
export async function timeApply(ops: TimeOp[], said: string): Promise<{ ok: true; done: number; undo: TimeOp[] } | { ok: false; error: string }> {
  try {
    const v = await manager();
    const admin = createAdminClient();
    const list = (Array.isArray(ops) ? ops : []).slice(0, 40);
    if (!list.length) return { ok: false, error: "Nothing to change." };
    const ids = [...new Set(list.map((o) => o.punch_id).filter(Boolean))] as string[];
    const { data: ps } = ids.length ? await admin.from("time_punches").select("id, employee_id, kind, at, original_at, voided").in("id", ids) : { data: [] };
    const have = new Map(((ps || []) as Punch[]).map((p) => [p.id, p]));
    const { data: es } = await admin.from("employees").select("id").in("id", [...new Set(list.map((o) => o.employee_id))]);
    const empOk = new Set(((es || []) as { id: string }[]).map((e) => e.id));
    const now = new Date().toISOString();
    const note = (said || "").trim() ? `Told the time clock: "${said.trim().slice(0, 180)}"` : "Fixed on the time clock";
    const undo: TimeOp[] = [];
    let done = 0;
    for (const o of list) {
      if (!empOk.has(o.employee_id)) return { ok: false, error: "That employee wasn't found." };
      if (o.at && (isNaN(Date.parse(o.at)) || Date.parse(o.at) > Date.now() + 5 * 60000)) return { ok: false, error: "A punch can't be in the future." };
      if (o.kind && !(KINDS as readonly string[]).includes(o.kind)) return { ok: false, error: "Unknown punch type." };
      if (o.action === "add") {
        if (!o.at || !o.kind) return { ok: false, error: "A new punch needs a time." };
        const { data, error } = await admin.from("time_punches").insert({ employee_id: o.employee_id, kind: o.kind, at: o.at, source: "manual", note, edited_by: v.email, edited_at: now }).select("id").single();
        if (error) return { ok: false, error: error.message };
        undo.push({ action: "void", employee_id: o.employee_id, punch_id: data.id as string, was: { at: o.at, kind: o.kind }, why: "undo" });
      } else {
        const p = o.punch_id ? have.get(o.punch_id) : undefined;
        if (!p || p.employee_id !== o.employee_id) return { ok: false, error: "That punch isn't theirs anymore. Ask again." };
        if (o.action === "move") {
          const at = o.at || p.at, kind = o.kind || p.kind;
          const { error } = await admin.from("time_punches").update({ at, kind, note, original_at: p.original_at || (at !== p.at ? p.at : null), edited_by: v.email, edited_at: now }).eq("id", p.id);
          if (error) return { ok: false, error: error.message };
          undo.push({ action: "move", employee_id: p.employee_id, punch_id: p.id, at: p.at, kind: p.kind, was: { at, kind }, why: "undo" });
        } else {
          const { error } = await admin.from("time_punches").update({ voided: o.action === "void", note: o.action === "void" ? note : `Put back: ${note}`, edited_by: v.email, edited_at: now }).eq("id", p.id);
          if (error) return { ok: false, error: error.message };
          undo.push({ action: o.action === "void" ? "unvoid" : "void", employee_id: p.employee_id, punch_id: p.id, was: { at: p.at, kind: p.kind }, why: "undo" });
        }
      }
      done++;
    }
    return { ok: true, done, undo: undo.reverse() };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** a new (or renamed) employee onto every face clock that's on; their face is still added at the clock */
export async function sendToFaceClock(): Promise<{ ok: boolean; message: string }> {
  try {
    const v = await manager();
    const admin = createAdminClient();
    const { data: devs } = await admin.from("timeclock_devices").select("id, name").eq("kind", "zk").eq("active", true);
    if (!devs?.length) return { ok: false, message: "No face clock is turned on yet (Time Clock → Settings → Face Clock)." };
    let sent = 0, asking = false;
    for (const d of devs as { id: string; name: string }[]) { const r = await zkQueueUsers(admin, d.id, v.email); sent += r.sent; asking ||= r.waiting; }
    return { ok: true, message: sent ? `Sent to the face clock: it picks them up within a minute. Then add their face at the clock (Menu → User Mgt → All Users → their ID → Face).` : asking ? "Checking who's on the face clock; it'll add them on the next try." : "They're already on the face clock." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
