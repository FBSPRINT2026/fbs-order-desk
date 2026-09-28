"use client";
import { useEffect, useState } from "react";
import ProjectList from "@/components/ProjectList";
import { createProjectAsStaff, loadSummaries } from "@/lib/projectsClient";
import type { ProjectSummary } from "@/lib/projects";

/** A customer's projects on their page in the shop. */
export default function ShopCustomerProjects({ customerId, label, onCount }: { customerId: string; label: string; onCount?: (n: number) => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { loadSummaries(customerId).then((l) => { setList(l); onCount?.(l.filter((p) => p.status === "planning" || p.status === "active").length); }); }, [customerId, n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <div className="gb-empty">Loading…</div>;
  return <ProjectList mode="shop" projects={list} hrefOf={(id) => `/shop/projects/${id}`} customers={[{ id: customerId, label }]} onCreate={async (f) => { const r = await createProjectAsStaff({ ...f, customer_id: customerId }); setN((x) => x + 1); return r; }} />;
}
