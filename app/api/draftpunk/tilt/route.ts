import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Tilt hydrometer readings for DraftPunk (migration 339). The Tilt app and TiltPi "Cloud URL" logging post each reading
 * (form fields Timepoint, SG, Temp, Color, Beer, Comment; TiltPi can send JSON) to this address with the brewer's own
 * key (?k=). A reading goes to the brewer's newest brew log set to that Tilt color; one with no match is still kept.
 */
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("k") || "";
  if (key.length < 20) return NextResponse.json({ error: "missing key" }, { status: 401 });
  const admin = createAdminClient();
  const { data: brewer } = await admin.from("dp_brewers").select("user_id").eq("tilt_key", key).maybeSingle();
  if (!brewer) return NextResponse.json({ error: "unknown key" }, { status: 401 });
  let f: Record<string, string> = {};
  const type = req.headers.get("content-type") || "";
  try {
    if (type.includes("json")) f = Object.fromEntries(Object.entries(await req.json()).map(([k, v]) => [k, String(v)]));
    else f = Object.fromEntries(Array.from((await req.formData()).entries()).map(([k, v]) => [k, String(v)]));
  } catch { return NextResponse.json({ error: "unreadable" }, { status: 400 }); }
  const pick = (...names: string[]) => { for (const n of names) { const hit = Object.keys(f).find((k) => k.toLowerCase() === n); if (hit && f[hit] !== "") return f[hit]; } return ""; };
  let sg = parseFloat(pick("sg", "gravity", "specificgravity"));
  if (sg > 2) sg = sg / 1000; // 1050 style
  let temp = parseFloat(pick("temp", "temperature"));
  if (Number.isFinite(temp) && temp < 45 && /c/i.test(pick("tempunits", "units"))) temp = temp * 1.8 + 32;
  const color = pick("color", "colour").toUpperCase();
  if (!Number.isFinite(sg)) return NextResponse.json({ error: "no gravity" }, { status: 400 });
  // the brewer's newest brew set to this Tilt color
  const { data: brew } = await admin.from("dp_brews").select("id").eq("owner_id", brewer.user_id).eq("measured->>tiltColor", color).order("brewed_on", { ascending: false }).limit(1).maybeSingle();
  // Timepoint is an Excel date (days since 1899-12-30) in the phone's local time; the arrival time is close enough
  const { error } = await admin.from("dp_readings").insert({ owner_id: brewer.user_id, brew_id: brew?.id || null, color, sg, temp_f: Number.isFinite(temp) ? temp : null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, brew: brew?.id || null, result: "Data received" });
}
