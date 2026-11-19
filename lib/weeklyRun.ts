import type { SupabaseClient } from "@supabase/supabase-js";
import { estimate, mergeProduction, needsForOrder } from "@/lib/production";
import { trainingSaid, trainingWords, type TrainingDefaults } from "@/lib/orderTrainings";
import type { Group, Order } from "@/lib/pricing";

/**
 * A customer's weekly run keeps itself on the schedule (Nick, Nov 19 2026, All My Sons: "we should have a weekly run for
 * Kelsey's crew on Tuesday… any All My Sons job that gets counted after we start the weekly run… should just
 * automatically go into the pool on the next Tuesday… I just want it to automatically flow through the schedule. We
 * shouldn't have to touch it from a production standpoint").
 *
 * An order training with a weekly run and a press (Settings → Order training → Order defaults: Weekly run, Runs on, On
 * press) owns its orders' print runs: every approved order it names is booked on that press, on the first run day on or
 * after its production date (runDates) and never before today. So:
 *  - a new order goes straight into its week's run, never Ready to schedule;
 *  - one left over after its run day (not printed, goods not counted) moves to the next run by itself;
 *  - one counted after the run started waits for next week's run;
 *  - a run too long for the day carries over on the same press (the booking is locked to the press).
 * A booking that has started, been printed or been split by hand is left alone; a second booking of the same whole job is
 * the same job twice and goes. Run by the hourly goods pass and whenever the schedule opens.
 */
type Train = { id: string; customer_id: string; name: string; when_words: string | null; defaults: TrainingDefaults | null };
type SlotRow = { id: string; machine: string; day: string; status: string; started_at: string | null; locations: string[] | null; issue_id: string | null; locked: string | null; position: number | null };

const shopToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDay = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
/** the first `day` (0 = Sunday) on or after `from` */
export const runDayFrom = (from: string, day: number) => { let d = from; for (let i = 0; i < 7 && weekday(d) !== day; i++) d = addDay(d, 1); return d; };

export async function keepWeeklyRuns(admin: SupabaseClient): Promise<{ booked: number; moved: number; removed: number; errors: string[] }> {
  const out = { booked: 0, moved: 0, removed: 0, errors: [] as string[] };
  const { data: tr } = await admin.from("order_trainings").select("id, customer_id, name, when_words, defaults");
  const runs = ((tr || []) as Train[]).filter((t) => t.defaults?.run?.press);
  if (!runs.length) return out;
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeProduction((st?.data as { production?: unknown } | null)?.production);
  const typeOf = (id: string) => s.machines.find((m) => m.id === id)?.type || "";
  const today = shopToday();
  for (const t of runs) {
    const run = t.defaults!.run!, m = s.machines.find((x) => x.id === run.press);
    if (!m) { out.errors.push(`${t.name}: its press isn't on the schedule any more`); continue; }
    const { data: os } = await admin.from("orders").select("id, number, nickname, po_number, status, production_date, groups, lines")
      .eq("customer_id", t.customer_id).eq("type", "invoice").in("status", ["approved", "production"]).is("discarded_at", null).is("declined_at", null).order("number");
    const mine = ((os || []) as (Pick<Order, "groups" | "lines" | "number" | "nickname"> & { id: string; po_number: string | null; production_date: string | null })[])
      .filter((o) => !trainingWords(t.when_words || "").length || trainingSaid({ when_words: t.when_words || "" }, `${o.nickname || ""} ${o.po_number || ""}`));
    let pos = 0;
    for (const o of mine) {
      const need = needsForOrder(s, o, ((o.groups || []) as (Group & { sample?: unknown })[]).filter((g) => !g.sample)).find((n) => n.type === m.type);
      if (!need) continue;
      const day = runDayFrom(o.production_date && o.production_date > today ? o.production_date : today, run.day);
      const { data: sl } = await admin.from("production_slots").select("id, machine, day, status, started_at, locations, issue_id, locked, position").eq("order_id", o.id);
      const ours = ((sl || []) as SlotRow[]).filter((x) => typeOf(x.machine) === m.type && !x.issue_id);
      // started, printed or split by hand: the floor has it
      if (ours.some((x) => x.status !== "scheduled" || x.started_at || (x.locations || []).length)) continue;
      pos++;
      const [keep, ...extra] = ours.sort((a, b) => a.day.localeCompare(b.day));
      if (extra.length) { const r = await admin.from("production_slots").delete().in("id", extra.map((x) => x.id)); if (r.error) out.errors.push(r.error.message); else out.removed += extra.length; }
      if (!keep) {
        const r = await admin.from("production_slots").insert({ order_id: o.id, machine: m.id, day, minutes: estimate(s, need, m).minutes, start_min: null, position: 100 + pos, kind: need.type, label: need.label, source: "weekly_run", locked: "press" });
        if (r.error) out.errors.push(`#${o.number}: ${r.error.message}`); else out.booked++;
      } else if (keep.machine !== m.id || keep.day !== day || keep.locked !== "press") {
        const r = await admin.from("production_slots").update({ machine: m.id, day, start_min: null, locked: "press", ...(keep.day !== day || keep.machine !== m.id ? { position: 100 + pos } : {}), updated_at: new Date().toISOString() }).eq("id", keep.id);
        if (r.error) out.errors.push(`#${o.number}: ${r.error.message}`); else out.moved++;
      }
    }
  }
  return out;
}
