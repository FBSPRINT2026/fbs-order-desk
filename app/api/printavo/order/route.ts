import { NextResponse } from "next/server";
import { importOrder } from "@/lib/printavoImport";
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
    const r = await importOrder(g.sb, String(printavoId), String(customerId));
    await g.sb.from("printavo_index").update({ status: r.filesLeft ? "files" : "done", archived_id: r.id, imported_at: new Date().toISOString(), error: null }).eq("printavo_id", String(printavoId));
    return NextResponse.json({ id: r.id, visualId: r.visualId, filesLeft: r.filesLeft, warnings: r.warnings });
  } catch (e) { return fail(e); }
}
