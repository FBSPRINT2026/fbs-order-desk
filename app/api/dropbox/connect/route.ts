import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dropboxConfigured, dropboxStatus } from "@/lib/dropbox";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET ?go=1: the owner is sent to Dropbox to allow read-only access; GET: is Dropbox set up and connected? */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!new URL(req.url).searchParams.get("go")) return NextResponse.json(await dropboxStatus(createAdminClient()));
  if (v.role !== "owner") return NextResponse.json({ error: "Only the owner connects Dropbox." }, { status: 403 });
  if (!dropboxConfigured()) return NextResponse.json({ error: "Add DROPBOX_APP_KEY and DROPBOX_APP_SECRET in Vercel first." }, { status: 400 });
  const state = crypto.randomUUID();
  (await cookies()).set("dbx_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  const u = new URL("https://www.dropbox.com/oauth2/authorize");
  u.searchParams.set("client_id", process.env.DROPBOX_APP_KEY!.trim());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("token_access_type", "offline");
  u.searchParams.set("redirect_uri", `${SITE_URL}/api/dropbox/callback`);
  u.searchParams.set("state", state);
  return NextResponse.redirect(u.toString());
}
