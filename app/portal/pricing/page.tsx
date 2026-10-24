import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalCtx } from "@/lib/portal";
import { priceList } from "@/lib/pricing";
import PrintButton from "./print";
import PricingTabs from "./tabs";

/**
 * The wholesale price list, for wholesale accounts (Oct 24, Nick: "on the wholesale companies, we need to add pricing to
 * the top toolbar, and they should be able to view a nice version of the price list"). Read live from the wholesale
 * list in Settings → Pricing (the FBS Contract Pricing List), so it always matches what their orders are priced at.
 */
const m = (n: number) => (n < 1 ? `$${n.toFixed(2).replace(/^0/, "")}` : `$${n.toFixed(2)}`);
const ranges = (t: number[]) => t.map((q, i) => (i < t.length - 1 ? `${q.toLocaleString()}–${(t[i + 1] - 1).toLocaleString()}` : `${q.toLocaleString()}+`));

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  const ctx = await getPortalCtx(as, "/portal/pricing");
  const qs = ctx.preview ? `?as=${ctx.preview.id}` : "";
  if (!ctx.customers.some((c) => c.price_type === "wholesale")) redirect(`/portal${qs}`);
  const pl = priceList(ctx.settings, "wholesale");
  const tiers = pl.tiers || [];
  const colors = Math.max(...(pl.screen || []).map((r) => r.length), 0);
  const embT = pl.embTiers?.length ? pl.embTiers : tiers;
  const dtfOk = (pl.dtf || []).some((v) => +v > 0);
  const fin = (pl.finishing || []).filter((f) => !f.more && !/^emb_/.test(f.id));
  const embX = [...(pl.embExtras || []), ...(pl.finishing || []).filter((f) => !f.more && /^emb_/.test(f.id) && !(pl.embExtras || []).some((e) => e.id === f.id))];
  const notes = String(pl.contractNotes || "").split(/(?<=\.)\s+(?=[A-Z0-9])/).map((x) => x.trim()).filter((x) => x && !/^FBS Contract Pricing List/i.test(x));
  const title = String(pl.contractNotes || "").match(/^FBS Contract Pricing List[^.]*/)?.[0] || "FBS wholesale price list";
  const light = (pl.lightColors || []).join(" and ");
  // a worked example from the list itself: 100 dark tees, 1-color front and 1-color back
  const ti = (q: number, t: number[]) => t.reduce((a, x, i) => (q >= x ? i : a), 0);
  const exC = 1 + (pl.darkAddsColor ? 1 : 0), exRow = pl.screen?.[ti(100, tiers)] || [];
  const exEach = (exRow[exC - 1] || 0) * 2, exSetup = exC * 2 * (pl.screenFee || 0);
  const company = ctx.customers[0]?.company || ctx.customers[0]?.name || "";
  return (
    <>
      {ctx.preview && <div className="preview-bar">Preview of {ctx.preview.company || ctx.preview.name}&apos;s price list.</div>}
      <main className="p-main pl">
        <Link href={`/portal${qs}`} className="back">← Dashboard</Link>
        <div className="page-head">
          <div>
            <h1>Your wholesale pricing</h1>
            <div className="eyebrow">{title}{company ? <> · for <span data-notranslate>{company}</span></> : null}</div>
          </div>
          <div className="row"><PrintButton /></div>
        </div>
        <p className="pl-lead">Prices are per piece, per print location, on garments you supply. Your quotes and orders are priced from this list automatically; you&apos;ll see the total on every order before you confirm it.</p>

        <PricingTabs tabs={[
          { k: "screen", label: "Screen printing", body: <>
        <section className="panel pl-sec">
          <div className="panel-h"><h2>Screen printing</h2><span className="faint">Per location, per piece, by the number of ink colors</span></div>
          <div className="panel-b">
            <div className="pl-wrap"><table className="pl-tbl">
              <thead><tr><th>Pieces</th>{Array.from({ length: colors }, (_, i) => <th key={i}>{i + 1} color{i ? "s" : ""}</th>)}</tr></thead>
              <tbody>{ranges(tiers).map((r, i) => <tr key={r}><th scope="row">{r}</th>{Array.from({ length: colors }, (_, c) => <td key={c}>{pl.screen?.[i]?.[c] != null ? m(+pl.screen[i][c]) : "—"}</td>)}</tr>)}</tbody>
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
          <section className="panel pl-sec pl-ex">
            <div className="panel-h"><h2>How it adds up</h2><span className="faint">An example</span></div>
            <div className="panel-b">
              <p><b>100 black tees, a 1-color front and a 1-color back.</b></p>
              <dl className="pl-dl">
                <div><dt>Each print{pl.darkAddsColor ? " (1 color + underbase)" : ""}</dt><dd>{m(exRow[exC - 1] || 0)} × 2 locations</dd></div>
                <div><dt>Per shirt</dt><dd><b>{m(exEach)}</b></dd></div>
                <div><dt>Screens ({exC * 2} × {m(pl.screenFee || 0)})</dt><dd>{m(exSetup)} <small>one time</small></dd></div>
                <div className="tot"><dt>Order total</dt><dd><b>{m(exEach * 100 + exSetup)}</b></dd></div>
              </dl>
            </div>
          </section>
        </div>

          </> },
          { k: "emb", label: "Embroidery", body: <>
        <section className="panel pl-sec">
          <div className="panel-h"><h2>Embroidery</h2><span className="faint">Per location, per piece, up to {(pl.embStitches || 0).toLocaleString()} stitches</span></div>
          <div className="panel-b">
            <div className="pl-wrap"><table className="pl-tbl pl-narrow">
              <thead><tr><th>Pieces</th><th>Price</th>{pl.embSpecialty?.length ? <th>Hats, bags, fleece &amp; jackets</th> : null}</tr></thead>
              <tbody>{ranges(embT).map((r, i) => <tr key={r}><th scope="row">{r}</th><td>{pl.embroidery?.[i] != null ? m(+pl.embroidery[i]) : "—"}</td>{pl.embSpecialty?.length ? <td>{pl.embSpecialty[i] != null ? `${m((+pl.embroidery[i] || 0) + (+pl.embSpecialty[i] || 0))}` : "—"}<small> (+{m(+pl.embSpecialty[i] || 0)})</small></td> : null}</tr>)}</tbody>
            </table></div>
            <ul className="pl-rules">
              {pl.embPer1k ? <li><b>Over {(pl.embStitches || 0).toLocaleString()} stitches:</b> add {m(pl.embPer1k)} per 1,000.</li> : null}
              <li><b>Digitizing</b> (turning your logo into stitches, one time): from {m(pl.digitizing || 0)}; complex or 3D puff logos are quoted.</li>
              {embX.map((x) => <li key={x.id}><b>{x.name.replace(/\s*\(embroidery\)\s*/i, "")}:</b> add {m(x.price)} per piece.</li>)}
            </ul>
          </div>
        </section>

          </> },
          ...(dtfOk ? [{ k: "dtf", label: "DTF heat transfers", body: <>
        <section className="panel pl-sec">
            <div className="panel-h"><h2>DTF heat transfers</h2><span className="faint">Full color, per location, per piece</span></div>
            <div className="panel-b">
              <div className="pl-wrap"><table className="pl-tbl pl-narrow">
                <thead><tr><th>Pieces</th><th>Price</th></tr></thead>
                <tbody>{ranges(tiers).map((r, i) => <tr key={r}><th scope="row">{r}</th><td>{pl.dtf?.[i] != null ? m(+pl.dtf[i]) : "—"}</td></tr>)}</tbody>
              </table></div>
            </div>
          </section>
          </> }] : []),
        ]} />

        {fin.length > 0 && (
          <section className="panel pl-sec">
            <div className="panel-h"><h2>Finishing</h2><span className="faint">Per piece</span></div>
            <div className="panel-b"><dl className="pl-dl pl-cols">{fin.map((f) => <div key={f.id}><dt>{f.name}</dt><dd>{m(f.price)}</dd></div>)}</dl></div>
          </section>
        )}

        {notes.length > 0 && (
          <section className="panel pl-sec">
            <div className="panel-h"><h2>Good to know</h2></div>
            <div className="panel-b"><ul className="pl-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
          </section>
        )}
        <p className="pl-foot faint">Questions about pricing? <Link href={`/portal?area=messages${ctx.preview ? `&as=${ctx.preview.id}` : ""}`}>Send us a message</Link>{ctx.settings.shop.phone ? ` or call ${ctx.settings.shop.phone}` : ""}.</p>
      </main>
    </>
  );
}
