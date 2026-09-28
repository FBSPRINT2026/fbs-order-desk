import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { ST } from "@/lib/pricing";
import { withFiles } from "@/lib/messages";
import type { Project, ProjectOrder, ProjectTask } from "@/lib/projects";
import PortalProject from "./client";

/** A customer's project in their portal: dates, orders, tasks and the project conversation. */
export default async function PortalProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ as?: string }> }) {
  const { id } = await params;
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/projects/${id}`);
  if (!ctx.customerIds.length) notFound();
  const admin = createAdminClient();
  const { data: pr } = await admin.from("projects").select("*").eq("id", id).in("customer_id", ctx.customerIds).maybeSingle();
  if (!pr) notFound();
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  const [{ data: ts }, { data: os }, { data: ar }, { data: ms }] = await Promise.all([
    admin.from("project_tasks").select("*").eq("project_id", id).eq("shop_only", false).order("position"),
    admin.from("orders").select("id, number, nickname, status, type, total, due_date, project_id, submitted_at").in("customer_id", ctx.customerIds).neq("status", "quote").order("number", { ascending: false }).limit(500),
    admin.from("archived_orders").select("id, visual_id, nickname, status_name, status_color, kind, total, balance, due_date, project_id").in("customer_id", ctx.customerIds).order("order_date", { ascending: false }).limit(500),
    admin.from("messages").select("id, order_id, project_id, topic, author_type, author_name, body, created_at, read_at, attachments").eq("project_id", id).is("order_id", null).order("created_at"),
  ]);
  const visible = (os || []).filter((o) => !(o.status === "request" && !o.submitted_at));
  const inProject = visible.filter((o) => o.project_id === id).map((o) => o.id);
  const { data: pays } = inProject.length ? await admin.from("payments").select("order_id, amount").in("order_id", inProject) : { data: [] };
  const paid: Record<string, number> = {};
  (pays || []).forEach((p) => { paid[p.order_id] = (paid[p.order_id] || 0) + (+p.amount || 0); });
  const orders: ProjectOrder[] = [
    ...visible.filter((o) => o.project_id === id).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", type: o.type, statusLabel: ST[o.status as keyof typeof ST]?.portal || o.status, statusColor: ST[o.status as keyof typeof ST]?.c, total: +o.total || 0, balance: o.type === "invoice" ? (+o.total || 0) - (paid[o.id] || 0) : 0, due_date: o.due_date, href: `/portal/orders/${o.id}${qs}` })),
    ...(ar || []).filter((a) => a.project_id === id).map((a) => ({ id: a.id, number: +a.visual_id || 0, nickname: a.nickname || "", type: a.kind, statusLabel: a.status_name, statusColor: a.status_color, total: +a.total || 0, balance: 0, due_date: a.due_date, href: `/portal/archive/${a.id}${qs}`, archived: true })),
  ];
  const linkable = [
    ...visible.filter((o) => !o.project_id).map((o) => ({ id: o.id, label: `#${o.number} ${o.nickname || ""}` })),
  ];
  const signer = async (paths: string[]) => { const { data } = await admin.storage.from("proofs").createSignedUrls(paths, 3600); return (data || []).map((d) => d.signedUrl || null); };
  const messages = await withFiles((ms || []) as never[], signer);
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s project. Buttons are turned off in preview.</div>}
      <main className="p-main">
        <Link className="back" href={`/portal${qs}${qs ? "&" : "?"}area=projects`}>← Projects</Link>
        <PortalProject project={pr as Project} tasks={(ts || []) as ProjectTask[]} orders={orders} linkable={linkable} messages={messages} shopName={ctx.settings.shop.name} as={ctx.preview?.id} canAct={!ctx.preview} />
      </main>
    </>
  );
}
