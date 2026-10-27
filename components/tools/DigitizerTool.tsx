"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orderGroups, type Design, type Imprint, type Order } from "@/lib/pricing";
import { paintPrint } from "@/lib/inkColors";
import { threadByName } from "@/lib/embroidery";
import { guessHex } from "@/lib/mockup";
import { DIGITIZE_FROM, DIGITIZER, dayLabel, digitizeEmailMany, logoName, sheetName, specRows, type DigitizeCtx } from "@/lib/digitizer";

/**
 * The Digitizer (Oct 27, Nick): ONE tool (lib/aiTools.ts "digitizer"). For now it sends the logo to Volikes Creative to be
 * digitized, from Amanda's mailbox: a plain "this is for digitizing" email with the specs, our digitizing sheet (a PDF
 * like the work order: the logo large with its dimensions, the thread and backing, the mockup for placement) and the
 * original art file. Nothing goes out until Send is pressed. Opens from Digitizing and from an embroidered print on the
 * order page.
 */
type Load = { ctx: DigitizeCtx; logo: string | null; on: { bg: string; why: string }; threads: string[]; threadNames: string[]; garmentHex: string; garmentName: string; mock: string | null; requested?: { at: string; by: string } | null; origName: string };

const parseSize = (size: string, ratio: number) => {
  const m = /^([\d.]+)\s*"?\s*(wide|tall)?/i.exec(size || ""); if (!m || !ratio) return { w: 0, h: 0 };
  const n = +m[1]; return /tall/i.test(m[2] || "") ? { w: n / ratio, h: n } : { w: n, h: n * ratio };
};
const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const x = new Image(); x.crossOrigin = "anonymous"; x.onload = () => res(x); x.onerror = rej; x.src = src; });
/**
 * The logo as they digitize from it (Oct 27, Nick: "they need to draw it from a very specific… style… we don't want the
 * embroidery effect… you wouldn't want black on tone on tone"): painted in its threads (the Mockup Creator's picks;
 * colors taken off stay off), the empty edges cut away so its width and height are the logo's own.
 */
async function threadArt(url: string, im: Imprint): Promise<{ png: string; ratio: number } | null> {
  try {
    const x = await img(url);
    const want: Record<string, string> = {};
    const map = im.inkMap && im.inkMap.design === im.design_id ? im.inkMap.map : null;
    if (map) for (const [src, v] of Object.entries(map)) want[src] = v.name === "none" || !v.hex ? "none" : v.hex;
    // white in the art is the garment (paper) unless a thread is white, as the order page paints it
    const targets = Object.values(want).filter((v) => v !== "none");
    const paper = !/white/i.test(im.inks || "") && !targets.some((h) => lum(h) > 0.85);
    const c0 = paintPrint(x, want, { paper, maxSide: 2400 });
    // cut to what's left (anything not see-through)
    const g0 = c0.getContext("2d", { willReadFrequently: true })!, d = g0.getImageData(0, 0, c0.width, c0.height).data;
    let x0 = c0.width, y0 = c0.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c0.height; y++) for (let xx = 0; xx < c0.width; xx++) if (d[(y * c0.width + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0 || y1 < y0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(c0, x0, y0, w, h, 0, 0, w, h);
    return { png: c.toDataURL("image/png"), ratio: h / w };
  } catch { return null; }
}
/** a picture as a JPEG; `half` keeps one side of a front-and-back mockup (the side this logo is on) */
async function asJpeg(url: string, half?: "left" | "right"): Promise<string | null> {
  try {
    const x = await img(url);
    const two = !!half && x.naturalWidth / Math.max(1, x.naturalHeight) > 1.5;
    const sw = two ? x.naturalWidth / 2 : x.naturalWidth, sx = two && half === "right" ? sw : 0;
    const k = Math.min(1, 1400 / Math.max(sw, x.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(x.naturalHeight * k);
    const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(x, sx, 0, sw, x.naturalHeight, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  } catch { return null; }
}
const onBack = (loc: string) => /back|yoke|shoulders/i.test(loc || "");
const hexRgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0x777777; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const; };
const lum = (h: string) => { const [r, g, b] = hexRgb(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/**
 * What the logo is shown on for digitizing (Oct 27, Nick: "if it has white in it at all, you've got to have it be on a dark
 * background… if you have no white in it… a white background… or a colored background, one that matches the garment"):
 * no white (or light) thread → white; white thread → black; white AND black thread → the garment's color (or gray).
 */
export function drawOn(threads: string[], garment: string) {
  const light = threads.some((h) => lum(h) > 0.6), dark = threads.some((h) => lum(h) < 0.03);
  if (!light) return { bg: "#FFFFFF", why: "no white thread" };
  if (!dark) return { bg: "#111111", why: "it has white thread" };
  if (/^#[0-9a-f]{6}$/i.test(garment) && threads.every((h) => contrast(h, garment) >= 1.8)) return { bg: garment, why: "black and white thread: on the garment's color" };
  return { bg: "#8A8F96", why: "black and white thread: on gray" };
}

/** the digitizing sheet: a letter page per logo (Oct 27, Nick: both of #40193's logos, "each page of this"), the logo
 *  big to digitize from with its width and height marked, then its threads, how it looks on the garment and where it goes */
async function buildSheet(parts: Load[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const [i, L] of parts.entries()) await sheetPage(pdf, L, i, parts.length, f, fb, rgb);
  return pdf.save();
}
type PdfLib = typeof import("pdf-lib");
async function sheetPage(pdf: import("pdf-lib").PDFDocument, L: Load, i: number, n0: number, f: import("pdf-lib").PDFFont, fb: import("pdf-lib").PDFFont, rgb: PdfLib["rgb"]) {
  const { degrees } = await import("pdf-lib");
  const page = pdf.addPage([612, 792]);
  const ink = rgb(0.07, 0.09, 0.13), grey = rgb(0.38, 0.42, 0.48), blue = rgb(0.055, 0.608, 0.847), line = rgb(0.86, 0.87, 0.89), white = rgb(1, 1, 1);
  const col = (h: string) => { const [r, g, b] = hexRgb(h); return rgb(r, g, b); };
  const c = L.ctx, M = 40;
  page.drawText("FOR DIGITIZING", { x: M, y: 742, size: 24, font: fb, color: ink });
  const right = `FBS #${c.number} · ${c.company}`.slice(0, 60);
  page.drawText(right, { x: 612 - M - f.widthOfTextAtSize(right, 11), y: 748, size: 11, font: f, color: grey });
  // which logo this is ("Logo 1 of 2"), and where it goes
  let lx = M;
  if (n0 > 1) {
    const tag = `LOGO ${i + 1} OF ${n0}`, tw = fb.widthOfTextAtSize(tag, 10);
    page.drawRectangle({ x: M, y: 718, width: tw + 12, height: 17, color: blue });
    page.drawText(tag, { x: M + 6, y: 723, size: 10, font: fb, color: white });
    lx = M + tw + 20;
  }
  page.drawText(`${logoName(c)} · ${c.im.location} · Embroidery`.slice(0, 90), { x: lx, y: 722, size: 12, font: f, color: grey });
  const n = L.threads.length || c.im.colors || 1;
  page.drawText(`DIGITIZE FROM THIS (${n} COLOR${n === 1 ? "" : "S"}, ${L.on.bg === "#FFFFFF" ? "ON WHITE" : L.on.bg === "#111111" ? "ON BLACK" : "ON THE GARMENT COLOR"})`, { x: M, y: 698, size: 9, font: fb, color: grey });
  // the logo, big, in its threads
  const box = { x: M, y: 400, w: 612 - 2 * M - 34, h: 288 };
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: col(L.on.bg), borderColor: line, borderWidth: 1 });
  const pic = L.logo ? await pdf.embedPng(L.logo) : null;
  if (pic) {
    const k = Math.min((box.w - 60) / pic.width, (box.h - 50) / pic.height);
    const w = pic.width * k, h = pic.height * k, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
    page.drawImage(pic, { x, y, width: w, height: h });
    const wIn = c.wIn || 0, hIn = c.hIn || 0;
    // width under the box, height to its right, both lined up with the logo
    const yy = box.y - 14;
    page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 1.2, color: blue });
    for (const xx of [x, x + w]) page.drawLine({ start: { x: xx, y: yy - 5 }, end: { x: xx, y: yy + 5 }, thickness: 1.2, color: blue });
    const wt = wIn ? `${wIn.toFixed(2)}" wide` : "width as ordered";
    page.drawText(wt, { x: x + w / 2 - fb.widthOfTextAtSize(wt, 12) / 2, y: yy - 16, size: 12, font: fb, color: blue });
    const xx = box.x + box.w + 14;
    page.drawLine({ start: { x: xx, y }, end: { x: xx, y: y + h }, thickness: 1.2, color: blue });
    for (const y0 of [y, y + h]) page.drawLine({ start: { x: xx - 5, y: y0 }, end: { x: xx + 5, y: y0 }, thickness: 1.2, color: blue });
    if (hIn) { const ht = `${hIn.toFixed(2)}" tall`; page.drawText(ht, { x: xx + 6, y: y + h / 2 + fb.widthOfTextAtSize(ht, 11) / 2, size: 11, font: fb, color: blue, rotate: degrees(-90) }); }
  }
  // three small boxes: the threads, how it looks on the garment, where it goes
  const bw = (612 - 2 * M - 24) / 3, by = 220, bh = 132;
  const boxAt = (i: number, title: string) => { const bx = M + i * (bw + 12); page.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: line, borderWidth: 1 }); page.drawText(title, { x: bx + 8, y: by + bh - 14, size: 8.5, font: fb, color: grey }); return bx; };
  let bx = boxAt(0, "THREAD");
  let ty = by + bh - 34;
  for (const t of (L.threadNames.length ? L.threadNames : ["As shown"]).slice(0, 6)) {
    const hx = L.threads[L.threadNames.indexOf(t)] || "";
    if (hx) page.drawRectangle({ x: bx + 8, y: ty - 2, width: 11, height: 11, color: col(hx), borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.6 });
    page.drawText(t.replace(/^Madeira\s+/i, "").slice(0, 34), { x: bx + 24, y: ty, size: 9.5, font: f, color: ink });
    ty -= 16;
  }
  if (c.im.stitches) page.drawText(`about ${c.im.stitches.toLocaleString("en-US")} stitches (our estimate)`, { x: bx + 8, y: by + 10, size: 8.5, font: f, color: grey });
  bx = boxAt(1, "ON THE GARMENT");
  page.drawRectangle({ x: bx + 8, y: by + 26, width: bw - 16, height: bh - 50, color: col(L.garmentHex) });
  if (pic) { const k = Math.min((bw - 36) / pic.width, (bh - 66) / pic.height), w = pic.width * k, h = pic.height * k; page.drawImage(pic, { x: bx + (bw - w) / 2, y: by + 26 + (bh - 50 - h) / 2, width: w, height: h }); }
  page.drawText(`${L.garmentName}`.slice(0, 38), { x: bx + 8, y: by + 10, size: 8.5, font: f, color: grey });
  bx = boxAt(2, "PLACEMENT");
  if (L.mock) { const mp = await pdf.embedJpg(L.mock); const k = Math.min((bw - 16) / mp.width, (bh - 40) / mp.height), w = mp.width * k, h = mp.height * k; page.drawImage(mp, { x: bx + (bw - w) / 2, y: by + 22 + (bh - 40 - h) / 2, width: w, height: h }); }
  else page.drawText("No mockup saved yet", { x: bx + 8, y: by + bh / 2, size: 9, font: f, color: grey });
  page.drawText(`${c.im.location} · ${onBack(c.im.location) ? "back" : "front"}${c.wIn ? ` · ${c.wIn.toFixed(2)}" wide` : ""}`.slice(0, 40), { x: bx + 8, y: by + 10, size: 8.5, font: f, color: grey });
  // the specs (the same as the email)
  let y = 190;
  for (const [k, v] of specRows(c)) {
    page.drawText(k.toUpperCase(), { x: M, y, size: 8.5, font: fb, color: grey });
    const words = v.split(" "); let ln = "", yy = y;
    for (const wd of words) { const t = ln ? `${ln} ${wd}` : wd; if (f.widthOfTextAtSize(t, 10.5) > 420 && ln) { page.drawText(ln, { x: M + 92, y: yy, size: 10.5, font: f, color: ink }); yy -= 13; ln = wd; } else ln = t; }
    if (ln) page.drawText(ln, { x: M + 92, y: yy, size: 10.5, font: f, color: ink });
    y = yy - 17;
  }
  page.drawText("Please digitize at the size shown. Send back the DST, the EMB and the production worksheet PDF.", { x: M, y: 36, size: 10, font: f, color: grey });
}

export default function DigitizerTool({ orderId, imprintId: imprint0, onClose, onSent }: { orderId: string; /** a print to include; every embroidered logo that still needs digitizing is ticked too */ imprintId?: string; onClose: () => void; onSent?: () => void }) {
  // every logo on the order that needs digitizing goes in one request (Oct 27, Nick on #40193: "It should ask for both
  // files… the left chest and then the back"); untick one to leave it out
  const [picked, setPicked] = useState<string[] | null>(null);
  const [choices, setChoices] = useState<{ id: string; label: string; done: boolean }[]>([]);
  const [parts, setParts] = useState<Load[] | null>(null);
  const [err, setErr] = useState("");
  const [to, setTo] = useState(DIGITIZER.email);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const pdfBytes = useRef<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const key = (picked || []).join(",");

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = createClient();
      const { data: o, error } = await sb.from("orders").select("*, customers(company, name)").eq("id", orderId).maybeSingle();
      if (!live) return;
      if (error || !o) { setErr(error?.message || "Order not found."); return; }
      const gs = orderGroups(o as Order);
      const embs = gs.flatMap((x) => x.imprints.filter((d) => d.method === "embroidery" && d.design_id).map((d) => ({ g: x, d })));
      const done = (d: Imprint) => !!(d.digitized || d.emb?.file);
      setChoices(embs.map(({ g: x, d }) => ({ id: d.id, done: done(d), label: `${d.location}${d.size ? ` · ${d.size}` : ""}${gs.length > 1 && x.name ? ` · ${x.name}` : ""}${done(d) ? " (digitized)" : ""}` })));
      if (!embs.length) { setErr("No embroidered print with a logo on this order yet."); return; }
      if (picked === null) {
        const need = embs.filter(({ d }) => !done(d) || d.id === imprint0).map(({ d }) => d.id);
        setPicked(need.length ? need : [imprint0 || embs[0].d.id]);
        return;
      }
      if (!picked.length) { setParts([]); setPdfUrl(""); pdfBytes.current = null; return; }
      setParts(null);
      const cust = (o as { customers?: { company?: string; name?: string } }).customers;
      const out: Load[] = [];
      for (const id of picked) {
        const g = gs.find((x) => x.imprints.some((im) => im.id === id)), im = g?.imprints.find((x) => x.id === id);
        if (!g || !im) continue;
        const { data: dd } = im.design_id ? await sb.from("designs").select("*").eq("id", im.design_id).maybeSingle() : { data: null };
        const d = (dd as Design | null) || null;
        const paths = [d?.preview_path, g.mockupThumbs?.[0]].filter(Boolean) as string[];
        const { data: su } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
        const urlOf = (p?: string | null) => (p ? su?.find((x) => x.path === p)?.signedUrl || "" : "");
        // the placement picture: the side of the mockup this logo is on (a front-and-back mockup cut in half)
        const [art, mock] = await Promise.all([urlOf(d?.preview_path) ? threadArt(urlOf(d?.preview_path), im) : null, urlOf(g.mockupThumbs?.[0]) ? asJpeg(urlOf(g.mockupThumbs?.[0]), onBack(im.location) ? "right" : "left") : null]);
        const ratio = art?.ratio || im.artRatio || (d?.art_box?.w && d.art_box.h ? d.art_box.h / d.art_box.w : d?.width_px && d.height_px ? d.height_px / d.width_px : 0);
        const sz = parseSize(im.size, ratio);
        const ctx: DigitizeCtx = { number: o.number, company: cust?.company || cust?.name || "", nickname: o.nickname, due: o.due_date, g, im, d, wIn: sz.w || undefined, hIn: sz.h || undefined };
        const l0 = g.lines[0];
        const lh = (l0 as { hex?: string } | undefined)?.hex || "";
        const garmentHex = /^#[0-9a-f]{6}$/i.test(lh) ? lh : guessHex(l0?.color || "Black");
        const map = im.inkMap && im.inkMap.design === im.design_id ? im.inkMap.map : null;
        const pk = map ? Object.values(map).filter((v) => v.name !== "none" && v.hex) : [];
        const threads = [...new Map(pk.map((v) => [v.hex.toLowerCase(), v])).values()];
        const names = threads.length ? threads.map((v) => v.name) : (im.inks || "").split(/\s*,\s*/).filter(Boolean);
        const emb = (d?.specs as { embroidery?: { request?: { at: string; by: string } } } | null)?.embroidery;
        const hexes = threads.length ? threads.map((v) => v.hex) : names.map((n) => threadByName(n)?.hex || (/white/i.test(n) ? "#FFFFFF" : /black/i.test(n) ? "#111111" : "")).filter(Boolean);
        const colorName = (l0?.color || "").replace(/\s*\([^)]*\)/g, "").trim();
        out.push({ ctx, logo: art?.png || null, on: drawOn(hexes, garmentHex), threads: hexes, threadNames: names, garmentHex, garmentName: [colorName, [l0?.brand, l0?.garment || l0?.style].filter(Boolean).join(" ")].filter(Boolean).join(" · "), mock, requested: emb?.request || null, origName: d?.specs?.original?.name || d?.file_name || "" });
      }
      if (!live) return;
      setParts(out); setPdfUrl(""); pdfBytes.current = null;
      if (!out.length) return;
      const e = digitizeEmailMany(out.map((x) => x.ctx));
      setSubject(e.subject); setBody(e.body);
      try { const bytes = await buildSheet(out); pdfBytes.current = bytes; if (live) setPdfUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }))); }
      catch (x) { if (live) setErr(`Couldn't make the digitizing sheet: ${x instanceof Error ? x.message : x}`); }
    })();
    return () => { live = false; };
  }, [orderId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function send() {
    if (!parts?.length || !pdfBytes.current) return;
    setBusy(true); setErr("");
    let bin = ""; const u = pdfBytes.current; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    const r = await fetch("/api/digitizer/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, imprintIds: parts.map((x) => x.ctx.im.id), to, subject, body, pdf: btoa(bin), pdfName: sheetName(parts[0].ctx) }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok) { setErr(j.error || "The email didn't go out."); return; }
    setSent(j.sentAt || new Date().toISOString());
    onSent?.();
  }

  const was = (parts || []).filter((x) => x.requested);
  return (
    <div className="dla-bg dock wide" role="dialog" aria-label="Digitizer">
      <div className="dla dgt">
        <h3>Digitizer</h3>
        <p className="dla-sub">Send the logos to {DIGITIZER.name} to be digitized: one email, a page for each logo. Nothing goes out until you press Send.</p>
        {choices.length > 1 && !sent && picked && (
          <div className="dgt-pick" role="group" aria-label="Which logos">
            <span className="lbl">Logos to digitize</span>
            {choices.map((c) => (
              <label key={c.id} className="check"><input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? choices.filter((x) => x.id === c.id || picked.includes(x.id)).map((x) => x.id) : picked.filter((x) => x !== c.id))} />{c.label}</label>
            ))}
          </div>
        )}
        {parts === null && !err && <p className="faint">Getting the logos and making the digitizing sheet…</p>}
        {parts && !parts.length && !sent && <p className="faint">Tick a logo to send.</p>}
        {was.length > 0 && !sent && <p className="dgt-was">{was.map((x) => `${x.ctx.im.location} was requested ${dayLabel(new Date(x.requested!.at))}${x.requested!.by ? ` by ${x.requested!.by.split("@")[0]}` : ""}`).join("; ")}. Sending again sends a new request.</p>}
        {sent ? (
          <div className="dgt-done">
            <b>Sent to {DIGITIZER.name}</b>
            <span>From {DIGITIZE_FROM}. {parts && parts.length > 1 ? `The ${parts.length} logos are` : "The logo is"} marked Requested on Digitizing, and their reply with the files will wait there to be added.</span>
          </div>
        ) : parts && parts.length > 0 && (
          <>
            <div className="dgt-f">
              <label className="field"><span className="lbl">From</span><input type="text" value={`Amanda · ${DIGITIZE_FROM}`} readOnly /></label>
              <label className="field"><span className="lbl">To</span><input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
            <label className="field"><span className="lbl">Subject</span><input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            <label className="field"><span className="lbl">Email</span><textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></label>
            <span className="faint">Amanda&apos;s Outlook signature goes under it.</span>
            <div className="dgt-att">
              <span className="lbl">Attached</span>
              {pdfUrl ? <a className="dgt-file" href={pdfUrl} target="_blank" rel="noreferrer">{sheetName(parts[0].ctx)}{parts.length > 1 ? ` (${parts.length} pages)` : ""}</a> : <span className="dgt-file">Making the sheet…</span>}
              {parts.map((x) => <span key={x.ctx.im.id} className="dgt-file">{x.origName || "The logo's picture"}</span>)}
            </div>
            {pdfUrl && <iframe className="dgt-pdf" src={pdfUrl + "#toolbar=0&view=FitH"} title="Digitizing sheet" />}
          </>
        )}
        {err && <p className="err">{err}</p>}
        <div className="dla-acts">
          <button type="button" className="btn ghost" onClick={onClose}>{sent ? "Close" : "Cancel"}</button>
          {!sent && <button type="button" className="btn primary" disabled={busy || !pdfUrl || !parts?.length} onClick={() => void send()}>{busy ? "Sending…" : `Send to ${DIGITIZER.name.split(" ")[0]}`}</button>}
        </div>
      </div>
    </div>
  );
}
