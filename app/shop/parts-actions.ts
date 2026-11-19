"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { markPartsPrinted, moveOnIfPrinted, partsLeft } from "@/lib/partsPrinted";
import type { MachineType } from "@/lib/production";
import type { Flag } from "@/lib/orderStages";

/**
 * Mark printed by part, and Ship with a part not printed (Nick, Nov 19 2026: "you should be able to click on an order and
 * say ship, and then it should say, hey, this order is not complete. It's missing its embroidery… Do you want to ship it
 * anyway?… are you shipping all of it or just partial of it? If you ship it all… should I mark everything complete?").
 * lib/partsPrinted.ts does the work; components/ShipCheck.tsx asks.
 */
async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), by: String((v.staff as { name?: string } | null)?.name || v.email || "shop") };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

/** mark a part (or every part) printed on these orders; each moves on to Ready once everything's printed */
export async function markPrinted(orderIds: string[], which: MachineType | "all") {
  try {
    const { admin, by } = await staff();
    const done: string[] = [], moved: number[] = [];
    for (const id of orderIds.slice(0, 200)) {
      const got = await markPartsPrinted(admin, id, which, by);
      if (got.length) done.push(id);
      if (await moveOnIfPrinted(admin, id, by)) moved.push(1);
    }
    return { ok: true as const, done: done.length, moved: moved.length };
  } catch (e) { return fail(e); }
}

/** what Ship needs to know: the order, and the parts not printed yet */
export async function shipCheck(number: string) {
  try {
    const { admin } = await staff();
    const { data: o } = await admin.from("orders").select("id, number, nickname, status, delivery_method, type").eq("number", +number).is("discarded_at", null).maybeSingle();
    if (!o) return { ok: false as const, error: `#${number} isn't an order here.` };
    const { left, words } = await partsLeft(admin, o.id as string);
    return { ok: true as const, id: o.id as string, number: String(o.number), job: String(o.nickname || ""), status: String(o.status), ready: o.status === "ready" && o.delivery_method === "ship", left, words };
  } catch (e) { return fail(e); }
}

/** ship all of it: every part marked printed, and the order goes to Shipping */
export async function shipAll(orderId: string) {
  try {
    const { admin, by } = await staff();
    await markPartsPrinted(admin, orderId, "all", by);
    await admin.from("orders").update({ delivery_method: "ship" }).eq("id", orderId);
    const moved = await moveOnIfPrinted(admin, orderId, by);
    const { data: o } = await admin.from("orders").select("status").eq("id", orderId).maybeSingle();
    if (!moved && o?.status !== "ready") return { ok: false as const, error: "It still has pieces to print (an open Issue). Close the Issue, or ship part of it." };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** ship part of it: it stays In Production, and it's on the Shipping list until that shipment goes (the "partial" flag) */
export async function shipPart(orderId: string) {
  try {
    const { admin, by } = await staff();
    const { data: o } = await admin.from("orders").select("flags").eq("id", orderId).maybeSingle();
    const flags = (Array.isArray(o?.flags) ? o!.flags : []) as Flag[];
    const rest = flags.filter((f) => f.key !== "partial");
    const { error } = await admin.from("orders").update({ flags: [...rest, { key: "partial", note: "Shipping part now", by, at: new Date().toISOString() }], delivery_method: "ship" }).eq("id", orderId);
    if (error) return fail(error.message);
    await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: "Shipping part of it now; the rest stays in production", actor: by });
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
