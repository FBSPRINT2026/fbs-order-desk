import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pv } from "@/lib/printavo";
import { copyFiles, importOrder } from "@/lib/printavoImport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TEMPORARY: imports Printavo order #34317 (read-only from Printavo) so it can be previewed on the staff page. Returns only ids and counts. Removed after use.
export async function GET() {
  const admin = createAdminClient();
  const f = await pv<{ orders: { nodes: { __typename: string; id?: string; visualId?: string }[] } }>(`query{ orders(query:"34317", first:10){ nodes{ __typename ... on Invoice{ id visualId } ... on Quote{ id visualId } } } }`);
  const hit = f.orders.nodes.find((n) => String(n.visualId) === "34317");
  if (!hit?.id) return NextResponse.json({ found: false, n: f.orders.nodes.length });
  const r = await importOrder(admin, hit.id);
  let left = r.filesLeft, copied = 0; const failed: string[] = [];
  const end = Date.now() + 40000;
  while (left > 0 && Date.now() < end) { const c = await copyFiles(admin, r.id, end); left = c.left; copied = c.copied; failed.push(...c.failed); if (c.storageFull) break; }
  return NextResponse.json({ id: r.id, kind: hit.__typename, warnings: r.warnings, messages: r.order.messages.length, approvals: r.order.approvals.length, files: r.order ? copied : 0, left, failed: failed.length });
}
