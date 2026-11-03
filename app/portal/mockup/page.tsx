import { Suspense } from "react";
import { getPortalCtx } from "@/lib/portal";
import MockupBuilder from "@/components/MockupBuilder";
import PortalTour from "@/components/PortalTour";
import { tourDue } from "@/lib/portalTour";

/** The customer's own Mockup Creator: their logos on any garment, saved to their artwork. */
export default async function PortalMockup({ searchParams }: { searchParams: Promise<{ as?: string; tour?: string }> }) {
  const { as, tour } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/mockup");
  // back to the home dashboard (Oct 24, Nick: "I click go back to dashboard, it takes you to artwork")
  const back = `/portal${as ? `?as=${as}` : ""}`;
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s Mockup Creator. Saving works from the customer&apos;s own login.</div>}
      <main className="p-main mk-portal">
        <Suspense fallback={<div className="empty">Loading…</div>}><MockupBuilder portal backHref={back} /></Suspense>
      </main>
      {/* its walk-through: by itself the first time each person opens it (and after the shop's Reset tutorial), or ?tour=1 */}
      <PortalTour view="mockup" auto={tour === "1" || (!ctx.preview && await tourDue(ctx.email, "mockup", (ctx.customers[0] as { tour_reset_at?: string | null } | undefined)?.tour_reset_at))} />
    </>
  );
}
