import { NextResponse } from "next/server";
import { getOrder } from "@/lib/printavo";
import { fileUrls } from "@/lib/archive";
import { fail, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Step 2: bring over one Printavo invoice or quote, exactly as it is. Importing again refreshes it. */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const { printavoId, customerId } = await req.json().catch(() => ({}));
  if (!printavoId || !customerId) return NextResponse.json({ error: "Missing order or customer." }, { status: 400 });
  try {
    const o = await getOrder(String(printavoId));
    const { data: prev } = await g.sb.from("archived_orders").select("files").eq("printavo_id", o.id).maybeSingle();
    const urls = fileUrls(o);
    const kept = Object.fromEntries(Object.entries((prev?.files || {}) as Record<string, string>).filter(([u, path]) => urls.includes(u) && path !== "failed"));
    const row = {
      printavo_id: o.id, kind: o.kind, visual_id: o.visualId, customer_id: customerId, nickname: o.nickname,
      status_name: o.status.name, status_color: o.status.color,
      order_date: (o.createdAt || "").slice(0, 10) || null, due_date: (o.customerDueAt || o.dueAt || "").slice(0, 10) || null,
      total: o.total, paid: o.amountPaid, balance: o.amountOutstanding, qty: o.totalQuantity, po_number: o.poNumber,
      data: o, files: kept, files_total: urls.length, files_copied: Object.keys(kept).length, imported_at: new Date().toISOString(),
    };
    const { data, error } = await g.sb.from("archived_orders").upsert(row, { onConflict: "printavo_id" }).select("id").single();
    if (error || !data) throw new Error("Couldn't save: " + (error?.message || "unknown"));
    return NextResponse.json({ id: data.id, visualId: o.visualId, filesLeft: urls.length - Object.keys(kept).length, warnings: o.warnings || [] });
  } catch (e) { return fail(e); }
}
