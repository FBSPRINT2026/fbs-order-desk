import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadJobCard, parseJobCode } from "@/lib/jobCard";
import { qrSvg } from "@/lib/qr";
import { code128Svg } from "@/lib/barcode";
import { jobLink } from "@/lib/zpl";
import PrintButton from "../../[id]/PrintButton";

export const dynamic = "force-dynamic";

/**
 * A job ticket for any job (Printavo jobs too): the job's QR code (its phone menu: press setup, notes, photos, box
 * labels, time) and barcode, big enough to scan from across the press. Half a letter sheet.
 */
export default async function JobTicket({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { user, isStaff } = await getViewer();
  if (!user) redirect(`/login?next=/print/job/${code}`);
  if (!isStaff) notFound();
  const ref = parseJobCode(code);
  const card = ref ? await loadJobCard(createAdminClient(), { number: ref.number }) : null;
  if (!card) notFound();
  const bc = code128Svg(card.number, 40);
  const day = (d: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "—");
  return (
    <div style={{ background: "#fff", minHeight: "100%", color: "#141D2B", fontFamily: "Helvetica, Arial, sans-serif" }}>
      <style>{`@page { size: 8.5in 11in; margin: 0.4in; } @media print { .print-bar { display: none } }`}</style>
      <div className="print-bar"><PrintButton /></div>
      <div style={{ maxWidth: "7.6in", margin: "0 auto", border: "3px solid #141D2B", borderRadius: 10, padding: "0.3in", display: "grid", gridTemplateColumns: "1fr 2.4in", gap: "0.3in", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: "#5A6478" }}>Job ticket{card.rush ? " · RUSH" : ""}</div>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1 }}>#{card.number}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{card.customer}</div>
          <div style={{ fontSize: 17, marginTop: 2 }}>{card.name}</div>
          <div style={{ fontSize: 15, marginTop: 10 }}><b>{card.qty} pcs</b> · In hands <b>{day(card.due)}</b>{card.po ? ` · PO ${card.po}` : ""}</div>
          <div style={{ marginTop: 14, width: `${(bc.width * 1.6) / 96}in`, height: "0.55in" }} dangerouslySetInnerHTML={{ __html: bc.svg }} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: "2.4in", height: "2.4in" }} dangerouslySetInnerHTML={{ __html: qrSvg(jobLink(card.number), 2).svg }} />
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>Scan with your phone: press setup, notes, photos, box labels, time</div>
        </div>
      </div>
    </div>
  );
}
