import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: which sort Printavo's order list accepts for "recently changed". Returns only error messages and timestamps
// (no customer or order details). Removed after use.
export async function GET() {
  const email = process.env.PRINTAVO_EMAIL?.trim() || "", token = process.env.PRINTAVO_TOKEN?.trim() || "";
  const out: Record<string, unknown> = {};
  const f = "timestamps{ createdAt updatedAt }";
  for (const sort of ["updatedAt", "UPDATED_AT", "updated_at", "timestamps.updatedAt", "visualId", "VISUAL_ID"]) {
    await new Promise((r) => setTimeout(r, 700));
    const query = `query{ orders(first:5, sortOn:"${sort}", sortDescending:true){ nodes{ __typename ... on Invoice{ ${f} } ... on Quote{ ${f} } } } }`;
    const r = await fetch("https://www.printavo.com/api/v2", { method: "POST", headers: { "Content-Type": "application/json", email, token }, body: JSON.stringify({ query }), cache: "no-store" });
    const j = await r.json().catch(() => null);
    out[sort] = { status: r.status, errors: j?.errors?.map((e: { message: string }) => e.message), updated: j?.data?.orders?.nodes?.map((n: { timestamps?: { updatedAt: string } }) => n?.timestamps?.updatedAt) };
  }
  await new Promise((r) => setTimeout(r, 700));
  const r = await fetch("https://www.printavo.com/api/v2", { method: "POST", headers: { "Content-Type": "application/json", email, token }, body: JSON.stringify({ query: `query{ orders(first:5){ nodes{ __typename ... on Invoice{ ${f} } ... on Quote{ ${f} } } } }` }), cache: "no-store" });
  const j = await r.json().catch(() => null);
  out.default = { status: r.status, errors: j?.errors?.map((e: { message: string }) => e.message), updated: j?.data?.orders?.nodes?.map((n: { timestamps?: { createdAt: string; updatedAt: string } }) => n?.timestamps) };
  return NextResponse.json(out);
}
