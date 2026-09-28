import { NextResponse } from "next/server";
import { customerOrderIds } from "@/lib/printavo";
import { importCustomer } from "@/lib/printavoImport";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Step 1: bring over the customer (or link one we already have with the same email) and list their Printavo orders. */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { printavoId } = await req.json().catch(() => ({}));
  if (!printavoId) return NextResponse.json({ error: "Which Printavo customer?" }, { status: 400 });
  try {
    const c = await importCustomer(g.sb, String(printavoId));
    const orders = await customerOrderIds(String(printavoId));
    const { data: have } = orders.length ? await g.sb.from("archived_orders").select("printavo_id").in("printavo_id", orders.map((o) => o.id)) : { data: [] };
    return NextResponse.json({ ...c, orders, imported: ((have || []) as { printavo_id: string }[]).map((x) => x.printavo_id) });
  } catch (e) { return fail(e); }
}
