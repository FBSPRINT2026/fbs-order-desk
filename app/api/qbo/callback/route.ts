import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectWithCode } from "@/lib/qbo/client";
import { SITE_URL } from "@/lib/config";
import { checkState } from "../state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Back from Intuit: check the state, trade the code for the sign-in (kept server-side only), back to the settings page. */
export async function GET(req: Request) {
  const v = await getViewer();
  const back = (msg: string) => NextResponse.redirect(`${SITE_URL}/shop/settings/quickbooks?qbo=${encodeURIComponent(msg)}`);
  if (!v.user || v.role !== "owner") return back("Only the owner connects QuickBooks.");
  const sp = new URL(req.url).searchParams;
  const jar = await cookies();
  const cookie = jar.get("qbo_state")?.value;
  jar.set("qbo_state", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/qbo", maxAge: 0 });
  if (sp.get("error")) return back(`QuickBooks: ${sp.get("error_description") || sp.get("error")}`);
  if (!checkState(cookie, sp.get("state"))) return back("That sign-in didn't match. Press Connect again.");
  const code = sp.get("code"), realmId = sp.get("realmId");
  if (!code || !realmId) return back("QuickBooks didn't send the company. Press Connect again.");
  try {
    const r = await connectWithCode(createAdminClient(), code, realmId, v.email);
    return back(`connected:${r.company || realmId}`);
  } catch (e) { return back(e instanceof Error ? e.message : String(e)); }
}
