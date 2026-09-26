import { Suspense } from "react";
import { getPortalCtx } from "@/lib/portal";
import MockupBuilder from "@/components/MockupBuilder";

/** The customer's own mockup builder: their logos on any garment, saved to their artwork. */
export default async function PortalMockup({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/mockup");
  const back = `/portal${as ? `?as=${as}` : ""}`;
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s mockup builder. Saving works from the customer&apos;s own login.</div>}
      <main className="p-main mk-portal">
        <Suspense fallback={<div className="empty">Loading…</div>}><MockupBuilder portal backHref={`${back}${back.includes("?") ? "&" : "?"}area=artwork`} /></Suspense>
      </main>
    </>
  );
}
