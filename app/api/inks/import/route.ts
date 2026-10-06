import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import rx from "@/data/ims/RX.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Load the IMS 3.0 formula list (every color's code, name, hex and base, from the shop's IMS formula cache, saved in
 * data/ims/<system>.json) into ink_formulas. Ingredient lines already captured are kept. Sync token only.
 */
const SETS: Record<string, { system: string; cols: string[]; rows: unknown[][] }> = { RX: rx as never };

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!s || req.headers.get("x-sync-token") !== s.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const set = SETS[new URL(req.url).searchParams.get("system") || "RX"];
  if (!set) return NextResponse.json({ error: "Unknown system" }, { status: 400 });
  const rows = set.rows.map((r) => ({ system: set.system, ...Object.fromEntries(set.cols.map((c, i) => [c, r[i] ?? (c === "ing_count" || c === "ims_updated_at" ? null : "")])) }));
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("ink_formulas").upsert(rows.slice(i, i + 500), { onConflict: "system,ims_id", ignoreDuplicates: false });
    if (error) return NextResponse.json({ error: error.message, done: n }, { status: 500 });
    n += Math.min(500, rows.length - i);
  }
  return NextResponse.json({ ok: true, system: set.system, rows: n });
}
