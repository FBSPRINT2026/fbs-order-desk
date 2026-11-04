import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tokenMatches } from "@/lib/qbo/config";

export const dynamic = "force-dynamic";

/**
 * Stax's deposits (Nov 4, Nick: "can you see the deposits report in Stax… when Stax sends a deposit… here's your total
 * deposit… the payments you received that day… one transaction a day" for the QuickBooks deposit and its card fees).
 * Read only: each deposit (batch) with its gross, fees and net, and with ?batch= its payments. Staff, or the QuickBooks
 * sync's own token.
 */
const STAX = "https://apiprod.fattlabs.com";

export async function GET(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) {
    const { data: s } = await createAdminClient().from("qbo_settings").select("token").eq("id", 1).maybeSingle();
    if (!s || !tokenMatches(req.headers.get("x-sync-token"), String(s.token))) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const key = process.env.STAX_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Stax isn't connected." }, { status: 400 });
  const u = new URL(req.url);
  const h = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  const batch = u.searchParams.get("batch");
  const end = u.searchParams.get("end") || new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const start = u.searchParams.get("start") || new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const path = batch ? `/query/depositDetail?${new URLSearchParams({ batch_id: batch })}` : `/query/deposit?${new URLSearchParams({ startDate: start, endDate: end })}`;
  const r = await fetch(`${STAX}${path}`, { headers: h, cache: "no-store" });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* as text */ }
  return NextResponse.json({ status: r.status, path, body }, { status: r.ok ? 200 : 502 });
}
