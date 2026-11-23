import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Pal = { n: number; cur?: boolean; cus?: boolean; c: [string, string][] };
type Job = { id: number; ref?: string; st?: string; at?: string; p: Pal[] };

/**
 * Separo's ink ladders kept for learning (Nick, Nov 23 2026: "learn how it limits the colors… how it goes from 4 to 3").
 * Each Separo job offers 1 to 9 inks and picks one count by default; the list of jobs, read from the shop's own Separo
 * account in the browser, is saved here (separo_jobs) for the separation coach to learn from.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { jobs?: Job[] };
  const rows = (b.jobs || []).filter((j) => Number.isFinite(j.id) && Array.isArray(j.p)).slice(0, 2000).map((j) => {
    const auto = j.p.find((p) => p.cur && !p.cus) || j.p.find((p) => p.cur);
    return { id: j.id, ref: String(j.ref || "").slice(0, 200), state: String(j.st || ""), created: j.at || null, picked: auto ? auto.n : null, palettes: j.p, imported_at: new Date().toISOString() };
  });
  const admin = createAdminClient();
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from("separo_jobs").upsert(rows.slice(i, i + 200));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}
