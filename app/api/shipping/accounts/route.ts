import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { carrierAccounts, easypostConfigured } from "@/lib/easypost";

export const dynamic = "force-dynamic";

/** FBS's carrier accounts in EasyPost (staff only): which UPS / FedEx accounts labels can be bought on. */
export async function GET() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!easypostConfigured()) return NextResponse.json({ error: "EasyPost isn't connected yet." }, { status: 503 });
  try { return NextResponse.json({ accounts: await carrierAccounts() }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "EasyPost didn't answer." }, { status: 502 }); }
}
