import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, uid } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * Save a custom finishing to the sometimes-used list (Oct 20, Nick: "would you like to save this to your sometimes
 * used"): added to the retail list (or the wholesale contract list, when the order is wholesale and that list has its
 * own) marked `more`, so it's under "+ More" on orders, not shown on every one. A name already on the list is updated.
 *   POST { name, price, wholesale? } → { ok, item }
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; price?: number; wholesale?: boolean };
  const name = String(b.name || "").trim().slice(0, 80), price = Math.round((+(b.price ?? 0) || 0) * 100) / 100;
  if (!name || price < 0) return NextResponse.json({ error: "A label and a price per piece." }, { status: 400 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const data = { ...((row?.data as Record<string, unknown>) || {}) };
  type F = { id: string; name: string; price: number; more?: boolean };
  const ws = (data.wholesale || {}) as { finishing?: F[] };
  const useWs = !!b.wholesale && Array.isArray(ws.finishing) && ws.finishing.length > 0;
  // the list as the shop sees it (the defaults when it was never edited, so they aren't wiped)
  const list: F[] = [...((useWs ? ws.finishing : (mergeSettings(data).finishing as F[])) || [])];
  const at = list.findIndex((f) => f.name.trim().toLowerCase() === name.toLowerCase());
  const item: F = at >= 0 ? { ...list[at], name, price } : { id: "fin_" + uid(), name, price, more: true };
  if (at >= 0) list[at] = item; else list.push(item);
  if (useWs) data.wholesale = { ...ws, finishing: list }; else data.finishing = list;
  const { error } = await admin.from("settings").update({ data, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item });
}
