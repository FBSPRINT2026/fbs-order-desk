import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanmarConfigured, sanmarProbe, sanmarSellableStyles, sanmarStyleSummary } from "@/lib/sanmar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Keeps our copy of SanMar's style list (sanmar_styles) up to date, so SanMar styles show up in style search.
 * Called every minute by the database's schedule while something is due (migration 062), with the sync token:
 *   1. weekly: SanMar's list of every sellable style (PromoStandards GetProductSellable); styles no longer on it are hidden,
 *   2. then each style's brand, name, category, photo, colors and sizes (monthly), a few at a time until the minute is up.
 */
const RUN_MS = 46000, LIST_EVERY = 7 * 86400000, DETAIL_EVERY = 30 * 86400000, AT_ONCE = 4;

export async function GET(req: Request) {
  const admin = createAdminClient();
  const { data: ps } = await admin.from("printavo_sync").select("token").eq("id", 1).single();
  if (!ps || req.headers.get("x-sync-token") !== (ps as { token: string }).token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  if (!sanmarConfigured()) return NextResponse.json({ error: "SanMar isn't connected" }, { status: 503 });
  if (new URL(req.url).searchParams.get("probe")) return NextResponse.json(await sanmarProbe());
  const { data: s } = await admin.from("sanmar_sync").select("enabled, list_at").eq("id", 1).single();
  const sync = s as { enabled: boolean; list_at: string | null } | null;
  if (!sync?.enabled) return NextResponse.json({ off: true });
  const { data: got } = await admin.rpc("sanmar_sync_claim", { p_seconds: 58 });
  if (!got) return NextResponse.json({ busy: true });
  const start = Date.now(), deadline = start + RUN_MS;
  const out: Record<string, unknown> = {};
  try {
    // 1. the style list
    if (!sync.list_at || Date.now() - new Date(sync.list_at).getTime() > LIST_EVERY) {
      const at = new Date().toISOString();
      const { styles, version, parts } = await sanmarSellableStyles();
      for (let i = 0; i < styles.length; i += 500) {
        const { error } = await admin.from("sanmar_styles").upsert(styles.slice(i, i + 500).map((style) => ({ style, sellable: true, listed_at: at, updated_at: at })), { onConflict: "style" });
        if (error) throw new Error(error.message);
      }
      if (styles.length > 500) await admin.from("sanmar_styles").update({ sellable: false, updated_at: at }).lt("listed_at", at);
      await admin.from("sanmar_sync").update({ list_at: at, list_count: styles.length }).eq("id", 1);
      Object.assign(out, { listed: styles.length, parts, version });
    }
    // 2. details, oldest first
    const stale = new Date(Date.now() - DETAIL_EVERY).toISOString();
    let done = 0, missing = 0, failed = 0, inARow = 0;
    while (Date.now() < deadline - 8000) {
      const { data: due } = await admin.from("sanmar_styles").select("style").eq("sellable", true).or(`detail_at.is.null,detail_at.lt.${stale}`).order("detail_at", { ascending: true, nullsFirst: true }).order("style").limit(AT_ONCE);
      const list = ((due || []) as { style: string }[]).map((d) => d.style);
      if (!list.length) break;
      await Promise.all(list.map(async (style) => {
        const now = new Date().toISOString();
        try {
          const g = await sanmarStyleSummary(style);
          inARow = 0;
          if (!g) { missing++; await admin.from("sanmar_styles").update({ detail_at: now, detail_error: "SanMar sent no details", updated_at: now }).eq("style", style); return; }
          done++;
          await admin.from("sanmar_styles").update({ brand: g.brand, title: g.title, category: g.category, image: g.image, colors: g.colors, sizes: g.sizes, status: g.status, detail_at: now, detail_error: null, updated_at: now }).eq("style", style);
        } catch (e) {
          failed++; inARow++;
          // try this one again in a day
          const retry = new Date(Date.now() - DETAIL_EVERY + 86400000).toISOString();
          await admin.from("sanmar_styles").update({ detail_at: retry, detail_error: (e instanceof Error ? e.message : String(e)).slice(0, 300), updated_at: now }).eq("style", style);
        }
      }));
      if (inARow >= 8) throw new Error("SanMar kept failing; trying again in 10 minutes");
    }
    Object.assign(out, { detailed: done, missing, failed, ms: Date.now() - start });
    await admin.from("sanmar_sync").update({ last_run_at: new Date().toISOString() }).eq("id", 1);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await admin.from("sanmar_sync").update({ last_error: msg, last_error_at: new Date().toISOString(), last_run_at: new Date().toISOString() }).eq("id", 1);
    out.error = msg;
  } finally {
    await admin.from("sanmar_sync").update({ running_until: null }).eq("id", 1);
  }
  return NextResponse.json(out);
}
