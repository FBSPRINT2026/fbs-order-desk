import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Canva, CanvaError, accountFor, canvaEnv, samePath, withCorrelation } from "@/lib/canva/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST: Design with Canva from the Mockup Creator (staff, or a customer in their portal). Makes a blank Canva design
 * sized for the side's print area (300 pixels an inch, less when Canva's size limits need it), or opens one of our
 * Canva-made designs again ({ from_design }), and records the trip. Answers Canva's editor link carrying our
 * correlation_state, so Return in Canva comes back through /api/canva/return to the right mockup.
 *
 * Whose Canva account: the person's own (canva_accounts) when connected; else the shop's for staff; else
 * { needs_connect: true } (Canva's editor links only work for the account that owns the design).
 * Customers: always their own customer record and their own designs; back to a /portal/ page.
 *   body: { side, location, w_in, h_in, customer_id (staff), order_id?, group_id?, im_id?, return_to, from_design? }
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient();
  if (!canvaEnv().configured) return NextResponse.json({ error: "Canva isn't set up here yet." }, { status: 400 });
  const str = (k: string, n = 200) => String(b[k] ?? "").slice(0, n);
  const uuid = (k: string) => (/^[0-9a-f-]{36}$/i.test(str(k)) ? str(k) : null);
  let customerId: string | null;
  if (v.isStaff) customerId = uuid("customer_id");
  else { const { data: cs } = await v.supabase.from("customers").select("id").limit(1); customerId = (cs?.[0]?.id as string) || null; }
  if (!customerId) return NextResponse.json({ error: v.isStaff ? "Pick the customer first. The design is saved to their account." : "We couldn't find your account." }, { status: 400 });
  const account = await accountFor(admin, { userId: v.user.id, isStaff: v.isStaff });
  if (!account) return NextResponse.json({ error: "Sign in to your Canva account, or make a free one, to design here.", needs_connect: true }, { status: 409 });
  // where to come back to: a page on this site (staff: /shop/…, customers: /portal/…)
  const area = v.isStaff ? "/shop/" : "/portal/";
  let returnTo = v.isStaff ? "/shop/artwork/mockup" : "/portal/mockup";
  const want = samePath(str("return_to", 2000));
  if (want.startsWith(area)) { const u = new URL(want, "https://x.invalid"); u.searchParams.delete("canva"); u.searchParams.delete("canva_connected"); u.searchParams.delete("canva_error"); returnTo = u.pathname + u.search; }
  const c = new Canva(admin, account);
  try {
    let designId = "", editUrl = "", fromDesign: string | null = null;
    const wIn = Math.max(1, Math.min(30, Number(b.w_in) || 12)), hIn = Math.max(1, Math.min(30, Number(b.h_in) || 14));
    if (uuid("from_design")) {
      const { data: d } = await admin.from("designs").select("id, name, customer_id, canva_design_id").eq("id", uuid("from_design")!).maybeSingle();
      if (!d || (!v.isStaff && d.customer_id !== customerId)) return NextResponse.json({ error: "We couldn't find that design." }, { status: 404 });
      if (!d.canva_design_id) return NextResponse.json({ error: "That design didn't come from Canva." }, { status: 400 });
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
      correlation_state: state, design_id: designId, customer_id: customerId, order_id: v.isStaff ? uuid("order_id") : null, group_id: str("group_id", 80),
      side: str("side", 20), location: str("location", 60), im_id: str("im_id", 80), width_in: wIn, height_in: hIn,
      return_to: returnTo, status: "editing", from_design: fromDesign, created_by: v.email, user_id: v.user.id, account: account.kind,
    }).select("id").single();
    if (error || !s) return NextResponse.json({ error: error?.message || "Couldn't start." }, { status: 500 });
    return NextResponse.json({ session: s.id, edit_url: withCorrelation(editUrl, state) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof CanvaError && /not connected|refused the sign-in/i.test(msg) && account.kind === "user") return NextResponse.json({ error: "Your Canva sign-in has ended. Sign in to Canva again.", needs_connect: true }, { status: 409 });
    return NextResponse.json({ error: e instanceof CanvaError && e.noAccess ? "Canva says your Canva account can't open that design." : msg }, { status: 502 });
  }
}
