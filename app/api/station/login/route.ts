import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { shopNetwork } from "@/lib/shopNetwork";
import { checkPin } from "@/lib/timeclockServer";
import { STATIONS, stationByName, stationEmail } from "@/lib/stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A shop computer signs in (lib/stations.ts): its name and the shop computer PIN (set by the owner on Settings → Shop
 * computers, kept scrambled in settings.data.stations), on the shop's network only. Five wrong PINs lock it for 5 minutes.
 * The computer's own staff login is made the first time (no email is ever sent), then signed in.
 */
type St = { pinHash?: string; fails?: number; lockedUntil?: string | null };
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const st = stationByName(String(b.name || ""));
  if (!st) return NextResponse.json({ error: `That isn't a shop computer. Try ${STATIONS.map((s) => s.name).join(", ")}.` }, { status: 400 });
  const admin = createAdminClient();
  const net = await shopNetwork(admin);
  if (!net.configured) return NextResponse.json({ error: "The shop's network isn't saved yet. Ask the office." }, { status: 403 });
  if (!net.on) return NextResponse.json({ error: "Shop computers only sign in on the shop's network." }, { status: 403 });
  const { data: srow } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const data = (srow?.data || {}) as Record<string, unknown>;
  const cur = (data.stations || {}) as St;
  if (!cur.pinHash) return NextResponse.json({ error: "No shop computer PIN set yet. The owner sets it on Settings → Shop computers." }, { status: 403 });
  if (cur.lockedUntil && Date.parse(cur.lockedUntil) > Date.now()) return NextResponse.json({ error: "Too many wrong PINs. Wait a few minutes and try again." }, { status: 429 });
  const save = async (patch: St) => { const { data: fresh } = await admin.from("settings").select("data").eq("id", 1).maybeSingle(); const d = (fresh?.data || {}) as Record<string, unknown>; await admin.from("settings").update({ data: { ...d, stations: { ...((d.stations || {}) as St), ...patch } } }).eq("id", 1); };
  if (!checkPin(String(b.pin || ""), cur.pinHash)) {
    const fails = (cur.fails || 0) + 1;
    await save({ fails: fails >= 5 ? 0 : fails, lockedUntil: fails >= 5 ? new Date(Date.now() + 5 * 60000).toISOString() : null });
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }
  if (cur.fails) await save({ fails: 0, lockedUntil: null });
  const email = stationEmail(st);
  // its own staff login, made once: a staff row with its role (kept if the owner changed it later), an auth user
  const { data: have } = await admin.from("staff").select("email").eq("email", email).maybeSingle();
  if (!have) { const r = await admin.from("staff").insert({ email, name: `${st.name} · ${st.label}`, role: st.role }); if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 }); }
  const made = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (made.error && !/already|registered|exists/i.test(made.error.message)) return NextResponse.json({ error: made.error.message }, { status: 500 });
  // signed in without any email: a one-time sign-in made here and used right away
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const token = link.data?.properties?.hashed_token;
  if (link.error || !token) return NextResponse.json({ error: link.error?.message || "Couldn't sign in." }, { status: 500 });
  const sb = await createClient();
  const v = await sb.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (v.error) return NextResponse.json({ error: v.error.message }, { status: 500 });
  const res = NextResponse.json({ ok: true, to: st.home });
  // the portal's home opens on this computer's page from now on (middleware.ts, fbs_app_start)
  if (st.home.startsWith("/shop/")) res.cookies.set("fbs_app_start", st.home, { path: "/", maxAge: 400 * 86400, sameSite: "lax", secure: true });
  return res;
}
