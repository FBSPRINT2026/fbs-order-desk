import { proofViewed } from "@/lib/proofs";
import BackLink from "@/components/BackLink";
import { notFound } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { inkNames, isPmsInk, lineQty, sizeLabel, FULL_COLOR, METHODS, SIZES, type Order, type Proof, withoutShopPieces } from "@/lib/pricing";
import { colorHex, WILFLEX_HEX } from "@/lib/inkColors";
import { guessHex, lineColor } from "@/lib/mockup";
import { fmtStamp } from "@/lib/format";
import { orderGroups } from "@/lib/pricing";
import { loadGroupLook, printSize } from "@/lib/groupLook";
import ReviewDecision from "./ReviewDecision";

/**
 * The customer's art review (Oct 15, Nick): the shirt and every print as they are in the Mockup Creator (the inks,
 * the size on the shirt with its measurements), and a panel to approve, approve with changes, or make changes
 * (tell us, or change it themselves in their Mockup Creator).
 */
export default async function ReviewArt({ params, searchParams }: { params: Promise<{ id: string; proofId: string }>; searchParams: Promise<{ as?: string }> }) {
  const { id, proofId } = await params;
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, `/portal/orders/${id}/review/${proofId}`);
  const { data: od } = await ctx.db.from("orders").select("*").eq("id", id).in("customer_id", ctx.customerIds.length ? ctx.customerIds : ["00000000-0000-0000-0000-000000000000"]).maybeSingle();
  if (!od) notFound();
  const o = withoutShopPieces(od as Order); // the customer's view: never the shop's own pieces (lib/pricing.ts withoutShopPieces)
  const { data: pf } = await ctx.db.from("proofs").select("*").eq("id", proofId).eq("order_id", id).is("archived_at", null).maybeSingle();
  if (!pf) notFound();
  const proof = pf as Proof;
  const admin = createAdminClient();
  const { data: mk } = (proof as Proof & { mockup_id?: string | null }).mockup_id
    ? await admin.from("mockups").select("group_id").eq("id", (proof as Proof & { mockup_id?: string | null }).mockup_id!).maybeSingle()
    : await admin.from("mockups").select("group_id").eq("proof_id", proofId).maybeSingle();
  if (!ctx.isStaff) await proofViewed(admin, id, proofId).catch(() => null);
  const groups = orderGroups(o);
  const g = groups.find((x) => x.id === mk?.group_id) || groups[0];
  if (!g) notFound();
  const { designs, hexes, maxes, shownSizes } = await loadGroupLook(admin, [g]);
  const hex = hexes[0], shownOn = shownSizes[0];
  const qs = as ? `?as=${as}` : "";
  const back = `/portal/orders/${id}${qs}`;

  // the pictures: the shirt (photos only) big, the full proof sheet behind "See the full proof"; each logo
  const big = g.mockupThumbs?.[0] || "";
  const dz = Object.values(designs).filter((d) => d.preview_path);
  const paths = [proof.file_path, ...(big ? [big] : []), ...dz.map((d) => d.preview_path)];
  const { data: su } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
  const url = (p: string) => su?.[paths.indexOf(p)]?.signedUrl || "";
  const fullUrl = url(proof.file_path), bigUrl = big ? url(big) : fullUrl;
  const dUrl: Record<string, string> = Object.fromEntries(dz.map((d) => [d.id, url(d.preview_path)]));

  const lines = g.lines.filter((l) => lineQty(l) > 0);
  const total = lines.reduce((a, l) => a + lineQty(l), 0);
  const pending = proof.status === "pending";
  const sent = new Date(proof.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s art review. Buttons are turned off in preview.</div>}
      <main className="p-main ar">
        <BackLink href={back} label={`Order #${o.number}`} trail={false} />
        <div className="page-head" style={{ margin: 0 }}><div><h1>Review your artwork</h1>
          <div className="muted" style={{ marginTop: 10 }}>{g.name || o.nickname} · proof sent {sent} · look over the shirt, every print and its size, then tell us how to go ahead.</div></div></div>

        <div className="ar-grid">
          <section className="panel ar-dec">
            <div className="panel-h"><h2>Your decision</h2></div>
            <div className="panel-b">
              {pending
                ? <ReviewDecision proofId={proof.id} orderId={o.id} disabled={!!ctx.preview} changeHref={`/portal/mockup?change=${proof.id}${as ? `&as=${as}` : ""}`} />
                : <div className={"ar-done " + proof.status}>
                    <b>{proof.status === "approved" ? (proof.customer_comment ? "Approved with changes" : "Approved") : "Changes requested"}</b>
                    {proof.decided_name && <span>{proof.decided_name}{proof.decided_at ? ` · ${fmtStamp(proof.decided_at)}` : ""}</span>}
                    {proof.customer_comment && <p>{proof.customer_comment}</p>}
                    <span className="muted">{proof.status === "approved" ? (proof.customer_comment ? "We'll make these changes and print. No new proof." : "We'll start printing.") : "We'll send you a new proof."}</span>
                  </div>}
            </div>
          </section>

          <section className="panel ar-view">
            <div className="panel-h"><h2>Proof</h2><a className="btn sm" href={`/portal/mockup?view=${proof.id}${as ? `&as=${as}` : ""}`}>See the full proof</a></div>
            <div className="panel-b">
              <div className="ar-stage">
                <a className="ar-mk" href={fullUrl || undefined} target="_blank" rel="noreferrer" title="Open full size">{bigUrl ? <img src={bigUrl} alt="Your mockup" /> : <span className="muted">No picture</span>}</a>
                <div className="ar-side">
                  {lines.map((l) => (
                    <div className="ar-gar" key={l.id}>
                      <b>{[l.brand, l.style].filter(Boolean).join(" ")}{l.garment ? ` · ${l.garment}` : ""}</b>
                      <div className="ar-c"><span className="ar-sw" style={{ background: lines.length === 1 ? hex : guessHex(lineColor(l)) }} />{l.color}</div>
                      <div className="ar-chips">{SIZES.filter((z) => l.sizes?.[z]).map((z) => <span key={z}>{sizeLabel(z)} <b>{l.sizes[z]}</b></span>)}</div>
                    </div>
                  ))}
                  {lines.length > 0 && <div className="ar-tot">{total} pieces</div>}
                  <div className="ar-check"><b>Check before you approve</b><span>✓ Spelling of every word</span><span>✓ Ink colors</span><span>✓ Size on the shirt</span><span>✓ Garment and color</span><span>✓ Sizes and quantities</span></div>
                </div>
              </div>

              {g.imprints.map((d, di) => {
                const des = d.design_id ? designs[d.design_id] : null, pic = des ? dUrl[des.id] : "";
                const sz = printSize(d, des), max = maxes[0]?.[di] || null, inks = d.visualOnly ? [] : inkNames(d.inks);
                // the art on the shirt color, with its measurements (px per inch fits the panel)
                const s = sz.w && sz.h ? Math.min(380 / sz.w, 220 / sz.h) : sz.w ? 380 / sz.w : 0;
                const aw = s ? sz.w * s : 300, ah = s && sz.h ? sz.h * s : 220, top = 36;
                const dark = (() => { const h = hex.replace("#", ""); const [r, gg, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * gg + 0.114 * b < 120; })();
                const colors = d.method === "dtf" || d.colors >= FULL_COLOR ? "Full color" : `${d.colors || 1} color${d.colors === 1 ? "" : "s"}`;
                return (
                  <div className="ar-pr" key={d.id}>
                    <div className={"ar-cl" + (dark ? " dark" : "")} style={{ background: hex }}>
                      {max && s > 0 && <div className="ar-area" style={{ top, width: max.w * s, height: max.h * s }}><span>largest that fits{max.on ? ` the ${max.on}` : ""}: {max.w}&quot; × {max.h}&quot;</span></div>}
                      {pic ? <img src={pic} alt={des ? `D-${des.number}` : ""} style={{ top, width: aw, height: ah }} /> : <div className="ar-none">No logo on this print yet</div>}
                      {pic && sz.w > 0 && !d.visualOnly && <div className="ar-dw" style={{ top: top + ah + 6, width: aw }}>{sz.w.toFixed(2)}&quot;</div>}
                      {pic && sz.h > 0 && !d.visualOnly && <div className="ar-dh" style={{ top, height: ah, left: `calc(50% + ${aw / 2 + 12}px)` }}>{sz.h.toFixed(2)}&quot;</div>}
                    </div>
                    <div className="ar-ps">
                      <div className="ar-loc">{d.location || "Print"}</div>
                      {/* a visual-only mockup (a reorder production confirms on the run): the picture, none of our guesses */}
                      <div className="muted">{METHODS[d.method] || d.method}{d.visualOnly ? " · printed to match your previous order" : ` · ${colors}`}</div>
                      {!d.visualOnly && <dl>
                        {sz.label && <><dt>Size</dt><dd>{sz.w ? `${+sz.w.toFixed(2)}" wide` : ""}{sz.h ? ` × ${+sz.h.toFixed(2)}" tall` : ""}</dd></>}
                        <dt>Placement</dt><dd>{d.drop ? `${d.drop}" below the collar` : "Standard (about 3\" below the collar)"}</dd>
                        {inks.length > 0 && <><dt>{d.method === "embroidery" ? "Thread" : "Ink"}</dt><dd>{inks.map((k) => <span className="ar-ink" key={k}><i style={{ background: colorHex(k) || "#ccc" }} /><b>{k}</b>{WILFLEX_HEX[k] ? <small>Wilflex RFU</small> : isPmsInk(k) ? <small>PMS match</small> : null}</span>)}</dd></>}
                        {des && <><dt>Art</dt><dd>D-{des.number}{des.name ? ` · ${des.name}` : ""}</dd></>}
                      </dl>}
                      {(d.artChanges || []).length > 0 && <div className="ar-ann"><b>{d.artChanges!.length === 1 ? "A change we made to your art" : `${d.artChanges!.length} changes we made to your art`}:</b> {d.artChanges!.join("; ")}. Look it over and approve, or tell us if it should stay as you sent it.</div>}
                      {max?.on && shownOn && max.on !== shownOn && <div className="ar-ann">Shown on the {shownOn}. One screen prints every size, so it&apos;s sized to fit the {max.on} too.</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
