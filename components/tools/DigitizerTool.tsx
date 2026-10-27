"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orderGroups, type Design, type Order } from "@/lib/pricing";
import { guessHex } from "@/lib/mockup";
import { DIGITIZE_FROM, DIGITIZER, dayLabel, digitizeEmail, logoName, sheetName, specRows, type DigitizeCtx } from "@/lib/digitizer";

/**
 * The Digitizer (Oct 27, Nick): ONE tool (lib/aiTools.ts "digitizer"). For now it sends the logo to Volikes Creative to be
 * digitized, from Amanda's mailbox: a plain "this is for digitizing" email with the specs, our digitizing sheet (a PDF
 * like the work order: the logo large with its dimensions, the thread and backing, the mockup for placement) and the
 * original art file. Nothing goes out until Send is pressed. Opens from Digitizing and from an embroidered print on the
 * order page.
 */
type Load = { ctx: DigitizeCtx; logo: string | null; logoBg: string; mock: string | null; requested?: { at: string; by: string } | null; origName: string };

const parseSize = (size: string, ratio: number) => {
  const m = /^([\d.]+)\s*"?\s*(wide|tall)?/i.exec(size || ""); if (!m || !ratio) return { w: 0, h: 0 };
  const n = +m[1]; return /tall/i.test(m[2] || "") ? { w: n / ratio, h: n } : { w: n, h: n * ratio };
};
const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const x = new Image(); x.crossOrigin = "anonymous"; x.onload = () => res(x); x.onerror = rej; x.src = src; });
/** the picture cut to the art (its empty margins off), as PNG data */
async function cropped(url: string, d: Design | null): Promise<string | null> {
  try {
    const x = await img(url);
    const bx = d?.art_box && d.art_box.of?.w ? d.art_box : null;
    const sx = bx ? (bx.x / bx.of.w) * x.naturalWidth : 0, sy = bx ? (bx.y / bx.of.h) * x.naturalHeight : 0;
    const sw = bx ? (bx.w / bx.of.w) * x.naturalWidth : x.naturalWidth, sh = bx ? (bx.h / bx.of.h) * x.naturalHeight : x.naturalHeight;
    const k = Math.min(1, 2400 / Math.max(sw, sh));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext("2d")!.drawImage(x, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } catch { return null; }
}
async function asJpeg(url: string): Promise<string | null> {
  try { const x = await img(url); const k = Math.min(1, 1400 / Math.max(x.naturalWidth, x.naturalHeight)); const c = document.createElement("canvas"); c.width = Math.round(x.naturalWidth * k); c.height = Math.round(x.naturalHeight * k); const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(x, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.88); } catch { return null; }
}
const hexRgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = m ? parseInt(m[1], 16) : 0x777777; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const; };

/** the digitizing sheet: one letter page, the logo big on the garment's color with its width and height marked */
async function buildSheet(L: Load): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.13), grey = rgb(0.38, 0.42, 0.48), blue = rgb(0.055, 0.608, 0.847);
  const c = L.ctx, M = 40;
  page.drawText("FOR DIGITIZING", { x: M, y: 742, size: 24, font: fb, color: ink });
  const right = `FBS #${c.number} · ${c.company}`.slice(0, 60);
  page.drawText(right, { x: 612 - M - f.widthOfTextAtSize(right, 11), y: 748, size: 11, font: f, color: grey });
  page.drawText(`${logoName(c)} · ${c.im.location} · Embroidery`.slice(0, 90), { x: M, y: 720, size: 12, font: f, color: grey });
  // the logo, big, on the garment's color
  const box = { x: M, y: 330, w: 612 - 2 * M - 34, h: 370 };
  const [r, g, b] = hexRgb(L.logoBg);
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: rgb(r, g, b) });
  if (L.logo) {
    const pic = await pdf.embedPng(L.logo);
    const k = Math.min((box.w - 60) / pic.width, (box.h - 60) / pic.height);
    const w = pic.width * k, h = pic.height * k, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
    page.drawImage(pic, { x, y, width: w, height: h });
    const wIn = c.wIn || 0, hIn = c.hIn || 0;
    // width under the box, height to its right, both lined up with the logo
    const yy = box.y - 16;
    page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 1.2, color: blue });
    for (const xx of [x, x + w]) page.drawLine({ start: { x: xx, y: yy - 5 }, end: { x: xx, y: yy + 5 }, thickness: 1.2, color: blue });
    const wt = wIn ? `${wIn.toFixed(2)}"` : "width as ordered";
    page.drawText(wt, { x: x + w / 2 - fb.widthOfTextAtSize(wt, 13) / 2, y: yy - 18, size: 13, font: fb, color: blue });
    const xx = box.x + box.w + 14;
    page.drawLine({ start: { x: xx, y }, end: { x: xx, y: y + h }, thickness: 1.2, color: blue });
    for (const y0 of [y, y + h]) page.drawLine({ start: { x: xx - 5, y: y0 }, end: { x: xx + 5, y: y0 }, thickness: 1.2, color: blue });
    if (hIn) { const ht = `${hIn.toFixed(2)}"`; page.drawText(ht, { x: xx + 6, y: y + h / 2 + fb.widthOfTextAtSize(ht, 11) / 2, size: 11, font: fb, color: blue, rotate: degrees(-90) }); }
  }
  // the specs, and the mockup for placement
  let y = 270;
  const colW = L.mock ? 330 : 532;
  for (const [k, v] of specRows(c)) {
    page.drawText(k.toUpperCase(), { x: M, y, size: 8.5, font: fb, color: grey });
    const words = v.split(" "); let line = "", yy = y;
    for (const wd of words) { const t = line ? `${line} ${wd}` : wd; if (f.widthOfTextAtSize(t, 11) > colW - 100 && line) { page.drawText(line, { x: M + 100, y: yy, size: 11, font: f, color: ink }); yy -= 14; line = wd; } else line = t; }
    if (line) page.drawText(line, { x: M + 100, y: yy, size: 11, font: f, color: ink });
    y = yy - 20;
  }
  if (L.mock) {
    const mp = await pdf.embedJpg(L.mock);
    const k = Math.min(180 / mp.width, 220 / mp.height), w = mp.width * k, h = mp.height * k;
    page.drawText("PLACEMENT", { x: 612 - M - 180, y: 270, size: 8.5, font: fb, color: grey });
    page.drawImage(mp, { x: 612 - M - 180 + (180 - w) / 2, y: 260 - h, width: w, height: h });
  }
  page.drawText("Please digitize at the size shown. Send back the DST, the EMB and the production worksheet PDF.", { x: M, y: 40, size: 10, font: f, color: grey });
  return pdf.save();
}

export default function DigitizerTool({ orderId, imprintId, onClose, onSent }: { orderId: string; imprintId: string; onClose: () => void; onSent?: () => void }) {
  const [L, setL] = useState<Load | null>(null);
  const [err, setErr] = useState("");
  const [to, setTo] = useState(DIGITIZER.email);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const pdfBytes = useRef<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const sb = createClient();
      const { data: o, error } = await sb.from("orders").select("*, customers(company, name)").eq("id", orderId).maybeSingle();
      if (!live) return;
      if (error || !o) { setErr(error?.message || "Order not found."); return; }
      const gs = orderGroups(o as Order), g = gs.find((x) => x.imprints.some((im) => im.id === imprintId)), im = g?.imprints.find((x) => x.id === imprintId);
      if (!g || !im) { setErr("That print isn't on the order anymore."); return; }
      const { data: dd } = im.design_id ? await sb.from("designs").select("*").eq("id", im.design_id).maybeSingle() : { data: null };
      const d = (dd as Design | null) || null;
      const ratio = d?.art_box?.w && d.art_box.h ? d.art_box.h / d.art_box.w : d?.width_px && d.height_px ? d.height_px / d.width_px : 0;
      const sz = parseSize(im.size, ratio);
      const cust = (o as { customers?: { company?: string; name?: string } }).customers;
      const ctx: DigitizeCtx = { number: o.number, company: cust?.company || cust?.name || "", nickname: o.nickname, due: o.due_date, g, im, d, wIn: sz.w || undefined, hIn: sz.h || undefined };
      const paths = [d?.preview_path, g.mockupThumbs?.[0]].filter(Boolean) as string[];
      const { data: su } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
      const urlOf = (p?: string | null) => (p ? su?.find((x) => x.path === p)?.signedUrl || "" : "");
      const [logo, mock] = await Promise.all([urlOf(d?.preview_path) ? cropped(urlOf(d?.preview_path), d) : null, urlOf(g.mockupThumbs?.[0]) ? asJpeg(urlOf(g.mockupThumbs?.[0])) : null]);
      const l0 = g.lines[0];
      const lh = (l0 as { hex?: string } | undefined)?.hex || "";
      const logoBg = /^#[0-9a-f]{6}$/i.test(lh) ? lh : guessHex(l0?.color || "Black");
      const emb = (d?.specs as { embroidery?: { request?: { at: string; by: string } } } | null)?.embroidery;
      const origName = d?.specs?.original?.name || d?.file_name || "";
      if (!live) return;
      const Lx: Load = { ctx, logo, logoBg, mock, requested: emb?.request || null, origName };
      setL(Lx);
      const e = digitizeEmail(ctx);
      setSubject(e.subject); setBody(e.body);
      try { const bytes = await buildSheet(Lx); pdfBytes.current = bytes; if (live) setPdfUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }))); }
      catch (x) { if (live) setErr(`Couldn't make the digitizing sheet: ${x instanceof Error ? x.message : x}`); }
    })();
    return () => { live = false; };
  }, [orderId, imprintId]);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function send() {
    if (!L || !pdfBytes.current) return;
    setBusy(true); setErr("");
    let bin = ""; const u = pdfBytes.current; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    const r = await fetch("/api/digitizer/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, imprintId, to, subject, body, pdf: btoa(bin), pdfName: sheetName(L.ctx) }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok) { setErr(j.error || "The email didn't go out."); return; }
    setSent(j.sentAt || new Date().toISOString());
    onSent?.();
  }

  return (
    <div className="dla-bg dock wide" role="dialog" aria-label="Digitizer">
      <div className="dla dgt">
        <h3>Digitizer</h3>
        <p className="dla-sub">Send this logo to {DIGITIZER.name} to be digitized. Nothing goes out until you press Send.</p>
        {!L && !err && <p className="faint">Getting the logo and making the digitizing sheet…</p>}
        {L && L.requested && !sent && <p className="dgt-was">Already requested {dayLabel(new Date(L.requested.at))}{L.requested.by ? ` by ${L.requested.by.split("@")[0]}` : ""}. Sending again sends a new request.</p>}
        {sent ? (
          <div className="dgt-done">
            <b>Sent to {DIGITIZER.name}</b>
            <span>From {DIGITIZE_FROM}. The logo is marked Requested on Digitizing, and their reply with the files will wait there to be added.</span>
          </div>
        ) : L && (
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
              {pdfUrl ? <a className="dgt-file" href={pdfUrl} target="_blank" rel="noreferrer">{sheetName(L.ctx)}</a> : <span className="dgt-file">Making the sheet…</span>}
              <span className="dgt-file">{L.origName || "The logo's picture"}</span>
            </div>
            {pdfUrl && <iframe className="dgt-pdf" src={pdfUrl + "#toolbar=0&view=FitH"} title="Digitizing sheet" />}
          </>
        )}
        {err && <p className="err">{err}</p>}
        <div className="dla-acts">
          <button type="button" className="btn ghost" onClick={onClose}>{sent ? "Close" : "Cancel"}</button>
          {!sent && <button type="button" className="btn primary" disabled={busy || !pdfUrl || !L} onClick={() => void send()}>{busy ? "Sending…" : `Send to ${DIGITIZER.name.split(" ")[0]}`}</button>}
        </div>
      </div>
    </div>
  );
}
