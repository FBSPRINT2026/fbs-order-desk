"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { phoneSnapState, sendSewoutPhoto, sewoutPhoneLink } from "@/app/shop/sewout-actions";
import PhoneSnapAsk from "@/components/PhoneSnapAsk";
import SewnPanel, { startSewn, type SewCtx, type SewnValue } from "@/components/SewnPanel";

/**
 * The sew-out photo (Oct 24, Nick: "when our embroidery team does the sew out and they take a picture… crop it and
 * say here's your sew out"). On a phone the button opens the camera. The photo comes up with a crop box already around
 * the stitching (found by how it stands out from the fabric around the edges of the photo); drag the box or its corners
 * to change it, turn the photo if it's sideways, add a note if there's something to say, and "Save and send" crops it,
 * keeps it with the order and emails it to the customer to approve (lib/sewouts.ts).
 *
 * On a computer the button shows a QR code first (Oct 29, Nick: "a QR code that pops up so… on their phone, they can
 * just add it in like a photo"): the phone opens /snap/<id>, which is this same component with `snapId`, takes and crops
 * the photo there, and the computer's pop-up closes when it arrives. "Use a photo on this computer" still works.
 *
 * Beside the crop, "What we sewed" (components/SewnPanel.tsx): the stitch file version and the threads really sewn,
 * which the order is changed to match; and an optional placement photo (a wider shot of where it sits on the garment).
 * Saving keeps it; Send to customer on Digitizing sends it (Oct 29, Nick).
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

/** a picked photo, scaled down to send (the placement photo isn't cropped) */
async function scaled(f: File, max = 1800): Promise<Blob> {
  const im = await loadImage(f), k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read the placement photo."))), "image/jpeg", 0.88));
}

export default function SewoutCapture({ orderId, imprintId, label, onDone, snapId, where, ctx }: {
  orderId: string; imprintId: string; label?: string; onDone: (msg: string) => void;
  /** the print's stitch files, threads and size, and the threads on the wall, for "What we sewed" */
  ctx?: SewCtx;
  /** on the phone, from the computer's QR code: uploads with that link instead of a sign-in */
  snapId?: string;
  /** the order and print, for the computer's QR pop-up ("#40200 · Logotology · Left chest") */
  where?: string;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [turn, setTurn] = useState(0); // quarter turns
  const [box, setBox] = useState<Box>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [note, setNote] = useState("");
  const [sewn, setSewn] = useState<SewnValue | null>(null);
  const [place, setPlace] = useState<{ file: File; url: string } | null>(null);
  const pickPlace = (f: File) => setPlace((p) => { if (p) URL.revokeObjectURL(p.url); return { file: f, url: URL.createObjectURL(f) }; });
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [preview, setPreview] = useState("");
  const cv = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; b: Box } | null>(null);
  // a computer (a mouse, not a touch screen) gets the QR pop-up first; a phone or tablet goes straight to the camera
  const [computer, setComputer] = useState(false);
  useEffect(() => { setComputer(!snapId && !window.matchMedia("(pointer: coarse)").matches); }, [snapId]);
  const [ask, setAsk] = useState<{ id: string | null; done: string; error: string } | null>(null);
  const pick = (f: File) => void loadImage(f).then((im) => { setAsk(null); setTurn(0); setImg(im); setSewn(ctx ? startSewn(ctx) : null); setPlace(null); }).catch((x) => setErr(x.message));
  const close = () => { setImg(null); setNote(""); setTurn(0); setPlace(null); };
  async function openAsk() {
    setErr(""); setAsk({ id: null, done: "", error: "" });
    const r = await sewoutPhoneLink(orderId, imprintId);
    setAsk((a) => (a ? (r.ok ? { ...a, id: r.id } : { ...a, error: r.error }) : a));
  }
  // waiting for the phone: ask every few seconds until the photo is in
  const askId = ask?.id, askDone = !!ask?.done;
  useEffect(() => {
    if (!askId || askDone) return;
    let live = true;
    const t = setInterval(async () => {
      const r = await phoneSnapState(askId);
      if (!live || !r.ok) return;
      if (r.done) { setAsk((a) => (a ? { ...a, done: r.msg || "The photo came in from the phone." } : a)); onDone(r.msg || "The sew-out came in from the phone."); }
      else if (r.expired) setAsk((a) => (a ? { ...a, error: "The code ran out (30 minutes). Close this and click the button again for a new one." } : a));
    }, 3000);
    return () => { live = false; clearInterval(t); };
  }, [askId, askDone]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const sb = createClient();
      const sewnOut = sewn ? { filePath: sewn.filePath || undefined, threads: sewn.threads } : undefined;
      if (snapId) {
        // on the phone: upload with the link's pass, then save it the same way (app/api/snap)
        const post = async (body: object) => { const x = await fetch("/api/snap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: snapId, ...body }) }); return (await x.json()) as { ok: boolean; error?: string; photo?: { path: string; token: string }; raw?: { path: string; token: string }; placement?: { path: string; token: string }; msg?: string }; };
        const u = await post({ step: "urls" });
        if (!u.ok || !u.photo || !u.raw) throw new Error(u.error || "Couldn't get the photo ready to upload.");
        const a = await sb.storage.from("proofs").uploadToSignedUrl(u.photo.path, u.photo.token, await blob(o), { contentType: "image/jpeg" });
        if (a.error) throw new Error(a.error.message);
        await sb.storage.from("proofs").uploadToSignedUrl(u.raw.path, u.raw.token, await blob(r), { contentType: "image/jpeg" });
        let placement: string | undefined;
        if (place && u.placement) { const pu = await sb.storage.from("proofs").uploadToSignedUrl(u.placement.path, u.placement.token, await scaled(place.file), { contentType: "image/jpeg" }); if (!pu.error) placement = u.placement.path; }
        const done = await post({ step: "save", photo: u.photo.path, raw: u.raw.path, placement, note, sewn: sewnOut });
        if (!done.ok) throw new Error(done.error || "Couldn't save it.");
        onDone(done.msg || "Saved.");
        close(); setBusy(false);
        return;
      }
      const ts = Date.now();
      const photo = `sewouts/${orderId}/${ts}.jpg`, raw = `sewouts/${orderId}/${ts}-whole.jpg`;
      const up1 = await sb.storage.from("proofs").upload(photo, await blob(o), { contentType: "image/jpeg" });
      if (up1.error) throw new Error(up1.error.message);
      await sb.storage.from("proofs").upload(raw, await blob(r), { contentType: "image/jpeg" });
      let placement: string | undefined;
      if (place) { const pp = `sewouts/${orderId}/${ts}-placement.jpg`; const pu = await sb.storage.from("proofs").upload(pp, await scaled(place.file), { contentType: "image/jpeg" }); if (!pu.error) placement = pp; }
      const res = await sendSewoutPhoto(orderId, imprintId, photo, raw, note, { placementPath: placement, sewn: sewnOut });
      if (!res.ok) throw new Error(res.error || "Couldn't save it.");
      onDone(`Sew-out v${res.version} saved.${res.changes.length ? ` The order now matches what was sewn (${res.changes.length} change${res.changes.length === 1 ? "" : "s"}).` : ""} Download the PDF proof or send it to the customer.`);
      close();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save it."); }
    setBusy(false);
  }

  return (
    <>
      {computer
        ? <button type="button" className="btn sm primary" onClick={() => void openAsk()}>{label || "Take the sew-out photo"}</button>
        : <label className={snapId ? "btn primary snap-big" : "btn sm primary"} style={{ cursor: "pointer" }}>
          {label || "Take the sew-out photo"}
          <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
        </label>}
      {snapId && <label className="btn snap-big" style={{ cursor: "pointer" }}>
        Pick from my photos
        <input type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
      </label>}
      {ask && !img && <PhoneSnapAsk title="Take the sew-out photo" sub={where || ""} path={ask.id ? `/snap/${ask.id}` : null} done={!!ask.done} error={ask.error}
        status={ask.done || "Waiting for the phone… keep this open."} onFile={pick} onClose={() => setAsk(null)} />}
      {err && !img && <div className="pv-err">{err}</div>}
      {img && (
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="sw-t" onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }}>
          <div className={"mk-modal sow-modal" + (sewn ? " wide" : "")}>
            <h2 id="sw-t">Crop the sew-out</h2>
            <p className="faint">Drag the box or its corners so it frames the stitching. This is the picture the customer sees.{where ? <span data-notranslate> · {where}</span> : null}</p>
            <div className="sow-cols">
              <div className="stack" style={{ gap: 10, minWidth: 0 }}>
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
                {/* a second, wider photo of where it sits on the garment (Oct 29, Nick: "we might take another photo for placement") */}
                <div className="sow-place">
                  {place ? <img src={place.url} alt="Placement photo" /> : <span className="sow-place-none" aria-hidden>Placement</span>}
                  <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                    <span className="imp-l">Placement photo (optional)</span>
                    <span className="faint" style={{ fontSize: 12 }}>A wider shot showing where it sits on the garment. It goes on the proof next to the close-up.</span>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <label className="btn sm" style={{ cursor: "pointer" }}>{place ? "Change it" : "Add a placement photo"}
                        <input type="file" hidden accept="image/*" {...(computer ? {} : { capture: "environment" as const })} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickPlace(f); }} />
                      </label>
                      {place && <button type="button" className="btn sm ghost" onClick={() => { URL.revokeObjectURL(place.url); setPlace(null); }}>Remove</button>}
                    </div>
                  </div>
                </div>
              </div>
              <div className="stack" style={{ gap: 10, minWidth: 0 }}>
                {sewn && ctx && <SewnPanel ctx={ctx} value={sewn} onChange={setSewn} />}
                <label className="sow-note"><span className="imp-l">Note for the customer (optional)</span>
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything they should know, like a thread we swapped" /></label>
              </div>
            </div>
            {err && <div className="pv-err">{err}</div>}
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <span className="faint" style={{ fontSize: 12, marginRight: "auto" }}>Saving keeps it with the order. Nothing goes to the customer until Send.</span>
              <button type="button" className="btn" onClick={close} disabled={busy}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save the sew-out"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
