import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { authorizeUrl, canvaEnv, newPkce, oauthCookie } from "@/lib/canva/client";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner only: off to Canva's sign-in (OAuth with PKCE) to let the portal use the shop's Canva account. */
export async function GET() {
  const v = await getViewer();
  const back = (msg: string) => NextResponse.redirect(`${SITE_URL}/shop/settings/canva?canva=${encodeURIComponent(msg)}`);
  if (!v.user || v.role !== "owner") return back("Only the owner connects Canva.");
  const env = canvaEnv();
  if (!env.configured) return back(`Add ${env.missing.join(" and ")} in Vercel first, then redeploy.`);
  const { verifier, challenge, state } = newPkce();
  // the PKCE verifier and state wait in a signed, httpOnly cookie for the callback (10 minutes)
  (await cookies()).set("canva_oauth", oauthCookie(state, verifier), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/canva", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state, challenge));
}
