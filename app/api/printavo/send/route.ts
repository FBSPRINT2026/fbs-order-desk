import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchPrintavoNumber, sendPreview, sendToPrintavo } from "@/lib/printavoSend";
import { fail, holdSync, staffOnly } from "../guard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The Send to Printavo window: Printavo's statuses, the dates, and who it goes to (or why it can't go yet). */
export async function GET(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const id = new URL(req.url).searchParams.get("order") || "";
  if (!id) return NextResponse.json({ error: "Missing order." }, { status: 400 });
  // staff can see this order (row security), then the server reads the rest
  const { data: mine } = await g.sb.from("orders").select("id").eq("id", id).maybeSingle();
  if (!mine) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  try { await holdSync(30); return NextResponse.json(await sendPreview(createAdminClient(), id)); } catch (e) { return fail(e); }
}

/** Staff pressed Send: makes the quote in Printavo, sets the status they picked, links it to our order. */
export async function POST(req: Request) {
  const g = await staffOnly();
  if ("error" in g) return g.error;
  const b = await req.json().catch(() => ({}));
  const s = (v: unknown, n = 2000) => String(v ?? "").trim().slice(0, n);
  const orderId = s(b.orderId, 64);
  const { data: mine } = await g.sb.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!mine) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  try {
    await holdSync(60);
    // an order already in Printavo under Printavo's own number: give it ours
    if (b.action === "renumber") return NextResponse.json(await matchPrintavoNumber(createAdminClient(), orderId, g.email));
    const r = await sendToPrintavo(createAdminClient(), { orderId, statusId: s(b.statusId, 64), customerDue: s(b.customerDue, 10), productionDue: s(b.productionDue, 10), nickname: s(b.nickname, 200), po: s(b.po, 100), productionNote: s(b.productionNote, 4000), by: g.email });
    return NextResponse.json(r);
  } catch (e) { return fail(e); }
}
