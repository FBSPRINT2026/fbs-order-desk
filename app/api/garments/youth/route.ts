import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ssConfigured, ssSearch } from "@/lib/ss";
import { sanmarCompanions, sanmarConfigured } from "@/lib/sanmar";

export const dynamic = "force-dynamic";

/**
 * The youth style that goes with an adult style (Oct 21, Nick: "1717 → 9018, Gildan 5000 → 5000B… if you don't know,
 * ask me and remember it"), for "+ Add youth" on an order's garments.
 *  GET ?style=1717&brand=Comfort Colors → { known: {style, brand} | null, guesses: [{style, brand, title, supplier, sure}] }
 *    known: a pair someone keyed in or picked (garment_youth). Guesses: first SanMar's own companion styles that are
 *    youth (1717's companions include 1745Y and 9018), then the brand's youth styles in SanMar's catalog
 *    whose name matches the adult one with "Youth" in it ("Heavyweight Ring Spun Tee" → "Youth Heavyweight Ring Spun
 *    Tee"), and the usual youth numbers (5000B, PC54Y, 3001Y) where S&S or SanMar carries them. `sure`: one clear match.
 *  POST { adult, adultBrand, youth, youthBrand, source } → remembered for next time (staff).
 */
const STOP = new Set(["youth", "adult", "unisex", "mens", "men's", "the", "and", "with", "-", "."]);
const words = (t: string, brand: string, style: string) => {
  const drop = new Set([...brand.toLowerCase().split(/\s+/), style.toLowerCase()]);
  return new Set(t.toLowerCase().replace(/[^a-z0-9%' ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w) && !drop.has(w)));
};
const like = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n); };

export async function GET(req: Request) {
  const { user } = await getViewer();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const style = (sp.get("style") || "").trim(), brand = (sp.get("brand") || "").trim();
  if (!style) return NextResponse.json({ error: "Which style?" }, { status: 400 });
  const admin = createAdminClient();
  const key = style.toUpperCase();
  const { data: k } = await admin.from("garment_youth").select("youth, youth_brand, source").eq("adult", key).maybeSingle();
  if (k) return NextResponse.json({ known: { style: k.youth, brand: k.youth_brand || brand, source: k.source }, guesses: [] });

  type G = { style: string; brand: string; title: string; supplier: "sanmar" | "ss"; score: number };
  const out: G[] = [];
  // the adult style's name in SanMar's catalog (or the one the order has), and the brand's youth styles
  const { data: me } = await admin.from("sanmar_styles").select("style, brand, title").ilike("style", key).maybeSingle();
  const b = brand || me?.brand || "";
  const adultTitle = me?.title || sp.get("title") || "";
  // SanMar's companion styles: the youth ones, the closest name first (1717 → 9018 "Youth Heavyweight Ring Spun Tee"
  // ahead of 1745Y)
  if (sanmarConfigured()) {
    const comp = await sanmarCompanions(key).catch(() => [] as string[]);
    if (comp.length) {
      const { data: cs } = await admin.from("sanmar_styles").select("style, brand, title").in("style", comp);
      const aw = words(adultTitle, b || me?.brand || "", style);
      for (const y of (cs || []) as { style: string; brand: string; title: string }[]) {
        if (!/youth|kid|boys|girls/i.test(y.title) && !/Y$/i.test(y.style)) continue;
        out.push({ style: y.style, brand: y.brand, title: y.title, supplier: "sanmar", score: 1 + like(aw, words(y.title, y.brand, y.style)) });
      }
    }
  }
  if (b) {
    const { data: ys } = await admin.from("sanmar_styles").select("style, brand, title").eq("sellable", true).ilike("brand", b).or("title.ilike.%youth%,title.ilike.%kids%,style.ilike.%Y,style.ilike.%B").limit(300);
    const aw = words(adultTitle, b, style);
    for (const y of (ys || []) as { style: string; brand: string; title: string }[]) {
      if (y.style.toUpperCase() === key || !/youth|kid|boys|girls/i.test(y.title) || out.some((g) => g.style === y.style)) continue;
      let sc = like(aw, words(y.title, b, y.style));
      if (y.style.toUpperCase().startsWith(key)) sc += 0.35; // 5000 → 5000B, PC54 → PC54Y
      if (sc > 0.2) out.push({ style: y.style, brand: y.brand, title: y.title, supplier: "sanmar", score: sc });
    }
  }
  // the usual youth numbers, where SanMar or S&S carries them
  const tries = [`${key}B`, `${key}Y`, `Y${key}`, `${key}YCVC`].filter((t) => !out.some((g) => g.style.toUpperCase() === t));
  if (tries.length) {
    const { data: sm } = await admin.from("sanmar_styles").select("style, brand, title").eq("sellable", true).in("style", tries);
    for (const y of (sm || []) as { style: string; brand: string; title: string }[]) if (!b || y.brand.toLowerCase() === b.toLowerCase()) out.push({ style: y.style, brand: y.brand, title: y.title, supplier: "sanmar", score: 0.6 });
    if (ssConfigured()) {
      for (const t of tries.filter((t) => !out.some((g) => g.style.toUpperCase() === t)).slice(0, 2)) {
        const hits = await ssSearch(t).catch(() => []);
        const h = hits.find((x) => x.style.toUpperCase() === t && (!b || x.brand.toLowerCase() === b.toLowerCase()));
        if (h) out.push({ style: h.style, brand: h.brand, title: h.title, supplier: "ss", score: 0.6 });
      }
    }
  }
  out.sort((a, c) => c.score - a.score);
  const top = out.slice(0, 4);
  // sure: a close name match well ahead of the next one
  // (a SanMar companion counts 1 + its name match: the only youth companion, or one clearly closer than the next)
  const sure = !!top[0] && top[0].score >= 0.7 && (!top[1] || top[0].score - top[1].score >= 0.2 || (top[0].score >= 1.5 && top[1].score < 1.3));
  return NextResponse.json({ known: null, guesses: top.map((g, i) => ({ style: g.style, brand: g.brand, title: g.title, supplier: g.supplier, sure: i === 0 && sure })) });
}

export async function POST(req: Request) {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) return NextResponse.json({ ok: true, learned: false });
  const b = (await req.json().catch(() => ({}))) as { adult?: string; adultBrand?: string; youth?: string; youthBrand?: string; source?: string };
  const adult = String(b.adult || "").trim().toUpperCase().slice(0, 40), youth = String(b.youth || "").trim().toUpperCase().slice(0, 40);
  if (!adult || !youth || adult === youth) return NextResponse.json({ error: "Which styles?" }, { status: 400 });
  const { error } = await createAdminClient().from("garment_youth").upsert({ adult, adult_brand: String(b.adultBrand || "").slice(0, 80), youth, youth_brand: String(b.youthBrand || "").slice(0, 80), source: b.source === "catalog" ? "catalog" : "staff", by: String(v.staff?.name || "") || v.email.split("@")[0], at: new Date().toISOString() }, { onConflict: "adult" });
  if (error) return NextResponse.json({ error: /garment_youth/.test(error.message) ? "Run supabase/migrations/183_garment_youth.sql first." : error.message }, { status: 500 });
  return NextResponse.json({ ok: true, learned: true });
}
