import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { authorizeUrl, canvaEnv, newPkce, oauthCookie, samePath } from "@/lib/canva/client";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Off to Canva's sign-in (OAuth with PKCE).
 *   (no for)                     owner only: the shop's Canva account (email-link exports, staff designs)
 *   ?for=me&return_to=/portal/…  anyone signed in: their OWN Canva account (customers design in Canva from the portal),
 *                                then back to return_to (a path on this site)
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const v = await getViewer();
  const me = sp.get("for") === "me";
  const back = samePath(sp.get("return_to")) || (me ? (v.isStaff ? "/shop/artwork/mockup" : "/portal/mockup") : "/shop/settings/canva");
  const fail = (msg: string) => {
    const u = new URL(me ? back : "/shop/settings/canva", SITE_URL);
    u.searchParams.set(me ? "canva_error" : "canva", msg);
    return NextResponse.redirect(u.toString());
  };
  if (!v.user) return NextResponse.redirect(`${SITE_URL}/login?next=${encodeURIComponent(back)}`);
  if (!me && v.role !== "owner") return fail("Only the owner connects the shop's Canva account.");
  const env = canvaEnv();
  if (!env.configured) return fail(me ? "Canva isn't set up here yet." : `Add ${env.missing.join(" and ")} in Vercel first, then redeploy.`);
  const { verifier, challenge, state } = newPkce();
  // the PKCE verifier, state, whose connection and where to go back wait in a signed, httpOnly cookie (10 minutes)
  (await cookies()).set("canva_oauth", oauthCookie({ state, verifier, for: me ? "me" : "shop", ...(me ? { uid: v.user.id, back } : {}) }), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/canva", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state, challenge));
}
