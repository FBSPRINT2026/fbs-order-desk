import { Fragment } from "react";
import { FULL_COLOR, imprintLabel, METHODS, type Imprint } from "@/lib/pricing";
import { needsDetails } from "@/lib/productionDetails";

/**
 * The prints on a customer-facing order (portal, quote / invoice PDF). A reorder whose print details production
 * hasn't confirmed yet shows its specs greyed out, marked REORDER: we print it the way we did before.
 */
export default function ImprintSpecs({ list, sep = " · " }: { list: Imprint[]; sep?: string }) {
  return (
    <>
      {list.map((d, i) => {
        const pre = i ? sep : "";
        if (!needsDetails(d)) return <Fragment key={d.id || i}>{pre}{imprintLabel(d)}</Fragment>;
        const head = `${METHODS[d.method] || d.method} ${d.location}`.trim();
        const specs = [
          d.method === "screen" || d.method === "embroidery" ? (d.method === "screen" && d.colors >= FULL_COLOR ? "full color" : `${d.colors} color${d.colors > 1 ? "s" : ""}`) : "",
          d.inks, d.size, d.drop ? `${d.drop}" drop` : "",
        ].filter(Boolean).join(" · ");
        return (
          <Fragment key={d.id || i}>{pre}{head} <span className="imp-reorder" title="A reorder: printed the same way as last time">REORDER</span>{specs ? <span className="imp-reorder-specs"> {specs}</span> : null}</Fragment>
        );
      })}
    </>
  );
}
