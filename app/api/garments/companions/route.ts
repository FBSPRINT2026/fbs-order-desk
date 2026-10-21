import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanmarCompanions, sanmarConfigured } from "@/lib/sanmar";

export const dynamic = "force-dynamic";

/**
 * The styles that go with a garment, like SanMar shows them (Oct 21, Nick: "Add Companion Style… the youth is 3001Y,
 * the women's is this model, the long sleeve is this model, just like SanMar does"), for "+ Add companion style" on an
 * order's garments.
 *  GET ?style=3001&brand=Bella + Canvas&color=Heather Navy → { style, kinds: [{ kind, items: [{ style, brand, title,
 *    image, inColor, remembered }] }] }
 *  SanMar's own companion styles (GetProduct RelatedProduct), sorted into Youth / Women's / Long sleeve / Tank /
 *  Sweatshirts & hoodies / Other; the youth style someone keyed in before (garment_youth) is added under Youth.
 *  `inColor`: SanMar lists the order line's color for it (null when we don't know the colors).
 */
type Item = { style: string; brand: string; title: string; image: string | null; inColor: boolean | null; remembered?: boolean };
const KINDS = ["Youth", "Toddler & infant", "Women's", "Long sleeve", "Tank", "Sweatshirts & hoodies", "Short sleeve", "Other"] as const;
function kindOf(title: string, category: string, style: string): (typeof KINDS)[number] {
  const t = `${title} ${category}`.toLowerCase();
  if (/toddler|infant|baby|onesie|bodysuit/.test(t)) return "Toddler & infant";
  if (/youth|kids?\b|boys|girls/.test(t) || /Y$/i.test(style)) return "Youth";
  if (/women|ladies|womens|\bwomen's/.test(t)) return "Women's";
  if (/hood|sweatshirt|crewneck|crew neck|fleece|pullover|zip/.test(t)) return "Sweatshirts & hoodies";
  if (/tank|sleeveless|muscle/.test(t)) return "Tank";
  if (/long sleeve|long-sleeve|\bls\b/.test(t)) return "Long sleeve";
  if (/tee|t-shirt|short sleeve/.test(t)) return "Short sleeve";
  return "Other";
}
const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, "");

export async function GET(req: Request) {
  const { user } = await getViewer();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const style = (sp.get("style") || "").trim().toUpperCase(), brand = (sp.get("brand") || "").trim(), color = (sp.get("color") || "").trim();
  if (!style) return NextResponse.json({ error: "Which style?" }, { status: 400 });
  const admin = createAdminClient();
  type Row = { style: string; brand: string; title: string; category: string | null; image: string | null; colors: string[] | null };
  const cols = "style, brand, title, category, image, colors";
  // the style as SanMar numbers it (an S&S "3001" is SanMar's "BC3001")
  let { data: me } = await admin.from("sanmar_styles").select(cols).ilike("style", style).maybeSingle();
  if (!me && brand) {
    const { data: alt } = await admin.from("sanmar_styles").select(cols).ilike("brand", brand).ilike("style", `%${style}`).limit(5);
    me = ((alt || []) as Row[]).find((r) => r.style.toUpperCase().replace(/^[A-Z]+/, "") === style.replace(/^[A-Z]+/, "")) || null;
  }
  const sm = (me as Row | null)?.style?.toUpperCase() || style;
  const comp = sanmarConfigured() ? await sanmarCompanions(sm).catch(() => [] as string[]) : [];
  const { data: rows } = comp.length ? await admin.from("sanmar_styles").select(cols).in("style", comp) : { data: [] };
  const items = new Map<string, Item & { kind: (typeof KINDS)[number] }>();
  const add = (r: Row, remembered = false) => {
    const k = r.style.toUpperCase();
    if (k === sm || k === style) return;
    const inColor = color && r.colors?.length ? r.colors.some((c) => norm(c) === norm(color)) : null;
    items.set(k, { style: r.style, brand: r.brand, title: r.title.replace(/\.\s*\S+$/, ""), image: r.image, inColor, remembered: remembered || items.get(k)?.remembered, kind: kindOf(r.title, r.category || "", r.style) });
  };
  for (const r of (rows || []) as Row[]) add(r);
  // the youth style someone picked before for this one
  const { data: y } = await admin.from("garment_youth").select("youth, youth_brand").eq("adult", style).maybeSingle();
  if (y?.youth) {
    const { data: yr } = await admin.from("sanmar_styles").select(cols).ilike("style", y.youth).maybeSingle();
    if (yr) add(yr as Row, true);
    else items.set(String(y.youth).toUpperCase(), { style: y.youth, brand: y.youth_brand || brand, title: "Youth (picked before)", image: null, inColor: null, remembered: true, kind: "Youth" });
    const it = items.get(String(y.youth).toUpperCase()); if (it) { it.kind = "Youth"; it.remembered = true; }
  }
  const kinds = KINDS.map((kind) => ({ kind, items: [...items.values()].filter((x) => x.kind === kind).sort((a, b) => Number(!!b.remembered) - Number(!!a.remembered) || Number(b.inColor === true) - Number(a.inColor === true)).map(({ kind: _k, ...x }) => x) })).filter((k) => k.items.length);
  return NextResponse.json({ style: sm, title: (me as Row | null)?.title?.replace(/\.\s*\S+$/, "") || "", kinds });
}
