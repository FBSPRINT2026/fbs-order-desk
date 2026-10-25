import { redirect } from "next/navigation";
import { oneOfEach } from "@/lib/mockupList";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, type Design, type Garment, type Message, type Order } from "@/lib/pricing";
import RequestEditor from "./editor";
import type { NeckLabelSet } from "@/lib/neckLabels";
import { hasAiKey } from "@/lib/ai/claude";

/** reading an uploaded PO with the AI can take a minute (Oct 24: Upload a PO) */
export const maxDuration = 120;

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
  const [{ data: g }, { data: d }, { data: m }, { data: gd }] = await Promise.all([
    admin.from("garments").select("*").order("style"),
    ctx.db.from("designs").select("*").eq("customer_id", order.customer_id).is("archived_at", null).eq("draft", false).order("number", { ascending: false }),
    ctx.db.from("messages").select("*").eq("order_id", id).order("created_at"),
    ctx.db.from("order_goods").select("supplier, supplier_po, ship_date").eq("order_id", id).maybeSingle(),
  ]);
  // customers never see our blank costs
  const catalog = ((g || []) as Garment[]).map((x) => ({ ...x, cost: 0, size_costs: {}, color_size_costs: {} }));
  // logos made for this order (drafts: not in the library yet) come along so its prints show (Oct 24)
  const usedIds = [...new Set(order.groups.flatMap((x) => x.imprints.map((im) => im.design_id).filter(Boolean) as string[]))].filter((x) => !(d || []).some((y) => y.id === x));
  const { data: dd } = usedIds.length ? await ctx.db.from("designs").select("*").eq("customer_id", order.customer_id).in("id", usedIds) : { data: [] };
  const designs = [...(d || []), ...(dd || [])] as Design[];
  const withPv = designs.filter((x) => x.preview_path);
  const urls: Record<string, string> = {};
  if (withPv.length) {
    const { data: sg } = await admin.storage.from("proofs").createSignedUrls(withPv.map((x) => x.preview_path), 3600);
    withPv.forEach((x, i) => { if (sg?.[i]?.signedUrl) urls[x.id] = sg[i].signedUrl!; });
  }
  // mockups: ones already attached to this order, and the customer's saved ones they can attach
  const { data: saved } = await admin.from("mockups").select("id,title,file_path,created_at,number,order_id,shelved_at").eq("customer_id", order.customer_id).is("archived_at", null).eq("draft", false).order("created_at", { ascending: false }).limit(60);
  const savedList = oneOfEach((saved || []) as { id: string; title: string; file_path: string; created_at: string; number: number | null; order_id: string | null; shelved_at: string | null }[]);
  // their saved mockups to pick for a group (Oct 24, Nick: "choose a mock-up from the one that they've created"): one per
  // set, not ones on an order or archived
  const pickSets = savedList.filter((m, i, all) => !m.order_id && !m.shelved_at && (!m.number || all.findIndex((x) => x.number === m.number && !x.order_id) === i)).slice(0, 24);
  const { data: pickSg } = pickSets.length ? await admin.storage.from("proofs").createSignedUrls(pickSets.map((m) => m.file_path.replace(/\.png$/, "-thumb.png")), 3600) : { data: [] };
  const pickMockups = pickSets.map((m, i) => ({ id: m.id, number: m.number, name: m.title.split(" — ")[0], colors: savedList.filter((x) => m.number && x.number === m.number && !x.order_id).length || 1, when: m.created_at, thumb: pickSg?.[i]?.signedUrl || "" }));
  const paths = [...new Set([...order.groups.flatMap((g) => [...(g.customerMockups || []).map((m) => m.path), ...(g.mockupThumbs || []), ...(g.tagArt ? [g.tagArt.path] : []), ...g.imprints.map((d) => d.shownArt || "").filter(Boolean)]), ...savedList.map((m) => m.file_path)])];
  const mockupUrls: Record<string, string> = {};
  if (paths.length) {
    const { data: sg } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
    paths.forEach((p, i) => { if (sg?.[i]?.signedUrl) mockupUrls[p] = sg[i].signedUrl!; });
  }
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s order request. Editing is turned off in preview.</div>}
      <RequestEditor neckSets={((ctx.customers.find((c) => c.id === order.customer_id) || ctx.customers[0]) as unknown as { neck_labels?: NeckLabelSet[] } | undefined)?.neck_labels || []} initial={order} settings={ctx.settings} catalog={catalog} designs={designs} designUrls={urls} messages={(m || []) as Message[]} savedMockups={savedList.map((m) => ({ path: m.file_path, name: m.title }))} pickMockups={pickMockups} mockupUrls={mockupUrls} mockupHref={`/portal/mockup${as ? `?as=${as}` : ""}`} preview={!!ctx.preview} goodsInfo={order.price_type === "wholesale" ? { supplier: gd?.supplier || "", supplier_po: gd?.supplier_po || "", ship_date: gd?.ship_date || null } : null} aiAssist={hasAiKey() && ctx.settings.assistant.ai.enabled && ctx.settings.assistant.ai.customerAssist} backHref={`/portal${as ? `?as=${as}` : ""}`} />
    </>
  );
}
