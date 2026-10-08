import { NextResponse } from "next/server";
import { pv } from "@/lib/printavo";

export const dynamic = "force-dynamic";

/** TEMPORARY: Printavo's public API shape for the quote/invoice update inputs (same as their docs, no shop data). */
const T = `name kind ofType{ name kind ofType{ name kind } }`;
export async function GET() {
  const out: Record<string, unknown> = {};
  for (const n of ["QuoteInput", "InvoiceInput"]) {
    try { out[n] = (await pv<{ __type: unknown }>(`query($n:String!){ __type(name:$n){ inputFields{ name type{ ${T} } } } }`, { n })).__type; } catch (e) { out[n] = String(e); }
  }
  return NextResponse.json(out);
}
