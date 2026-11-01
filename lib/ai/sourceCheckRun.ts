import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lineQty, orderGroups, type Design, type Group, type Order } from "@/lib/pricing";
import { applyColorway, applyColorwayChange, colorwaysOf, sewKindOf } from "@/lib/brands";
import { sourceCheck, type SrcCatalog, type SrcFinding, type SrcLogo } from "@/lib/sourceCheck";

/**
 * What lib/sourceCheck.ts needs to know beyond the words: the catalog's name, brand and colors for each style on the
 * order, and the customer's logos (each print's logo and the other logos of its brand, with their versions), so
 * "Primary" vs "Stacked" and "All White" can be told. Used at the reading (lib/ai/emailOrder.ts), in the order check
 * (lib/ai/orderFix.ts) and before an order is kept as a worked example (app/shop/ai-actions.ts markOrderChecked).
 */
export async function sourceCtx(admin: SupabaseClient, groups: Group[]): Promise<{ catalog: SrcCatalog; logos: SrcLogo[]; designs: Map<string, Design> }> {
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
  return { catalog, logos, designs: new Map(rows.map((d) => [d.id, d as unknown as Design])) };
}

/**
 * A logo's version the paperwork names, put on the order at the reading (Oct 31, #40330: the cart said "MEI Stacked Logo
 * All White" on four garments and "Icon Only (M) All Black" on one; the reading recolored the thread but kept the Full
 * Color version and its sew file). The whole print takes that version (its sew file, threads, picture) when every garment
 * of the group asked for it; else those garment colors get it as a colorway change. Any logo, any version, any method.
 */
export function applyColorwayFixes(groups: Group[], findings: SrcFinding[], designs: Map<string, Design>): { groups: Group[]; did: string[] } {
  const did: string[] = [];
  const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = groups.map((g) => ({ ...g, imprints: [...(g.imprints || [])] }));
  // one per print and version: several garments of a group asking for the same version are the whole group's (Oct 31,
  // #40332: six garments all asked All White, and each got it as a color change on a Maroon / Black print)
  const by = new Map<string, SrcFinding>();
  for (const f of findings) {
    if (f.kind !== "colorway" || !f.designId) continue;
    const k = `${f.group}|${f.designId}|${key(f.paper)}`, was = by.get(k);
    by.set(k, was ? { ...was, lineIds: [...new Set([...was.lineIds, ...f.lineIds])], what: `${was.what}, ${f.what}` } : f);
  }
  for (const f of by.values()) {
    if (f.kind !== "colorway" || !f.designId) continue;
    const g = out[f.group], d = designs.get(f.designId);
    if (!g || !d) continue;
    const k = g.imprints.findIndex((im) => im.design_id === f.designId);
    const cw = colorwaysOf(d).find((c) => key(c.name) === key(f.paper));
    if (k < 0 || !cw) continue;
    const lines = (g.lines || []).filter((l) => lineQty(l) > 0), mine = lines.filter((l) => f.lineIds.includes(l.id));
    if (!mine.length) continue;
    const im = g.imprints[k];
    if (mine.length === lines.length) g.imprints[k] = applyColorway({ ...im, colorwayBy: undefined, inkBy: undefined }, d, cw, sewKindOf(lines));
    else g.imprints[k] = applyColorwayChange(im, d, { ...(im.colorwayBy || {}), ...Object.fromEntries(mine.map((l) => [l.color || "", cw.name])) });
    did.push(`${f.what}: ${d.name} in ${cw.name}`);
  }
  return { groups: out, did };
}

/**
 * The logo the paperwork names, put on the order at the reading (Oct 31, #40332: the cart's "MEI Stacked Logo" was read
 * as the SMM stacked logo, a look-alike with no sew files): the print takes that logo, in the same version when it has
 * one (its sew file, threads, inks). Only where every garment of the group names it; otherwise it's asked.
 */
export function applyLogoFixes(groups: Group[], findings: SrcFinding[], designs: Map<string, Design>): { groups: Group[]; did: string[] } {
  const did: string[] = [];
  const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = groups.map((g) => ({ ...g, imprints: [...(g.imprints || [])] }));
  const by = new Map<string, SrcFinding>();
  for (const f of findings) {
    if (f.kind !== "logo" || !f.designId || !f.toDesign) continue;
    const k = `${f.group}|${f.printId || f.designId}|${f.toDesign}`, was = by.get(k);
    by.set(k, was ? { ...was, lineIds: [...new Set([...was.lineIds, ...f.lineIds])] } : f);
  }
  for (const f of by.values()) {
    const g = out[f.group], d2 = designs.get(f.toDesign!);
    if (!g || !d2) continue;
    const k = g.imprints.findIndex((im) => (f.printId ? im.id === f.printId : im.design_id === f.designId));
    const lines = (g.lines || []).filter((l) => lineQty(l) > 0);
    if (k < 0 || !lines.length || !lines.every((l) => f.lineIds.includes(l.id))) continue;
    const im = g.imprints[k];
    const x = { ...im, design_id: d2.id, emb: im.emb ? { ...im.emb, file: undefined } : im.emb } as typeof im;
    delete x.shownArt; delete x.inkMap;
    const cw = im.colorway ? colorwaysOf(d2).find((c) => key(c.name) === key(im.colorway!)) : null;
    g.imprints[k] = cw ? applyColorway(x, d2, cw, sewKindOf(lines)) : x;
    did.push(`${f.what}: the ${d2.name} logo`);
  }
  return { groups: out, did };
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

/**
 * A garment the paperwork has decorated another way than its group (Oct 31, #40334: an embroidered polo in the heat
 * transfer group), moved at the reading to the group that prints the same logo at the same spot that way. Returns the
 * prints it went into, so the reading fills them again for the garments they have now (their colors' versions).
 */
export function applyMethodFixes(groups: Group[], findings: SrcFinding[]): { groups: Group[]; did: string[]; touched: string[] } {
  const did: string[] = [], touched: string[] = [];
  let out = groups.map((g) => ({ ...g, lines: [...(g.lines || [])], imprints: [...(g.imprints || [])] }));
  const norm = (x?: string) => (x || "").trim().toLowerCase();
  for (const f of findings) {
    if (f.kind !== "method" || !f.fix) continue;
    const from = out[f.group];
    if (!from) continue;
    const logos = from.imprints.filter((im) => im.design_id);
    const to = out.find((g, i) => i !== f.group && g.imprints.length === logos.length && logos.every((im) => g.imprints.some((x) => x.design_id === im.design_id && norm(x.location) === norm(im.location) && x.method === f.fix)));
    if (!to) continue;
    const moving = from.lines.filter((l) => f.lineIds.includes(l.id));
    if (!moving.length) continue;
    from.lines = from.lines.filter((l) => !f.lineIds.includes(l.id));
    to.lines.push(...moving);
    touched.push(...to.imprints.map((im) => im.id));
    did.push(`${f.what}: ${f.fix === "dtf" ? "heat transfer" : f.fix}, with the others done that way`);
  }
  out = out.filter((g) => g.lines.length || !(groups.find((x) => x.id === g.id)?.lines || []).length);
  return { groups: out, did, touched };
}
