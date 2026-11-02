"use client";
import ProjectList from "@/components/ProjectList";
import ProjectsOverview from "@/components/ProjectsOverview";
import { createProject } from "@/app/portal/project-actions";
import type { ProjectSummary } from "@/lib/projects";

/** The customer's Projects tab: the overview (numbers, timeline, calendar) over the project cards (Nov 2, Nick). */
export default function PortalProjects({ projects, qs, canAct }: { projects: ProjectSummary[]; qs: string; canAct: boolean }) {
  const hrefOf = (id: string) => `/portal/projects/${id}${qs}`;
  const orderHref = (id: string) => `/portal/orders/${id}${qs}`;
  return <>
    <ProjectsOverview projects={projects} hrefOf={hrefOf} orderHref={orderHref} />
    <ProjectList mode="portal" projects={projects} canAct={canAct} hrefOf={hrefOf} orderHref={orderHref} onCreate={(p) => createProject(p)} />
  </>;
}
