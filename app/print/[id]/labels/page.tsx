import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadJobCard } from "@/lib/jobCard";
import { boxLabelSvg } from "@/lib/zpl";
import LabelControls from "./LabelControls";

export const dynamic = "force-dynamic";

/**
 * Box labels to print from the browser (when the Zebra isn't handy): the very same label the Zebra prints, drawn by
 * the one layout (`drawBoxLabel` in lib/zpl.ts; Nick, Nov 16 2026: the scanners read the QR, so no barcode). One per
 * box, BOX ___ OF ___ to write in.
 */
export default async function LabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ boxes?: string; size?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=/print/${id}/labels`);
  if (!isStaff) notFound();
  const card = await loadJobCard(createAdminClient(), { kind: "o", id });
  if (!card) notFound();
  const svg = boxLabelSvg(card, 0, 0);
  const boxes = Math.min(50, Math.max(1, parseInt(sp.boxes || "1", 10) || 1));
  const size = sp.size === "letter" ? "letter" : "4x6";
  return (
    <div className="labels-page">
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        .labels-page { background: #e9edf2; min-height: 100%; padding: 16px 16px 40px; }
        .lbl { width: 4in; height: 6in; margin: 0 auto 16px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.12); }
        .lbl svg { width: 100%; height: 100%; display: block; }
        @media print { .labels-page { background: #fff; padding: 0; } .no-print { display: none !important; } .lbl { box-shadow: none; margin: 0; page-break-after: always; break-after: page; } }
      `}</style>
      <LabelControls boxes={boxes} size={size} job={{ kind: "o", id }} />
      {Array.from({ length: boxes }, (_, i) => <div key={i} className="lbl" dangerouslySetInnerHTML={{ __html: svg }} />)}
    </div>
  );
}
