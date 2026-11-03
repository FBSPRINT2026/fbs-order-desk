import { money } from "@/lib/format";
import { cardHasPrices, cardsOf, type Program, type ProgramItem } from "@/lib/programs";
import ProgramRateCard from "@/components/ProgramRateCard";

/**
 * The customer's program prices as one clean price page (Nov 2, Nick: "that card… just had their pricing like on one nice
 * printed page that said like helper T, these styles, this price. That's exactly what I want… I don't need… send your
 * order right now"). One section per end client the prices are for (Nine18: All My Sons, Armstrong); each row is the
 * item, the styles it covers, how it's decorated, and the price. A program with only a price grid (Peticolas) shows the
 * grid. Never shows our notes or our costs.
 */
const METHOD: Record<string, string> = { screen: "Screen print", embroidery: "Embroidery", dtf: "DTF" };
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

export default function ProgramSheet({ program, items, images, extras }: {
  program: Program; items: ProgramItem[]; images: Record<string, string>; /** the program's own extra prices, named */ extras: { name: string; price: number }[];
}) {
  const card = cardsOf(program).find((c) => cardHasPrices(c)) || null;
  // one section per end client (the first of its "who" words), else one for the whole program
  const groups = new Map<string, ProgramItem[]>();
  // cheapest first (Nov 2, Nick: "start with the helper tees… arrange it by price"), in their saved order at one price
  const byPrice = [...items].sort((a, b) => +a.price - +b.price || a.position - b.position);
  for (const it of byPrice) { const k = it.match?.who?.[0] || ""; groups.set(k, [...(groups.get(k) || []), it]); }
  const withPics = items.some((i) => images[i.id]);
  const row = (it: ProgramItem) => {
    const who = [...(it.match?.who || [])].sort((a, b) => b.length - a.length);
    // "AMS helper tees" under All My Sons reads "Helper tees"
    let name = it.name;
    for (const w of who) if (name.toLowerCase().startsWith(w.toLowerCase() + " ")) { name = cap(name.slice(w.length + 1)); break; }
    // "Short sleeve tees: ST350, PC43…" = what it is, then the styles
    const g = String(it.garment || "");
    const [kind, styles] = g.includes(":") ? [g.slice(0, g.indexOf(":")).trim(), g.slice(g.indexOf(":") + 1).trim()] : ["", [it.brand, it.style, g].filter(Boolean).join(" ")];
    const methods = [...new Set(it.imprints.map((d) => d.method))];
    const spots = it.imprints.map((d) => [d.location, d.size, d.method === "screen" && d.colors ? `${d.colors} color${d.colors > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · "));
    const tiers = (it.tiers || []).filter((t) => +t.price > 0);
    const breaks = tiers.length > 1 || (tiers[0] && tiers[0].min > 0);
    return (
      <tr key={it.id}>
        {withPics ? <td className="psh-pic">{images[it.id] ? <img src={images[it.id]} alt="" loading="lazy" /> : null}</td> : null}
        <td className="psh-it"><b>{name}</b>{kind ? <span>{kind}</span> : null}</td>
        <td className="psh-st">{styles || "—"}</td>
        <td className="psh-dec">{methods.map((k) => <span key={k} className={"psh-m " + k}>{METHOD[k] || k}</span>)}{spots.map((x, i) => <small key={i}>{x}</small>)}</td>
        <td className="psh-pr">{breaks ? <span className="psh-tiers">{tiers.map((t) => <span key={t.min}><small>{t.min ? `${t.min.toLocaleString()}+` : "Any qty"}</small>{money(+t.price)}</span>)}</span> : <span className="psh-amt">{money(+it.price)}<small>each</small></span>}</td>
      </tr>
    );
  };
  return (
    <div className="psh">
      {items.length > 0 ? [...groups.entries()].map(([who, list]) => (
        <section key={who || "all"} className="panel psh-card">
          {/* the navy bar with our colors under it (Nov 2, Nick: "like the blue header… a little pizzazz") */}
          <div className="psh-h"><div><span className="psh-k">Program pricing</span><h2>{who || program.name || "Your program"}</h2></div>{program.notes ? <p>{program.notes}</p> : null}<span className="psh-n">{list.length} item{list.length === 1 ? "" : "s"}</span></div>
          <div className="panel-b psh-b">
            <table className="psh-t">
              <thead><tr>{withPics ? <th aria-label="Picture" /> : null}<th>Item</th><th>Styles</th><th>Decoration</th><th className="r">Price</th></tr></thead>
              <tbody>{list.map((it) => row(it))}</tbody>
            </table>
            {extras.length > 0 && <ul className="psh-x">{extras.map((x) => <li key={x.name}><span>{x.name}</span><b>{money(x.price)}</b></li>)}</ul>}
          </div>
        </section>
      )) : card ? (
        <section className="panel psh-card">
          <div className="panel-h"><h2>{program.name || "Your program pricing"}</h2>{program.notes ? <span className="faint">{program.notes}</span> : null}</div>
          <div className="panel-b"><ProgramRateCard card={card} /></div>
        </section>
      ) : null}
    </div>
  );
}
