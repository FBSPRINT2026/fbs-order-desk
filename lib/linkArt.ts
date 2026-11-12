import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inflateRawSync } from "node:zlib";
import { Canva, CanvaError, NO_ACCESS_MSG, canvaConnected, designIdFrom } from "@/lib/canva/client";
import { exportBoth, fileTitle } from "@/lib/canva/save";
import { isPrintavoLink, readPrintavoPage, printavoHead, type PrintavoOrder } from "@/lib/printavoLink";

/**
 * Artwork sent as a LINK instead of an attachment (Oct 9, Nick: "she sent me a Canva link… learn to work with Canva").
 * Customers paste Canva, Dropbox and Google Drive links, and their company's mail filter wraps every link
 * (url.emailprotection.link, Outlook Safe Links, Proofpoint urldefense…). For each link in the customer's new text
 * (not the quoted thread under it) we follow the wrapper to the real address, then:
 *  - Canva design: with the shop's Canva account connected (Settings → Canva), the design itself through Canva's API:
 *    the print-quality PDF (vector where the design is vector) and a see-through PNG for the mockup. Canva only lets
 *    the account export designs it can open: a customer's "collaborate" link has to be opened once while signed in to
 *    Canva (it joins the account), then Get the design from Canva again. Not connected: Canva's own public preview of
 *    the shared design (oEmbed thumbnail, else the page's preview image), a picture for mockups and quoting, NOT
 *    print-ready art.
 *  - Dropbox / Google Drive / a direct file link: every file behind it (filesFromLink: a shared folder's files one by
 *    one; art, PDFs, Office files, CSVs).
 * What's found is saved with the email like an attachment ({ from_link, source }), so Create order, the Assistant and
 * the Mockup Creator use it the same way.
 */
export type LinkFile = { name: string; path: string; type: string; size: number; from_link: string; source: "canva-preview" | "canva-export" | "download"; note?: string };
type Found = { url: string; final: string; kind: "canva" | "dropbox" | "drive" | "file" | "printavo" | "other"; saved?: LinkFile; /** the Canva export's second file (PDF + PNG) */ also?: LinkFile; /** the rest of a shared folder's files */ more?: LinkFile[]; error?: string };

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

/**
 * The link as the customer typed it. Our mail filter (url.emailprotection.link) rewrites where a link POINTS, but the
 * link's visible text in the saved email is still what the customer sent ("https://canva.link/qbpivk65175038y"), the
 * same thing Nick sees on his phone. For known art sites only, that typed address is used directly: the scanner is
 * never clicked through, and anything that isn't an art site still goes through the scanner.
 */
const ART_HOSTS = /(^|\.)(canva\.link|canva\.com|dropbox\.com|db\.tt|drive\.google\.com|docs\.google\.com|1drv\.ms|onedrive\.live\.com)$/i;
export function typedArtLinks(html: string): string[] {
  // only the customer's new message, not the quoted thread under it (Outlook's reply header, Gmail's quote)
  const cut = html.search(/id=["']?divRplyFwdMsg|class=["']?gmail_quote|<b>From:<\/b>|<hr[^>]*>\s*<div[^>]*>\s*<font[^>]*><b>From/i);
  const part = cut > 0 ? html.slice(0, cut) : html;
  const out = new Set<string>();
  for (const m of part.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, "").trim();
    const url = /^https?:\/\//i.test(text) ? text : /^www\./i.test(text) ? `https://${text}` : "";
    if (!url) continue;
    try { if (ART_HOSTS.test(new URL(url).hostname)) out.add(url.replace(/[.,;:!?]+$/, "")); } catch { /* not a link */ }
  }
  // links typed in plain text that the filter didn't wrap
  for (const m of part.replace(/<[^>]+>/g, " ").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    try { if (ART_HOSTS.test(new URL(m[0]).hostname)) out.add(m[0].replace(/[.,;:!?]+$/, "")); } catch { /* skip */ }
  }
  return [...out].slice(0, 6);
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
    const got = await new Promise<{ url?: string; meta?: string; text?: string } | null>((done) => {
      let settled = false;
      const end = (v: { url?: string; meta?: string; text?: string } | null) => { if (settled) return; settled = true; try { sock.close(); } catch { /* closed */ } done(v); };
      // only the scanner's own all-clear is followed: its "continue anyway?" step (/scanning/force) is never pressed for you
      const sock = new WS(`wss://${host}/scanning`);
      const timer = setTimeout(() => end(null), 25_000);
      sock.onopen = () => sock.send(info!);
      sock.onerror = () => { clearTimeout(timer); end(null); };
      sock.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(String(ev.data)) as { redirect?: { url?: string }; refresh?: { meta?: string; text?: string } };
          if (d.redirect?.url) { clearTimeout(timer); end({ url: d.redirect.url }); }
          else if (d.refresh?.meta || d.refresh?.text) { clearTimeout(timer); end({ meta: d.refresh.meta, text: d.refresh.text }); }
        } catch { /* keep waiting */ }
      };
    });
    if (got?.url) return new URL(got.url, pageUrl).toString();
    // the verdict page it swaps in ("This site looks safe… Open"): its Open link
    const ok = got?.text ? safeOpen(got.text) : null; if (ok) return ok;
    info = got?.meta;
  }
  return null;
}

/** the scanner's "This site looks safe" page: the Open link it offers (only that verdict; a warning page is never followed) */
function safeOpen(html: string): string | null {
  if (!/looks safe/i.test(html) || /dangerous|malicious|suspicious|blocked/i.test(html.replace(/known dangerous sites/gi, ""))) return null;
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].replace(/&amp;/g, "&"), text = m[2].replace(/<[^>]+>/g, " ").trim();
    try { const h = new URL(href).hostname; if (/emailprotection\.link$|\.int$|zix|proofpoint|mimecast/i.test(h)) continue; } catch { continue; }
    if (/^open$/i.test(text) || text.includes(new URL(href).hostname)) return href;
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
      if (/emailprotection\.link$/i.test(new URL(u).hostname)) {
        // the scanner's own all-clear page ("This site looks safe… Open"): its Open link is where it goes (Nov 12, Illusive's
        // Printavo link: once a link's been scanned, the page comes back with that verdict and no WebSocket step)
        const safe = safeOpen(html); if (safe) { u = safe; continue; }
        const real = await emailProtection(u, html); if (real) { u = real; continue; }
        // scanned just now: the page answers with its verdict the second time
        const again = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) }).then((x) => x.text()).catch(() => "");
        const s2 = safeOpen(again); if (s2) { u = s2; continue; }
        return u;
      }
      const m = html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i) || html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i) || html.match(/location\.replace\(\s*["']([^"']+)["']/i);
      if (m) { u = new URL(m[1].replace(/&amp;/g, "&"), u).toString(); continue; }
    }
    return u;
  }
  return u;
}

export const linkKind = (u: string): Found["kind"] => {
  return kindOf(u);
};
const kindOf = (u: string): Found["kind"] => {
  try {
    const h = new URL(u).hostname;
    if (/(^|\.)canva\.com$/i.test(h) && /\/design\//i.test(u)) return "canva";
    if (isPrintavoLink(u)) return "printavo";
    if (/(^|\.)dropbox(usercontent)?\.com$/i.test(h)) return "dropbox";
    if (/drive\.google\.com|docs\.google\.com/i.test(h)) return "drive";
    if (/\.(png|jpe?g|gif|webp|svg|pdf|ai|eps|zip|tiff?|xlsx|xlsm|docx|pptx|csv)(\?|$)/i.test(new URL(u).pathname)) return "file";
  } catch { /* skip */ }
  return "other";
};

/** what's kept from a link: art, a PDF, an Office file or a CSV (a PO in Excel), or a zip (a shared folder) */
const KEEP_TYPE = /^(image\/|text\/(csv|plain|tab-separated)|application\/(pdf|postscript|illustrator|zip|x-zip|x-zip-compressed|octet-stream|vnd\.openxmlformats|vnd\.ms-excel|msword|binary))/i;
async function download(u: string, max = MAX, type = ART_TYPE): Promise<{ buf: Buffer; type: string; name: string } | null> {
  const r = await fetch(u, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(max > MAX ? 55_000 : 30_000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const t = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!type.test(t)) return null;
  const len = +(r.headers.get("content-length") || 0); if (len > max) return null;
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > max || buf.length < 200) return null;
  const cd = r.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1], plain = cd.match(/filename=["']?([^"';]+)/i)?.[1];
  let name = (star || plain || new URL(r.url || u).pathname.split("/").pop() || "file").trim().replace(/^["']|["']$/g, "");
  try { name = decodeURIComponent(name); } catch { /* as it is */ }
  return { buf, type: t, name: name.slice(-120) };
}

/* a zip's files (a shared folder comes down as one): node's zlib, no library */
const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|(^|\/)__MACOSX\//i;
const EXT_TYPE: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ai: "application/postscript", eps: "application/postscript", psd: "image/vnd.adobe.photoshop", tif: "image/tiff", tiff: "image/tiff",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", csv: "text/csv", txt: "text/plain", dst: "application/octet-stream", emb: "application/octet-stream", cdr: "application/octet-stream", zip: "application/zip" };
export const typeByName = (n: string) => EXT_TYPE[(n.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
function unzipAll(buf: Buffer, o: { files: number; each: number }): { name: string; buf: Buffer; type: string }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; buf: Buffer; type: string }[] = [], seen = new Map<string, number>();
  for (let n = 0; n < count && p + 46 <= buf.length && out.length < o.files; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const full = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (full.endsWith("/") || JUNK.test(full) || csize === 0xffffffff || usize > o.each || (method !== 0 && method !== 8)) continue;
    try {
      const ln = buf.readUInt16LE(local + 26), le = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + ln + le, local + 30 + ln + le + csize);
      const b = method === 8 ? inflateRawSync(data) : Buffer.from(data);
      if (b.length < 1) continue;
      // the file's own name; one with the same name in another folder keeps its folder in front
      let name = full.split("/").pop() || "file";
      if (seen.has(name)) name = full.split("/").slice(-2).join(" - ");
      seen.set(name, 1);
      out.push({ name, buf: b, type: typeByName(name) });
    } catch { /* a damaged entry: skipped */ }
  }
  return out;
}
const isZip = (f: { buf: Buffer; type: string; name: string }) => f.buf.length > 4 && f.buf.readUInt32LE(0) === 0x04034b50 && (/zip/i.test(f.type) || /\.zip$/i.test(f.name) || /octet-stream|binary/i.test(f.type));

/**
 * Every file behind a share link (Nov 1, Nick: Tiger Blue "just links the Dropbox… treat them as if they're
 * attachments… automatically just bring them into our system"): a Dropbox file or FOLDER (Dropbox sends a folder as
 * one zip: it's opened and each file kept on its own), a Google Drive file, a Google Sheet / Doc / Slides (as Excel /
 * Word / PDF), or a direct link to a file. Art, PDFs, Office files and CSVs; a folder up to 40 files and 120 MB.
 * A link that needs a sign-in (or a Drive folder, which Google only lists to signed-in apps) gives an error to show.
 */
export async function filesFromLink(final: string, admin?: SupabaseClient): Promise<{ files: { name: string; buf: Buffer; type: string }[]; error?: string; folder?: boolean; skipped?: string[] }> {
  const kind = kindOf(final);
  let got: { buf: Buffer; type: string; name: string } | null = null;
  const BIG = 120 * 1024 * 1024;
  // a Dropbox folder, file by file through the shop's Dropbox (no size limit on the folder as a whole); the zip below
  // when Dropbox isn't connected or won't read the link
  let apiErr = "";
  if (kind === "dropbox" && admin && /\/(scl\/fo|sh)\//.test(final)) {
    try {
      const { sharedLinkFiles } = await import("@/lib/dropbox");
      const r = await sharedLinkFiles(admin, final, { each: 40 * 1024 * 1024, total: 150 * 1024 * 1024, files: 40, deadline: Date.now() + 120_000 });
      const files = r.files.filter((f) => !JUNK.test(f.name)).map((f) => ({ ...f, type: /octet-stream|binary/i.test(f.type) ? typeByName(f.name) : f.type }));
      if (files.length) return { files, folder: true, skipped: r.skipped };
      apiErr = r.skipped.length ? `Every file there is over 40 MB (${r.skipped.slice(0, 3).join(", ")}).` : "The folder is empty.";
    } catch (e) { apiErr = e instanceof Error ? e.message : String(e); }
  }
  try {
    if (kind === "dropbox") {
      const x = new URL(final); x.searchParams.set("dl", "1"); got = await download(x.toString(), BIG, KEEP_TYPE);
    } else if (kind === "drive") {
      const u = new URL(final), id = final.match(/\/d\/([\w-]{20,})/)?.[1] || u.searchParams.get("id");
      if (/\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) return { files: [], error: "A Google Drive folder can't be opened without signing in to Google. Ask for a Dropbox link, or open it and add the files." };
      if (!id) return { files: [], error: "Couldn't read the Google Drive file from that link." };
      const sub = /docs\.google\.com/i.test(u.hostname) ? u.pathname.split("/")[1] : "";
      got = sub === "spreadsheets" ? await download(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, MAX, KEEP_TYPE)
        : sub === "document" ? await download(`https://docs.google.com/document/d/${id}/export?format=docx`, MAX, KEEP_TYPE)
        : sub === "presentation" ? await download(`https://docs.google.com/presentation/d/${id}/export/pdf`, MAX, KEEP_TYPE)
        : await download(`https://drive.google.com/uc?export=download&id=${id}`, MAX, KEEP_TYPE);
    } else if (kind === "file") got = await download(final, MAX, KEEP_TYPE);
    else return { files: [] };
  } catch (e) { return { files: [], error: e instanceof Error ? e.message : String(e) }; }
  if (!got) return { files: [], error: "Nothing downloadable at that link (it may need a sign-in, or it's over 120 MB)." + (apiErr ? ` Dropbox: ${apiErr}` : "") };
  if (isZip(got)) {
    const files = unzipAll(got.buf, { files: 40, each: 40 * 1024 * 1024 });
    return files.length ? { files, folder: true } : { files: [], error: "The folder came down empty." };
  }
  if (/octet-stream|binary/i.test(got.type)) got.type = typeByName(got.name);
  return { files: [got] };
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
  // Canva links already exported through the API (a preview saved earlier doesn't count: the export is still wanted)
  const exported = new Set((meta.attachments || []).filter((f) => (f as LinkFile).source === "canva-export").map((f) => (f as LinkFile).from_link));
  const canvaOn = await canvaConnected(admin).catch(() => false);
  const found: Found[] = [];
  // the art links as the customer typed them (from the saved email's link text), else the links in the plain text
  // (resolved through their wrapper; each can take a few seconds to "scan")
  let typed: string[] = [];
  const htmlPath = (meta as { html?: string }).html;
  if (htmlPath) {
    const { data: blob } = await admin.storage.from("proofs").download(htmlPath);
    if (blob) typed = typedArtLinks(await blob.text());
  }
  const urls = typed.length ? typed : linksIn(newPart(String(a.body || "")));
  const finals = await Promise.all(urls.map((u) => resolveLink(u).catch(() => u)));
  for (const [i, url] of urls.entries()) {
    const final = finals[i];
    const kind = kindOf(final);
    const f: Found = { url, final, kind };
    found.push(f);
    if (kind === "other") continue;
    // another shop's Printavo order page: the order as their work order (text), each line's pictures, their art files
    if (kind === "printavo") {
      if (have.has(final)) continue;
      try {
        const p = await readPrintavoPage(final);
        const saved = await savePrintavo(admin, a.customer_id as string | null, final, p);
        if (saved.files.length) { f.saved = saved.files[0]; f.more = saved.files.slice(1); }
        if (saved.error) f.error = saved.error;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        // Printavo turns the portal's server away: the page is brought in from a browser instead (Bring in from Printavo)
        f.error = /403/.test(m) ? "Printavo won't let the portal open this page by itself. Open it in Chrome and bring it in from there." : m;
      }
      continue;
    }
    if (kind === "canva" && canvaOn) {
      if (exported.has(final)) continue;
      // the design itself, through the shop's Canva account: PDF (print) + see-through PNG (mockup)
      try {
        const id = designIdFrom(final);
        if (!id) { f.error = "Couldn't read the Canva design from that link."; continue; }
        const x = await exportBoth(new Canva(admin), id);
        const name = fileTitle(x.title);
        const files = [x.pdf && { buf: x.pdf.buf, type: x.pdf.type, name: `${name}.pdf`, note: "The Canva design as a print-quality PDF (vector where the design is vector)." },
          x.png && { buf: x.png.buf, type: x.png.type, name: `${name}.png`, note: `${x.pages > 1 ? `Page 1 of ${x.pages}, ` : ""}${x.opaque ? "with the design's background (this Canva plan can't export see-through)" : "see-through background"} (for the mockup).` }].filter(Boolean) as { buf: Buffer; type: string; name: string; note: string }[];
        const saved: LinkFile[] = [];
        for (const g of files) {
          const path = `emails/${a.customer_id || "leads"}/${Date.now().toString(36)}-${g.name.replace(/[^\w.\- ()]+/g, "_").slice(-120)}`;
          const { error } = await admin.storage.from("proofs").upload(path, g.buf, { contentType: g.type, upsert: false });
          if (error) { f.error = error.message; continue; }
          saved.push({ name: g.name, path, type: g.type, size: g.buf.length, from_link: final, source: "canva-export", note: g.note });
        }
        if (saved[0]) f.saved = saved[0];
        if (saved[1]) f.also = saved[1];
        if (!saved.length && !f.error) f.error = x.pdfError || x.pngError || "Canva didn't send a file.";
      } catch (e) {
        f.error = e instanceof CanvaError && e.noAccess ? NO_ACCESS_MSG : e instanceof Error ? e.message : String(e);
      }
      continue;
    }
    if (have.has(final)) { if (kind === "canva") f.error = "The preview picture is saved. Connect Canva (Settings → Canva) to get the design itself."; continue; }
    try {
      if (kind !== "canva") {
        // a Dropbox / Google Drive file or folder, or a direct file link: every file behind it (lib filesFromLink)
        const r = await filesFromLink(final);
        if (!r.files.length) { f.error = r.error || "Nothing downloadable at that link (it may need a sign-in)."; continue; }
        const saved: LinkFile[] = [];
        for (const [k, g] of r.files.entries()) {
          const safe = g.name.replace(/[^\w.\- ()]+/g, "_").slice(-120);
          const path = `emails/${a.customer_id || "leads"}/${Date.now().toString(36)}${k ? `-${k}` : ""}-${safe}`;
          const { error } = await admin.storage.from("proofs").upload(path, g.buf, { contentType: g.type, upsert: false });
          if (error) { f.error = error.message; continue; }
          saved.push({ name: g.name, path, type: g.type, size: g.buf.length, from_link: final, source: "download", ...(r.folder ? { note: "From the shared folder the link opens." } : {}) });
        }
        if (saved.length) { f.saved = saved[0]; f.more = saved.slice(1); }
        continue;
      }
      const got = await canvaPreview(final);
      const note = "A preview picture of the Canva design (fine for the mockup, not for printing). For print art: the Canva connection's vector PDF, or ask the customer to download it as PDF Print / SVG.";
      if (!got) { f.error = "Nothing downloadable at that link (it may need a sign-in)."; continue; }
      const safe = got.name.replace(/[^\w.\- ()]+/g, "_").slice(-120);
      const path = `emails/${a.customer_id || "leads"}/${Date.now().toString(36)}-${safe}`;
      const { error } = await admin.storage.from("proofs").upload(path, got.buf, { contentType: got.type, upsert: false });
      if (error) { f.error = error.message; continue; }
      f.saved = { name: got.name, path, type: got.type, size: got.buf.length, from_link: final, source: "canva-preview", note };
    } catch (e) { f.error = e instanceof Error ? e.message : String(e); }
  }
  const add = found.flatMap((f) => [f.saved, f.also, ...(f.more || [])]).filter(Boolean) as LinkFile[];
  const links = found.filter((f) => f.kind !== "other").map((f) => ({ url: f.final, kind: f.kind, ok: !!f.saved, error: f.error }));
  await admin.from("activities").update({ meta: { ...meta, attachments: [...(meta.attachments || []), ...add], link_art_at: new Date().toISOString(), ...(links.length ? { links } : {}) } }).eq("id", activityId);
  return { ok: true, found };
}

/**
 * Another shop's Printavo order saved onto an email like attachments: the order as text (their prices left out), then
 * each picture and file. Used when the portal reads the page itself, and when the page was read in a browser (Printavo
 * turns servers away; Nov 12) and handed in: lib/printavoLink.ts.
 */
export async function savePrintavo(admin: SupabaseClient, customerId: string | null, link: string, p: PrintavoOrder): Promise<{ files: LinkFile[]; error?: string }> {
  const saved: LinkFile[] = [];
  let error = "";
  const put = async (name: string, buf: Buffer, type: string, note?: string) => {
    const path = `emails/${customerId || "leads"}/${Date.now().toString(36)}-${saved.length}-${name.replace(/[^\w.\- ()#]+/g, "_").slice(-120)}`;
    const { error: e } = await admin.storage.from("proofs").upload(path, buf, { contentType: type, upsert: false });
    if (e) { error = e.message; return; }
    saved.push({ name, path, type, size: buf.length, from_link: link, source: "download", ...(note ? { note } : {}) });
  };
  await put(`${p.title} (their Printavo).txt`, Buffer.from(p.text, "utf8"), "text/plain", "The order as it reads on their Printavo page (their prices left out).");
  for (const x of p.files.slice(0, 14)) {
    // only the files Printavo keeps (its file host), never an address handed in from elsewhere
    try { if (!/(^|\.)(filepicker\.io|filestackcontent\.com|printavo\.com|amazonaws\.com)$/i.test(new URL(x.url).hostname)) continue; } catch { continue; }
    const got = await download(x.url, MAX, KEEP_TYPE).catch(() => null);
    if (!got) { error = error || `Couldn't download ${x.name}.`; continue; }
    const ext = /\.[a-z0-9]{2,4}$/i.test(x.name) ? "" : got.type.includes("png") ? ".png" : got.type.includes("pdf") ? ".pdf" : /jpe?g/.test(got.type) ? ".jpg" : got.type.includes("webp") ? ".webp" : "";
    const name = x.name + ext;
    await put(name, got.buf, /octet-stream|binary/i.test(got.type) ? typeByName(name) : got.type);
  }
  return { files: saved, ...(error ? { error } : {}) };
}

/** a Printavo page read in a browser, handed in for an email: saved onto it like attachments (once per link) */
export async function printavoIntoEmail(admin: SupabaseClient, activityId: string, link: string, html: string, read?: PrintavoOrder): Promise<{ ok: true; files: string[]; error?: string } | { ok: false; error: string }> {
  if (!isPrintavoLink(link)) return { ok: false, error: "That isn't a Printavo order link." };
  const { data: a } = await admin.from("activities").select("id, customer_id, meta").eq("id", activityId).maybeSingle();
  if (!a) return { ok: false, error: "Email not found." };
  const { parsePrintavoHtml } = await import("@/lib/printavoLink");
  const p: PrintavoOrder = read ? { title: String(read.title || "Printavo order").slice(0, 120), text: printavoHead(String(read.title || "Printavo order").slice(0, 120), link) + String(read.text || "").slice(0, 20_000), files: (Array.isArray(read.files) ? read.files : []).slice(0, 14).map((x) => ({ url: String(x.url || ""), name: String(x.name || "File").slice(0, 120) })) } : parsePrintavoHtml(html, link);
  const meta = (a.meta || {}) as { attachments?: LinkFile[]; links?: { url: string; kind: string; ok: boolean; error?: string }[] };
  const keep = (meta.attachments || []).filter((x) => x.from_link !== link);
  const r = await savePrintavo(admin, a.customer_id as string | null, link, p);
  const links = [...(meta.links || []).filter((x) => x.url !== link), { url: link, kind: "printavo", ok: r.files.length > 0, ...(r.error ? { error: r.error } : {}) }];
  await admin.from("activities").update({ meta: { ...meta, attachments: [...keep, ...r.files], links } }).eq("id", activityId);
  return { ok: true, files: r.files.map((x) => x.name), ...(r.error ? { error: r.error } : {}) };
}
