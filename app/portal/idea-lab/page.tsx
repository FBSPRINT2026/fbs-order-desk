import { Suspense } from "react";
import { getPortalCtx } from "@/lib/portal";
import DesignerStudio from "@/components/DesignerStudio";

/** The customer's Idea Lab: text, clip art and their pictures, saved to their logos. */
export default async function PortalDesigner({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/idea-lab");
  const q = as ? `?as=${as}` : "";
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s Idea Lab. Saving works from the customer&apos;s own login.</div>}
      <main className="p-main mk-portal">
        <Suspense fallback={<div className="empty">Loading…</div>}><DesignerStudio portal backHref={`/portal${q}${q ? "&" : "?"}area=artwork`} mockupHref={`/portal/mockup${q}`} /></Suspense>
      </main>
    </>
  );
}
