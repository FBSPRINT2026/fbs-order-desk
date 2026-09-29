import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandRank, ssConfigured, ssSearch, type SSHit } from "@/lib/ss";
import { sanmarConfigured } from "@/lib/sanmar";

export const dynamic = "force-dynamic";

type Hit = SSHit & { supplier: "ss" | "sanmar" };

/** SanMar styles from our copy of SanMar's catalog (sanmar_styles), best matches first. */
async function sanmarSearch(q: string): Promise<Hit[]> {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9\-+&\/]/g, "")).filter((w) => w.length >= 1).slice(0, 4);
  if (!words.length) return [];
  const stripped = words.length === 1 ? words[0].replace(/^[a-z]{1,2}(?=\d)/, "") : "";
  const ors = words.flatMap((w) => [`style.ilike.${w}%`, `title.ilike.%${w}%`, `brand.ilike.%${w}%`]);
  if (stripped && stripped !== words[0]) ors.push(`style.ilike.${stripped}%`);
  const { data } = await createAdminClient().from("sanmar_styles").select("style, brand, title, image").eq("sellable", true).or(ors.join(",")).limit(400);
  const rows = (data || []) as { style: string; brand: string; title: string; image: string }[];
  const lc = (x: string) => (x || "").toLowerCase();
  const full = q.trim().toLowerCase();
  const score = (r: { style: string; brand: string; title: string }) => {
    const st = lc(r.style);
    if (st === full || st === stripped || `${lc(r.brand)} ${st}` === full) return 0;
    if (words.some((w) => st.startsWith(w)) || (stripped && st.startsWith(stripped))) return 1;
    return 2;
  };
  return rows
    .filter((r) => { const hay = lc(`${r.brand} ${r.style} ${r.title}`); return words.every((w) => hay.includes(w)) || (stripped && lc(r.style).startsWith(stripped)); })
    .sort((a, b) => score(a) - score(b) || brandRank(a.brand) - brandRank(b.brand) || a.style.length - b.style.length || a.style.localeCompare(b.style))
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
