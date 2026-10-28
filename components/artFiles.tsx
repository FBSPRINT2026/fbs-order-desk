"use client";
import { useEffect, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

/**
 * A Printavo job's (or a Dropbox folder's) files, as the Customer artwork builder and a logo's "Find it everywhere" read
 * them: the art, each DST with its EMB and sewing sheet, what a DST / sheet says, where a job's embroidery went.
 */
type SB = ReturnType<typeof createClient>;
export type Job = { id: string; visual_id: string; nickname: string; order_date: string; files: Record<string, string> | null; search_text?: string | null;
  /** a Dropbox folder (the builder's Dropbox source): its path there */ dbx?: string };
export type Item = { key: string; job: Job; path: string; name: string; ext: string; kind: "art" | "sew" | "sheet" | "other"; emb?: string; sheet?: string };

export const ART = /^(pdf|ai|png|jpe?g|svg|eps|psd|tiff?|webp)$/;
export const PREVIEW = /^(pdf|ai|png|jpe?g|webp|svg)$/;
export const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
/** the file's own name: Printavo's copies start with a short code ("mukt3xws5-Embark-Logo.pdf") */
export const nameOf = (p: string) => (p.split("/").pop() || p).replace(/^(?=[a-z0-9]*\d)[a-z0-9]{6,12}-/, "");
export const baseOf = (p: string) => nameOf(p).replace(/\.[^.]+$/, "").toLowerCase();
/** a name a person gave it (not a filepicker code like "qtTHnfKGTcCccaDxZY0w") */
export const realName = (p: string) => { const b = nameOf(p).replace(/\.[^.]+$/, ""); return /^[A-Za-z0-9]{18,22}$/.test(b) ? "" : b.replace(/[_-]+/g, " ").trim(); };
export const typeOf = (ext: string) => ({ pdf: "application/pdf", ai: "application/illustrator", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", eps: "application/postscript", psd: "image/vnd.adobe.photoshop", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp" } as Record<string, string>)[ext] || "application/octet-stream";

/** a job's files: Printavo's thumbnails left out; each DST with its EMB and sewing PDF (same name) as one sew file */
export function itemsOf(job: Job): Item[] {
  const paths = [...new Set(Object.entries(job.files || {}).filter(([k]) => !/resize=|output=format|ico-document/.test(k)).map(([, v]) => v))];
  const dsts = paths.filter((p) => extOf(p) === "dst");
  const used = new Set<string>();
  const out: Item[] = [];
  for (const d of dsts) {
    const b = baseOf(d);
    let emb = paths.find((p) => extOf(p) === "emb" && baseOf(p) === b);
    if (!emb && dsts.length === 1) { const embs = paths.filter((p) => extOf(p) === "emb"); if (embs.length === 1) emb = embs[0]; }
    const sheet = paths.find((p) => extOf(p) === "pdf" && baseOf(p) === b);
    if (emb) used.add(emb); if (sheet) used.add(sheet);
    out.push({ key: d, job, path: d, name: nameOf(d), ext: "dst", kind: "sew", ...(emb ? { emb } : {}), ...(sheet ? { sheet } : {}) });
  }
  for (const p of paths) {
    if (used.has(p) || extOf(p) === "dst") continue;
    const ext = extOf(p);
    out.push({ key: p, job, path: p, name: nameOf(p), ext, kind: ART.test(ext) ? "art" : "other" });
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "art" ? -1 : b.kind === "art" ? 1 : a.kind === "sew" ? -1 : 1));
}

/* pictures of the files, a few at a time (PDF / AI drawn by pdf.js) */
export const PICS = new Map<string, Promise<string>>();
let running = 0;
export const waiting: (() => void)[] = [];
export async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await f(); } finally { running--; waiting.shift()?.(); }
}
export function picOf(sb: SB, path: string): Promise<string> {
  if (!PICS.has(path)) PICS.set(path, slot(async () => {
    const ext = extOf(path);
    if (/^(png|jpe?g|webp|svg)$/.test(ext)) { const { data } = await sb.storage.from("proofs").createSignedUrl(path, 3600); return data?.signedUrl || ""; }
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return "";
    const { pdfPicture } = await import("@/lib/printavoArt");
    const c = await pdfPicture(await data.arrayBuffer(), 420);
    return c.toDataURL("image/jpeg", 0.8);
  }).catch(() => ""));
  return PICS.get(path)!;
}
export function Pic({ sb, path }: { sb: SB; path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let on = true;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); picOf(sb, path).then((u) => { if (on) setSrc(u); }); } }, { rootMargin: "300px" });
    if (el.current) io.observe(el.current);
    return () => { on = false; io.disconnect(); };
  }, [sb, path]);
  return <span className="bi-pic" ref={el}>{src ? <img src={src} alt="" /> : <span className="faint">{src === "" ? "No picture" : "Loading…"}</span>}</span>;
}
/* what a DST and a sewing sheet say, read once each: to put a job's sewing sheet with its DST when the names differ
   (Oct 28, Nick on #33064: "the PDF isn't going with the DST") */
export type Facts = { stitches: number; wIn: number; hIn: number; colors: number };
export const FACTS = new Map<string, Promise<Facts | null>>();
export function factsOf(sb: SB, path: string): Promise<Facts | null> {
  if (!FACTS.has(path)) FACTS.set(path, (async () => {
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return null;
    const buf = await data.arrayBuffer();
    if (extOf(path) === "dst") { const { readDst } = await import("@/lib/dst"); const i = readDst(buf); return { stitches: i.stitches, wIn: i.wIn, hIn: i.hIn, colors: i.colors }; }
    const [{ pdfText }, { parseWorksheet }] = await Promise.all([import("@/lib/printavoArt"), import("@/lib/worksheet")]);
    const t = await pdfText(buf, 3), w = parseWorksheet(t);
    if (w) return { stitches: w.stitches, wIn: w.wIn, hIn: w.hIn, colors: w.colors };
    // other digitizing programs' sheets (Oct 28, Nick on #34724: Hatch's "Design Worksheet… Color Sequence" goes with
    // its DST): a sheet with a stitch count and a size
    const n = (re: RegExp) => +(re.exec(t.replace(/\s+/g, " "))?.[1] || "0").replace(/,/g, "");
    const st = n(/Stitches\s*:?\s*([\d,]+)/i);
    if (st && (/worksheet|color sequence|stop sequence|digitiz|embroidery/i.test(t))) return { stitches: st, wIn: n(/Width\s*:?\s*([\d.]+)\s*(?:in|")/i), hIn: n(/Height\s*:?\s*([\d.]+)\s*(?:in|")/i), colors: n(/Colors\s*:?\s*(\d+)/i) || 1 };
    return null;
  })().catch(() => null));
  return FACTS.get(path)!;
}
export const factLine = (f: Facts) => `${f.wIn}" × ${f.hIn}" · ${f.stitches.toLocaleString()} st · ${f.colors} color${f.colors === 1 ? "" : "s"}`;
/* where a job's embroidery went, read off its mockups and line items (Oct 28, Nick: "we have to know what the DST is…
   where it was used… last used on 33998, the location was left chest and left sleeve… the little E… on the nape") */
export const LOCS: [RegExp, string][] = [[/left\s+chest/i, "Left Chest"], [/right\s+chest/i, "Right Chest"], [/left\s+(sleeve|arm)/i, "Left Sleeve"], [/right\s+(sleeve|arm)/i, "Right Sleeve"],
  [/nape|back\s+(of\s+(the\s+)?)?neck|neck\s*line|back\s+collar/i, "Nape"], [/full\s+back/i, "Full Back"], [/upper\s+back|yoke/i, "Upper Back"], [/center\s+(chest|front)|front\s+center/i, "Center Chest"],
  [/(hat|cap)\s+front|front\s+of\s+(the\s+)?(hat|cap)/i, "Hat Front"], [/left\s+hip/i, "Left Hip"], [/right\s+hip/i, "Right Hip"], [/cuff/i, "Cuff"], [/side\s+of\s+(the\s+)?(hat|cap)/i, "Hat Side"]];
export const locsIn = (t: string) => LOCS.filter(([re]) => re.test(t)).map(([, n]) => n);
export const TEXTS = new Map<string, Promise<string>>();
export function textOf(sb: SB, path: string): Promise<string> {
  if (!TEXTS.has(path)) TEXTS.set(path, (async () => {
    const { data } = await sb.storage.from("proofs").download(path);
    if (!data) return "";
    const { pdfText } = await import("@/lib/printavoArt");
    return await pdfText(await data.arrayBuffer(), 4);
  })().catch(() => ""));
  return TEXTS.get(path)!;
}
export const fmtDay = (d: string) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

/** a job's files with each sewing sheet put with the DST it was made for (same stitches or size) */
export function arrange(list: Item[], facts: Record<string, Facts | null | undefined>): Item[] {
  const sheets = list.filter((i) => i.kind === "art" && i.ext === "pdf" && facts[i.path]);
  if (!sheets.length) return list;
  const out = list.map((i) => ({ ...i })), taken = new Set<string>();
  for (const d of out.filter((i) => i.kind === "sew" && !i.sheet)) {
    const f = facts[d.path]; if (!f) continue;
    const m = sheets.find((x) => { const w = facts[x.path]!; return !taken.has(x.path) && ((f.stitches && Math.abs(w.stitches - f.stitches) / f.stitches <= 0.03) || (Math.abs(w.wIn - f.wIn) < 0.06 && Math.abs(w.hIn - f.hIn) < 0.06)); });
    if (m) { d.sheet = m.path; taken.add(m.path); }
  }
  // one DST and one sewing sheet left on the job: they go together even when the numbers don't line up
  const lone = out.filter((i) => i.kind === "sew" && !i.sheet), left = sheets.filter((x) => !taken.has(x.path));
  if (lone.length === 1 && left.length === 1) { lone[0].sheet = left[0].path; taken.add(left[0].path); }
  return out.filter((i) => !taken.has(i.path)).map((i) => (i.kind === "art" && i.ext === "pdf" && facts[i.path] ? { ...i, kind: "sheet" as const } : i));
}
export function DstInfo({ sb, path }: { sb: SB; path: string }) {
  const [t, setT] = useState("");
  useEffect(() => { let on = true; factsOf(sb, path).then((f) => { if (on) setT(f ? factLine(f) : "Couldn't read the DST"); }); return () => { on = false; }; }, [sb, path]);
  return <span className="faint">{t || "Reading the DST…"}</span>;
}

