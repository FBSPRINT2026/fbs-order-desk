"use client";
import { useRouter } from "next/navigation";
import ProjectView from "@/components/ProjectView";
import PortalMessages from "@/components/PortalMessages";
import type { HubMsg } from "@/lib/messages";
import type { Project, ProjectOrder, ProjectTask } from "@/lib/projects";
import { addMyTask, setOrderProject, startProjectOrder, toggleMyTask, updateProject } from "@/app/portal/project-actions";

export default function PortalProject({ project, tasks, orders, linkable, messages, shopName, as, canAct }: {
  project: Project; tasks: ProjectTask[]; orders: ProjectOrder[]; linkable: { id: string; label: string }[]; messages: HubMsg[]; shopName: string; as?: string; canAct: boolean;
}) {
  const router = useRouter();
  return (
    <ProjectView mode="portal" project={project} tasks={tasks} orders={orders} linkable={linkable} canAct={canAct}
      messages={<PortalMessages initial={messages} orders={[]} projects={[{ id: project.id, name: project.name }]} only={`p:${project.id}`} shopName={shopName} as={as} canAct={canAct} height={480} />}
      act={{
        save: (patch) => updateProject(project.id, patch),
        addTask: (t) => addMyTask(project.id, t.title, t.due_date),
        toggleTask: (id, done) => toggleMyTask(id, done),
        link: (orderId) => setOrderProject(orderId, project.id),
        unlink: (orderId, archived) => (archived ? Promise.resolve({ ok: false, error: "Ask us to move a past order." }) : setOrderProject(orderId, null)),
        newOrder: async () => { const r = await startProjectOrder(project.id); if (r.ok && r.id) router.push(`/portal/request/${r.id}`); return r; },
        changed: () => router.refresh(),
      }} />
  );
}
