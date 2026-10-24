"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendSewoutPhoto } from "@/app/shop/sewout-actions";
import { SEWOUT_EMAILS } from "@/lib/customerContact";

/**
 * The sew-out photo (Oct 24, Nick: "when our embroidery team does the sew out and they take a picture… crop it and
 * say here's your sew out"). On a phone the button opens the camera. The photo comes up with a crop box already around
 * the stitching (found by how it stands out from the fabric around the edges of the photo); drag the box or its corners
 * to change it, turn the photo if it's sideways, add a note if there's something to say, and "Save and send" crops it,
 * keeps it with the order and emails it to the customer to approve (lib/sewouts.ts).
 */
type Box = { x: number; y: number; w: number; h: number }; // 0..1 of the (turned) photo
const MAX_OUT = 1800;

/** where the stitching is: the part of the photo that differs most from the fabric color around its edges */
function findStitching(c: HTMLCanvasElement): Box {
  const s = 160, k = Math.min(1, s / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const t = document.createElement("canvas"); t.width = w; t.height = h;
  const g = t.getContext("2d", { willReadFrequently: true })!; g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  // the fabric: the middle color of the border pixels
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > 2 && y > 2 && x < w - 3 && y < h - 3) continue;
    const i = (y * w + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const R = med(rs), G = med(gs), B = med(bs);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, dd = Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B);
    if (dd > 90) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (n < w * h * 0.01 || x1 < 0) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  // a little fabric around it
  const px = (x1 - x0) * 0.18 + 4, py = (y1 - y0) * 0.3 + 4;
  const bx = Math.max(0, x0 - px), by = Math.max(0, y0 - py), ex = Math.min(w, x1 + px), ey = Math.min(h, y1 + py);
  return { x: bx / w, y: by / h, w: (ex - bx) / w, h: (ey - by) / h };
}

function loadImage(f: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const u = URL.createObjectURL(f); const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("That photo couldn't be opened.")); im.src = u; });
}

export default function SewoutCapture({ orderId, imprintId, label, onDone }: { orderId: string; imprintId: string; label?: string; onDone: (msg: string) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [turn, setTurn] = useState(0); // quarter turns
  const [box, setBox] = useState<Box>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [preview, setPreview] = useState("");
  const cv = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; b: Box } | null>(null);

  // the photo, turned, on a canvas
  const turned = () => {
    if (!img) return null;
    const c = document.createElement("canvas"), q = ((turn % 4) + 4) % 4;
    c.width = q % 2 ? img.naturalHeight : img.naturalWidth; c.height = q % 2 ? img.naturalWidth : img.naturalHeight;
    const g = c.getContext("2d")!;
    g.translate(c.width / 2, c.height / 2); g.rotate((q * Math.PI) / 2); g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return c;
  };
  useEffect(() => {
    const c = turned();
    cv.current = c;
    if (!c) { setPreview(""); return; }
    setBox(findStitching(c));
    // a screen-sized copy to crop on
    const k = Math.min(1, 1200 / Math.max(c.width, c.height)), p = document.createElement("canvas");
    p.width = Math.round(c.width * k); p.height = Math.round(c.height * k);
    p.getContext("2d")!.drawImage(c, 0, 0, p.width, p.height);
    setPreview(p.toDataURL("image/jpeg", 0.85));
  }, [img, turn]); // eslint-disable-line react-hooks/exhaustive-deps

  function down(mode: string, e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, b: { ...box } };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current, el = wrap.current; if (!d || !el) return;
    const r = el.getBoundingClientRect(), dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height, m = 0.04;
    let { x, y, w, h } = d.b;
    if (d.mode === "move") { x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - h, Math.max(0, y + dy)); }
    else {
      if (d.mode.includes("l")) { const nx = Math.min(x + w - m, Math.max(0, x + dx)); w += x - nx; x = nx; }
      if (d.mode.includes("r")) w = Math.min(1 - x, Math.max(m, w + dx));
      if (d.mode.includes("t")) { const ny = Math.min(y + h - m, Math.max(0, y + dy)); h += y - ny; y = ny; }
      if (d.mode.includes("b")) h = Math.min(1 - y, Math.max(m, h + dy));
    }
    setBox({ x, y, w, h });
  }

  async function save() {
    const c = cv.current; if (!c) return;
    setBusy(true); setErr("");
    try {
      const sx = Math.round(box.x * c.width), sy = Math.round(box.y * c.height), sw = Math.round(box.w * c.width), sh = Math.round(box.h * c.height);
      const k = Math.min(1, MAX_OUT / Math.max(sw, sh));
      const o = document.createElement("canvas"); o.width = Math.round(sw * k); o.height = Math.round(sh * k);
      o.getContext("2d")!.drawImage(c, sx, sy, sw, sh, 0, 0, o.width, o.height);
      const kr = Math.min(1, 2400 / Math.max(c.width, c.height));
      const r = document.createElement("canvas"); r.width = Math.round(c.width * kr); r.height = Math.round(c.height * kr);
      r.getContext("2d")!.drawImage(c, 0, 0, r.width, r.height);
      const blob = (x: HTMLCanvasElement) => new Promise<Blob>((res, rej) => x.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't save the photo."))), "image/jpeg", 0.9));
      const sb = createClient(), ts = Date.now();
      const photo = `sewouts/${orderId}/${ts}.jpg`, raw = `sewouts/${orderId}/${ts}-whole.jpg`;
      const up1 = await sb.storage.from("proofs").upload(photo, await blob(o), { contentType: "image/jpeg" });
      if (up1.error) throw new Error(up1.error.message);
      await sb.storage.from("proofs").upload(raw, await blob(r), { contentType: "image/jpeg" });
      const res = await sendSewoutPhoto(orderId, imprintId, photo, raw, note);
      if (!res.ok) throw new Error(res.error || "Couldn't send it.");
      onDone("error" in res && res.error ? res.error : res.emailed ? `Sew-out v${res.version} sent to the customer.` : `Sew-out v${res.version} saved, but the email didn't go out. Use Remind to try again.`);
      setImg(null); setNote(""); setTurn(0);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send it."); }
    setBusy(false);
  }

  return (
    <>
      <label className="btn sm primary" style={{ cursor: "pointer" }}>
        {label || "Take the sew-out photo"}
        <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void loadImage(f).then((im) => { setTurn(0); setImg(im); }).catch((x) => setErr(x.message)); }} />
      </label>
      {err && !img && <div className="pv-err">{err}</div>}
      {img && (
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="sw-t" onKeyDown={(e) => { if (e.key === "Escape" && !busy) setImg(null); }}>
          <div className="mk-modal sow-modal">
            <h2 id="sw-t">Crop the sew-out</h2>
            <p className="faint">Drag the box or its corners so it frames the stitching. This is the picture the customer sees.{SEWOUT_EMAILS ? "" : " Customer emails are off, so saving doesn't send it."}</p>
            <div className="sow-stage" ref={wrap} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
              {preview && <img src={preview} alt="The sew-out photo" draggable={false} />}
              <div className="sow-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} onPointerDown={(e) => down("move", e)}>
                {["tl", "tr", "bl", "br"].map((c) => <span key={c} className={"sow-h " + c} onPointerDown={(e) => down(c, e)} />)}
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn sm" onClick={() => setTurn(turn - 1)} disabled={busy}>↺ Turn left</button>
              <button type="button" className="btn sm" onClick={() => setTurn(turn + 1)} disabled={busy}>↻ Turn right</button>
              <button type="button" className="btn sm" onClick={() => cv.current && setBox(findStitching(cv.current))} disabled={busy}>Find the stitching</button>
            </div>
            <label className="sow-note"><span className="imp-l">Note for the customer (optional)</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything they should know, like a thread we swapped" /></label>
            {err && <div className="pv-err">{err}</div>}
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setImg(null)} disabled={busy}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : SEWOUT_EMAILS ? "Save and send to the customer" : "Save the sew-out"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
