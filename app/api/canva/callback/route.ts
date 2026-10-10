import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectUserWithCode, connectWithCode, readOauthCookie, samePath } from "@/lib/canva/client";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Back from Canva: check the state (signed cookie), trade the code for the sign-in (kept server-side only):
 *  - the shop's connection (owner) → Settings → Canva
 *  - one person's own Canva account → their canva_accounts row → back to the page they started from
 */
export async function GET(req: Request) {
  const v = await getViewer();
  const sp = new URL(req.url).searchParams;
  const jar = await cookies();
  const raw = jar.get("canva_oauth")?.value;
  jar.set("canva_oauth", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/canva", maxAge: 0 });
  const c = readOauthCookie(raw, sp.get("state"));
  const me = c?.for === "me";
  const back = (msg: string, ok = false) => {
    if (!me) return NextResponse.redirect(`${SITE_URL}/shop/settings/canva?canva=${encodeURIComponent(msg)}`);
    const u = new URL(samePath(c?.back) || (v.isStaff ? "/shop/artwork/mockup" : "/portal/mockup"), SITE_URL);
    u.searchParams.set(ok ? "canva_connected" : "canva_error", msg);
    return NextResponse.redirect(u.toString());
  };
  if (sp.get("error")) return back(sp.get("error") === "access_denied" ? "Canva sign-in was cancelled." : `Canva: ${sp.get("error_description") || sp.get("error")}`);
  if (!c) return back("That Canva sign-in didn't match (or took over 10 minutes). Try again.");
  const code = sp.get("code");
  if (!code) return back("Canva didn't send a sign-in code. Try again.");
  if (!v.user) return NextResponse.redirect(`${SITE_URL}/login`);
  const admin = createAdminClient();
  try {
    if (me) {
      if (c.uid !== v.user.id) return back("You signed in as someone else meanwhile. Try again.");
      // a customer's own account (their first, like the rest of the portal); staff: no customer
      let customerId: string | null = null;
      if (!v.isStaff) { const { data: cs } = await v.supabase.from("customers").select("id").limit(1); customerId = (cs?.[0]?.id as string) || null; }
      const r = await connectUserWithCode(admin, code, c.verifier, { userId: v.user.id, email: v.email, customerId });
      return back(r.name || "your Canva account", true);
    }
    if (v.role !== "owner") return back("Only the owner connects the shop's Canva account.");
    const r = await connectWithCode(admin, code, c.verifier, v.email);
    return back(`connected:${r.name || "your Canva account"}`);
  } catch (e) { return back(e instanceof Error ? e.message : String(e)); }
}
