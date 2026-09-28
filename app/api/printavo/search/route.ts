import { NextResponse } from "next/server";
import { searchCustomers } from "@/lib/printavo";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";

/** Find Printavo customers by company, contact or email; marks the ones already imported. */
export async function GET(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ hits: [] });
  try {
    const hits = await searchCustomers(q);
    const { data } = hits.length ? await g.sb.from("printavo_customers").select("printavo_id, customer_id").in("printavo_id", hits.map((h) => h.id)) : { data: [] };
    const done = new Map(((data || []) as { printavo_id: string; customer_id: string }[]).map((x) => [x.printavo_id, x.customer_id]));
    return NextResponse.json({ hits: hits.map((h) => ({ ...h, customerId: done.get(h.id) || null })) });
  } catch (e) { return fail(e); }
}
