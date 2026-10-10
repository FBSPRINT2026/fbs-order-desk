import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Canva, CanvaError, canvaConnected, withCorrelation } from "@/lib/canva/client";
import { SITE_URL } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Staff (POST): "Design in Canva" from the Mockup Creator. Makes a blank Canva design sized for the side's print area
 * (300 pixels an inch, less when Canva's size limits need it), or opens one of our Canva-made designs again
 * ({ from_design }), and records the trip. Answers Canva's editor link carrying our correlation_state, so when Nick
 * presses Return in Canva, /api/canva/return knows where the design goes.
 *   body: { side, location, w_in, h_in, customer_id, order_id?, group_id?, im_id?, return_to, from_design? }
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();
  if (!(await canvaConnected(admin))) return NextResponse.json({ error: "Canva isn't connected (Settings → Canva)." }, { status: 400 });
  const str = (k: string, n = 200) => String(b[k] ?? "").slice(0, n);
  const uuid = (k: string) => (/^[0-9a-f-]{36}$/i.test(str(k)) ? str(k) : null);
  const customerId = uuid("customer_id");
  if (!customerId) return NextResponse.json({ error: "Pick the customer first. The design is saved to their account." }, { status: 400 });
  // where to come back to: a page on this site only
  let returnTo = "/shop/artwork/mockup";
  try { const u = new URL(str("return_to", 2000) || returnTo, SITE_URL); if (u.origin === new URL(SITE_URL).origin && u.pathname.startsWith("/shop/")) { u.searchParams.delete("canva"); returnTo = u.pathname + u.search; } } catch { /* default */ }
  const c = new Canva(admin);
  try {
    let designId = "", editUrl = "", fromDesign: string | null = null;
    const wIn = Math.max(1, Math.min(30, Number(b.w_in) || 12)), hIn = Math.max(1, Math.min(30, Number(b.h_in) || 14));
    if (uuid("from_design")) {
      const { data: d } = await admin.from("designs").select("id, name, canva_design_id").eq("id", uuid("from_design")!).maybeSingle();
      if (!d?.canva_design_id) return NextResponse.json({ error: "That design didn't come from Canva." }, { status: 400 });
      const cd = await c.getDesign(d.canva_design_id as string);
      designId = cd.id; editUrl = cd.urls?.edit_url || ""; fromDesign = d.id as string;
    } else {
      // 300 px an inch, or less to stay within Canva's limits (8,000 px a side, 25 million px in all)
      const dpi = Math.floor(Math.min(300, 8000 / Math.max(wIn, hIn), Math.sqrt(25_000_000 / (wIn * hIn))));
      const { data: cu } = await admin.from("customers").select("company, name").eq("id", customerId).maybeSingle();
      const who = (cu?.company || cu?.name || "Customer") as string;
      const title = `${who} · ${str("location", 60) || "Design"} (${wIn}" × ${hIn}")`;
      const cd = await c.createDesign(wIn * dpi, hIn * dpi, title);
      designId = cd.id; editUrl = cd.urls?.edit_url || "";
    }
    if (!designId || !editUrl) return NextResponse.json({ error: "Canva didn't send an editor link. Try again." }, { status: 502 });
    const state = randomBytes(18).toString("base64url"); // 24 URL-safe characters (Canva allows 50)
    const { data: s, error } = await admin.from("canva_sessions").insert({
      correlation_state: state, design_id: designId, customer_id: customerId, order_id: uuid("order_id"), group_id: str("group_id", 80),
      side: str("side", 20), location: str("location", 60), im_id: str("im_id", 80), width_in: wIn, height_in: hIn,
      return_to: returnTo, status: "editing", from_design: fromDesign, created_by: v.email,
    }).select("id").single();
    if (error || !s) return NextResponse.json({ error: error?.message || "Couldn't start." }, { status: 500 });
    return NextResponse.json({ session: s.id, edit_url: withCorrelation(editUrl, state) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: e instanceof CanvaError && e.noAccess ? "Canva says the shop's account can't open that design." : msg }, { status: 502 });
  }
}
