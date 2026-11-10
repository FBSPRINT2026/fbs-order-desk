"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Crop, rotate and zoom a photo on the phone before it's saved (Nov 10, Nick: "simple editing tools… crop, rotate…
 * you need to be able to zoom and pinch, in and out"). Pinch (or the mouse wheel) zooms, one finger drags the photo,
 * the corners of the white box crop, Rotate turns it a quarter. `edited()` gives the result as a JPEG at the photo's
 * own resolution (what's inside the box), or the original file when nothing was changed.
 */
export type PhotoEditApi = { edited: () => Promise<File> };

type Box = { x: number; y: number; w: number; h: number };
const MIN = 48;

export default function PhotoEdit({ file, apiRef, labels }: { file: File; apiRef: { current: PhotoEditApi | null }; labels: { rotate: string; reset: string; hint: string } }) {
  const stage = useRef<HTMLDivElement>(null);
  const [url] = useState(() => URL.createObjectURL(file));
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rot, setRot] = useState(0), [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState<Box | null>(null);
  const changed = useRef(false);

  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = url; return () => URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);

  // the photo fits the stage at zoom 1, whichever way it's turned
  const turned = rot % 180 !== 0;
  const nw = img?.naturalWidth || 1, nh = img?.naturalHeight || 1;
  const rw = turned ? nh : nw, rh = turned ? nw : nh;
  const fit = size.w && size.h ? Math.min(size.w / rw, size.h / rh) : 1;
  const k = fit * zoom;
  // the box starts on the whole photo as shown
  const photoBox = (): Box => { const w = rw * fit, h = rh * fit; return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h }; };
  useEffect(() => { if (img && size.w) setBox(photoBox()); }, [img, size.w, size.h, rot]); // eslint-disable-line react-hooks/exhaustive-deps

  // gestures: pointers on the stage (pan / pinch); the box's corners have their own
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; zoom: number; mid: { x: number; y: number }; pan: { x: number; y: number } } | null>(null);
  const mid = () => { const v = [...pts.current.values()]; return { x: (v[0].x + (v[1]?.x ?? v[0].x)) / 2, y: (v[0].y + (v[1]?.y ?? v[0].y)) / 2 }; };
  const dist = () => { const v = [...pts.current.values()]; return v.length < 2 ? 0 : Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y); };
  const begin = () => { start.current = { d: dist(), zoom, mid: mid(), pan }; };
  const onDown = (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); begin(); };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !start.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current, m = mid();
    if (pts.current.size >= 2 && s.d) setZoom(Math.min(8, Math.max(1, (s.zoom * dist()) / s.d)));
    setPan({ x: s.pan.x + m.x - s.mid.x, y: s.pan.y + m.y - s.mid.y });
    changed.current = true;
  };
  const onUp = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); begin(); };
  const onWheel = (e: React.WheelEvent) => { setZoom((z) => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))); changed.current = true; };

  // a corner of the crop box
  const corner = (cx: 0 | 1, cy: 0 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY, b0 = box!;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h } = b0;
      if (cx === 0) { x = Math.min(b0.x + b0.w - MIN, Math.max(0, b0.x + dx)); w = b0.x + b0.w - x; } else w = Math.min(size.w - b0.x, Math.max(MIN, b0.w + dx));
      if (cy === 0) { y = Math.min(b0.y + b0.h - MIN, Math.max(0, b0.y + dy)); h = b0.y + b0.h - y; } else h = Math.min(size.h - b0.y, Math.max(MIN, b0.h + dy));
      setBox({ x, y, w, h }); changed.current = true;
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  // the result: what's inside the box, at the photo's own resolution (at most 4,000 px a side)
  apiRef.current = {
    edited: async () => {
      if (!img || !box || (!changed.current && rot === 0)) return file;
      let scale = 1 / k; // photo pixels per screen pixel
      const big = Math.max(box.w, box.h) * scale; if (big > 4000) scale *= 4000 / big;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(box.w * scale)); c.height = Math.max(1, Math.round(box.h * scale));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(scale, scale);
      ctx.translate(-box.x, -box.y);
      ctx.translate(size.w / 2 + pan.x, size.h / 2 + pan.y);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(k, k);
      ctx.drawImage(img, -nw / 2, -nh / 2);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
      if (!blob) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    },
  };

  const reset = () => { setRot(0); setZoom(1); setPan({ x: 0, y: 0 }); changed.current = false; setBox(photoBox()); };
  return (
    <div className="pe">
      <div ref={stage} className="pe-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        {img && <img src={url} alt="" draggable={false} style={{ width: nw, height: nh, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) rotate(${rot}deg) scale(${k})` }} />}
        {box && <div className="pe-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          {([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([cx, cy]) => <span key={`${cx}${cy}`} className={`pe-c pe-c${cx}${cy}`} onPointerDown={corner(cx, cy)} />)}
        </div>}
      </div>
      <div className="pe-tools">
        <button type="button" className="jm-ghost" onClick={() => { setRot((r) => (r + 90) % 360); changed.current = true; }}>⟳ {labels.rotate}</button>
        <button type="button" className="jm-ghost" onClick={reset}>{labels.reset}</button>
      </div>
      <div className="pe-hint">{labels.hint}</div>
    </div>
  );
}
