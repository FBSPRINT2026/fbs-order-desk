import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * "Open in FBS Order Desk" (Oct 16, Nick: a link in Printavo's production files that opens the order in the new
 * system). Printavo copies this small page when an order is sent; clicking it in Printavo opens it and it goes straight
 * to the order here (sign-in first, as always). Public, but it says nothing: the order's number and a link.
 * /pv/40070/Open-in-FBS-Order-Desk-40070.html
 */
export async function GET(_req: Request, ctx: { params: Promise<{ n: string }> }) {
  const { n } = await ctx.params;
  const num = parseInt(n, 10);
  let to = `${SITE_URL}/shop/orders`;
  if (num >= 40000 && num < 50000) {
    const { data } = await createAdminClient().from("orders").select("id").eq("number", num).maybeSingle();
    if (data?.id) to = `${SITE_URL}/shop/orders/${data.id}`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Order #${num || ""} in FBS Order Desk</title>
<meta http-equiv="refresh" content="0;url=${to}"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;padding:32px"><p>Opening order #${num || ""} in the FBS Order Desk…</p><p><a href="${to}">Open it</a></p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
