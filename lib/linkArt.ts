import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Artwork sent as a LINK instead of an attachment (Oct 9, Nick: "she sent me a Canva link… learn to work with Canva").
 * Customers paste Canva, Dropbox and Google Drive links, and their company's mail filter wraps every link
 * (url.emailprotection.link, Outlook Safe Links, Proofpoint urldefense…). For each link in the customer's new text
 * (not the quoted thread under it) we follow the wrapper to the real address, then:
 *  - Canva design: Canva's own public preview of the shared design (oEmbed thumbnail, else the page's preview image).
 *    It's a picture of the design for mockups and quoting, NOT print-ready art: print art comes from the Canva
 *    connection (vector PDF) or the customer's download.
 *  - Dropbox / Google Drive / a direct file link: the file itself when it's art (picture, PDF, AI, EPS, SVG, ZIP).
 * What's found is saved with the email like an attachment ({ from_link, source }), so Create order, the Assistant and
 * the Mockup Creator use it the same way.
 */
export type LinkFile = { name: string; path: string; type: string; size: number; from_link: string; source: "canva-preview" | "download"; note?: string };
type Found = { url: string; final: string; kind: "canva" | "dropbox" | "drive" | "file" | "other"; saved?: LinkFile; error?: string };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ART_TYPE = /^(image\/|application\/(pdf|postscript|illustrator|zip|x-zip|octet-stream)|image\/svg)/i;
const MAX = 40 * 1024 * 1024;

/** the customer's own words: everything above the quoted thread ("From: … Sent:", "On … wrote:", "-----Original") */
export function newPart(body: string) {
  const cut = body.search(/\n\s*(From:\s.*\n\s*Sent:|On .{6,80} wrote:|-{3,}\s*Original Message)/i);
  return cut > 0 ? body.slice(0, cut) : body.slice(0, 6000);
}

/** links in text, without trailing punctuation / angle brackets; signature and social links skipped */
export function linksIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    if (/facebook|twitter|instagram|linkedin|mailto:|\.(gov|org)\/?$/i.test(u)) continue;
    out.add(u);
  }
  return [...out].slice(0, 8);
}

/** a mail filter's wrapper, decoded without a request when the real address is inside it */
function unwrap(u: string): string | null {
  try {
    const x = new URL(u);
    if (/safelinks\.protection\.outlook\.com$/i.test(x.hostname)) return x.searchParams.get("url");
    if (/urldefense\.(com|proofpoint\.com)$/i.test(x.hostname)) {
      const v3 = u.match(/\/v3\/__(.+?)__;/); if (v3) return v3[1];
      const q = x.searchParams.get("u"); if (q) return decodeURIComponent(q.replace(/-/g, "%").replace(/_/g, "/"));
    }
    if (/^(l|lm)\.facebook\.com$|google\.com$/i.test(x.hostname) && x.pathname === "/url") return x.searchParams.get("q") || x.searchParams.get("url");
  } catch { /* not a URL */ }
  return null;
}

/**
 * url.emailprotection.link (the filter Methodist and others use) answers with a "scanning this website" page: its
 * script opens a WebSocket to /scanning, sends the page's data-urlinfo, and gets back { redirect: { url } }
 * (or { refresh: { meta } } to send again). Done the same way here.
 */
async function emailProtection(pageUrl: string, html: string): Promise<string | null> {
  let info = html.match(/data-urlinfo=["']([^"']+)["']/i)?.[1];
  const WS = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!info || !WS) return null;
  const host = new URL(pageUrl).host;
  for (let round = 0; round < 3 && info; round++) {
    const got = await new Promise<{ url?: string; meta?: string } | null>((done) => {
      let settled = false;
      const end = (v: { url?: string; meta?: string } | null) => { if (settled) return; settled = true; try { sock.close(); } catch { /* closed */ } done(v); };
      const sock = new WS(`wss://${host}/scanning`);
      const timer = setTimeout(() => end(null), 25_000);
      sock.onopen = () => sock.send(info!);
      sock.onerror = () => { clearTimeout(timer); end(null); };
      sock.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(String(ev.data)) as { redirect?: { url?: string }; refresh?: { meta?: string } };
          if (d.redirect?.url) { clearTimeout(timer); end({ url: d.redirect.url }); }
          else if (d.refresh?.meta) { clearTimeout(timer); end({ meta: d.refresh.meta }); }
        } catch { /* keep waiting */ }
      };
    });
    if (got?.url) return new URL(got.url, pageUrl).toString();
    info = got?.meta;
  }
  return null;
}

/** follow redirects (HTTP, meta refresh, a script redirect) to the real address, at most 8 hops */
export async function resolveLink(url: string): Promise<string> {
  let u = url;
  for (let hop = 0; hop < 8; hop++) {
    const inner = unwrap(u); if (inner) { u = inner; continue; }
    let r: Response;
    try { r = await fetch(u, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) }); } catch { return u; }
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).toString(); continue; }
    // wrappers that answer with a page that sends you on (meta refresh or window.location)
    if (/text\/html/i.test(r.headers.get("content-type") || "") && !/canva\.com|dropbox\.com|drive\.google\.com/i.test(new URL(u).hostname)) {
      const html = (await r.text().catch(() => "")).slice(0, 200_000);
      if (/emailprotection\.link$/i.test(new URL(u).hostname)) { const real = await emailProtection(u, html); if (real) { u = real; continue; } return u; }
      const m = html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i) || html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) || html.match(/location\.replace\(\s*["']([^"']+)["']/i);
      if (m) { u = new URL(m[1].replace(/&amp;/g, "&"), u).toString(); continue; }
    }
    return u;
  }
  return u;
}

const kindOf = (u: string): Found["kind"] => {
  try {
    const h = new URL(u).hostname;
    if (/(^|\.)canva\.com$/i.test(h) && /\/design\//i.test(u)) return "canva";
    if (/(^|\.)dropbox(usercontent)?\.com$/i.test(h)) return "dropbox";
    if (/drive\.google\.com|docs\.google\.com/i.test(h)) return "drive";
    if (/\.(png|jpe?g|gif|webp|svg|pdf|ai|eps|zip|tiff?)(\?|$)/i.test(new URL(u).pathname)) return "file";
  } catch { /* skip */ }
  return "other";
};

async function download(u: string): Promise<{ buf: Buffer; type: string; name: string } | null> {
  const r = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const type = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!ART_TYPE.test(type)) return null;
  const len = +(r.headers.get("content-length") || 0); if (len > MAX) return null;
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX || buf.length < 200) return null;
  const cd = r.headers.get("content-disposition") || "";
  const name = (cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1] || new URL(r.url || u).pathname.split("/").pop() || "art").slice(-100);
  return { buf, type, name: decodeURIComponent(name) };
}

/** Canva: the shared design's preview picture (Canva's oEmbed, else the page's og:image) */
async function canvaPreview(u: string): Promise<{ buf: Buffer; type: string; name: string; title: string } | null> {
  const view = u.replace(/\/(edit|view)(\?.*)?$/i, "/view");
  let img = "", title = "";
  try {
    const r = await fetch(`https://www.canva.com/_oembed?url=${encodeURIComponent(view)}&format=json`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (r.ok) { const j = await r.json() as { thumbnail_url?: string; title?: string }; img = j.thumbnail_url || ""; title = j.title || ""; }
  } catch { /* try the page */ }
  if (!img) {
    const r = await fetch(view, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const html = r && r.ok ? (await r.text()).slice(0, 400_000) : "";
    img = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i) || [])[1] || "";
    title = title || ((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || "");
    img = img.replace(/&amp;/g, "&");
  }
  if (!img) return null;
  const d = await download(img);
  if (!d || !/^image\//.test(d.type)) return null;
  const ext = d.type.includes("png") ? "png" : d.type.includes("webp") ? "webp" : "jpg";
  return { ...d, name: `${(title || "Canva design").replace(/[^\w .-]+/g, " ").trim().slice(0, 60) || "Canva design"} (Canva preview).${ext}`, title };
}

/** Follow every link in the customer's new text and save the art found with the email. Safe to run again. */
export async function linkArtForEmail(admin: SupabaseClient, activityId: string, opts: { force?: boolean } = {}): Promise<{ ok: true; found: Found[] } | { ok: false; error: string }> {
  const { data: a } = await admin.from("activities").select("id, customer_id, direction, body, meta").eq("id", activityId).maybeSingle();
  if (!a) return { ok: false, error: "Email not found." };
  const meta = (a.meta || {}) as { attachments?: (LinkFile | { name: string; path: string; type: string; size: number })[]; link_art_at?: string };
  if (meta.link_art_at && !opts.force) return { ok: true, found: [] };
  const have = new Set((meta.attachments || []).map((f) => (f as LinkFile).from_link).filter(Boolean));
  const found: Found[] = [];
  // resolved all at once (each wrapper can take a few seconds to "scan")
  const urls = linksIn(newPart(String(a.body || "")));
  const finals = await Promise.all(urls.map((u) => resolveLink(u).catch(() => u)));
  for (const [i, url] of urls.entries()) {
    const final = finals[i];
    const kind = kindOf(final);
    const f: Found = { url, final, kind };
    found.push(f);
    if (kind === "other" || have.has(final)) continue;
    try {
      let got: { buf: Buffer; type: string; name: string } | null = null, source: LinkFile["source"] = "download", note: string | undefined;
      if (kind === "canva") {
        got = await canvaPreview(final); source = "canva-preview";
        note = "A preview picture of the Canva design (fine for the mockup, not for printing). For print art: the Canva connection's vector PDF, or ask the customer to download it as PDF Print / SVG.";
      } else if (kind === "dropbox") {
        const x = new URL(final); x.searchParams.set("dl", "1"); got = await download(x.toString());
      } else if (kind === "drive") {
        const id = final.match(/\/d\/([\w-]{20,})/)?.[1] || new URL(final).searchParams.get("id");
        if (id) got = await download(`https://drive.google.com/uc?export=download&id=${id}`);
      } else got = await download(final);
      if (!got) { f.error = "Nothing downloadable at that link (it may need a sign-in)."; continue; }
      const safe = got.name.replace(/[^\w.\- ()]+/g, "_").slice(-120);
      const path = `emails/${a.customer_id || "leads"}/${Date.now().toString(36)}-${safe}`;
      const { error } = await admin.storage.from("proofs").upload(path, got.buf, { contentType: got.type, upsert: false });
      if (error) { f.error = error.message; continue; }
      f.saved = { name: got.name, path, type: got.type, size: got.buf.length, from_link: final, source, ...(note ? { note } : {}) };
    } catch (e) { f.error = e instanceof Error ? e.message : String(e); }
  }
  const add = found.map((f) => f.saved).filter(Boolean) as LinkFile[];
  const links = found.filter((f) => f.kind !== "other").map((f) => ({ url: f.final, kind: f.kind, ok: !!f.saved, error: f.error }));
  await admin.from("activities").update({ meta: { ...meta, attachments: [...(meta.attachments || []), ...add], link_art_at: new Date().toISOString(), ...(links.length ? { links } : {}) } }).eq("id", activityId);
  return { ok: true, found };
}
