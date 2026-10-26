import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanmarConfigured, sanmarSkus } from "@/lib/sanmar";
import { ssConfigured, ssOtherPhotos } from "@/lib/ss";
import { sanmarStyles } from "@/lib/sanmarStyle";
import { matchColor } from "@/lib/colorMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { garmentId, color } (staff) → a photo of a color our supplier has none of, from the other supplier (Oct 22, Nick:
 * "if S&S doesn't have an image of 64400 Neon Blue, I know SanMar does. Why didn't you pull it from there?"). SanMar is
 * asked for the same style (as written, and with Gildan's G in front); the color's flat front and back shots are saved
 * on the garment (color_images, marked from SanMar) so every mockup of it has them from now on.
 *
 * { want: "back" }: a color with a front photo but no back (Oct 26, Nick: S&S has no back of the Next Level 6221 in any
 * color): SanMar's back of the same style and color, saved the same way (back_from "sanmar"). None there either: the
 * color's other photos (on a model, the side) to pick from, and the search isn't repeated for 30 days.
 * { setBack: { path, from } }: the back picked for that color (one of those photos, an upload, or "drawn": the drawn back,
 * so it stops asking), saved on the garment for every mockup of it.
 */
const BACK_PATH = /^(Images\/[\w\/.\-]+\.(jpe?g|png|webp)|https:\/\/([\w-]+\.)*sanmar\.com\/[\w\/.\-%~]+\.(jpe?g|png|webp)|store:garment-backs\/[\w\/.\-]+\.(jpe?g|png|webp))$/i;
const sq = (s: string) => (s || "").toLowerCase().replace(/grey/g, "gray").replace(/[^a-z0-9]+/g, "");
export async function POST(req: Request) {
  const v = await getViewer(); if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { garmentId, color, want, setBack } = await req.json().catch(() => ({})) as { garmentId?: string; color?: string; want?: string; setBack?: { path?: string; from?: string } };
  if (!garmentId || !color?.trim()) return NextResponse.json({ error: "Which garment and color?" }, { status: 400 });
  const admin = createAdminClient();
  const { data: g } = await admin.from("garments").select("id, style, brand, supplier, supplier_style, color_images, ss_style_id").eq("id", garmentId).maybeSingle();
  if (!g) return NextResponse.json({ error: "That garment isn't in the catalog." }, { status: 404 });
  type Ci = { front?: string; back?: string; side?: string; hex?: string; from?: string; back_from?: string; back_checked?: string };
  const imgs = (g.color_images || {}) as Record<string, Ci>;
  const have = Object.entries(imgs).find(([k, x]) => sq(k) === sq(color) && x?.front);
  // the back picked for a color (Oct 26)
  if (setBack) {
    if (!have) return NextResponse.json({ error: "That color has no front photo." }, { status: 400 });
    const path = String(setBack.path || ""), from = String(setBack.from || "");
    if (path !== "drawn" && !BACK_PATH.test(path)) return NextResponse.json({ error: "That photo can't be used." }, { status: 400 });
    const entry: Ci = { ...have[1], back: path === "drawn" ? "" : path, back_from: path === "drawn" ? "drawn" : (["model", "upload", "side"].includes(from) ? from : "picked") };
    await admin.from("garments").update({ color_images: { ...imgs, [have[0]]: entry } }).eq("id", g.id);
    return NextResponse.json({ name: have[0], ...entry });
  }
  if (have && want === "back" && !have[1].back && !have[1].back_from) {
    const [name, ci] = have;
    // SanMar's back of the same style and color, unless it was looked for lately
    const lately = ci.back_checked && Date.now() - new Date(ci.back_checked).getTime() < 30 * 86400000;
    const sanmarModel: { label: string; path: string }[] = [];
    if (!lately && g.supplier !== "sanmar" && sanmarConfigured()) {
      for (const t of await sanmarStyles(admin, String(g.supplier_style || g.style || "").trim().toUpperCase(), String(g.brand || ""))) {
        const skus = (await sanmarSkus(t).catch(() => [])).filter((x) => x.backFlat || x.backModel);
        if (!skus.length) continue;
        let hit = skus.find((x) => sq(x.color) === sq(color) || sq(x.catalogColor) === sq(color));
        if (!hit) { const names = [...new Set(skus.flatMap((x) => [x.color, x.catalogColor]).filter(Boolean))]; const m = matchColor(color, names); if (m?.sure) hit = skus.find((x) => x.color === m.color || x.catalogColor === m.color); }
        if (!hit) continue;
        // a flat back is used as is; SanMar's back on a model is offered with the others
        if (!hit.backFlat) { sanmarModel.push({ label: "On a model, back (SanMar)", path: hit.backModel }); break; }
        const entry: Ci = { ...ci, back: hit.backFlat, back_from: "sanmar" };
        await admin.from("garments").update({ color_images: { ...imgs, [name]: entry } }).eq("id", g.id);
        return NextResponse.json({ name, ...entry });
      }
      await admin.from("garments").update({ color_images: { ...imgs, [name]: { ...ci, back_checked: new Date().toISOString() } } }).eq("id", g.id);
    }
    // none: the color's other photos to pick from
    const others = [...sanmarModel, ...(g.ss_style_id && ssConfigured() ? await ssOtherPhotos(g.ss_style_id as number, name).catch(() => []) : [])];
    if (ci.side && !others.some((o) => o.path === ci.side)) others.push({ label: "Side", path: ci.side });
    return NextResponse.json({ none: true, name, others });
  }
  if (have) return NextResponse.json({ name: have[0], ...have[1] });
  if (g.supplier === "sanmar" || !sanmarConfigured()) return NextResponse.json({ none: true });
  const st = String(g.supplier_style || g.style || "").trim().toUpperCase();
  // SanMar's number for it (BC3001CVC for 3001CVC, G-numbers for some Gildan: lib/sanmarStyle.ts)
  const tries = await sanmarStyles(admin, st, String(g.brand || ""));
  for (const t of tries) {
    const skus = (await sanmarSkus(t).catch(() => [])).filter((s) => s.front || s.image);
    if (!skus.length) continue;
    // SanMar shortens color names ("NeonBlue", "NeonRdOrng"): the same letters, else the closest name
    let hit = skus.find((s) => sq(s.color) === sq(color) || sq(s.catalogColor) === sq(color));
    if (!hit) { const names = [...new Set(skus.flatMap((s) => [s.color, s.catalogColor]).filter(Boolean))]; const m = matchColor(color, names); if (m?.sure) hit = skus.find((s) => s.color === m.color || s.catalogColor === m.color); }
    if (!hit) continue;
    const name = Object.keys(imgs).find((k) => sq(k) === sq(color)) || color.trim();
    const entry = { front: hit.front || hit.image, back: hit.back || "", side: "", hex: imgs[name]?.hex || "", from: "sanmar" };
    await admin.from("garments").update({ color_images: { ...imgs, [name]: entry } }).eq("id", g.id);
    return NextResponse.json({ name, ...entry });
  }
  return NextResponse.json({ none: true });
}
