import { notFound } from "next/navigation";
import PrintPage from "../[id]/page";

export const dynamic = "force-dynamic";

/**
 * Several work orders in one go, one print (Nick, Nov 13 2026: "my grouped jobs like All My Sons… print off all the work
 * orders at one time"): /print/work?ids=<order id>,<order id>… is each order's own work order (/print/<id>?work=1, the
 * same page, its sign-in rules included) one after another, each starting on a new sheet, with one Print at the top.
 */
export default async function WorkOrders({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const ids = [...new Set(String((await searchParams).ids || "").split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 60);
  if (!ids.length) notFound();
  const docs = [];
  for (const id of ids) docs.push(await PrintPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ work: "1" }) }));
  return (
    <div className="wob">
      <style dangerouslySetInnerHTML={{ __html: ".wob>.pdoc~.pdoc .print-bar{display:none}@media print{.wob>.pdoc~.pdoc{break-before:page}}" }} />
      <title>{`Work orders (${ids.length})`}</title>
      {docs}
    </div>
  );
}
