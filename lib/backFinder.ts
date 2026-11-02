import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, imageTypeOf } from "@/lib/ai/claude";

/**
 * A garment color with no flat back photo at S&S or SanMar, found online (Nov 1, Nick: "Typically, I would just Google
 * it… I found these online and this looks like a match. Do you want to bring this in?… It might be easier to just bring in
 * the front and the back… that way you know it's formatted similar… if you can't, then you find just the back").
 *
 *  1. Claude searches the web for shops that sell the style in that color with product photos (no model).
 *  2. Each page's pictures are read off the page (its product images, og:image, srcset, the JSON a shop page carries).
 *  3. Claude looks at them beside our front and pairs each page's front and back of that color, flat, on white: a pair
 *     from one site first (both sides framed and lit the same, so they size alike), else that site's back alone.
 * Staff pick one; nothing is saved until they do (the photo route's setBack, from "web").
 */
export type WebBack = { site: string; page: string; back: string; front?: string; score: number; note: string };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/** a public https address (never our own network) */
export function publicUrl(s: string): URL | null {
  let u: URL; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":")) return null;
  return u;
}
async function get(url: string, ms: number, accept: string): Promise<Response | null> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" } }); return r.ok ? r : null; }
  catch { return null; } finally { clearTimeout(t); }
}
/** a picture off the web: its bytes when it's a real JPEG/PNG/WebP under 6 MB */
export async function webImage(url: string, ms = 8000): Promise<{ buf: Buffer; type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" } | null> {
  if (!publicUrl(url)) return null;
  const r = await get(url, ms, "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5");
  if (!r) return null;
  const len = +(r.headers.get("content-length") || 0); if (len > 6e6) return null;
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 6e6) return null;
  const type = imageTypeOf(buf.subarray(0, 16)); return type ? { buf, type } : null;
}

const slug = (s: string) => (s || "").toLowerCase().replace(/grey/g, "gray").replace(/[^a-z0-9]+/g, "");
/** the product pictures on a shop's page, best guesses first (this color, a back view, big) */
export function pageImages(html: string, base: string, color: string): string[] {
  const found = new Map<string, number>();
  const col = slug(color), colWords = color.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const add = (raw: string) => {
    let s = (raw || "").trim().replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    if (!s || s.startsWith("data:")) return;
    if (s.startsWith("//")) s = "https:" + s;
    let u: URL; try { u = new URL(s, base); } catch { return; }
    if (u.protocol === "http:") u.protocol = "https:";
    const href = u.toString(), low = decodeURIComponent(href).toLowerCase();
    if (!/\.(jpe?g|png|webp)(\b|$)|\/image|format=(jpe?g|png|webp)|\/media\//.test(low)) return;
    if (/\.(svg|gif)(\?|$)|sprite|logo|icon|favicon|badge|banner|swatch|placeholder|payment|flag|avatar|rating|star|loader|spinner/.test(low)) return;
    let sc = 0;
    const flat = slug(low);
    if (col && flat.includes(col)) sc += 4; else if (colWords.some((w) => low.includes(w))) sc += 2;
    if (/(^|[^a-z])(back|bk|rear)([^a-z]|$)|_b\.|-b\.|_back|back_/.test(low)) sc += 3;
    if (/(^|[^a-z])(front|fr|fl)([^a-z]|$)|_f\.|-f\./.test(low)) sc += 1;
    if (/thumb|_xs|_sm\b|small|50x|100x|w=\d{2}\b|width=\d{2}\b/.test(low)) sc -= 3;
    if (/model|lifestyle|onmodel|_om_/.test(low)) sc -= 2;
    found.set(href, Math.max(found.get(href) ?? -99, sc));
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)/gi)) add(m[1]);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    for (const a of tag.matchAll(/\b(?:src|data-src|data-zoom-image|data-large|data-full|data-original|data-image)=["']([^"']+)["']/gi)) add(a[1]);
    const ss = tag.match(/\b(?:srcset|data-srcset)=["']([^"']+)["']/i);
    if (ss) { const parts = ss[1].split(",").map((x) => x.trim().split(/\s+/)[0]); add(parts[parts.length - 1]); }
  }
  for (const m of html.matchAll(/https?:(?:\/|\\\/){2}[^"'\s<>()]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s<>()\\]*)?/gi)) add(m[0]);
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

type Ai = { model: string; admin: SupabaseClient; by?: string };
/** shop pages for the style in that color, found by Claude's web search */
async function findPages(ai: Ai, what: string): Promise<string[]> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return [];
  const started = Date.now();
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45_000);
  let usage: { input_tokens?: number; output_tokens?: number } = {}, error = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ai.model, max_tokens: 700,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        system: "You find product pages for blank apparel. Search the web for shops that sell the exact style in the exact color and show flat product photos (laid flat or ghost mannequin, no person), ideally both the front and the back. Good sources: the brand's own site, Jiffy Shirts, ShirtSpace, Bulk Apparel, BlankStyle, Apparel Wholesale, TSC Apparel, Amazon. Skip ssactivewear.com and sanmar.com (already checked). Answer with only the product page URLs, one per line, best first, at most 6. A page for the style that has a color picker counts. No other words.",
        messages: [{ role: "user", content: `Find product pages with front and back photos of: ${what}` }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    usage = j?.usage || {};
    if (!r.ok) { error = j?.error?.message || `Claude API error ${r.status}`; return []; }
    type B = { type: string; text?: string; content?: { url?: string }[] };
    const blocks = (j.content || []) as B[];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
    const urls = [...text.matchAll(/https:\/\/[^\s)<>"'\]]+/g)].map((m) => m[0].replace(/[.,;]+$/, ""));
    // the search's own results as a fallback
    for (const b of blocks) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const x of b.content) if (x.url) urls.push(x.url);
    const out: string[] = [];
    for (const u of urls) { const p = publicUrl(u); if (!p || /ssactivewear|sanmar\.com/i.test(p.hostname)) continue; if (!out.includes(p.toString())) out.push(p.toString()); }
    return out.slice(0, 6);
  } catch (e) { error = e instanceof Error ? e.message : "search failed"; return []; }
  finally {
    clearTimeout(t);
    await ai.admin.from("ai_runs").insert({ task: "find_back_search", model: ai.model, ms: Date.now() - started, created_by: ai.by || "system", input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, status: error ? "error" : "ok", error: error || null });
  }
}

const TOOL = {
  name: "photo_pairs",
  description: "The flat front and back photos of the garment in the asked color, paired by page.",
  input_schema: {
    type: "object",
    properties: {
      pairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            back: { type: "integer", description: "the picture number of the back view" },
            front: { type: ["integer", "null"], description: "the front view from the SAME page, same color and same style of photo; null when that page has none" },
            score: { type: "integer", description: "0-100: how good a match (right style shape, right color, flat or ghost mannequin, plain white background, whole garment in frame)" },
            note: { type: "string", description: "a few words, e.g. 'flat, white background' or 'color looks lighter'" },
          },
          required: ["back", "front", "score", "note"],
        },
      },
    },
    required: ["pairs"],
  },
};

/** the whole search: pages → their pictures → the pairs Claude sees, best first */
export async function findWebBacks(ai: Ai, g: { brand: string; style: string; title?: string; color: string; front?: { buf: Buffer; type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" } | null }): Promise<{ found: WebBack[]; searched: string[] }> {
  const what = `${g.brand} ${g.style}${g.title ? ` (${g.title})` : ""} in the color "${g.color}"`;
  const pages = await findPages(ai, what);
  if (!pages.length) return { found: [], searched: [] };
  // each page's likeliest product pictures
  const per = await Promise.all(pages.map(async (p) => {
    const r = await get(p, 9000, "text/html,application/xhtml+xml");
    const html = r ? (await r.text().catch(() => "")).slice(0, 3_000_000) : "";
    return { page: p, imgs: html ? pageImages(html, r!.url || p, g.color).slice(0, 10) : [] };
  }));
  const cand: { page: string; url: string }[] = [];
  for (const x of per) for (const u of x.imgs) cand.push({ page: x.page, url: u });
  const got = await Promise.all(cand.map(async (c) => ({ ...c, img: await webImage(c.url, 7000) })));
  // too small to be a product photo
  // too big for the AI to look at (over 3.5 MB, or past ~18 MB in all): left out
  let total = 0;
  const ok = got.filter((c) => { if (!c.img || c.img.buf.length <= 9000 || c.img.buf.length > 3.5e6 || total + c.img.buf.length > 18e6) return false; total += c.img.buf.length; return true; }).slice(0, 36) as (typeof got[number] & { img: NonNullable<typeof got[number]["img"]> })[];
  if (!ok.length) return { found: [], searched: pages };
  const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
  const images = [
    ...(g.front ? [{ media_type: g.front.type, data: g.front.buf.toString("base64"), label: "OUR FRONT PHOTO (reference: the style and color to match)" }] : []),
    ...ok.map((c, i) => ({ media_type: c.img.type, data: c.img.buf.toString("base64"), label: `Picture ${i + 1} (from ${host(c.page)}):` })),
  ];
  const res = await askClaude<{ pairs: { back: number; front: number | null; score: number; note: string }[] }>({
    task: "find_back_pick", model: ai.model, admin: ai.admin, ctx: { by: ai.by }, tool: TOOL, images, maxTokens: 1500, timeoutMs: 60_000,
    system: "You pick garment product photos for a screen printing shop's mockups. A good photo shows the whole garment laid flat or on a ghost (invisible) mannequin, no person, on a plain white or near-white background, in the exact color asked. Never pick a photo with a person in it, a close-up, a folded garment, a different color, or a different style.",
    prompt: `We need the BACK view of ${what}. Look at the numbered pictures. List every picture that is the back of this garment in this color, flat or ghost mannequin. For each, give the front view from the same site in the same color and the same kind of photo (so both sides match), or null. Best first. Leave out anything that isn't a back view of this garment in "${g.color}".`,
  });
  if (!res.ok) return { found: [], searched: pages };
  const found: WebBack[] = [];
  for (const p of res.data.pairs || []) {
    const b = ok[p.back - 1]; if (!b) continue;
    const f = p.front ? ok[p.front - 1] : undefined;
    if (found.some((x) => x.back === b.url)) continue;
    found.push({ site: host(b.page), page: b.page, back: b.url, ...(f && f.page === b.page && f.url !== b.url ? { front: f.url } : {}), score: Math.max(0, Math.min(100, Math.round(+p.score || 0))), note: String(p.note || "").slice(0, 80) });
  }
  // a matching pair from one site first, then the best backs alone
  found.sort((a, b) => (b.score + (b.front ? 15 : 0)) - (a.score + (a.front ? 15 : 0)));
  return { found: found.filter((x) => x.score >= 40).slice(0, 6), searched: pages };
}
