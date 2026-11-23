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
export default async function LabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ boxes?: string; size?: string; a?: string; known?: string; only?: string; go?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=/print/${id}/labels${sp.a ? "?a=1" : ""}`);
  if (!isStaff) notFound();
  // ?a=1: an old Printavo job still being finished (archived_orders; Nov 18, Nick: "a box label… next to reorder")
  const kind: "o" | "a" = sp.a ? "a" : "o";
  const card = await loadJobCard(createAdminClient(), { kind, id });
  if (!card) return notFound();
  const boxes = Math.min(99, Math.max(1, parseInt(sp.boxes || "1", 10) || 1));
  // "I know my box count": each label says its own box ("BOX 3 OF 40"), or only the one box being reprinted
  const known = sp.known === "1", only = known ? Math.min(boxes, Math.max(0, parseInt(sp.only || "0", 10) || 0)) : 0;
  // the labels are all alike (BOX ___ OF ___), so a page opened to print by hand shows one, and how many is the print
  // window's own Copies: one count, asked once (Nick, Nov 23 2026: 40 here, then 40 copies there, made 1,600). Outbound's
  // Print button (?go=1) still sends all of them, counted on its own screen, with Copies left at 1.
  const nums = known ? (only ? [only] : Array.from({ length: boxes }, (_, i) => i + 1)) : Array.from({ length: sp.go === "1" ? boxes : 1 }, () => 0);
  const blank = boxLabelSvg(card, 0, 0);
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
      {/* ?go=1: opened from Outbound's Print button just to print (a hidden frame): no controls (Nick, Nov 23 2026) */}
      {sp.go !== "1" && <LabelControls boxes={boxes} size={size} job={{ kind, id }} />}
      {nums.map((b, i) => <div key={i} className="lbl" dangerouslySetInnerHTML={{ __html: b ? boxLabelSvg(card, b, boxes) : blank }} />)}
    </div>
  );
}
