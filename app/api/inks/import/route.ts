import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import rx from "@/data/ims/RX.json";
import rxLines from "@/data/ims/RX-lines.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Load the IMS 3.0 formula list (every color's code, name, hex and base, from the shop's IMS formula cache, saved in
 * data/ims/<system>.json) into ink_formulas. Ingredient lines already captured are kept. Sync token only.
 */
const SETS: Record<string, { system: string; cols: string[]; rows: unknown[][] }> = { RX: rx as never };
type Read = { rec_type: string; code: string; ims_id?: number; grams_per_qt: number; lines: { type: string; code: string; desc: string; pct: number; g?: number }[]; note?: string };
const READS: Record<string, { formulas: Read[] }> = { RX: rxLines as never };

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
  // ingredient lines read from the IMS screen (data/ims/<system>-lines.json, the source of truth for reads): every
  // formula in that file is written as it is there
  // (20 at a time, so a long list still finishes well inside the time limit)
  let lines = 0;
  const reads = READS[set.system]?.formulas || [];
  const at = new Date().toISOString();
  for (let i = 0; i < reads.length; i += 20) {
    const out = await Promise.all(reads.slice(i, i + 20).map((f) => {
      let q = admin.from("ink_formulas").update({ lines: f.lines, grams_per_qt: f.grams_per_qt, captured_at: at, captured_note: f.note || "Read from IMS 3.0 screen (grams for 1 qt)" }).eq("system", set.system);
      q = f.ims_id ? q.eq("ims_id", f.ims_id) : q.eq("rec_type", f.rec_type).eq("code", f.code);
      if (f.rec_type === "S" && !f.ims_id) q = q.eq("base", set.system);
      return q.select("id");
    }));
    const bad = out.find((r) => r.error);
    if (bad?.error) return NextResponse.json({ error: bad.error.message, rows: n, lines }, { status: 500 });
    lines += out.reduce((t, r) => t + (r.data || []).length, 0);
  }
  return NextResponse.json({ ok: true, system: set.system, rows: n, lines });
}
