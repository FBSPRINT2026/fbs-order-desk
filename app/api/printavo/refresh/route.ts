import { NextResponse } from "next/server";
import { importOrder } from "@/lib/printavoImport";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refresh from Printavo (Oct 26, Nick: "I updated some invoices in Printavo… and those didn't update in a couple hours"):
 * one imported order read again right now, exactly as Printavo has it. Read-only toward Printavo. History before 2026
 * is locked (migration 082) and stays as imported.
 */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { archivedId } = await req.json().catch(() => ({}));
  if (!archivedId) return NextResponse.json({ error: "Missing order." }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("archived_orders").select("id, printavo_id, customer_id, visual_id, locked").eq("id", String(archivedId)).maybeSingle();
  if (!row) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (row.locked) return NextResponse.json({ error: `#${row.visual_id} is from before 2026: that history is locked and kept as it was imported.` }, { status: 409 });
  // the background sync steps aside for a moment (never shortening a longer pause Printavo asked for)
  const { data: s } = await admin.from("printavo_sync").select("pause_until").eq("id", 1).single();
  const until = Date.now() + 30000;
  if (!s?.pause_until || new Date(s.pause_until as string).getTime() < until) await admin.from("printavo_sync").update({ pause_until: new Date(until).toISOString() }).eq("id", 1);
  try {
    const r = await importOrder(admin, String(row.printavo_id), (row.customer_id as string) || null);
    const now = new Date().toISOString();
    await admin.from("printavo_index").update({ status: r.filesLeft ? "files" : "done", archived_id: r.id, imported_at: now, deep_at: now, attempts: 0, error: null }).eq("printavo_id", String(row.printavo_id));
    return NextResponse.json({ ok: true, visualId: r.visualId, filesLeft: r.filesLeft });
  } catch (e) { return fail(e); }
}
