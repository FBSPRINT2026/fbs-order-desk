import Link from "next/link";
import { notFound } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { inkNames, lineQty, orderGroups, sizeLabel, SIZES, type Order, withoutShopPieces } from "@/lib/pricing";
import { guessHex } from "@/lib/mockup";
import { fmtStamp } from "@/lib/format";
import { threadByName } from "@/lib/embroidery";
import { printOf, sewoutViewed, type Sewout } from "@/lib/sewouts";
import SewoutDecision from "./SewoutDecision";

/**
 * The customer's sew-out approval (Oct 24, Nick: "here's your sew out… you approve that, on file for future
 * reference"): the photo of the real stitched logo, what it is (where it goes, size, threads, stitches, the garments),
 * and approve (their typed name) or ask for changes. The same thing as a PDF from "Download the PDF".
 */
export default async function SewoutReview({ params, searchParams }: { params: Promise<{ id: string; sid: string }>; searchParams: Promise<{ as?: string }> }) {
  const { id, sid } = await params;
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/orders/${id}/sewout/${sid}`);
  const { data: od } = await ctx.db.from("orders").select("*").eq("id", id).in("customer_id", ctx.customerIds.length ? ctx.customerIds : ["00000000-0000-0000-0000-000000000000"]).maybeSingle();
  if (!od) notFound();
  const o = withoutShopPieces(od as Order); // the customer's view: never the shop's own pieces (lib/pricing.ts withoutShopPieces)
  const admin = createAdminClient();
  const { data: sw } = await admin.from("sewouts").select("*").eq("id", sid).eq("order_id", id).maybeSingle();
  if (!sw) notFound();
  const s = sw as Sewout;
  if (!ctx.isStaff && !s.archived_at) await sewoutViewed(admin, s.id).catch(() => null);
  const { data: newer } = s.archived_at ? await admin.from("sewouts").select("id").eq("order_id", id).eq("imprint_id", s.imprint_id).is("archived_at", null).maybeSingle() : { data: null };
  const pr = printOf(o, s.imprint_id);
  const g = pr?.g || orderGroups(o)[0];
  const im = pr?.im;
  const { data: des } = im?.design_id ? await admin.from("designs").select("number, name").eq("id", im.design_id).maybeSingle() : { data: null };
  const { data: su } = await admin.storage.from("proofs").createSignedUrl(s.photo_path, 3600);
  const photo = su?.signedUrl || "";
  const lines = (g?.lines || []).filter((l) => lineQty(l) > 0);
  const threads = im ? inkNames(im.inks) : [];
  const qs = as ? `?as=${as}` : "";
  const pending = s.status === "pending" && !s.archived_at;

  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s sew-out approval. Buttons are turned off in preview.</div>}
      <main className="p-main ar">
        <Link className="back" href={`/portal/orders/${id}${qs}`}>← Order #{o.number}</Link>
        <div className="page-head" style={{ margin: 0 }}><div><h1>Approve your sew-out</h1>
          <div className="muted" style={{ marginTop: 10 }}>{g?.name || o.nickname || `Order #${o.number}`} · version {s.version}{s.sent_at ? ` · sent ${fmtStamp(s.sent_at)}` : ""} · this is your logo stitched on our machine. Check it, then tell us how to go ahead.</div></div></div>
        {newer && <div className="ar-ann" style={{ marginTop: 12 }}>There&apos;s a newer sew-out of this logo. <Link href={`/portal/orders/${id}/sewout/${newer.id}${qs}`}>See the newest one</Link>.</div>}

        <div className="ar-grid">
          <section className="panel ar-dec">
            <div className="panel-h"><h2>Your decision</h2></div>
            <div className="panel-b">
              {pending
                ? <SewoutDecision id={s.id} orderId={o.id} disabled={!!ctx.preview} />
                : <div className={"ar-done " + s.status}>
                    <b>{s.status === "approved" ? "Approved" : s.status === "changes" ? "Changes requested" : "Replaced by a newer sew-out"}</b>
                    {s.decided_name && <span>{s.decided_name}{s.decided_at ? ` · ${fmtStamp(s.decided_at)}` : ""}</span>}
                    {s.customer_comment && <p>{s.customer_comment}</p>}
                    {s.status !== "pending" && <span className="muted">{s.status === "approved" ? "We'll run your order. This sew-out is kept on file for reorders." : "We'll fix it and send you a new sew-out."}</span>}
                  </div>}
              <a className="btn sm" style={{ marginTop: 12 }} href={`/print/${o.id}?sewout=${s.id}`} target="_blank" rel="noreferrer">Download the PDF</a>
            </div>
          </section>

          <section className="panel ar-view">
            <div className="panel-h"><h2>Sew-out</h2></div>
            <div className="panel-b">
              <div className="ar-stage">
                <a className="ar-mk" href={photo || undefined} target="_blank" rel="noreferrer" title="Open full size">{photo ? <img src={photo} alt="Your sew-out" /> : <span className="muted">No picture</span>}</a>
                <div className="ar-side">
                  {im && <div className="ar-gar">
                    <b>{im.location || "Embroidery"}</b>
                    <div className="muted">{[im.size, im.stitches ? `${im.stitches.toLocaleString()} stitches` : "", des ? `D-${des.number}${des.name ? ` · ${des.name}` : ""}` : ""].filter(Boolean).join(" · ")}</div>
                  </div>}
                  {threads.length > 0 && <div className="ar-gar"><b>Thread colors</b>
                    {threads.map((k) => { const t = threadByName(k); return <div className="ar-c" key={k}><span className="ar-sw" style={{ background: t?.hex || "#ccc" }} />{k}{t?.pms[0] ? <small className="muted" style={{ whiteSpace: "nowrap" }}> · PMS {t.pms[0].replace(/^PMS\s*/i, "")}</small> : null}</div>; })}
                  </div>}
                  {lines.map((l) => (
                    <div className="ar-gar" key={l.id}>
                      <b>{[l.brand, l.style].filter(Boolean).join(" ")}{l.garment ? ` · ${l.garment}` : ""}</b>
                      <div className="ar-c"><span className="ar-sw" style={{ background: guessHex(l.color) }} />{l.color}</div>
                      <div className="ar-chips">{SIZES.filter((z) => l.sizes?.[z]).map((z) => <span key={z}>{sizeLabel(z)} <b>{l.sizes[z]}</b></span>)}</div>
                    </div>
                  ))}
                  {s.note && <div className="ar-ann"><b>A note from us:</b> {s.note}</div>}
                  <div className="ar-check"><b>Check before you approve</b><span>✓ Spelling of every word</span><span>✓ Thread colors</span><span>✓ The size</span><span>✓ Small details are clear</span></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
