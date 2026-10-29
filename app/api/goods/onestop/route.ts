import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { osBrandNames, osConfigured, osOrdersLive, osPing, osPrices, osSetup, osStyle } from "@/lib/onestop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One Stop connection check (staff): GET /api/goods/onestop?brand=Next%20Level&style=6210 shows what we see there:
 * the brands they carry, that style's colors and sizes (their codes, barcodes), today's stock and price, and how an
 * order would be paid and shipped. Reads only; nothing is ordered.
 */
export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!osConfigured()) return NextResponse.json({ error: "ONESTOP_API_TOKEN isn't set." });
  const sp = new URL(req.url).searchParams, admin = createAdminClient();
  const brand = sp.get("brand") || "Next Level", style = sp.get("style") || "6210";
  // ?search=…: what One Stop's search sends back (its first rows as they come), and what we make of it
  if (sp.get("search")) {
    const { osSearchRaw, osSearch } = await import("@/lib/onestop");
    const q = sp.get("search")!;
    const raw = await osSearchRaw(q).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const hits = await osSearch(q).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ raw, hits });
  }
  const out: Record<string, unknown> = { orders: osOrdersLive() ? "live" : "test system" };
  const step = async (k: string, f: () => Promise<unknown>) => { try { out[k] = await f(); } catch (e) { out[k] = { error: e instanceof Error ? e.message : String(e) }; } };
  await step("ping", osPing);
  await step("brands", async () => { const b = await osBrandNames(); return { count: b.length, all: [...new Set(b)].sort() }; });
  let codes: string[] = [];
  await step("style", async () => { const it = await osStyle(admin, brand, style); codes = it.slice(0, 6).map((x) => x.code); return { found: it.length, colors: [...new Set(it.map((x) => x.color))].slice(0, 30), sample: it.slice(0, 6) }; });
  await step("prices", async () => Object.fromEntries(await osPrices(codes)));
  await step("setup", async () => {
    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const zip = mergeSettings(st?.data).ship.from.zip || "";
    const live = await osSetup(zip, false);
    return { zip, payment: live.termsLabel, shipVia: live.ships };
  });
  return NextResponse.json(out);
}
