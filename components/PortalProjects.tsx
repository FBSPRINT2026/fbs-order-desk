"use client";
import ProjectList from "@/components/ProjectList";
import { createProject } from "@/app/portal/project-actions";
import type { ProjectSummary } from "@/lib/projects";

/** The customer's Projects tab. */
export default function PortalProjects({ projects, qs, canAct }: { projects: ProjectSummary[]; qs: string; canAct: boolean }) {
  return <ProjectList mode="portal" projects={projects} canAct={canAct} hrefOf={(id) => `/portal/projects/${id}${qs}`} onCreate={(p) => createProject(p)} />;
}
