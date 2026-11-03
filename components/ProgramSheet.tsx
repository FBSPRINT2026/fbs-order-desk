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
  for (const it of items) { const k = it.match?.who?.[0] || ""; groups.set(k, [...(groups.get(k) || []), it]); }
  const withPics = items.some((i) => images[i.id]);
  const row = (it: ProgramItem) => {
    const who = [...(it.match?.who || [])].sort((a, b) => b.length - a.length);
    // "AMS helper tees" under All My Sons reads "Helper tees"
    let name = it.name;
    for (const w of who) if (name.toLowerCase().startsWith(w.toLowerCase() + " ")) { name = cap(name.slice(w.length + 1)); break; }
    // "Short sleeve tees: ST350, PC43…" = what it is, then the styles
    const g = String(it.garment || "");
    const [kind, styles] = g.includes(":") ? [g.slice(0, g.indexOf(":")).trim(), g.slice(g.indexOf(":") + 1).trim()] : ["", [it.brand, it.style, g].filter(Boolean).join(" ")];
    const method = [...new Set(it.imprints.map((d) => METHOD[d.method] || d.method))].join(" + ");
    const spots = it.imprints.map((d) => [d.location, d.size, d.method === "screen" && d.colors ? `${d.colors} color${d.colors > 1 ? "s" : ""}` : ""].filter(Boolean).join(" ")).join(" + ");
    const tiers = (it.tiers || []).filter((t) => +t.price > 0);
    const breaks = tiers.length > 1 || (tiers[0] && tiers[0].min > 0);
    return (
      <tr key={it.id}>
        {withPics ? <td className="psh-pic">{images[it.id] ? <img src={images[it.id]} alt="" loading="lazy" /> : null}</td> : null}
        <td className="psh-it"><b>{name}</b>{kind ? <span>{kind}</span> : null}</td>
        <td className="psh-st">{styles || "—"}</td>
        <td className="psh-dec">{method && <b>{method}</b>}<span>{spots}</span></td>
        <td className="psh-pr">{breaks ? <span className="psh-tiers">{tiers.map((t) => <span key={t.min}><small>{t.min ? `${t.min.toLocaleString()}+` : "Any qty"}</small>{money(+t.price)}</span>)}</span> : <b>{money(+it.price)}</b>}</td>
      </tr>
    );
  };
  return (
    <div className="psh">
      {items.length > 0 ? [...groups.entries()].map(([who, list]) => (
        <section key={who || "all"} className="panel psh-card">
          <div className="panel-h"><h2>{who ? `${who} pricing` : program.name || "Your program pricing"}</h2><span className="faint">Per piece{program.notes ? ` · ${program.notes.replace(/\.$/, "")}` : ""}</span></div>
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
