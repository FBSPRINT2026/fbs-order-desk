"use client";
import { useEffect, useState } from "react";
import { useShopData } from "@/lib/shopData";
import { custLabel } from "@/lib/format";
import ProjectList from "@/components/ProjectList";
import type { ProjectSummary } from "@/lib/projects";
import { createProjectAsStaff, loadSummaries } from "@/lib/projectsClient";

/** Staff: every customer's projects, upcoming first. */
export default function ProjectsPage() {
  const { customers, loading } = useShopData();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => { loadSummaries().then(setList); }, [reload]);
  if (loading || !list) return <div className="empty">Loading…</div>;
  const withCo = list.map((p) => ({ ...p, company: custLabel(customers[p.customer_id]) }));
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{withCo.filter((p) => p.status === "planning" || p.status === "active").length} open</div><h1>Projects</h1></div></div>
      <ProjectList mode="shop" projects={withCo} hrefOf={(id) => `/shop/projects/${id}`}
        customers={Object.values(customers).map((c) => ({ id: c.id, label: custLabel(c) })).sort((a, b) => a.label.localeCompare(b.label))}
        onCreate={async (f) => { const r = await createProjectAsStaff(f); setReload((n) => n + 1); return r; }} />
    </>
  );
}

