import { money } from "@/lib/format";
import { BACKS, BIG_SIZES, FRONTS, type RateCard } from "@/lib/programs";

/**
 * The customer's program price grid, read only (Oct 17, Nick: "you cannot see the program pricing in the customer
 * portal… a nice read only view that has the description and qualifiers"). Same layout as the shop's editor: Back over
 * the numbers, Front down the side. Only rows and columns with a price show. Never shows our costs or the markup.
 */
export default function ProgramRateCard({ card }: { card: RateCard }) {
  const p = card.prices || {};
  const has = (f: number, b: number) => +p[`${f}/${b}`] > 0;
  const fronts = FRONTS.filter((f) => BACKS.some((b) => has(f, b)));
  const backs = BACKS.filter((b) => FRONTS.some((f) => has(f, b)));
  const shirt = [card.base?.brand, card.base?.style].filter(Boolean).join(" ");
  const big = BIG_SIZES.filter((z) => +(card.sizeUp?.[z] || 0) > 0);
  // say "2 / 1 = 1 / 2" only when it's true on this card
  const same = Object.keys(p).filter((k) => +p[k] > 0).every((k) => { const [f, b] = k.split("/"); return !(+p[`${b}/${f}`] > 0) || +p[`${b}/${f}`] === +p[k]; });
  const terms: string[] = [];
  if (card.minQty) terms.push(`${card.minQty} piece minimum per design`);
  if (card.garmentIncluded) terms.push(shirt ? `Prices include the shirt: ${shirt}` : "Prices include the shirt");
  else terms.push("Print only: you supply the shirts");
  if (card.garmentIncluded && shirt) terms.push("Other shirts are priced from this grid, up or down by the shirt's cost");
  if (big.length) terms.push(`Bigger sizes, per piece: ${big.map((z) => `${z} +${money(+card.sizeUp![z]!)}`).join(", ")}`);
  if (card.included?.length) terms.push(`Included in the price: ${card.included.join(", ")}`);
  if (card.freeDelivery) terms.push("Free local delivery by our courier (shipping isn't included)");
  if (card.noSetupEver) terms.push("No setup fees on any job");
  else if (card.waiveSetup) terms.push("No setup fees on grid prices");
  if (card.screenFee != null) terms.push(`Screens: ${money(+card.screenFee)} each`);
  for (const x of card.extras || []) if (x.trim()) terms.push(x.trim());
  if (!fronts.length && terms.length <= 1) return null;
  return (
    <section className="prc">
      {fronts.length > 0 && (
        <div className="prc-wrap">
          <div className="prc-cap">Price per piece by ink colors on the front and back{shirt && card.garmentIncluded ? `, on a ${shirt}` : ""}</div>
          <table className="rc-grid prc-grid">
            <thead>
              <tr><td colSpan={2} /><th colSpan={backs.length} className="rc-ban" scope="colgroup">Back</th></tr>
              <tr><td colSpan={2} />{backs.map((b) => <th key={b} className="rc-n" scope="col">{b}</th>)}</tr>
            </thead>
            <tbody>
              {fronts.map((f, i) => (
                <tr key={f}>
                  {i === 0 && <th rowSpan={fronts.length} className="rc-ban rc-side" scope="rowgroup"><span>Front</span></th>}
                  <th className="rc-n" scope="row">{f}</th>
                  {backs.map((b) => <td key={b} className={has(f, b) ? "prc-v" : "prc-x"}>{has(f, b) ? money(+p[`${f}/${b}`]) : ""}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="prc-key">0 means no print on that side.{same ? " A 2 / 1 and a 1 / 2 are the same price." : ""}</div>
        </div>
      )}
      {terms.length > 0 && (
        <ul className="prc-terms">
          {terms.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </section>
  );
}
