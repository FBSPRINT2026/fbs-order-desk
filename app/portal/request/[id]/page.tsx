import { redirect } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, type Design, type Garment, type Message, type Order } from "@/lib/pricing";
import RequestEditor from "./editor";

/** A customer building their own order (no prices). Once sent in it becomes read-only. */
export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string }> }) {
  const { id } = await params;
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/request/${id}`);
  const { data: o } = await ctx.db.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o || !ctx.customerIds.includes(o.customer_id)) redirect("/portal");
  const order = { ...(o as Order), groups: orderGroups(o as Order) };
  if (order.status !== "request" || order.submitted_at) redirect(`/portal/orders/${id}${as ? `?as=${as}` : ""}`);
  const admin = createAdminClient();
  const [{ data: g }, { data: d }, { data: m }] = await Promise.all([
    admin.from("garments").select("*").order("style"),
    ctx.db.from("designs").select("*").eq("customer_id", order.customer_id).is("archived_at", null).order("number", { ascending: false }),
    ctx.db.from("messages").select("*").eq("order_id", id).order("created_at"),
  ]);
  // customers never see our blank costs
  const catalog = ((g || []) as Garment[]).map((x) => ({ ...x, cost: 0, size_costs: {} }));
  const designs = (d || []) as Design[];
  const withPv = designs.filter((x) => x.preview_path);
  const urls: Record<string, string> = {};
  if (withPv.length) {
    const { data: sg } = await admin.storage.from("proofs").createSignedUrls(withPv.map((x) => x.preview_path), 3600);
    withPv.forEach((x, i) => { if (sg?.[i]?.signedUrl) urls[x.id] = sg[i].signedUrl!; });
  }
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s order request. Editing is turned off in preview.</div>}
      <RequestEditor initial={order} settings={ctx.settings} catalog={catalog} designs={designs} designUrls={urls} messages={(m || []) as Message[]} preview={!!ctx.preview} backHref={`/portal${as ? `?as=${as}` : ""}`} />
    </>
  );
}
