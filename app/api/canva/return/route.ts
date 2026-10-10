import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/supabase/server";
import { CanvaError, SHOP, verifyReturnJwt } from "@/lib/canva/client";
import { saveCanvaAsDesign } from "@/lib/canva/save";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Canva's Return navigation lands here (?correlation_jwt=…). The token is checked (Canva's signature, our client id,
 * type "rti", not expired); its correlation_state finds the trip (canva_sessions); the design is exported (see-through
 * PNG for the mockup + the PDF as the print file), saved as the customer's design, and Nick goes back to the Mockup
 * Creator with ?canva=<trip id>, where it goes on that side of the shirt. Pressing Return twice saves it once.
 */
export async function GET(req: Request) {
  const jwt = new URL(req.url).searchParams.get("correlation_jwt") || "";
  const admin = createAdminClient();
  const to = (path: string, params: Record<string, string>) => {
    const u = new URL(path || "/shop/artwork/mockup", SITE_URL);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return NextResponse.redirect(u.toString(), 303);
  };
  // where a problem goes when there's no trip to go back to: staff → the Mockup Creator, customers → their portal's
  const home = async () => ((await getViewer().catch(() => null))?.isStaff ? "/shop/artwork/mockup" : "/portal/mockup");
  let claims: Awaited<ReturnType<typeof verifyReturnJwt>>;
  try { claims = await verifyReturnJwt(jwt); }
  catch (e) { return to(await home(), { canva_error: e instanceof Error ? e.message : String(e) }); }
  const { data: s } = await admin.from("canva_sessions").select("*").eq("correlation_state", claims.correlation_state).maybeSingle();
  if (!s) return to(await home(), { canva_error: "Couldn't find where this Canva design goes. Use Design with Canva from the Mockup Creator." });
  const back = () => to(s.return_to as string, { canva: s.id as string });
  // only one Return does the work; another one (a second press) just goes back and waits for it
  const { data: mine } = await admin.from("canva_sessions").update({ status: "returned", design_id: claims.design_id, error: null, updated_at: new Date().toISOString() })
    .eq("id", s.id).in("status", ["editing", "error"]).select("id").maybeSingle();
  if (!mine) return back();
  try {
    const d = await saveCanvaAsDesign(admin, {
      designId: claims.design_id, customerId: (s.customer_id as string) || null, by: (s.created_by as string) || "canva",
      // the Canva account the trip was made with: the person's own, or the shop's
      account: s.account === "user" && s.user_id ? { kind: "user", user: s.user_id as string } : SHOP,
      note: `Made in Canva for the ${s.location || "print"}${s.width_in ? ` (${+s.width_in}" × ${+s.height_in}" canvas)` : ""}.`,
    });
    await admin.from("canva_sessions").update({ status: "saved", design_ref: d.id, updated_at: new Date().toISOString() }).eq("id", s.id);
  } catch (e) {
    const msg = e instanceof CanvaError && e.noAccess ? "Canva says the Canva account this was started with can't open the design. Open it in Canva while signed in to that account, then press Return again." : e instanceof Error ? e.message : String(e);
    await admin.from("canva_sessions").update({ status: "error", error: msg.slice(0, 600), updated_at: new Date().toISOString() }).eq("id", s.id);
  }
  return back();
}
