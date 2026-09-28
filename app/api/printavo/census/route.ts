import { NextResponse } from "next/server";
import { listOrders, orderFileLinks, remoteSize } from "@/lib/printavo";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How big would a full Printavo import be? Where the count stands. */
export async function GET() {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { data, error } = await g.sb.rpc("printavo_census_summary");
  if (error) return fail(error);
  return NextResponse.json({ summary: data });
}

/**
 * step "list": reads Printavo's order list (25 per request) for about 40 seconds; call again with `after` until `after` is null.
 * step "measure": reads file sizes on randomly picked orders for about 40 seconds (sizes only, nothing is downloaded or copied).
 */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const body = await req.json().catch(() => ({}));
  const start = Date.now();
  try {
    if (body.step === "list") {
      let after: string | null = body.after || null, listed = 0, totalNodes: number | null = null;
      do {
        const p = await listOrders(after);
        totalNodes = p.totalNodes ?? totalNodes;
        if (p.orders.length) {
          const { error } = await g.sb.from("printavo_census").upsert(p.orders.map((o) => ({
            printavo_id: o.id, visual_id: o.visualId, kind: o.kind, created_at: o.createdAt || null, customer_pid: o.customerId, company: o.company, total: o.total, listed_at: new Date().toISOString(),
          })), { onConflict: "printavo_id", ignoreDuplicates: false });
          if (error) throw new Error("Couldn't save the list: " + error.message);
        }
        listed += p.orders.length; after = p.next;
      } while (after && Date.now() - start < 40000);
      return NextResponse.json({ after, listed, totalNodes });
    }

    if (body.step === "measure") {
      const { data: pick, error } = await g.sb.from("printavo_census").select("printavo_id").is("measured_at", null).order("rnd").limit(40);
      if (error) throw new Error(error.message);
      let measured = 0;
      for (const { printavo_id } of pick || []) {
        if (Date.now() - start > 38000) break;
        try {
          const urls = await orderFileLinks(printavo_id);
          const sizes: (number | null)[] = [];
          for (let i = 0; i < urls.length; i += 6) sizes.push(...await Promise.all(urls.slice(i, i + 6).map(remoteSize)));
          const known = sizes.filter((x): x is number => x != null);
          await g.sb.from("printavo_census").update({
            files: urls.length, bytes: known.reduce((a, b) => a + b, 0), largest: known.length ? Math.max(...known) : 0,
            unknown: sizes.length - known.length, measured_at: new Date().toISOString(), error: null,
          }).eq("printavo_id", printavo_id);
        } catch (e) {
          await g.sb.from("printavo_census").update({ measured_at: new Date().toISOString(), error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq("printavo_id", printavo_id);
        }
        measured++;
      }
      return NextResponse.json({ measured });
    }
    return NextResponse.json({ error: "Unknown step." }, { status: 400 });
  } catch (e) { return fail(e); }
}
