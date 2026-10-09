import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { qboEnv } from "@/lib/qbo/config";
import { authorizeUrl } from "@/lib/qbo/client";
import { SITE_URL } from "@/lib/config";
import { newState } from "../state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner only: off to Intuit's sign-in to allow the portal into the shop's QuickBooks company. */
export async function GET() {
  const v = await getViewer();
  const back = (msg: string) => NextResponse.redirect(`${SITE_URL}/shop/settings/quickbooks?qbo=${encodeURIComponent(msg)}`);
  if (!v.user || v.role !== "owner") return back("Only the owner connects QuickBooks.");
  const env = qboEnv();
  if (!env.configured) return back(`Add ${[...env.missing, ...env.problems].join(", ")} in Vercel first, then redeploy.`);
  const { state, cookie } = newState();
  (await cookies()).set("qbo_state", cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/qbo", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state));
}
