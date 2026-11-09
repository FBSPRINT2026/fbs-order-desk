import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listOrders } from "@/lib/printavo";
import { readAll } from "@/lib/readAll";

export const maxDuration = 300;

/**
 * Once, as the production schedule goes live (Nov 9, Nick: "anything that has a status of job completed, fulfillment,
 * ready for finishing, shipping, ready to ship or deliver… those need to be removed from our schedule… this is a one-time
 * action"): reads each open order's status in Printavo (read only, nothing in Printavo changes) and takes the ones already
 * past printing off the schedule (orders.schedule_off_at; MachineSchedule leaves them out). ?dry=1 only lists them.
 */
const PAST_PRINT = /job\s*complete|complete[d]?\b|fulfil|finishing|ship|deliver|picked\s*up/i;

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const ours = await readAll<{ id: string; number: number; nickname: string | null; status: string }>((from, to) =>
    admin.from("orders").select("id, number, nickname, status").is("discarded_at", null).is("schedule_off_at", null).not("printavo_id", "is", null).in("status", ["approved", "art", "blanks", "production"]).order("id").range(from, to));
  if (!ours.length) return NextResponse.json({ dry, off: [], kept: [] });
  const want = new Map(ours.map((o) => [String(o.number), o]));
  const low = Math.min(...ours.map((o) => o.number));
  const pvStatus = new Map<string, string>();
  let after: string | null = null;
  for (let page = 0; page < 200; page++) {
    const r = await listOrders(after, "number");
    for (const o of r.orders) if (want.has(o.visualId)) pvStatus.set(o.visualId, o.fingerprint.split("|")[3] || "");
    const last = r.orders[r.orders.length - 1];
    if (!r.next || !last || +last.visualId < low || pvStatus.size === want.size) break;
    after = r.next;
  }
  const off: string[] = [], kept: string[] = [];
  const at = new Date().toISOString();
  for (const o of ours) {
    const st = pvStatus.get(String(o.number));
    const line = `${o.number} ${o.nickname || ""} · Printavo: ${st ?? "not found"}`;
    if (st && PAST_PRINT.test(st)) {
      off.push(line);
      if (!dry) await admin.from("orders").update({ schedule_off_at: at, schedule_off_why: `Printavo: ${st}` }).eq("id", o.id);
    } else kept.push(line);
  }
  return NextResponse.json({ dry, off, kept });
}
