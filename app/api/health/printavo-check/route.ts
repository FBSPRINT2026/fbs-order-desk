import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: which sort Printavo's order list accepts for "recently changed". Returns only schema names and timestamps
// (no customer or order details). Removed after use.
async function q(query: string) {
  const email = process.env.PRINTAVO_EMAIL?.trim() || "", token = process.env.PRINTAVO_TOKEN?.trim() || "";
  await new Promise((r) => setTimeout(r, 700));
  const r = await fetch("https://www.printavo.com/api/v2", { method: "POST", headers: { "Content-Type": "application/json", email, token }, body: JSON.stringify({ query }), cache: "no-store" });
  return r.json().catch(() => null);
}
export async function GET() {
  const out: Record<string, unknown> = {};
  const e = await q(`{ __type(name:"OrderSortField"){ enumValues{ name description } } q: __type(name:"Query"){ fields{ name args{ name type{ name kind ofType{ name kind ofType{ name } } } } } } }`);
  out.sortValues = e?.data?.__type?.enumValues;
  out.queryArgs = (e?.data?.q?.fields || []).filter((f: { name: string }) => ["orders", "invoices", "quotes", "customers", "contacts"].includes(f.name))
    .map((f: { name: string; args: { name: string; type: { name: string | null; ofType?: { name: string | null; ofType?: { name: string | null } } } }[] }) => `${f.name}(${f.args.map((a) => a.name + ":" + (a.type.name || a.type.ofType?.name || a.type.ofType?.ofType?.name)).join(", ")})`);
  const f = "timestamps{ updatedAt }";
  for (const v of (out.sortValues as { name: string }[] | undefined || []).map((x) => x.name)) {
    const j = await q(`query{ orders(first:3, sortOn:${v}, sortDescending:true){ nodes{ ... on Invoice{ visualId ${f} } ... on Quote{ visualId ${f} } } } }`);
    out["sort_" + v] = j?.errors?.map((x: { message: string }) => x.message) || j?.data?.orders?.nodes;
  }
  return NextResponse.json(out);
}
