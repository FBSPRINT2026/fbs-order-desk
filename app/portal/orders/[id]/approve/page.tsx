import { notFound, redirect } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { proofLinkFor } from "@/lib/proofLinks";

export const dynamic = "force-dynamic";

/**
 * "Review and approve" from anywhere in the portal (Nov 2, Nick: "it should open the same exact dialogue that opens on
 * the email… you view the proof and then you review the quote"): the order's own review page, the one our email's button
 * opens (/proof/<link>, app/proof/[id]), made for the order if it wasn't sent yet. Every portal link to approve something
 * on an order comes here (lib/portalApprove.ts approveHref).
 */
export default async function ApproveOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string }> }) {
  const { id } = await params;
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/orders/${id}/approve`);
  const { data: od } = await ctx.db.from("orders").select("id").eq("id", id).in("customer_id", ctx.customerIds.length ? ctx.customerIds : ["00000000-0000-0000-0000-000000000000"]).maybeSingle();
  if (!od) notFound();
  const link = await proofLinkFor(createAdminClient(), { kind: "order", orderId: id, by: ctx.isStaff ? "portal preview" : "portal" });
  redirect(`/proof/${link}?from=portal${ctx.preview ? `&as=${ctx.preview.id}` : ""}`);
}
