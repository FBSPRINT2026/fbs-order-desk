import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderGroups, type Group, type Order } from "@/lib/pricing";
import { colorwaysOf } from "@/lib/brands";
import { sourceCheck, type SrcCatalog, type SrcFinding, type SrcLogo } from "@/lib/sourceCheck";

/**
 * What lib/sourceCheck.ts needs to know beyond the words: the catalog's name, brand and colors for each style on the
 * order, and the customer's logos (each print's logo and the other logos of its brand, with their versions), so
 * "Primary" vs "Stacked" and "All White" can be told. Used at the reading (lib/ai/emailOrder.ts), in the order check
 * (lib/ai/orderFix.ts) and before an order is kept as a worked example (app/shop/ai-actions.ts markOrderChecked).
 */
export async function sourceCtx(admin: SupabaseClient, groups: Group[]): Promise<{ catalog: SrcCatalog; logos: SrcLogo[] }> {
  const styles = [...new Set(groups.flatMap((g) => (g.lines || []).map((l) => (l.style || "").trim().toUpperCase())).filter((s) => s.length >= 3))];
  const ids = [...new Set(groups.flatMap((g) => (g.imprints || []).map((im) => im.design_id)).filter(Boolean) as string[])];
  const [{ data: st }, { data: ds }] = await Promise.all([
    styles.length ? admin.from("sanmar_styles").select("style, title, brand, colors").in("style", styles) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("designs").select("id, brand_id").in("id", ids) : Promise.resolve({ data: [] }),
  ]);
  const catalog: SrcCatalog = {};
  for (const r of (st || []) as { style: string; title: string | null; brand: string | null; colors: string[] | null }[]) catalog[r.style.toUpperCase()] = { title: r.title || "", brand: r.brand || "", colors: r.colors || [] };
  const bIds = [...new Set(((ds || []) as { brand_id: string | null }[]).map((d) => d.brand_id).filter(Boolean) as string[])];
  const { data: all } = bIds.length
    ? await admin.from("designs").select("id, name, brand_id, specs").in("brand_id", bIds).limit(200)
    : ids.length ? await admin.from("designs").select("id, name, brand_id, specs").in("id", ids) : { data: [] };
  const rows = (all || []) as { id: string; name: string | null; brand_id: string | null; specs: unknown; number?: number }[];
  // how often each is on an order staff said is right (the worked examples name logos by D-number)
  const uses = new Map<string, number>();
  if (rows.length > 1) {
    const { data: nums } = await admin.from("designs").select("id, number").in("id", rows.map((d) => d.id));
    const { data: ex } = await admin.from("order_examples").select("order_text").eq("active", true).ilike("order_text", "%logo D-%").order("confirmed_at", { ascending: false }).limit(400);
    const text = ((ex || []) as { order_text: string }[]).map((e) => e.order_text).join("\n");
    for (const n of (nums || []) as { id: string; number: number }[]) uses.set(n.id, (text.match(new RegExp(`logo D-${n.number}\\b`, "g")) || []).length);
  }
  const logos: SrcLogo[] = rows.map((d) => ({ id: d.id, name: d.name || "", brand: d.brand_id, colorways: colorwaysOf({ specs: d.specs } as never).map((c) => c.name).filter(Boolean), uses: uses.get(d.id) || 0 }));
  return { catalog, logos };
}

/** an order checked against what it was made from (its email or ClickUp task and their files' words) */
export async function checkOrderSource(admin: SupabaseClient, o: Order): Promise<{ findings: SrcFinding[]; source: string }> {
  const { sourceActivity, sourceOf } = await import("@/lib/ai/orderExamples");
  const src = await sourceActivity(admin, o.id);
  if (!src.activity) return { findings: [], source: "" };
  const { text } = await sourceOf(admin, src.activity);
  const groups = orderGroups(o);
  const findings = sourceCheck(text, groups, await sourceCtx(admin, groups));
  await suggestStyles(admin, (o as { customer_id?: string | null }).customer_id || null, groups, findings).catch((e) => console.warn("suggestStyles", e));
  return { findings, source: text };
}

/**
 * A garment on another product's style gets the style it should be, found the way the reading finds one (this
 * customer's past orders, else our garment list and SanMar's, never a past order that made the same mistake): "TM1MW451
 * is the Auckland Slub Polo, but the paperwork's garment is TravisMathew Sunnyvale Polo; their past orders put it on
 * TM1MAA369 (TravisMathew Sunnyvale Polo)".
 */
async function suggestStyles(admin: SupabaseClient, customerId: string | null, groups: Group[], findings: SrcFinding[]) {
  const off = findings.filter((f) => f.kind === "style");
  if (!off.length || !customerId) return;
  const { stylesFromHistory } = await import("@/lib/ai/stylesFromHistory");
  const copies = off.map((f) => { const l = groups[f.group]?.lines?.find((x) => x.id === f.lineIds[0]); return l ? { ...l } : null; });
  const was = copies.map((l) => l?.style || "");
  const done = await stylesFromHistory(admin, customerId, { groups: [{ lines: copies.filter(Boolean) }] } as never);
  const now = copies.map((l, i) => (l?.style && l.style !== was[i] ? l.style : ""));
  const want = [...new Set(now.filter(Boolean))];
  const { data } = want.length ? await admin.from("sanmar_styles").select("style, title").in("style", want) : { data: [] };
  const title = new Map(((data || []) as { style: string; title: string | null }[]).map((r) => [r.style.toUpperCase(), (r.title || "").replace(/\.?\s*\S+$/, "")]));
  off.forEach((f, i) => {
    const st = now[i];
    if (!st) return;
    const how = done.find((d) => d.includes(`= ${st}`))?.match(/\(([^)]+)\)$/)?.[1] || "their past orders";
    f.fix = st;
    f.say = `${f.say.replace(/\.$/, "")}; ${how === "their past orders" ? "their past orders put it on" : "the catalog's match is"} ${st}${title.get(st) ? ` (${title.get(st)})` : ""}.`;
  });
}
