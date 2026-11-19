import type { SupabaseClient } from "@supabase/supabase-js";
import { kindsOf, MIX_WORD } from "@/lib/mixParts";
import { mergeProduction, type MachineType } from "@/lib/production";
import type { Group } from "@/lib/pricing";

/**
 * An order's parts, printed or not (Nick, Nov 19 2026: "if it's like screen printing done and embroidery's not done…
 * its master status will go in production and it'll say partially complete… so that it's not ready to ship"). A part is
 * one kind of machine the order prints on (screen print, embroidery, heat press: lib/mixParts.ts kindsOf). It's printed
 * when it has bookings and every one of them is printed. The order moves on (to Ready: Ready for Pickup / Ready for
 * Delivery / Shipping by its delivery method) only when every part is printed and no Issue pieces are left to print.
 *
 * Used by the press timer and phones (app/api/jobs/timer), Mark printed (the order's Production menu, the Orders list),
 * and Ship (components/ShipCheck.tsx).
 */
type SlotRow = { id: string; kind: string | null; status: string; machine: string; minutes: number | null; started_at: string | null };

/** the parts not printed yet: no booking, or a booking still to print */
export async function partsLeft(admin: SupabaseClient, orderId: string): Promise<{ kinds: MachineType[]; left: MachineType[]; words: string[] }> {
  const [{ data: o }, { data: sl }] = await Promise.all([
    admin.from("orders").select("groups").eq("id", orderId).maybeSingle(),
    admin.from("production_slots").select("id, kind, status, machine, minutes, started_at").eq("order_id", orderId),
  ]);
  const kinds = kindsOf(((o?.groups || []) as Group[]).filter((g) => !(g as { sample?: unknown }).sample));
  const slots = (sl || []) as SlotRow[];
  const left = kinds.filter((k) => { const mine = slots.filter((s) => (s.kind || "screen") === k); return !mine.length || mine.some((s) => s.status !== "done"); });
  return { kinds, left, words: left.map((k) => MIX_WORD[k]) };
}

/** mark one part (or every part) printed: its bookings printed; a part never booked gets a printed booking of its own */
export async function markPartsPrinted(admin: SupabaseClient, orderId: string, which: MachineType | "all", by: string): Promise<string[]> {
  const { kinds, left } = await partsLeft(admin, orderId);
  const todo = which === "all" ? left : left.filter((k) => k === which);
  if (!todo.length) return [];
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeProduction((st?.data as { production?: unknown } | null)?.production);
  const now = new Date().toISOString(), today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { data: sl } = await admin.from("production_slots").select("id, kind, status, machine, minutes, started_at").eq("order_id", orderId).neq("status", "done");
  for (const k of todo) {
    const mine = ((sl || []) as SlotRow[]).filter((x) => (x.kind || "screen") === k);
    for (const x of mine) {
      await admin.from("production_slots").update({ status: "done", finished_at: now, started_at: x.started_at || now, progress: 1, progress_at: now, updated_at: now }).eq("id", x.id);
      await admin.from("production_slot_log").insert({ slot_id: x.id, order_id: orderId, machine: x.machine, action: "done", progress: 1, note: "Marked printed", by });
    }
    if (!mine.length) {
      const m = s.machines.find((x) => x.type === k && x.active !== false) || s.machines.find((x) => x.type === k);
      if (m) await admin.from("production_slots").insert({ order_id: orderId, machine: m.id, day: today, minutes: 0, start_min: null, position: 999, kind: k, label: `${MIX_WORD[k]} · marked printed`, source: "marked", status: "done", started_at: now, finished_at: now, progress: 1, progress_at: now });
    }
  }
  await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `${todo.map((k) => MIX_WORD[k]).join(" and ")} marked printed${kinds.length > todo.length ? "" : ""}`, actor: by });
  return todo.map((k) => MIX_WORD[k]);
}

/** every part printed and nothing left to reprint: the order goes on to Ready (or the status asked for) */
export async function moveOnIfPrinted(admin: SupabaseClient, orderId: string, by: string, to: "ready" | "fulfillment" | "completed" = "ready"): Promise<string | null> {
  const [{ left }, { data: oi }, { data: o }] = await Promise.all([
    partsLeft(admin, orderId),
    admin.from("production_issues").select("id").eq("order_id", orderId).eq("status", "open").limit(1),
    admin.from("orders").select("status").eq("id", orderId).maybeSingle(),
  ]);
  if (left.length || (oi || []).length) return null;
  const cur = String(o?.status || "");
  if (!["approved", "art", "blanks", "production", "fulfillment"].includes(cur) || cur === to) return null;
  const { error } = await admin.from("orders").update({ status: to, type: "invoice" }).eq("id", orderId);
  if (error) return null;
  await admin.from("order_events").insert({ order_id: orderId, kind: "status", detail: to, actor: by });
  return to;
}
