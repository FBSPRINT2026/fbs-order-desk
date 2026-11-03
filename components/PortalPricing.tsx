import Link from "next/link";
import type { PriceList } from "@/lib/pricing";
import PrintButton from "@/app/portal/pricing/print";
import PricingTabs from "@/app/portal/pricing/tabs";
import { EmbCalc, ScreenCalc } from "@/components/PricingCalc";
import CalcSheet from "@/components/CalcSheet";

/**
 * The wholesale price list, a tab in the portal for wholesale accounts (Oct 24, Nick: "on the wholesale companies, we
 * need to add pricing to the top toolbar… a nice version of the price list… it still needs to stay within the construct
 * of the portal"). Read live from the wholesale list in Settings → Pricing (the FBS Contract Pricing List), so it always
 * matches what their orders are priced at.
 */
/** a price in a grid cell: the $ is dropped on a phone so eight columns fit (the section says prices are in dollars) */
function Money({ n }: { n: number }) { const t = m(n); return <><span className="pl-dol">$</span>{t.slice(1)}</>; }
const m = (n: number) => (n < 1 ? `$${n.toFixed(2).replace(/^0/, "")}` : `$${n.toFixed(2)}`);
const ranges = (t: number[]) => t.map((q, i) => (i < t.length - 1 ? `${q.toLocaleString()}–${(t[i + 1] - 1).toLocaleString()}` : `${q.toLocaleString()}+`));
/** a quantity range in a table's first column: "144–287", and on a phone just "144+" (Nov 3, Nick: "abbreviate in the mobile version") */
function Rng({ r }: { r: string }) { const lo = r.split("–")[0].replace(/\+$/, ""); return <><span className="pl-long">{r}</span><span className="pl-short" aria-hidden>{lo}+</span></>; }

export default function PortalPricing({ pl, company, phone, msgHref }: { pl: PriceList; company: string; phone: string; msgHref: string }) {
  const tiers = pl.tiers || [];
  const colors = Math.max(...(pl.screen || []).map((r) => r.length), 0);
  const embT = pl.embTiers?.length ? pl.embTiers : tiers;
  const dtfOk = (pl.dtf || []).some((v) => +v > 0);
  const fin = (pl.finishing || []).filter((f) => !f.more && !/^emb_/.test(f.id));
  const embX = [...(pl.embExtras || []), ...(pl.finishing || []).filter((f) => !f.more && /^emb_/.test(f.id) && !(pl.embExtras || []).some((e) => e.id === f.id))];
  const notes = String(pl.contractNotes || "").split(/(?<=\.)\s+(?=[A-Z0-9])/).map((x) => x.trim()).filter((x) => x && !/^FBS Contract Pricing List/i.test(x));
  const title = String(pl.contractNotes || "").match(/^FBS Contract Pricing List[^.]*/)?.[0] || "FBS wholesale price list";
  const light = (pl.lightColors || []).join(" and ");
  return (
      <div className="pl">
        <div className="pl-head">
          <div>
            <h2>Your wholesale pricing</h2>
            <div className="eyebrow">{title}{company ? <> · for <span data-notranslate>{company}</span></> : null}</div>
          </div>
        </div>
        <p className="pl-lead">Prices are per piece, per print location, on garments you supply. Your quotes and orders are priced from this list automatically; you&apos;ll see the total on every order before you confirm it.</p>

        <PricingTabs right={<PrintButton />} tabs={[
          { k: "screen", label: "Screen printing", body: <>
        <section className="panel pl-sec">
          <div className="panel-h"><h2>Screen printing</h2><span className="faint">Per location, per piece, in dollars, by the number of ink colors</span></div>
          <div className="panel-b">
            <div className="pl-wrap"><table className="pl-tbl pl-grid" data-nofit>
              {/* a phone keeps the grid (Nov 1, Nick: "still needs the grid"): the headers shorten to the number of colors */}
              <thead><tr><th>Pieces</th>{Array.from({ length: colors }, (_, i) => <th key={i}><span className="pl-long">{i + 1} color{i ? "s" : ""}</span><span className="pl-short" aria-hidden>{i + 1}</span></th>)}</tr></thead>
              <tbody>{ranges(tiers).map((r, i) => <tr key={r}><th scope="row"><Rng r={r} /></th>{Array.from({ length: colors }, (_, c) => <td key={c}>{pl.screen?.[i]?.[c] != null ? <Money n={+pl.screen[i][c]} /> : "—"}</td>)}</tr>)}</tbody>
            </table></div>
            <ul className="pl-rules">
              {pl.darkAddsColor && <li><b>Dark garments</b> need a white underbase, which counts as one more color{light ? ` (${light} print without one)` : ""}.</li>}
              <li><b>{colors + 1}+ colors and full color</b> are quoted for the job.</li>
              {pl.minQty ? <li><b>Minimum {pl.minQty} pieces.</b> Smaller runs are charged as {pl.minQty}.</li> : null}
              {pl.specialLocPrice ? <li><b>Sleeves, pockets and sides</b>{pl.specialLocations?.length ? ` (${pl.specialLocations.join(", ").toLowerCase()})` : ""}: add {m(pl.specialLocPrice)} per location.</li> : null}
              {pl.specialtyInk?.length ? <li><b>Polyester, nylon or dyed garments</b> need specialty ink: add {m(pl.specialtyInk[0])} per location{pl.specialtyInk.some((v) => v !== pl.specialtyInk![0]) ? `, ${m(Math.min(...pl.specialtyInk))} at ${tiers[pl.specialtyInk.findIndex((v) => v === Math.min(...pl.specialtyInk!))]?.toLocaleString()}+ pieces` : ""}.</li> : null}
            </ul>
          </div>
        </section>

        <div className="pl-two">
          <section className="panel pl-sec">
            <div className="panel-h"><h2>Screens and setup</h2><span className="faint">One time, per job</span></div>
            <div className="panel-b">
              <dl className="pl-dl">
                <div><dt>New screen</dt><dd>{m(pl.screenFee || 0)} <small>per color</small></dd></div>
                {pl.remakeFee ? <div><dt>Screens on file (reorder)</dt><dd>{m(pl.remakeFee)} <small>per color</small></dd></div> : null}
                {pl.inkChangeFee ? <div><dt>Ink color change</dt><dd>{m(pl.inkChangeFee)} <small>per change</small></dd></div> : null}
                {pl.pmsFee ? <div><dt>PMS color match</dt><dd>{m(pl.pmsFee)} <small>per matched ink</small></dd></div> : null}
              </dl>
            </div>
          </section>
          {/* finishing beside screens and setup (Nov 2, Nick: "instead of how it adds up… put the finishing there") */}
          {fin.length > 0 && <section className="panel pl-sec">
            <div className="panel-h"><h2>Finishing</h2><span className="faint">Per piece</span></div>
            <div className="panel-b"><dl className="pl-dl">{fin.map((f) => <div key={f.id}><dt>{f.name}</dt><dd>{m(f.price)}</dd></div>)}</dl></div>
          </section>}
        </div>
        <CalcSheet><ScreenCalc pl={pl} /></CalcSheet>

          </> },
          { k: "emb", label: "Embroidery", body: <>
        <section className="panel pl-sec">
          <div className="panel-h"><h2>Embroidery</h2><span className="faint">Per location, per piece, up to {(pl.embStitches || 0).toLocaleString()} stitches</span></div>
          <div className="panel-b">
            <div className="pl-wrap"><table className="pl-tbl pl-narrow" data-nofit>
              {/* prices on the right, specialty items in their own column with what counts as one under its name (Nov 2, Nick) */}
              <colgroup><col />{pl.embSpecialty?.length ? <><col className="pl-c-p" /><col className="pl-c-sp" /></> : <col className="pl-c-p" />}</colgroup>
              <thead><tr><th>Pieces</th><th>Price</th>{pl.embSpecialty?.length ? <th>Specialty items<span className="pl-th-sub">Hats, bags, fleece &amp; jackets</span></th> : null}</tr></thead>
              <tbody>{ranges(embT).map((r, i) => <tr key={r}><th scope="row"><Rng r={r} /></th><td>{pl.embroidery?.[i] != null ? m(+pl.embroidery[i]) : "—"}</td>{pl.embSpecialty?.length ? <td>{pl.embSpecialty[i] != null ? m((+pl.embroidery[i] || 0) + (+pl.embSpecialty[i] || 0)) : "—"}</td> : null}</tr>)}</tbody>
            </table></div>
            <ul className="pl-rules">
              {pl.embPer1k ? <li><b>Over {(pl.embStitches || 0).toLocaleString()} stitches:</b> add {m(pl.embPer1k)} per 1,000.</li> : null}
              <li><b>Digitizing</b> (turning your logo into stitches, one time): from {m(pl.digitizing || 0)}; complex or 3D puff logos are quoted.</li>
              {embX.map((x) => <li key={x.id}><b>{x.name.replace(/\s*\(embroidery\)\s*/i, "")}:</b> add {m(x.price)} per piece.</li>)}
            </ul>
          </div>
        </section>

        <CalcSheet><EmbCalc pl={pl} /></CalcSheet>
          </> },
          ...(dtfOk ? [{ k: "dtf", label: "DTF heat transfers", body: <>
        <section className="panel pl-sec">
            <div className="panel-h"><h2>DTF heat transfers</h2><span className="faint">Full color, per location, per piece</span></div>
            <div className="panel-b">
              <div className="pl-wrap"><table className="pl-tbl pl-narrow" data-nofit>
                <colgroup><col /><col className="pl-c-p" /></colgroup>
                <thead><tr><th>Pieces</th><th>Price</th></tr></thead>
                <tbody>{ranges(tiers).map((r, i) => <tr key={r}><th scope="row"><Rng r={r} /></th><td>{pl.dtf?.[i] != null ? m(+pl.dtf[i]) : "—"}</td></tr>)}</tbody>
              </table></div>
            </div>
          </section>
          </> }] : []),
        ]} />


        {notes.length > 0 && (
          <section className="panel pl-sec">
            <div className="panel-h"><h2>Good to know</h2></div>
            <div className="panel-b"><ul className="pl-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
          </section>
        )}
        <p className="pl-foot faint">Questions about pricing? <Link href={msgHref}>Send us a message</Link>{phone ? ` or call ${phone}` : ""}.</p>
      </div>
  );
}
