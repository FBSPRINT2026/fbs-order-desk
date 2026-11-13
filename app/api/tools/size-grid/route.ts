import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pdfSizeGridServer } from "@/lib/pdfTextServer";

export const runtime = "nodejs";

/**
 * GET ?p=<a PDF in the proofs bucket>: its size grid as the order reader now sees it (lib/sizeGrid.ts), staff only, to
 * check a form's sizes against an order (Nov 13: Tiger Blue's #50030 / #40382).
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const p = new URL(req.url).searchParams.get("p") || "";
  if (!p || p.includes("..") || p.startsWith("/")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data } = await createAdminClient().storage.from("proofs").download(p);
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ grid: await pdfSizeGridServer(new Uint8Array(await data.arrayBuffer())) });
}
