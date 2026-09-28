"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useShopData } from "@/lib/shopData";
import { custLabel } from "@/lib/format";
import { ST } from "@/lib/pricing";
import ProjectView from "@/components/ProjectView";
import ShopMessages from "@/components/ShopMessages";
import type { Project, ProjectOrder, ProjectTask } from "@/lib/projects";

/** Staff view of a project: everything the customer sees, plus status, shop-only tasks and linking orders (old Printavo ones too). */
export default function ShopProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sb = createClient();
  const { orders: all, customers, settings } = useShopData();
  const [p, setP] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [arch, setArch] = useState<{ id: string; visual_id: string; nickname: string; status_name: string; status_color: string; kind: string; total: number; balance: number; due_date: string | null; project_id: string | null }[]>([]);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    const { data } = await sb.from("projects").select("*").eq("id", id).maybeSingle();
    if (!data) { setMissing(true); return; }
    setP(data as Project);
    const [{ data: ts }, { data: ar }] = await Promise.all([
      sb.from("project_tasks").select("*").eq("project_id", id).order("position"),
      sb.from("archived_orders").select("id, visual_id, nickname, status_name, status_color, kind, total, balance, due_date, project_id").eq("customer_id", data.customer_id).order("order_date", { ascending: false }).limit(500),
    ]);
    setTasks((ts || []) as ProjectTask[]);
    setArch((ar || []) as never);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const [links, setLinks] = useState<Record<string, string | null>>({});
  if (missing) return <><Link className="back" href="/shop/projects">← Projects</Link><div className="empty">This project doesn&apos;t exist.</div></>;
  if (!p) return <div className="empty">Loading…</div>;
  const cust = customers[p.customer_id];
  const mine = all.filter((o) => o.customer_id === p.customer_id);
  const projOf = (o: { id: string; project_id?: string | null }) => (o.id in links ? links[o.id] : (o as { project_id?: string | null }).project_id ?? null);
  const inProj: ProjectOrder[] = [
    ...mine.filter((o) => projOf(o as never) === id).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname || "", type: o.type, statusLabel: ST[o.status]?.label || o.status, statusColor: ST[o.status]?.c, total: o.total, balance: o.type === "invoice" ? o.balance : 0, due_date: o.due_date, href: `/shop/orders/${o.id}` })),
    ...arch.filter((a) => a.project_id === id).map((a) => ({ id: a.id, number: +a.visual_id || 0, nickname: a.nickname, type: a.kind, statusLabel: a.status_name, statusColor: a.status_color, total: +a.total || 0, balance: 0, due_date: a.due_date, href: `/shop/archive/${a.id}`, archived: true })),
  ];
  const linkable = [
    ...mine.filter((o) => !projOf(o as never)).map((o) => ({ id: o.id, label: `#${o.number} ${o.nickname || ""}${o.type === "quote" ? " (quote)" : ""}` })),
    ...arch.filter((a) => !a.project_id).map((a) => ({ id: a.id, label: `#${a.visual_id} ${a.nickname || ""} (archived)`, archived: true })),
  ];
  const ok = (e: { message: string } | null) => (e ? { ok: false, error: e.message } : { ok: true });
  return (
    <>
      <Link className="back" href="/shop/projects">← Projects</Link>
      <div style={{ marginTop: 10 }}>
        <ProjectView mode="shop" project={p} tasks={tasks} orders={inProj} linkable={linkable} company={custLabel(cust)} customerHref={`/shop/customers/${p.customer_id}`}
          messages={<ShopMessages customerId={p.customer_id} customerName={cust?.name || custLabel(cust)} orders={[]} projects={[{ id: p.id, name: p.name }]} only={`p:${p.id}`} shopName={settings.shop.name} height={480} />}
          act={{
            save: async (patch) => ok((await sb.from("projects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id)).error),
            addTask: async (t) => ok((await sb.from("project_tasks").insert({ project_id: id, title: t.title.trim().slice(0, 200), due_date: t.due_date, who: t.who, shop_only: t.shop_only, position: Date.now() % 2147483647 })).error),
            toggleTask: async (tid, done) => { const { data: u } = await sb.auth.getUser(); return ok((await sb.from("project_tasks").update({ done_at: done ? new Date().toISOString() : null, done_by: done ? u.user?.email || "shop" : "" }).eq("id", tid)).error); },
            deleteTask: async (tid) => ok((await sb.from("project_tasks").delete().eq("id", tid)).error),
            link: async (oid, archived) => { const r = ok((await sb.from(archived ? "archived_orders" : "orders").update({ project_id: id }).eq("id", oid)).error); if (r.ok && !archived) setLinks((l) => ({ ...l, [oid]: id })); return r; },
            unlink: async (oid, archived) => { const r = ok((await sb.from(archived ? "archived_orders" : "orders").update({ project_id: null }).eq("id", oid)).error); if (r.ok && !archived) setLinks((l) => ({ ...l, [oid]: null })); return r; },
            newOrder: async () => {
              const { data, error } = await sb.from("orders").insert({ customer_id: p.customer_id, tax_exempt: !!cust?.tax_exempt, price_type: cust?.price_type || "retail", project_id: id, nickname: p.name.slice(0, 120), due_date: p.in_hands_date }).select("id").single();
              if (error) return { ok: false, error: error.message };
              router.push(`/shop/orders/${data.id}?new=1`); return { ok: true };
            },
            changed: load,
          }} />
      </div>
    </>
  );
}
