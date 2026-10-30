import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { officeText } from "@/lib/officeText";
import { parsePersList } from "@/lib/persList";

export const dynamic = "force-dynamic";

/**
 * A personalization name list uploaded on an order (staff only): the file goes in the order's Production files (so the
 * team sews from the list itself), and its rows come back as names, titles, sizes and quantities.
 */
export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file"), orderId = String(fd?.get("orderId") || "");
  if (!(file instanceof File) || !orderId) return NextResponse.json({ error: "Pick the list file." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is over 10 MB." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const text = officeText(file.name, file.type, buf);
  const rows = parsePersList(text);
  if (!rows.length) return NextResponse.json({ error: "No names found in that file. It needs a column of names (and sizes); a header row like Name · Title · Size · Qty helps." }, { status: 400 });
  const path = `art/${orderId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
  const up = await v.supabase.storage.from("proofs").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) return NextResponse.json({ error: "Couldn't save the file: " + up.error.message }, { status: 500 });
  await v.supabase.from("art_files").insert({ order_id: orderId, name: `Personalization list: ${file.name}`, file_path: path, file_type: file.type || "", note: `${rows.length} names` });
  return NextResponse.json({ rows, file: { path, name: file.name } });
}
