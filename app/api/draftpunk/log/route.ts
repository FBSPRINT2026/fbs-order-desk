import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * A fermentation chamber's temperature from anything that can post JSON (Home Assistant, Node-RED, a script reading an
 * Inkbird locally): POST /api/draftpunk/log?k=<the brewer's key> with {"chamber":"Chamber 1","temp":66.2,"setpoint":66,
 * "unit":"F"}. The chamber is matched by name among the brewer's chambers (made if new).
 */
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("k") || "";
  if (key.length < 20) return NextResponse.json({ error: "missing key" }, { status: 401 });
  const admin = createAdminClient();
  const { data: brewer } = await admin.from("dp_brewers").select("user_id").eq("tilt_key", key).maybeSingle();
  if (!brewer) return NextResponse.json({ error: "unknown key" }, { status: 401 });
  let j: Record<string, unknown>;
  try { j = await req.json(); } catch { return NextResponse.json({ error: "send JSON" }, { status: 400 }); }
  const name = String(j.chamber || j.name || "").trim().slice(0, 60);
  const c = /^c/i.test(String(j.unit || "F"));
  const f = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? Math.round((c ? n * 1.8 + 32 : n) * 10) / 10 : null; };
  if (!name || f(j.temp) == null) return NextResponse.json({ error: "need chamber and temp" }, { status: 400 });
  let { data: ch } = await admin.from("dp_chambers").select("id").eq("owner_id", brewer.user_id).ilike("name", name).maybeSingle();
  if (!ch) ch = (await admin.from("dp_chambers").insert({ owner_id: brewer.user_id, name }).select("id").single()).data;
  const { error } = await admin.from("dp_readings").insert({ owner_id: brewer.user_id, chamber_id: ch?.id, source: "inkbird", color: name, temp_f: f(j.temp), set_f: f(j.setpoint ?? j.set) });
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
