import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalCtx, seesPriceList } from "@/lib/portal";
import { priceList } from "@/lib/pricing";
import { fmtPhone } from "@/lib/phone";
import SheetPrint from "./SheetPrint";
import { DTF_GRID, dtfGridOn } from "@/lib/dtfGrid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contract pricing · FBS Print", robots: { index: false } };

const m = (n: number) => (n < 1 ? `$${n.toFixed(2).replace(/^0/, "")}` : `$${+n % 1 ? n.toFixed(2) : n.toFixed(0)}`);
const d = (n: number) => (n < 1 ? n.toFixed(2).replace(/^0/, "") : n.toFixed(2));
const ranges = (t: number[]) => t.map((q, i) => (i < t.length - 1 ? `${q.toLocaleString()}-${(t[i + 1] - 1).toLocaleString()}` : `${q.toLocaleString()}+`));
const pick = (notes: string, re: RegExp) => notes.match(re)?.[1]?.trim() || "";

/**
 * The customer's contract price list as one printed page (Nov 2, Nick: "take exactly what I had and just make it look
 * like our website… same fonts and the same header… this is just to make a PDF to download"). The same sections as the
 * FBS Contract Pricing List, read live from their price list, so it always matches what their orders are priced at.
 */
export default async function PricingSheet({ searchParams }: { searchParams: Promise<{ as?: string; print?: string; save?: string }> }) {
  const { as, print, save } = await searchParams;
  const ctx = await getPortalCtx(as, "/print/pricing");
  if (!seesPriceList(ctx.customers)) notFound();
  const pl = priceList(ctx.settings, "wholesale");
  const sh = ctx.settings.shop;
  const notes = String(pl.contractNotes || "");
  const version = pick(notes, /FBS Contract Pricing List\s+([^.]+)/i);
  const tiers = pl.tiers || [];
  const cols = Math.max(...(pl.screen || []).map((r) => r.length), 0);
  const embT = pl.embTiers?.length ? pl.embTiers : tiers;
  const minQty = pl.minQty || tiers[0] || 12;
  const spec = pl.specialtyInk || [];
  const specLow = spec.length ? Math.min(...spec) : 0, specLowAt = tiers[spec.findIndex((v) => v === specLow)];
  const spoil = pick(notes, /Spoilage[^:]*:\s*([^.]+)/i);
  const setups: [string, string, string][] = [
    ["Screen setup / remake", "", `${m(pl.screenFee || 0)}${pl.remakeFee ? ` / ${m(pl.remakeFee)}` : ""} per color`],
    ...(pl.inkChangeFee ? [["Color changes", "", `${m(pl.inkChangeFee)} per color`] as [string, string, string]] : []),
    ...(spec.length ? [["Specialty ink", "Polyester, nylon, or dyed garments", `${m(spec[0])} per location${specLow !== spec[0] ? ` / ${m(specLow)} per location ${specLowAt?.toLocaleString()}+` : ""}`] as [string, string, string]] : []),
    ...(pl.specialLocPrice ? [["Special imprint", (pl.specialLocations?.length ? pl.specialLocations : ["Sleeve", "Pocket", "Side"]).join(", "), `${m(pl.specialLocPrice)} per location`] as [string, string, string]] : []),
    ...(pl.pmsFee ? [["PMS matching fee", "non-standard ink", `${m(pl.pmsFee)} per color`] as [string, string, string]] : []),
    ...(pl.finishing || []).filter((f) => !f.more && !/^emb_/.test(f.id)).map((f) => [f.name, "", `${m(f.price)} per garment`] as [string, string, string]),
    ["Vinyl names / numbers", "", `${m(pl.rosterName ?? 2)} per name / ${m(pl.rosterDigit ?? 3)} per digit`],
    ...(/drop ship/i.test(notes) ? [["Drop ship", "split by location or to individuals", "Contact us for a quote"] as [string, string, string]] : []),
  ];
  const digBasic = pick(notes, /digitizing:\s*basic\s+([^,]+)/i) || `${m(pl.digitizing || 0)}+`;
  const digComplex = pick(notes, /complex\s*\/\s*puff\s+([^\s(.,]+)/i);
  const sewOuts = pick(notes, /Sew-outs?\s+([^.]+)/i);
  const embRows: [string, string][] = [
    ["Basic digitizing", digBasic],
    ...(digComplex ? [["Complex / puff digitizing", digComplex] as [string, string]] : []),
    ...(sewOuts ? [["Sew outs", sewOuts] as [string, string]] : []),
    ...(pl.embExtras || []).map((x) => [x.name.replace(/\s*\(embroidery\)\s*/i, "").replace(/^Embroidery personalization.*$/i, "Personalization"), m(x.price)] as [string, string]),
  ];
  const service = pick(notes, /(Standard service[^;.]*)/i);
  const dg = pl.dtfGrid || DTF_GRID, dgPress = dg.press || DTF_GRID.press!;
  const qr = (q: number[], i: number) => (i < q.length - 1 ? `${q[i]}-${q[i + 1] - 1}` : `${q[i]}+`);
  return (
    <div className="pls">
      <SheetPrint auto={save === "1" || print === "1"} name={`FBS contract pricing${ctx.customers[0]?.company ? ` - ${ctx.customers[0].company}` : ""}`} />
      <article className="pls-page">
        {/* divs, not header/footer: the print styles hide page headers and footers */}
        <div className="pls-h">
          <img src="/brand/fbs-logo-white.svg" alt={sh.name} className="pls-logo" />
          <div className="pls-ttl"><b>Contract pricing</b></div>
          <div className="pls-c">
            {sh.phone && <b>{fmtPhone(sh.phone)}</b>}
            <span>{sh.email || "info@fbsprint.com"}</span>
            {sh.address && <span>{sh.address}</span>}
          </div>
        </div>
        <div className="pls-b">
          <h2>Contract screen printing</h2>
          <table className="pls-t pls-grid">
            <thead><tr><th>Screen printing</th>{Array.from({ length: cols }, (_, i) => <th key={i}>{i + 1} Color{i ? "s" : ""}</th>)}</tr></thead>
            <tbody>{ranges(tiers).map((r, i) => <tr key={r}><th scope="row">{r}</th>{Array.from({ length: cols }, (_, c) => <td key={c}>{pl.screen?.[i]?.[c] != null ? d(+pl.screen[i][c]) : ""}</td>)}</tr>)}</tbody>
          </table>
          <p className="pls-note"><i>{pl.darkAddsColor ? "Add one color to dark garments for underbase. " : ""}{cols + 1}+ color &amp; full color jobs are custom quoted.</i></p>
          <p className="pls-fine">Jobs below {minQty} pieces will be charged as {minQty} pieces.{spoil ? ` Spoilage / reject on customer supplied goods is ${spoil}.` : ""}</p>

          <table className="pls-t pls-kv">
            <thead><tr><th colSpan={2}>Setups and additional charges</th></tr></thead>
            <tbody>{setups.map(([a, b, c]) => <tr key={a}><th scope="row">{a}{b ? <span> – {b}</span> : null}</th><td>{c}</td></tr>)}</tbody>
          </table>

          {/* on paper the back side starts here: embroidery, DTF (Nov 4, Nick: "screen printing on the front and embroidery on the back") */}
          <div className="pls-back">
          <h2>Contract embroidery</h2>
          <div className="pls-two">
            <div>
              <table className="pls-t pls-grid">
                <thead><tr><th>Embroidery</th><th>0 - {Math.round((pl.embStitches || 6000) / 1000)}K Stitches</th>{pl.embPer1k ? <th>Add. 1K Stitches</th> : null}{pl.embSpecialty?.length ? <th>Specialty Items</th> : null}</tr></thead>
                <tbody>{ranges(embT).map((r, i) => <tr key={r}><th scope="row">{r}</th><td>{pl.embroidery?.[i] != null ? d(+pl.embroidery[i]) : ""}</td>{pl.embPer1k ? <td>+ {d(pl.embPer1k)}</td> : null}{pl.embSpecialty?.length ? <td>{pl.embSpecialty[i] != null ? `+ ${d(+pl.embSpecialty[i])}` : ""}</td> : null}</tr>)}</tbody>
              </table>
              {pl.embSpecialty?.length ? <p className="pls-fine pls-c2"><i>Specialty items are fleece materials, hats, beanies, bags, backpacks, and any other non-standard flat garment.</i></p> : null}
            </div>
            <div>
              <table className="pls-t pls-kv">
                <thead><tr><th colSpan={2}>Setups and additional charges</th></tr></thead>
                <tbody>{embRows.map(([a, b]) => <tr key={a}><th scope="row">{a}</th><td>{b}</td></tr>)}</tbody>
              </table>
              <div className="pls-rush"><b>Rush services available</b><span>{service || "Standard service on all decoration methods"}{service ? "" : ""}</span></div>
            </div>
          </div>
          {dtfGridOn(pl) && <>
            <h2>DTF heat transfers</h2>
            <table className="pls-t pls-grid">
              <thead><tr><th>We order and press</th>{dg.qty.map((_, k) => <th key={k}>{qr(dg.qty, k)}</th>)}</tr></thead>
              <tbody>
                {dg.sizes.map((z, i) => <tr key={z.name}><th scope="row">{z.name} <span className="pls-sub">up to {z.max} sq in</span></th>{dg.qty.map((_, k) => <td key={k}>{d((dg.price[i]?.[k] ?? 0) + (dgPress[k] ?? 0))}</td>)}</tr>)}
                <tr><th scope="row">Your own transfers <span className="pls-sub">pressing only</span></th>{dg.qty.map((_, k) => <td key={k}>{d(dgPress[k] ?? 0)}</td>)}</tr>
              </tbody>
            </table>
            <p className="pls-fine pls-c2"><i>Full color, per location, per piece. Small is up to 4×4, medium 8×10, large 12×12, XL 12×18.</i></p>
          </>}
          </div>
        </div>
        <div className="pls-f"><span>{sh.name}</span><b>{version}</b><span>Your quotes and orders are priced from this list.</span></div>
      </article>
    </div>
  );
}
