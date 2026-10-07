import { NextResponse } from "next/server";
import { pv } from "@/lib/printavo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY: Printavo's public API shape (the same as their published docs, no shop data) for the types the
 * "Send to Printavo" button writes, so the requests can be built to match. Removed once that's built.
 */
const T = `name kind ofType{ name kind ofType{ name kind ofType{ name kind } } }`;
const TYPES = ["Account", "ProductionFileCreateInput", "LineItemEnabledColumnsInput", "TaskableInput", "Quote", "Invoice", "ObjectTimestamps", "DeliveryMethod", "PaymentTerm", "Category", "User", "CustomAddressInput"];
export async function GET() {
  const out: Record<string, unknown> = {};
  try {
    const m = await pv<{ __schema: { mutationType: { fields: unknown[] }; queryType: { fields: unknown[] } } }>(`query { __schema { mutationType { fields { name args { name type { ${T} } } } } queryType { fields { name args { name type { ${T} } } } } } }`);
    const want = /^(quoteCreate|statusUpdate|quoteUpdate)$/;
    out.mutations = (m.__schema.mutationType.fields as { name: string }[]).filter((f) => want.test(f.name));

  } catch (e) { out.mutationsError = String(e); }
  for (const name of TYPES) {
    try {
      const r = await pv<{ __type: unknown }>(`query($n:String!){ __type(name:$n){ name kind inputFields{ name type{ ${T} } } fields{ name args{ name type{ ${T} } } type{ ${T} } } enumValues{ name } } }`, { n: name });
      out[name] = r.__type;
    } catch (e) { out[name] = String(e); }
  }
  return NextResponse.json(out);
}
