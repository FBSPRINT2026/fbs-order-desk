"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { CLIPART, FONTS, FONTS_CSS_URL, SHIRT_BG, TEMPLATES, UNITS_PER_IN, clipartOf, fontOf, type DesignDoc, type Layer, type LayerInit } from "@/lib/designerArt";
import { WILFLEX_HEX, deltaE } from "@/lib/inkColors";
import { knockOut, makePreview } from "@/lib/artPrep";

const W = 600, H = 700; // 12" x 14" at 50 units per inch
const uidOf = () => Math.random().toString(36).slice(2, 10);
const INKS = Object.entries(WILFLEX_HEX);
const inkName = (hex: string) => INKS.find(([, h]) => h.toLowerCase() === hex.toLowerCase())?.[0] || "";

export type DesignerOut = { svg: File; png: File; doc: DesignDoc; name: string; colors: number; inks: string };
type Tool = "text" | "art" | "upload" | "templates";

/* ---------- measuring text (for curved text) ---------- */
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string, size: number, spacing: number) {
  if (typeof document === "undefined") return text.length * size * 0.6;
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  const f = fontOf(font);
  measureCtx!.font = `${f.weight} ${size}px '${f.name}'`;
  return measureCtx!.measureText(text).width + spacing * Math.max(0, text.length - 1);
}

/** One layer's drawing around its own center (0,0). The layer's move/turn/size is on the group around it. */
function Inner({ l }: { l: Layer }) {
  if (l.kind === "text") {
    const f = fontOf(l.font);
    const paint = {
      fontFamily: `'${f.name}'`, fontWeight: f.weight, fontSize: l.size, letterSpacing: l.spacing || undefined, fill: l.color,
      stroke: l.strokeW ? l.stroke : undefined, strokeWidth: l.strokeW ? l.strokeW * 2 : undefined, strokeLinejoin: "round" as const, paintOrder: "stroke",
    };
    const lines = l.text.split("\n");
    if (l.arc && lines.length === 1 && l.text.trim()) {
      const up = l.arc > 0, a = (Math.min(350, Math.abs(l.arc)) * Math.PI) / 180, h = a / 2;
      const R = Math.max(10, textWidth(l.text, l.font, l.size, l.spacing) / a);
      const big = Math.abs(l.arc) > 180 ? 1 : 0;
      // arch up: along the top of a circle below the text; arch down (smile): along the bottom of a circle above it
      const d = up
        ? `M ${-R * Math.sin(h)} ${R - R * Math.cos(h)} A ${R} ${R} 0 ${big} 1 ${R * Math.sin(h)} ${R - R * Math.cos(h)}`
        : `M ${-R * Math.sin(h)} ${-R + R * Math.cos(h)} A ${R} ${R} 0 ${big} 0 ${R * Math.sin(h)} ${-R + R * Math.cos(h)}`;
      return (
        <g transform={`translate(0 ${up ? l.size * 0.35 : -l.size * 0.05})`}>
          <path id={`p-${l.id}`} d={d} fill="none" />
          <text {...paint} textAnchor="middle"><textPath href={`#p-${l.id}`} startOffset="50%">{l.text}</textPath></text>
        </g>
      );
    }
    const lh = l.size * 1.08;
    return (
      <text {...paint} textAnchor="middle" dominantBaseline="central">
        {lines.map((t, i) => <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * lh}>{t || " "}</tspan>)}
      </text>
    );
  }
  if (l.kind === "art") {
    const c = clipartOf(l.art);
    return <g transform={`translate(${-l.w / 2} ${-l.w / 2}) scale(${l.w / 100})`} color={l.color} fill="currentColor" dangerouslySetInnerHTML={{ __html: c?.svg || "" }} />;
  }
  return <image href={l.src} x={-l.w / 2} y={-l.h / 2} width={l.w} height={l.h} preserveAspectRatio="none" />;
}

const place = (l: Layer) => `translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.s})`;
const layerLabel = (l: Layer) => (l.kind === "text" ? l.text.split("\n")[0] || "Text" : l.kind === "art" ? clipartOf(l.art)?.label || "Clip art" : l.name || "Picture");

/* ---------- files ---------- */
function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
}
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
/** Any picture as a PNG data URL no bigger than 2000px, so saved designs stay a sensible size. */
async function shrink(img: HTMLImageElement, max = 2000) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/png"), w: c.width, h: c.height };
}
function b64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @font-face rules with the font files built in, so the saved SVG looks the same anywhere. */
async function embeddedFonts(names: string[]) {
  const out: string[] = [];
  for (const n of [...new Set(names)]) {
    try {
      const f = fontOf(n);
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${f.css}&display=swap`)).text();
      const block = (css.match(/\/\*\s*latin\s*\*\/\s*(@font-face\s*\{[^}]*\})/) || css.match(/(@font-face\s*\{[^}]*\})\s*$/) || [])[1];
      const url = block?.match(/url\((https:[^)]+)\)/)?.[1];
      if (!block || !url) continue;
      const data = b64(await (await fetch(url)).arrayBuffer());
      out.push(block.replace(url, `data:font/woff2;base64,${data}`));
    } catch { /* that font falls back */ }
  }
  return out.join("\n");
}

/**
 * The shirt designer: text, clip art, pictures and templates on a 12" x 14" print area.
 * Saving gives back an SVG (the art, fonts built in), a PNG (for mockups and previews) and the editable layers.
 */
export default function ShirtDesigner({ start, logos = [], onSave, onClose, saveLabel = "Save design" }: {
  start?: { doc?: DesignDoc | null; imageUrl?: string; name?: string };
  logos?: { id: string; name: string; url: string }[];
  onSave: (out: DesignerOut) => Promise<string | void> | string | void;
  onClose?: () => void;
  saveLabel?: string;
}) {
  const [layers, setLayersRaw] = useState<Layer[]>(() => start?.doc?.layers?.map((l) => ({ ...l })) || []);
  const [sel, setSel] = useState("");
  const [name, setName] = useState(start?.name || "");
  const [bg, setBg] = useState(SHIRT_BG[0].hex);
  const [tool, setTool] = useState<Tool>(start?.doc || start?.imageUrl ? "text" : "templates");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [guide, setGuide] = useState(false);
  const [, setFontTick] = useState(0);
  const past = useRef<Layer[][]>([]), future = useRef<Layer[][]>([]), lastKey = useRef({ k: "", t: 0 });
  const svgRef = useRef<SVGSVGElement>(null), contentRef = useRef<SVGGElement>(null);
  const innerRefs = useRef<Record<string, SVGGElement | null>>({});
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [all, setAll] = useState<{ w: number; h: number } | null>(null);
  const [vs, setVs] = useState(1); // screen px per artboard unit
  const drag = useRef<{ mode: "move" | "size" | "turn"; id: string; px: number; py: number; l0: Layer; snap: Layer[]; moved: boolean } | null>(null);

  // fonts: load the stylesheet once, redraw when fonts arrive (curved text is measured with them)
  useEffect(() => {
    if (!document.getElementById("sd-fonts")) {
      const ln = document.createElement("link");
      ln.id = "sd-fonts"; ln.rel = "stylesheet"; ln.href = FONTS_CSS_URL;
      document.head.appendChild(ln);
    }
    const bump = () => setFontTick((t) => t + 1);
    document.fonts?.addEventListener?.("loadingdone", bump);
    FONTS.forEach((f) => document.fonts?.load?.(`${f.weight} 40px '${f.name}'`).then(bump).catch(() => {}));
    return () => document.fonts?.removeEventListener?.("loadingdone", bump);
  }, []);

  // starting from an existing logo (no saved layers): it comes in as a picture layer
  useEffect(() => {
    if (!start?.imageUrl || start?.doc) return;
    (async () => {
      try {
        const img = await loadImg(start.imageUrl!);
        const s = await shrink(img);
        const fit = Math.min(440 / s.w, 300 / s.h);
        setLayersRaw((ls) => [...ls, { id: uidOf(), kind: "img", src: s.url, w: s.w * fit, h: s.h * fit, x: W / 2, y: 230, rot: 0, s: 1, name: start.name || "Logo" }]);
      } catch { setMsg("Couldn't load that logo into the designer."); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setVs(el.clientWidth / W || 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // measure the selected layer (its own box) and the whole design (for the size readout)
  useLayoutEffect(() => {
    const g = sel ? innerRefs.current[sel] : null;
    let b: { x: number; y: number; w: number; h: number } | null = null;
    try { if (g) { const r = g.getBBox(); b = { x: r.x, y: r.y, w: r.width, h: r.height }; } } catch { b = null; }
    if (JSON.stringify(b) !== JSON.stringify(box)) setBox(b);
    let a: { w: number; h: number } | null = null;
    try { const r = contentRef.current?.getBBox(); if (r && r.width) a = { w: Math.round(r.width), h: Math.round(r.height) }; } catch { a = null; }
    if (JSON.stringify(a) !== JSON.stringify(all)) setAll(a);
  });

  const cur = layers.find((l) => l.id === sel) || null;
  /** Change the layers and remember the step for Undo (typing into one field counts as one step). */
  const commit = (next: Layer[], key = "") => {
    const now = Date.now();
    if (!(key && lastKey.current.k === key && now - lastKey.current.t < 900)) { past.current.push(layers); if (past.current.length > 80) past.current.shift(); }
    lastKey.current = { k: key, t: now };
    future.current = [];
    setLayersRaw(next);
  };
  const edit = (id: string, patch: Partial<Layer>, key = "") => commit(layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)), key ? `${id}:${key}` : "");
  const undo = () => { const p = past.current.pop(); if (!p) return; future.current.push(layers); setLayersRaw(p); };
  const redo = () => { const f = future.current.pop(); if (!f) return; past.current.push(layers); setLayersRaw(f); };
  const add = (l: LayerInit) => { const id = uidOf(); commit([...layers, { ...l, id } as Layer]); setSel(id); };
  const remove = (id: string) => { commit(layers.filter((l) => l.id !== id)); setSel(""); };
  const duplicate = (id: string) => { const l = layers.find((x) => x.id === id); if (!l) return; const n = { ...l, id: uidOf(), x: l.x + 20, y: l.y + 20 } as Layer; commit([...layers, n]); setSel(n.id); };
  const move = (id: string, dir: 1 | -1) => {
    const i = layers.findIndex((l) => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const n = [...layers]; [n[i], n[j]] = [n[j], n[i]]; commit(n);
  };
  const nextY = () => {
    // new things go under what's already there
    const b = all && contentRef.current ? contentRef.current.getBBox() : null;
    return b && b.width ? Math.min(H - 60, b.y + b.height + 60) : 220;
  };

  // keyboard: delete, nudge, undo/redo, duplicate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (!cur) return;
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(cur.id); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(cur.id); return; }
      const n = e.shiftKey ? 10 : 2;
      const d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
      if (d) { e.preventDefault(); edit(cur.id, { x: cur.x + d[0], y: cur.y + d[1] }, "nudge"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- dragging on the artboard ---------- */
  const toPt = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!; const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : p;
  };
  const begin = (e: RPointerEvent, mode: "move" | "size" | "turn", l: Layer) => {
    e.stopPropagation(); e.preventDefault();
    setSel(l.id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = toPt(e);
    drag.current = { mode, id: l.id, px: p.x, py: p.y, l0: l, snap: layers, moved: false };
  };
  const onMoveEv = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = toPt(e), l0 = d.l0;
    let patch: Partial<Layer> = {};
    if (d.mode === "move") {
      let x = l0.x + p.x - d.px; const y = l0.y + p.y - d.py;
      const near = Math.abs(x - W / 2) < 8 / vs * 1.5;
      if (near) x = W / 2;
      setGuide(near);
      patch = { x, y };
    } else if (d.mode === "size") {
      const d0 = Math.hypot(d.px - l0.x, d.py - l0.y) || 1, d1 = Math.hypot(p.x - l0.x, p.y - l0.y);
      patch = { s: Math.max(0.05, Math.min(20, (l0.s * d1) / d0)) };
    } else {
      let a = (Math.atan2(p.y - l0.y, p.x - l0.x) * 180) / Math.PI + 90;
      a = ((a + 540) % 360) - 180;
      for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(a - snap) < 4) a = snap;
      patch = { rot: Math.round(a) };
    }
    d.moved = true;
    setLayersRaw((ls) => ls.map((l) => (l.id === d.id ? ({ ...l, ...patch } as Layer) : l)));
  };
  const onUpEv = () => {
    const d = drag.current; drag.current = null; setGuide(false);
    if (d?.moved) { past.current.push(d.snap); future.current = []; lastKey.current = { k: "", t: 0 }; }
  };

  /* ---------- adding things ---------- */
  const addText = (text: string, font: string, size: number) => add({ kind: "text", text, font, size, color: bg.toLowerCase() === "#1b1b1b" || deltaE(bg, "#111111") < 25 ? "#FFFFFF" : "#111111", stroke: "", strokeW: 0, spacing: 0, arc: 0, x: W / 2, y: nextY(), rot: 0, s: 1 });
  const addArt = (key: string) => add({ kind: "art", art: key, color: deltaE(bg, "#111111") < 25 ? "#FFFFFF" : "#111111", w: 140, x: W / 2, y: nextY(), rot: 0, s: 1 });
  const addPicture = async (src: string, nm: string, knock = false) => {
    try {
      const img = await loadImg(src);
      let s = await shrink(img);
      let alt: string | undefined;
      if (knock) {
        const k = knockOut(await loadImg(s.url));
        if (k) { alt = s.url; s = { ...s, url: k.url }; }
      }
      const fit = Math.min(360 / s.w, 300 / s.h, 1);
      add({ kind: "img", src: s.url, w: s.w * fit, h: s.h * fit, x: W / 2, y: nextY() + 80, rot: 0, s: 1, name: nm, ...(alt ? { alt, knocked: true } : {}) } as LayerInit);
    } catch { setMsg("Couldn't open that picture."); }
  };
  const uploadFile = async (f: File) => {
    setMsg("");
    let file: File | null = f;
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(f.type)) file = await makePreview(f);
    if (!file) return setMsg("That file type can't go in the designer. Try a PNG, JPG or SVG.");
    await addPicture(await blobToDataUrl(file), f.name.replace(/\.[^.]+$/, ""), /jpe?g/i.test(file.type));
  };
  const addLogo = async (lg: { name: string; url: string }) => {
    try { const b = await (await fetch(lg.url)).blob(); await addPicture(await blobToDataUrl(b), lg.name, /jpe?g/i.test(b.type)); }
    catch { setMsg("Couldn't load that logo."); }
  };
  const applyTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key); if (!t) return;
    commit(t.layers.map((l) => ({ ...l, id: uidOf() } as Layer)));
    setSel("");
    setMsg(layers.length ? "Template added in place of your design. Undo brings yours back." : "");
  };

  /* ---------- colors in the design ---------- */
  const used = useMemo(() => {
    const hex = new Set<string>(); let pictures = false;
    layers.filter((l) => !l.hidden).forEach((l) => {
      if (l.kind === "text") { hex.add(l.color.toUpperCase()); if (l.strokeW && l.stroke) hex.add(l.stroke.toUpperCase()); }
      else if (l.kind === "art") hex.add(l.color.toUpperCase());
      else pictures = true;
    });
    return { hex: [...hex], pictures };
  }, [layers]);
  const lowContrast = cur && cur.kind !== "img" && deltaE(bg, cur.color) < 12;

  /* ---------- saving ---------- */
  async function save() {
    if (!layers.some((l) => !l.hidden)) return setMsg("Add some text, clip art or a picture first.");
    setBusy(true); setMsg(""); setSel("");
    await new Promise((r) => setTimeout(r, 30)); // let the selection box disappear
    try {
      const g = contentRef.current!;
      const r = g.getBBox();
      const pad = 4 + Math.max(0, ...layers.map((l) => (l.kind === "text" ? l.strokeW * l.s : 0)));
      const vb = { x: Math.floor(r.x - pad), y: Math.floor(r.y - pad), w: Math.ceil(r.width + pad * 2), h: Math.ceil(r.height + pad * 2) };
      const fonts = await embeddedFonts(layers.filter((l) => l.kind === "text" && !l.hidden).map((l) => (l.kind === "text" ? l.font : "")));
      const inner = new XMLSerializer().serializeToString(g);
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${(vb.w / UNITS_PER_IN).toFixed(2)}in" height="${(vb.h / UNITS_PER_IN).toFixed(2)}in"><defs><style>${fonts}</style></defs>${inner}</svg>`;
      // PNG: 300 dpi, at most 2400px on the long side (mockups and previews)
      const k = Math.min(300 / UNITS_PER_IN, 2400 / Math.max(vb.w, vb.h));
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = await loadImg(url);
      await new Promise((res) => setTimeout(res, 150));
      const c = document.createElement("canvas");
      c.width = Math.round(vb.w * k); c.height = Math.round(vb.h * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const pngBlob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
      const base = (name.trim() || "Custom design").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "design";
      const inkList = used.hex.map((h) => inkName(h) || h);
      const out: DesignerOut = {
        svg: new File([svg], `${base}.svg`, { type: "image/svg+xml" }),
        png: new File([pngBlob], `${base}.png`, { type: "image/png" }),
        doc: { v: 1, w: W, h: H, layers },
        name: name.trim() || "Custom design",
        colors: used.pictures ? Math.max(used.hex.length, 4) : Math.max(1, used.hex.length),
        inks: inkList.join(", "),
      };
      const err = await onSave(out);
      if (err) setMsg(err);
    } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }

  /* ---------- panels ---------- */
  const swatches = (value: string, pick: (hex: string) => void, key: string) => (
    <div className="sd-inks">
      {INKS.map(([n, h]) => <button key={n} type="button" title={n} aria-label={n} className={"sd-ink" + (value.toLowerCase() === h.toLowerCase() ? " on" : "")} style={{ background: h }} onClick={() => pick(h)} />)}
      <label className="sd-ink custom" title="Any color"><input type="color" value={value || "#000000"} onChange={(e) => pick(e.target.value.toUpperCase())} data-key={key} />+</label>
    </div>
  );
  const sizeIn = (l: Layer) => {
    const g = innerRefs.current[l.id];
    try { const r = g?.getBBox(); if (r) return `${((r.width * l.s) / UNITS_PER_IN).toFixed(1)}" × ${((r.height * l.s) / UNITS_PER_IN).toFixed(1)}"`; } catch { /* not drawn yet */ }
    return "";
  };

  const hs = (l: Layer) => 9 / (vs * l.s); // handle size in the layer's own units, ~9 screen px

  return (
    <div className="sd">
      <div className="sd-top">
        <input className="sd-name" type="text" placeholder="Name this design" value={name} onChange={(e) => setName(e.target.value)} aria-label="Design name" />
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn sm ghost" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button type="button" className="btn sm ghost" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        </div>
        <div className="sd-shirts" role="group" aria-label="Preview on shirt color">
          <span className="faint">Shirt</span>
          {SHIRT_BG.map((s) => <button key={s.hex} type="button" title={s.name} aria-label={s.name} className={"sd-shirt" + (bg === s.hex ? " on" : "")} style={{ background: s.hex }} onClick={() => setBg(s.hex)} />)}
        </div>
        <span className="spacer" />
        {onClose && <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>}
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : saveLabel}</button>
      </div>
      {msg && <div className="banner" style={{ margin: "0 0 10px" }}>{msg}</div>}

      <div className="sd-body">
        <aside className="sd-tools panel">
          <div className="sd-tabs">
            {([["templates", "Templates"], ["text", "Text"], ["art", "Clip art"], ["upload", logos.length ? "Pictures & logos" : "Pictures"]] as [Tool, string][]).map(([k, t]) => (
              <button key={k} type="button" className={"sd-tab" + (tool === k ? " on" : "")} onClick={() => setTool(k)}>{t}</button>
            ))}
          </div>
          <div className="sd-tool-b">
            {tool === "text" && (
              <>
                <button type="button" className="sd-addtext big" onClick={() => addText("YOUR TEXT", "Anton", 90)}>Add a heading</button>
                <button type="button" className="sd-addtext mid" onClick={() => addText("Add a subheading", "Oswald", 46)}>Add a subheading</button>
                <button type="button" className="sd-addtext small" onClick={() => addText("Add small text", "Oswald", 28)}>Add small text</button>
                <div className="lbl" style={{ marginTop: 8 }}>OR START WITH A FONT</div>
                <div className="sd-fontgrid">
                  {FONTS.map((f) => <button key={f.name} type="button" className="sd-font" style={{ fontFamily: `'${f.name}'`, fontWeight: f.weight }} onClick={() => addText(f.group === "Script" ? "Your Text" : "YOUR TEXT", f.name, 80)}>{f.name}</button>)}
                </div>
              </>
            )}
            {tool === "art" && (["Icons", "Sports", "Shapes"] as const).map((grp) => (
              <div key={grp}>
                <div className="lbl">{grp.toUpperCase()}</div>
                <div className="sd-artgrid">
                  {CLIPART.filter((c) => c.group === grp).map((c) => (
                    <button key={c.key} type="button" className="sd-art" title={c.label} aria-label={c.label} onClick={() => addArt(c.key)}>
                      <svg viewBox="0 0 100 100" color="#1b1b1b" fill="currentColor" dangerouslySetInnerHTML={{ __html: c.svg }} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {tool === "upload" && (
              <>
                <label className="btn" style={{ cursor: "pointer", justifyContent: "center" }}>Upload a picture<input type="file" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.heic,.heif,.tif,.tiff,.bmp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadFile(f); }} /></label>
                <p className="faint" style={{ fontSize: 12, margin: "6px 0 10px" }}>PNG, JPG, SVG or PDF. White backgrounds on JPGs are removed for you.</p>
                {logos.length > 0 && (
                  <>
                    <div className="lbl">YOUR LOGOS</div>
                    <div className="sd-logos">
                      {logos.map((lg) => <button key={lg.id} type="button" className="sd-logo" title={lg.name} onClick={() => addLogo(lg)}><img src={lg.url} alt={lg.name} /><span>{lg.name}</span></button>)}
                    </div>
                  </>
                )}
              </>
            )}
            {tool === "templates" && (
              <>
                <p className="faint" style={{ fontSize: 12, marginTop: 0 }}>Pick a starting point, then click any words to change them.</p>
                <div className="sd-tpls">
                  {TEMPLATES.map((t) => (
                    <button key={t.key} type="button" className="sd-tpl" onClick={() => applyTemplate(t.key)}>
                      <svg viewBox={`0 60 ${W} ${H - 180}`}>{t.layers.map((l, i) => <g key={i} transform={place(l as Layer)}><Inner l={{ ...l, id: `t${t.key}${i}` } as Layer} /></g>)}</svg>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        <div className="sd-stage">
          <svg ref={svgRef} className="sd-svg" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMoveEv} onPointerUp={onUpEv} onPointerCancel={onUpEv}
            onPointerDown={(e) => { if (e.target === svgRef.current || (e.target as Element).classList?.contains("sd-bg")) setSel(""); }}>
            <rect className="sd-bg" x={0} y={0} width={W} height={H} fill={bg} />
            <rect x={1} y={1} width={W - 2} height={H - 2} fill="none" stroke={deltaE(bg, "#111111") < 25 ? "rgba(255,255,255,.3)" : "rgba(0,0,0,.18)"} strokeDasharray="6 6" pointerEvents="none" />
            <g ref={contentRef}>
              {layers.filter((l) => !l.hidden).map((l) => (
                <g key={l.id} transform={place(l)} style={{ cursor: "move" }} onPointerDown={(e) => begin(e, "move", l)}
                  onDoubleClick={() => { if (l.kind === "text") setTimeout(() => document.getElementById("sd-text")?.focus(), 0); }}>
                  <g ref={(el) => { innerRefs.current[l.id] = el; }}><Inner l={l} /></g>
                </g>
              ))}
            </g>
            {guide && <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#0A7BA6" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 4" pointerEvents="none" />}
            {cur && box && !cur.hidden && (
              <g transform={place(cur)}>
                <rect x={box.x - 3 / cur.s} y={box.y - 3 / cur.s} width={box.w + 6 / cur.s} height={box.h + 6 / cur.s} fill="none" stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                <line x1={box.x + box.w / 2} y1={box.y - 3 / cur.s} x2={box.x + box.w / 2} y2={box.y - 26 / (vs * cur.s)} stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                <circle cx={box.x + box.w / 2} cy={box.y - 26 / (vs * cur.s)} r={hs(cur) * 0.8} fill="#fff" stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "grab" }} onPointerDown={(e) => begin(e, "turn", cur)} />
                <rect x={box.x + box.w + 3 / cur.s - hs(cur) / 2} y={box.y + box.h + 3 / cur.s - hs(cur) / 2} width={hs(cur)} height={hs(cur)} fill="#fff" stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => begin(e, "size", cur)} />
              </g>
            )}
          </svg>
          <div className="sd-under faint">
            {all ? <>Design is about {(all.w / UNITS_PER_IN).toFixed(1)}&quot; × {(all.h / UNITS_PER_IN).toFixed(1)}&quot; on a 12&quot; × 14&quot; print area · </> : null}
            {used.hex.length > 0 && <>{used.hex.length} ink color{used.hex.length === 1 ? "" : "s"}{used.pictures ? " + full-color picture" : ""}</>}
            {!layers.length && "Pick a template or add text to get started."}
          </div>
        </div>

        <aside className="sd-props panel">
          {cur ? (
            <div className="sd-prop-b">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{cur.kind === "text" ? "Text" : cur.kind === "art" ? clipartOf(cur.art)?.label || "Clip art" : "Picture"}</b>
                <span className="faint" style={{ fontSize: 12 }}>{sizeIn(cur)}</span>
              </div>
              {cur.kind === "text" && (
                <>
                  <textarea id="sd-text" rows={Math.min(4, cur.text.split("\n").length + 1)} value={cur.text} onChange={(e) => edit(cur.id, { text: e.target.value }, "text")} aria-label="Text" />
                  <div className="lbl">FONT</div>
                  <div className="sd-fontgrid tight">
                    {FONTS.map((f) => <button key={f.name} type="button" className={"sd-font" + (cur.font === f.name ? " on" : "")} style={{ fontFamily: `'${f.name}'`, fontWeight: f.weight }} onClick={() => edit(cur.id, { font: f.name })}>{f.name}</button>)}
                  </div>
                </>
              )}
              {cur.kind !== "img" && (
                <>
                  <div className="lbl">COLOR <span className="faint" style={{ fontWeight: 400 }}>{inkName(cur.color) || cur.color}</span></div>
                  {swatches(cur.color, (h) => edit(cur.id, { color: h }), "fill")}
                  {lowContrast && <div className="ink-warn" style={{ margin: 0 }}>This color is close to the shirt color and may not show up.</div>}
                </>
              )}
              {cur.kind === "text" && (
                <>
                  <label className="sd-range">Curve <input type="range" min={-180} max={180} step={5} value={cur.arc} onChange={(e) => edit(cur.id, { arc: +e.target.value }, "arc")} /><span>{cur.arc ? `${cur.arc > 0 ? "arch" : "smile"} ${Math.abs(cur.arc)}°` : "none"}</span></label>
                  {cur.text.includes("\n") && cur.arc !== 0 && <div className="faint" style={{ fontSize: 12 }}>Curves work on one line of text.</div>}
                  <label className="sd-range">Spacing <input type="range" min={-5} max={40} step={1} value={cur.spacing} onChange={(e) => edit(cur.id, { spacing: +e.target.value }, "sp")} /><span>{cur.spacing}</span></label>
                  <label className="sd-range">Outline <input type="range" min={0} max={20} step={1} value={cur.strokeW} onChange={(e) => edit(cur.id, { strokeW: +e.target.value, stroke: cur.stroke || (deltaE(cur.color, "#111111") < 25 ? "#FFFFFF" : "#111111") }, "ow")} /><span>{cur.strokeW || "none"}</span></label>
                  {cur.strokeW > 0 && (<><div className="lbl">OUTLINE COLOR <span className="faint" style={{ fontWeight: 400 }}>{inkName(cur.stroke) || cur.stroke}</span></div>{swatches(cur.stroke, (h) => edit(cur.id, { stroke: h }), "stroke")}</>)}
                </>
              )}
              {cur.kind === "img" && cur.alt !== undefined && (
                <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={!!cur.knocked} onChange={() => edit(cur.id, { src: cur.alt!, alt: cur.src, knocked: !cur.knocked })} /> Remove the white background</label>
              )}
              <label className="sd-range">Size <input type="range" min={0.1} max={4} step={0.01} value={cur.s} onChange={(e) => edit(cur.id, { s: +e.target.value }, "s")} /><span>{Math.round(cur.s * 100)}%</span></label>
              <label className="sd-range">Turn <input type="range" min={-180} max={180} step={1} value={cur.rot} onChange={(e) => edit(cur.id, { rot: +e.target.value }, "rot")} /><span>{cur.rot}°</span></label>
              <div className="sd-actions">
                <button type="button" className="btn sm" onClick={() => edit(cur.id, { x: W / 2 })}>Center</button>
                <button type="button" className="btn sm" onClick={() => duplicate(cur.id)}>Duplicate</button>
                <button type="button" className="btn sm" onClick={() => move(cur.id, 1)} title="Bring forward">Forward</button>
                <button type="button" className="btn sm" onClick={() => move(cur.id, -1)} title="Send backward">Back</button>
                <button type="button" className="btn sm ghost danger" onClick={() => remove(cur.id)}>Delete</button>
              </div>
            </div>
          ) : (
            <div className="sd-prop-b faint" style={{ fontSize: 13 }}>
              Click anything on the design to change it. Drag to move, the corner square to resize, the circle on top to turn.
            </div>
          )}
          {layers.length > 0 && (
            <div className="sd-layers">
              <div className="lbl">LAYERS</div>
              {[...layers].reverse().map((l) => (
                <div key={l.id} className={"sd-layer" + (l.id === sel ? " on" : "")}>
                  <button type="button" className="sd-layer-n" onClick={() => setSel(l.id)}>
                    <span className="sd-layer-k">{l.kind === "text" ? "T" : l.kind === "art" ? "★" : "▣"}</span>{layerLabel(l)}
                  </button>
                  <button type="button" className="btn icon ghost" title={l.hidden ? "Show" : "Hide"} aria-label={l.hidden ? "Show" : "Hide"} onClick={() => edit(l.id, { hidden: !l.hidden })}>{l.hidden ? "◌" : "◉"}</button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
