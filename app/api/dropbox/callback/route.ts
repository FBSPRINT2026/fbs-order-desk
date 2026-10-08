import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dropboxConnect } from "@/lib/dropbox";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/** back from Dropbox: keep the sign-in, then back to Settings */
export async function GET(req: Request) {
  const v = await getViewer();
  const back = (msg: string) => NextResponse.redirect(`${SITE_URL}/shop/settings?dropbox=${encodeURIComponent(msg)}#dropbox`);
  if (!v.user || v.role !== "owner") return back("Only the owner connects Dropbox.");
  const sp = new URL(req.url).searchParams;
  const jar = await cookies();
  const state = jar.get("dbx_state")?.value;
  jar.delete("dbx_state");
  if (sp.get("error")) return back(`Dropbox: ${sp.get("error_description") || sp.get("error")}`);
  if (!state || state !== sp.get("state") || !sp.get("code")) return back("That sign-in didn't match. Try Connect again.");
  try { await dropboxConnect(createAdminClient(), sp.get("code")!, `${SITE_URL}/api/dropbox/callback`, v.email); return back("connected"); }
  catch (e) { return back(e instanceof Error ? e.message : String(e)); }
}
