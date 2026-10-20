import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CatalogRules } from "@/lib/designCatalog";
import { safeUrl } from "@/lib/safeUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Pictures of a design from the customer's own website (Oct 20, Nick: "try to find from customer site… Dear Heart
 * Designs is its own site. They have all their images on there"). GET ?customer=<id>&q=<design name> searches the
 * site's products (Shopify stores: their search, then each product's pictures); &url=<a product page> reads that page.
 * The site is the one saved on the customer's designs, else their email's domain (not gmail and the like).
 */
type Product = { title: string; url: string; images: string[] };
const FREE = /^(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn|me|comcast|att|sbcglobal|ymail|proton|protonmail)\./i;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; FBSPrintPortal/1.0)", Accept: "application/json,text/html;q=0.9,*/*;q=0.5" };

async function get(u: string, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(u, { headers: UA, signal: ac.signal, redirect: "follow" }); } catch { return null; } finally { clearTimeout(t); }
}
/** a Shopify picture at a sensible size */
const sized = (src: string, w = 1200) => { const x = safeUrl(src); if (!x) return ""; if (/\/cdn\/shop\/|cdn\.shopify\.com/.test(x.href)) x.searchParams.set("width", String(w)); return x.href; };

async function productAt(url: URL): Promise<Product | null> {
  // Shopify: the product page + ".json"
  const m = /\/products\/([^/?#]+)/.exec(url.pathname);
  if (m) {
    const r = await get(`${url.origin}/products/${m[1]}.json`);
    const j = r?.ok ? await r.json().catch(() => null) as { product?: { title?: string; images?: { src?: string }[] } } | null : null;
    if (j?.product) return { title: j.product.title || m[1], url: `${url.origin}/products/${m[1]}`, images: (j.product.images || []).map((i) => sized(i.src || "")).filter(Boolean).slice(0, 12) };
  }
  // any page: its share picture and the big pictures on it
  const r = await get(url.href);
  const html = r?.ok ? (await r.text()).slice(0, 2_000_000) : "";
  if (!html) return null;
  const title = (/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html) || /<title>([^<]+)/i.exec(html))?.[1]?.trim() || url.hostname;
  const found = [
    ...[...html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/gi)].map((x) => x[1]),
    ...[...html.matchAll(/(?:https?:)?\/\/[^"'\s)]+\/cdn\/shop\/(?:files|products)\/[^"'\s)?]+\.(?:jpe?g|png|webp)/gi)].map((x) => x[0]),
  ].map((s) => { try { return new URL(s, url).href; } catch { return ""; } }).map((s) => sized(s)).filter(Boolean);
  const seen = new Set<string>(), images: string[] = [];
  for (const s of found) { const k = s.split("?")[0]; if (!seen.has(k)) { seen.add(k); images.push(s); } }
  return { title, url: url.href, images: images.slice(0, 12) };
}

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const cid = sp.get("customer") || "", q = (sp.get("q") || "").trim(), link = (sp.get("url") || "").trim();
  if (!cid) return NextResponse.json({ error: "Which customer?" }, { status: 400 });
  const admin = createAdminClient();
  const [{ data: c }, { data: row }] = await Promise.all([
    admin.from("customers").select("email, contact2_email").eq("id", cid).maybeSingle(),
    admin.from("customer_designs").select("rules").eq("customer_id", cid).maybeSingle(),
  ]);
  const saved = ((row?.rules || {}) as CatalogRules & { site?: string }).site || "";
  const dom = [c?.email, c?.contact2_email].map((e) => String(e || "").split("@")[1] || "").find((d) => d && !FREE.test(d)) || "";
  const site = saved || (dom ? `https://www.${dom.replace(/^www\./, "")}` : "");

  if (link) {
    const u = safeUrl(link);
    if (!u) return NextResponse.json({ error: "That isn't a web address." }, { status: 400 });
    const p = await productAt(u);
    return NextResponse.json({ site, products: p && p.images.length ? [p] : [], error: p && p.images.length ? undefined : "No pictures found on that page." });
  }
  if (!site) return NextResponse.json({ site: "", products: [], error: "No website on file for this customer. Paste a link to the product page." });
  const base = safeUrl(site);
  if (!base) return NextResponse.json({ site, products: [], error: "Their website address doesn't look right." });
  const origin = base.origin;
  // Shopify search
  const r = await get(`${origin}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=6`);
  const j = r?.ok ? await r.json().catch(() => null) as { resources?: { results?: { products?: { title?: string; url?: string; handle?: string }[] } } } | null : null;
  const hits = j?.resources?.results?.products || [];
  if (!hits.length) return NextResponse.json({ site: origin, products: [], error: r?.ok ? `Nothing on ${base.hostname} matches "${q}". Paste a link to the product page.` : `${base.hostname} couldn't be searched. Paste a link to the product page.` });
  const products = (await Promise.all(hits.slice(0, 6).map((h) => { const u = safeUrl(new URL(h.url || `/products/${h.handle}`, origin).href); return u ? productAt(u) : null; }))).filter((p): p is Product => !!p && p.images.length > 0);
  return NextResponse.json({ site: origin, products });
}
