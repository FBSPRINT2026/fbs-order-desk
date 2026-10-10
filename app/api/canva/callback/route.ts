import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectWithCode, readOauthCookie } from "@/lib/canva/client";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Back from Canva: check the state, trade the code for the sign-in (kept server-side only), back to Settings → Canva. */
export async function GET(req: Request) {
  const v = await getViewer();
  const back = (msg: string) => NextResponse.redirect(`${SITE_URL}/shop/settings/canva?canva=${encodeURIComponent(msg)}`);
  if (!v.user || v.role !== "owner") return back("Only the owner connects Canva.");
  const sp = new URL(req.url).searchParams;
  const jar = await cookies();
  const cookie = jar.get("canva_oauth")?.value;
  jar.set("canva_oauth", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/canva", maxAge: 0 });
  if (sp.get("error")) return back(`Canva: ${sp.get("error_description") || sp.get("error")}`);
  const verifier = readOauthCookie(cookie, sp.get("state"));
  if (!verifier) return back("That sign-in didn't match (or took over 10 minutes). Press Connect again.");
  const code = sp.get("code");
  if (!code) return back("Canva didn't send a sign-in code. Press Connect again.");
  try {
    const r = await connectWithCode(createAdminClient(), code, verifier, v.email);
    return back(`connected:${r.name || "your Canva account"}`);
  } catch (e) { return back(e instanceof Error ? e.message : String(e)); }
}
