import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A person's Outlook signature, read from the emails they sent from Outlook (their Sent Items, which the portal
 * already keeps for customer email). Outlook adds the signature on the computer, so the mail server never has it on
 * its own; but every email they send ends with it. The signature is the block their recent emails all end with
 * (above the quoted email they were answering), or the part Outlook marks id="Signature" when it does.
 * Pictures (logos) come along inside the HTML as data: images; they're turned into attached pictures when sent.
 */

type Node = { name: string; start: number; openEnd: number; closeStart: number; end: number; attrs: string; kids: Node[] };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BLOCK = new Set(["p", "div", "table", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);

/** a forgiving HTML tree (start/end offsets only), good enough for email */
export function parseHtml(html: string): Node {
  const root: Node = { name: "#root", start: 0, openEnd: 0, closeStart: html.length, end: html.length, attrs: "", kids: [] };
  const stack: Node[] = [root];
  const re = /<!--[\s\S]*?-->|<(style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  const close = (n: Node, at: number, end: number) => { n.closeStart = at; n.end = end; };
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    const top = stack[stack.length - 1];
    if (m[1]) { top.kids.push({ name: m[1].toLowerCase(), start: m.index, openEnd: m.index, closeStart: re.lastIndex, end: re.lastIndex, attrs: "", kids: [] }); continue; }
    const name = m[3].toLowerCase();
    if (m[2]) {
      let i = stack.length - 1;
      while (i > 0 && stack[i].name !== name) i--;
      if (i === 0) continue;
      while (stack.length - 1 > i) close(stack.pop()!, m.index, m.index);
      close(stack.pop()!, m.index, re.lastIndex);
      continue;
    }
    if (BLOCK.has(name) && top.name === "p") close(stack.pop()!, m.index, m.index); // <p> doesn't hold blocks
    const parent = stack[stack.length - 1];
    const n: Node = { name, start: m.index, openEnd: re.lastIndex, closeStart: re.lastIndex, end: re.lastIndex, attrs: m[4] || "", kids: [] };
    parent.kids.push(n);
    if (!VOID.has(name) && !/\/\s*$/.test(m[4] || "")) stack.push(n);
  }
  while (stack.length > 1) close(stack.pop()!, html.length, html.length);
  return root;
}

function walk(n: Node, fn: (n: Node) => boolean | void): Node | null {
  for (const k of n.kids) { if (fn(k)) return k; const f = walk(k, fn); if (f) return f; }
  return null;
}

const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
/** the words in some HTML (no styles, scripts or comments), spaces collapsed */
export function textOf(h: string) {
  return h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(style|script|title)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (x, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? x)
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const imgKeys = (h: string) => [...h.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)].map((x) => `${x[1].length}:${x[1].slice(-32)}`);
const keyOf = (h: string) => { const t = textOf(h).toLowerCase().replace(/\s+/g, " "), im = imgKeys(h); return t || im.length ? `${t}|${im.join(",")}` : ""; };

/** where the quoted email starts (Outlook desktop, Outlook on the web/new Outlook, Gmail, Apple Mail, "Original Message") */
const QUOTE = /<div\b[^>]*\bid=["']?(?:x_)?(?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)\b[^>]*>|<div\b[^>]*class=["']?gmail_quote[^>]*>|<div\b[^>]*border-top:\s*solid\s*#(?:E1E1E1|B5C4DF)[^>]*>|<blockquote\b[^>]*type=["']?cite[^>]*>|-{3,}\s*Original Message\s*-{3,}/i;

/** the part of an email the person wrote (above what they were answering), and its blocks */
function ownPart(html: string) {
  const b = html.match(/<body\b[^>]*>/i);
  const from = b ? b.index! + b[0].length : 0;
  const rest = html.slice(from);
  const q = rest.search(QUOTE);
  let top = q >= 0 ? rest.slice(0, q) : rest;
  top = top.replace(/<\/body>[\s\S]*$/i, "");
  const root = parseHtml(top);
  // the person's own Signature block, when Outlook marks it
  const marked = walk(root, (n) => /\bid\s*=\s*["']?(?:x_)?Signature["'\s>]?/i.test(n.attrs) && /^(?:x_)?signature$/i.test((n.attrs.match(/\bid\s*=\s*["']?([\w-]+)/i) || [])[1] || ""));
  // step into wrappers (WordSection1, OWA's outer div) until there's more than one thing inside
  let box = root;
  for (;;) {
    const els = box.kids.filter((k) => !["style", "script", "title", "br", "meta", "link"].includes(k.name));
    if (els.length !== 1 || !["div", "span", "font", "section", "article", "center", "main"].includes(els[0].name)) break;
    const k = els[0];
    if (keyOf(top.slice(box.openEnd, k.start) + top.slice(k.end, box.closeStart))) break;
    box = k;
  }
  const blocks: { start: number; end: number; key: string }[] = [];
  let pos = box.openEnd;
  const push = (s: number, e: number) => { if (e > s) blocks.push({ start: s, end: e, key: keyOf(top.slice(s, e)) }); };
  for (const k of box.kids) { if (k.start > pos && textOf(top.slice(pos, k.start))) push(pos, k.start); push(k.start, k.end); pos = k.end; }
  if (box.closeStart > pos && textOf(top.slice(pos, box.closeStart))) push(pos, box.closeStart);
  return { top, blocks: blocks.filter((x) => x.key), marked: marked && keyOf(top.slice(marked.start, marked.end)) ? top.slice(marked.start, marked.end) : "" };
}

/** how each email splits up (for checking the reader against real mail) */
export function explain(html: string) {
  const p = ownPart(html);
  const b = html.match(/<body\b[^>]*>/i);
  const rest = b ? html.slice(b.index! + b[0].length) : html;
  return { size: html.length, quoteAt: rest.search(QUOTE), topLen: p.top.length, blocks: p.blocks.length, marked: !!p.marked, last: p.blocks.slice(-5).map((x) => x.key.slice(0, 90)), head: rest.slice(0, 300).replace(/data:[^"']+/g, "DATA"), tags: [...new Set((p.top.match(/<[a-z][\w:]*/gi) || []).map((t) => t.toLowerCase()))].slice(0, 30).join(" ") };
}

const cssOf = (html: string) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((x) => x[1].replace(/<!--|-->/g, "")).join("\n").slice(0, 30000);

/** the signature these emails share (newest first), or null when they don't agree on one */
export function findSignature(htmls: string[]): { html: string; css: string; how: string } | null {
  const parts = htmls.map((h) => ({ h, ...ownPart(h) })).filter((p) => p.blocks.length || p.marked);
  const marked = parts.find((p) => p.marked);
  if (marked) return { html: marked.marked, css: cssOf(marked.h), how: "marked" };
  if (parts.length < 2) return null;
  const a = parts[0], others = parts.slice(1);
  const common = others.map((b) => { let n = 0; while (n < a.blocks.length && n < b.blocks.length && a.blocks[a.blocks.length - 1 - n].key === b.blocks[b.blocks.length - 1 - n].key) n++; return n; }).sort((x, y) => y - x);
  const need = Math.max(1, Math.ceil(others.length / 2));
  const len = common[need - 1] || 0;
  if (!len) return null;
  const blocks = a.blocks.slice(a.blocks.length - len);
  const html = a.top.slice(blocks[0].start, blocks[blocks.length - 1].end).trim();
  if (html.length > 2_500_000) return null;
  return { html, css: cssOf(a.h), how: `ends ${len} block${len > 1 ? "s" : ""}, ${common.filter((c) => c >= len).length + 1} of ${parts.length} emails agree` };
}

/** read the person's signature from the emails they've sent from Outlook to customers, and keep it */
export async function detectSignature(admin: SupabaseClient, accountId: string) {
  const now = new Date().toISOString();
  const { data } = await admin.from("activities").select("meta").eq("kind", "email").eq("direction", "out").eq("meta->>account_id", accountId).eq("meta->>mailbox", "sent")
    .not("meta->>html", "is", null).order("occurred_at", { ascending: false }).limit(12);
  const htmls: string[] = [];
  for (const r of data || []) {
    const meta = (r.meta || {}) as { html?: string; via?: string };
    if (meta.via === "portal" || !meta.html) continue;
    const { data: blob } = await admin.storage.from("proofs").download(meta.html);
    if (blob) htmls.push(await blob.text());
    if (htmls.length >= 8) break;
  }
  const sig = findSignature(htmls);
  await admin.from("mail_accounts").update(sig ? { signature_html: sig.html, signature_css: sig.css, signature_at: now, signature_checked_at: now } : { signature_checked_at: now }).eq("id", accountId);
  return { sig, looked: htmls.length };
}
