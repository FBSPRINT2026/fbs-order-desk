import { Fragment } from "react";
import { FULL_COLOR, imprintLabel, METHODS, type Imprint } from "@/lib/pricing";
import { needsDetails } from "@/lib/productionDetails";

/**
 * The prints on a customer-facing order (portal, quote / invoice PDF). A reorder whose print details production
 * hasn't confirmed yet shows its specs greyed out, marked REORDER, "Matches previous order", and "Awaiting production
 * team confirmation of specs" (Oct 14, Nick): we print it the way we did before.
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
        // a visual-only mockup (Oct 20, Nick): the customer sees just the mockup, none of our guessed details
        if (d.visualOnly) return <Fragment key={d.id || i}>{pre}{head} <span className="imp-reorder" title="A reorder: printed to match your previous order">REORDER</span><span className="imp-reorder-specs"> Printed to match your previous order</span></Fragment>;
        return (
          <Fragment key={d.id || i}>{pre}{head} <span className="imp-reorder" title="A reorder: printed to match your previous order">REORDER</span><span className="imp-reorder-specs"> Matches previous order{specs ? ` · ${specs}` : ""}</span> <span className="imp-reorder-st">Awaiting production team confirmation of specs</span></Fragment>
        );
      })}
    </>
  );
}
