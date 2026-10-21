import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandRank, ssConfigured, ssSearch, type SSHit } from "@/lib/ss";
import { sanmarConfigured } from "@/lib/sanmar";

export const dynamic = "force-dynamic";

type Hit = SSHit & { supplier: "ss" | "sanmar" };

/**
 * Words people type that the catalog says another way (Oct 21, Nick: "A4 cooling crew" didn't find A4's Cooling
 * Performance Short Sleeve Tee: SanMar never says "crew"). Each typed word matches any of these.
 */
const SAME: Record<string, string[]> = {
  crew: ["crew", "tee", "t-shirt"], crewneck: ["crew", "tee", "sweatshirt"], tee: ["tee", "t-shirt"], tees: ["tee", "t-shirt"], shirt: ["shirt", "tee"], tshirt: ["t-shirt", "tee"], "t-shirt": ["t-shirt", "tee"],
  hoodie: ["hoodie", "hooded"], hoody: ["hoodie", "hooded"], hooded: ["hooded", "hoodie"], sweat: ["sweat", "fleece"], ls: ["long sleeve"], ss: ["short sleeve"],
  longsleeve: ["long sleeve"], shortsleeve: ["short sleeve"], ladies: ["ladies", "women"], womens: ["women"], women: ["women", "ladies"], kids: ["youth"], youth: ["youth"],
  cap: ["cap", "hat"], hat: ["hat", "cap"], polo: ["polo", "sport shirt"], quarter: ["quarter", "1/4"], qtr: ["1/4", "quarter"], zip: ["zip"],
};
const altsOf = (w: string) => SAME[w] || [w];

/** SanMar styles from our copy of SanMar's catalog (sanmar_styles), best matches first. Every word (or a word it's
 *  the same as) must be in the brand, style or name; if nothing has them all, styles missing one word come back. */
async function sanmarSearch(q: string): Promise<Hit[]> {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9\-+&\/]/g, "")).filter((w) => w.length >= 1).slice(0, 5);
  if (!words.length) return [];
  const stripped = words.length === 1 ? words[0].replace(/^[a-z]{1,2}(?=\d)/, "") : "";
  const ors = (w: string) => altsOf(w).flatMap((a) => [`style.ilike.${a}%`, `title.ilike.%${a}%`, `brand.ilike.%${a}%`]);
  const admin = createAdminClient();
  type Row = { style: string; brand: string; title: string; image: string };
  // all the words (each word its own condition, so the database narrows it: no arbitrary first 400 rows)
  let qb = admin.from("sanmar_styles").select("style, brand, title, image").eq("sellable", true);
  if (stripped && stripped !== words[0]) qb = qb.or([...ors(words[0]), `style.ilike.${stripped}%`].join(","));
  else for (const w of words) qb = qb.or(ors(w).join(","));
  let rows = (((await qb.limit(400)).data) || []) as Row[];
  const lc = (x: string) => (x || "").toLowerCase();
  const hits = (r: Row) => { const hay = lc(`${r.brand} ${r.style} ${r.title}`); return words.filter((w) => altsOf(w).some((a) => hay.includes(a))).length; };
  if (!rows.length && words.length > 1) {
    // nothing has every word: the styles with all but one (the brand or style word must be there)
    const { data } = await admin.from("sanmar_styles").select("style, brand, title, image").eq("sellable", true).or(ors(words[0]).join(",")).limit(1000);
    rows = ((data || []) as Row[]).filter((r) => hits(r) >= words.length - 1);
  }
  const full = q.trim().toLowerCase();
  const score = (r: Row) => {
    const st = lc(r.style);
    if (st === full || st === stripped || `${lc(r.brand)} ${st}` === full) return 0;
    if (words.some((w) => st.startsWith(w)) || (stripped && st.startsWith(stripped))) return 1;
    return 2;
  };
  return rows
    .sort((a, b) => score(a) - score(b) || hits(b) - hits(a) || brandRank(a.brand) - brandRank(b.brand) || a.style.length - b.style.length || a.style.localeCompare(b.style))
    .slice(0, 25)
    .map((r) => ({ styleID: 0, brand: r.brand || "SanMar", style: r.style, title: r.title, image: r.image, supplier: "sanmar" as const }));
}

// Signed-in staff and customers: list S&S and SanMar styles matching a style number or name (no prices in the results).
export async function GET(req: Request) {
  const { user } = await getViewer();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const ss = ssConfigured(), sm = sanmarConfigured();
  if (!ss && !sm) return NextResponse.json({ error: "No supplier is connected yet." }, { status: 503 });
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  let err = "";
  const [a, b] = await Promise.all([
    ss ? ssSearch(q).then((r) => r.map((h): Hit => ({ ...h, supplier: "ss" }))).catch((e) => { err = e instanceof Error ? e.message : String(e); return [] as Hit[]; }) : Promise.resolve([] as Hit[]),
    sm ? sanmarSearch(q).catch(() => [] as Hit[]) : Promise.resolve([] as Hit[]),
  ]);
  if (!a.length && !b.length && err) return NextResponse.json({ error: err }, { status: 502 });
  // exact style matches from either supplier first, then the rest of S&S, then the rest of SanMar
  const t = q.toLowerCase(), stripped = t.replace(/^[a-z]{1,2}(?=\d)/, "");
  const exact = (h: Hit) => [t, stripped].includes(h.style.toLowerCase()) || `${h.brand} ${h.style}`.toLowerCase() === t;
  const results = [...a.filter(exact), ...b.filter(exact), ...a.filter((h) => !exact(h)), ...b.filter((h) => !exact(h))].slice(0, 45);
  return NextResponse.json({ results });
}
