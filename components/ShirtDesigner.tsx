"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, ReactNode } from "react";
import { SHIRT_BG, UNITS_PER_IN, clipartOf, fontOf, type DesignDoc, type Layer, type LayerInit, type RosterRow } from "@/lib/designerArt";
import { TEMPLATES, TEMPLATE_CATS, type Template } from "@/lib/designerTemplates";
import { CLIP_CATEGORIES, clipCredits, firstIcon, getClipIcons, searchClipart, searchMany, uniqueIds, type ClipHit, type ClipIcon, type ClipSet } from "@/lib/clipart";
import { FONT_STYLES, boldOf, cssFamily, hasBold, loadFont, loadFontList, pickWeight, previewFont, type WebFont } from "@/lib/webfonts";
import { WILFLEX_HEX, deltaE } from "@/lib/inkColors";
import { knockOut, makePreview } from "@/lib/artPrep";

const W = 600, H = 700; // 12" x 14" at 50 units per inch
const uidOf = () => Math.random().toString(36).slice(2, 10);
const INKS = Object.entries(WILFLEX_HEX);
const inkName = (hex: string) => INKS.find(([, h]) => h.toLowerCase() === (hex || "").toLowerCase())?.[0] || "";

/** box = where the design sits on the 12" x 14" artboard (50 units per inch), so it can go back onto the shirt in the same spot. */
export type DesignerOut = { svg: File; png: File; doc: DesignDoc; name: string; colors: number; inks: string; box: { x: number; y: number; w: number; h: number }; roster?: RosterRow[] };
/** The real shirt photo behind the artboard: area = the full front/back print area on that photo (photo pixels). */
export type LabShirt = { src: string; hex: string; area: { x: number; y: number; w: number; h: number }; label: string };
type Tool = "ideas" | "text" | "art" | "upload" | "names" | "ai";

/* ---------- text ---------- */
const weightOf = (l: { font: string; weight?: number }) => l.weight ?? fontOf(l.font).weight;
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string, weight: number, size: number, spacing: number) {
  if (typeof document === "undefined") return text.length * size * 0.6;
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx!.font = `${weight} ${size}px '${font}'`;
  return measureCtx!.measureText(text).width + spacing * Math.max(0, text.length - 1);
}

/** One layer's drawing around its own center (0,0). The layer's move/turn/size is on the group around it. */
function Inner({ l }: { l: Layer }) {
  if (l.kind === "text") {
    const wt = weightOf(l);
    const lines = l.text.split("\n");
    const curved = !!l.arc && lines.length === 1 && !!l.text.trim();
    const draw = (fill: string, stroke: string | undefined, key: string) => {
      const paint = {
        fontFamily: `'${l.font}'`, fontWeight: wt, fontSize: l.size, letterSpacing: l.spacing || undefined, fill,
        stroke: l.strokeW ? stroke : undefined, strokeWidth: l.strokeW ? l.strokeW * 2 : undefined, strokeLinejoin: "round" as const, paintOrder: "stroke",
      };
      if (curved) {
        const up = l.arc > 0, a = (Math.min(350, Math.abs(l.arc)) * Math.PI) / 180, h = a / 2;
        const R = Math.max(10, textWidth(l.text, l.font, wt, l.size, l.spacing) / a);
        const big = Math.abs(l.arc) > 180 ? 1 : 0;
        const d = up
          ? `M ${-R * Math.sin(h)} ${R - R * Math.cos(h)} A ${R} ${R} 0 ${big} 1 ${R * Math.sin(h)} ${R - R * Math.cos(h)}`
          : `M ${-R * Math.sin(h)} ${-R + R * Math.cos(h)} A ${R} ${R} 0 ${big} 0 ${R * Math.sin(h)} ${-R + R * Math.cos(h)}`;
        return (
          <g key={key} transform={`translate(0 ${up ? l.size * 0.35 : -l.size * 0.05})`}>
            <path id={`p-${l.id}-${key}`} d={d} fill="none" />
            <text {...paint} textAnchor="middle"><textPath href={`#p-${l.id}-${key}`} startOffset="50%">{l.text}</textPath></text>
          </g>
        );
      }
      const lh = l.size * 1.08;
      const al = lines.length > 1 ? l.align || "center" : "center";
      const half = al === "center" ? 0 : Math.max(...lines.map((t) => textWidth(t, l.font, wt, l.size, l.spacing))) / 2;
      const x0 = al === "left" ? -half : al === "right" ? half : 0;
      return (
        <text key={key} {...paint} textAnchor={al === "left" ? "start" : al === "right" ? "end" : "middle"} dominantBaseline="central">
          {lines.map((t, i) => <tspan key={i} x={x0} y={(i - (lines.length - 1) / 2) * lh}>{t || " "}</tspan>)}
        </text>
      );
    };
    const sd = l.shadowD ?? 6;
    return (
      <g>
        {l.shadow && <g transform={`translate(${sd} ${sd})`}>{draw(l.shadow, l.shadow, "sh")}</g>}
        {draw(l.color, l.stroke, "m")}
      </g>
    );
  }
  if (l.kind === "art") {
    const vb = l.vb || [0, 0, 100, 100];
    const body = l.body ?? clipartOf(l.art)?.svg ?? "";
    const h = (l.w * vb[3]) / vb[2];
    return <g transform={`translate(${-l.w / 2} ${-h / 2}) scale(${l.w / vb[2]}) translate(${-vb[0]} ${-vb[1]})`} color={l.full ? undefined : l.color} fill={l.full ? undefined : "currentColor"} dangerouslySetInnerHTML={{ __html: uniqueIds(body, l.id) }} />;
  }
  return <image href={l.src} x={-l.w / 2} y={-l.h / 2} width={l.w} height={l.h} preserveAspectRatio="none" />;
}

const place = (l: Pick<Layer, "x" | "y" | "rot" | "s" | "flip">) => `translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.flip ? -l.s : l.s} ${l.s})`;
const SIZES = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const layerLabel = (l: Layer) => (l.kind === "text" ? (l.roster === "name" ? "Names (from list)" : l.roster === "number" ? "Numbers (from list)" : l.text.split("\n")[0] || "Text") : l.kind === "art" ? l.label || clipartOf(l.art)?.label || "Clip art" : l.name || "Picture");

/** A clip art layer from a library icon. */
const artLayer = (ic: ClipIcon, color: string, w: number, x: number, y: number): LayerInit => ({
  kind: "art", art: ic.id, color, w, body: ic.body, vb: [ic.left, ic.top, ic.w, ic.h], full: ic.full, label: ic.label, x, y, rot: 0, s: 1,
});

/* ---------- files ---------- */
function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
}
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
/** Any picture as a PNG data URL no bigger than 2400px, so saved designs stay a sensible size. */
async function shrink(img: HTMLImageElement, max = 2400) {
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
async function embeddedFonts(list: { font: string; weight: number }[]) {
  const out: string[] = [], done = new Set<string>();
  for (const { font, weight } of list) {
    const key = `${font}:${weight}`;
    if (done.has(key)) continue;
    done.add(key);
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${cssFamily(font, weight)}&display=swap`)).text();
      const block = (css.match(/\/\*\s*latin\s*\*\/\s*(@font-face\s*\{[^}]*\})/) || css.match(/(@font-face\s*\{[^}]*\})\s*$/) || [])[1];
      const url = block?.match(/url\((https:[^)]+)\)/)?.[1];
      if (!block || !url) continue;
      const data = b64(await (await fetch(url)).arrayBuffer());
      out.push(block.replace(url, `data:font/woff2;base64,${data}`));
    } catch { /* that font falls back */ }
  }
  return out.join("\n");
}

/* ---------- small pieces ---------- */
const RAIL: { k: Tool; label: string; icon: ReactNode }[] = [
  { k: "ideas", label: "Design ideas", icon: <svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" /></svg> },
  { k: "text", label: "Add text", icon: <svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg> },
  { k: "art", label: "Clip art", icon: <svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" /></svg> },
  { k: "upload", label: "Upload", icon: <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg> },
  { k: "names", label: "Names & numbers", icon: <svg viewBox="0 0 24 24"><path d="M4 7h7M4 12h5M4 17h7M15 6l-1 12M19 6l-1 12M13 10h7M12.5 14h7" /></svg> },
  { k: "ai", label: "AI art", icon: <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg> },
];

/** Clip art thumbnail (the icon drawn on its own). */
function ClipThumb({ ic }: { ic: ClipIcon }) {
  return <svg viewBox={`${ic.left} ${ic.top} ${ic.w} ${ic.h}`} color="#1b1b1b" fill={ic.full ? undefined : "currentColor"} dangerouslySetInnerHTML={{ __html: uniqueIds(ic.body, "t" + ic.id.replace(/[^\w]/g, "")) }} />;
}

/** Clip art: search box first, then browse by category. One color art can be recolored; full color art prints digitally. */
function ClipArtPanel({ onAdd }: { onAdd: (ic: ClipIcon) => void }) {
  const [q, setQ] = useState("");
  const [style, setStyle] = useState<"all" | "one" | "full">("all");
  const [cat, setCat] = useState<string>("");
  const [sub, setSub] = useState(-1);
  const [hits, setHits] = useState<ClipHit[] | null>(null);
  const [icons, setIcons] = useState<Record<string, ClipIcon>>({});
  const [n, setN] = useState(60);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<ClipIcon[]>(() => { try { return JSON.parse(localStorage.getItem("idea-lab-recent") || "[]"); } catch { return []; } });
  const c = CLIP_CATEGORIES.find((x) => x.key === cat);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim() && !c) { setHits(null); return; }
      setBusy(true);
      const list = q.trim() ? await searchClipart(q, { style }) : sub >= 0 ? await searchClipart(c!.subs[sub].q, { style }) : await searchMany(c!.subs.map((s) => s.q), { style });
      setHits(list); setN(60); setBusy(false);
    }, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, style, cat, sub]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hits) return;
    const need = hits.slice(0, n).map((h) => h.id).filter((id) => !icons[id]);
    if (need.length) getClipIcons(need).then((got) => setIcons((m) => ({ ...m, ...got })));
  }, [hits, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (ic: ClipIcon) => {
    onAdd(ic);
    const next = [ic, ...recent.filter((r) => r.id !== ic.id)].slice(0, 16);
    setRecent(next);
    try { localStorage.setItem("idea-lab-recent", JSON.stringify(next)); } catch { /* private window */ }
  };
  const grid = (list: ClipIcon[]) => (
    <div className="il-clipgrid">
      {list.map((ic) => <button key={ic.id} type="button" className="il-clip" title={ic.label} aria-label={ic.label} onClick={() => pick(ic)}><ClipThumb ic={ic} />{ic.full && <span className="il-full" title="Full color">●</span>}</button>)}
    </div>
  );
  return (
    <div className="il-panel-b">
      <label className="il-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" placeholder="Search clip art: football, eagle, cross…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clip art" />
      </label>
      <div className="il-seg" role="group" aria-label="Art style">
        {([["all", "All"], ["one", "One color"], ["full", "Full color"]] as const).map(([k, t]) => <button key={k} type="button" className={style === k ? "on" : ""} onClick={() => setStyle(k)}>{t}</button>)}
      </div>
      {!q.trim() && !c && (
        <>
          {recent.length > 0 && <><div className="lbl">RECENTLY USED</div>{grid(recent.slice(0, 8))}</>}
          <div className="lbl">BROWSE</div>
          <div className="il-cats">
            {CLIP_CATEGORIES.map((k) => <button key={k.key} type="button" className="il-cat" onClick={() => { setCat(k.key); setSub(-1); }}><span className="il-cat-e">{k.emoji}</span>{k.label}</button>)}
          </div>
        </>
      )}
      {!q.trim() && c && (
        <>
          <button type="button" className="il-back" onClick={() => { setCat(""); setSub(-1); }}>← All categories</button>
          <div className="il-subs">
            <button type="button" className={"chip" + (sub < 0 ? " on" : "")} onClick={() => setSub(-1)}>All {c.label.toLowerCase()}</button>
            {c.subs.map((s, i) => <button key={s.label} type="button" className={"chip" + (sub === i ? " on" : "")} onClick={() => setSub(i)}>{s.label}</button>)}
          </div>
        </>
      )}
      {hits && (
        <>
          <div className="faint il-count">{busy ? "Searching…" : hits.length ? `${hits.length >= 400 ? "400+" : hits.length} results${q ? ` for “${q.trim()}”` : ""}` : `Nothing found${q ? ` for “${q.trim()}”` : ""}. Try a simpler word (“dog” instead of “bulldog”).`}</div>
          {grid(hits.slice(0, n).map((h) => icons[h.id]).filter(Boolean))}
          {hits.length > n && <button type="button" className="btn sm" style={{ alignSelf: "center" }} onClick={() => setN(n + 60)}>Show more</button>}
        </>
      )}
    </div>
  );
}

/** Font browser: search, shirt styles, every Google font; each name shown in its own font (and the customer's own words). */
function FontPicker({ value, sample, onPick, onPeek }: { value: string; sample: string; onPick: (font: string, weight: number) => void; onPeek?: (font: string | null, weight?: number) => void }) {
  const [list, setList] = useState<WebFont[]>([]);
  const [q, setQ] = useState("");
  const [style, setStyle] = useState("popular");
  const [n, setN] = useState(60);
  useEffect(() => { loadFontList().then(setList); }, []);
  const byName = useMemo(() => new Map(list.map((f) => [f.f, f])), [list]);
  const GCATS: Record<string, string> = { sans: "Sans Serif", serif: "Serif", display: "Display", hand: "Handwriting", mono: "Monospace" };
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t) return list.filter((f) => f.f.toLowerCase().includes(t));
    if (style.startsWith("g:")) return list.filter((f) => f.c === GCATS[style.slice(2)]);
    if (style === "all") return list;
    const st = FONT_STYLES.find((s) => s.key === style);
    return st ? [...new Set(st.fonts)].map((nm) => byName.get(nm)).filter(Boolean) as WebFont[] : list;
  }, [q, style, list, byName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setN(60), [q, style]);
  const text = (sample || "").split("\n")[0].slice(0, 22);
  return (
    <div className="il-fonts" onMouseLeave={() => onPeek?.(null)}>
      <label className="il-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" placeholder={`Search ${list.length > 100 ? list.length.toLocaleString() + " " : ""}fonts`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fonts" />
      </label>
      {!q && (
        <div className="il-subs">
          {FONT_STYLES.map((s) => <button key={s.key} type="button" className={"chip" + (style === s.key ? " on" : "")} onClick={() => setStyle(s.key)}>{s.label}</button>)}
          {list.length > 100 && (<>
            <button type="button" className={"chip" + (style === "g:display" ? " on" : "")} onClick={() => setStyle("g:display")}>All display</button>
            <button type="button" className={"chip" + (style === "g:hand" ? " on" : "")} onClick={() => setStyle("g:hand")}>All handwriting</button>
            <button type="button" className={"chip" + (style === "all" ? " on" : "")} onClick={() => setStyle("all")}>Every font</button>
          </>)}
        </div>
      )}
      <div className="il-fontlist">
        {shown.slice(0, n).map((f) => {
          const w = pickWeight(f, FONT_STYLES[1].fonts.includes(f.f) || f.c === "Display" || f.c === "Handwriting" ? 400 : 700);
          return <FontRow key={f.f} f={f} on={f.f === value} text={text} onPick={() => { onPeek?.(null); onPick(f.f, w); }} onPeek={onPeek ? (on) => onPeek(on ? f.f : null, w) : undefined} />;
        })}
        {shown.length > n && <button type="button" className="btn sm" onClick={() => setN(n + 80)}>Show more fonts</button>}
        {!shown.length && <div className="faint" style={{ fontSize: 12, padding: 8 }}>No fonts match.</div>}
      </div>
    </div>
  );
}
function FontRow({ f, on, text, onPick, onPeek }: { f: WebFont; on: boolean; text: string; onPick: () => void; onPeek?: (on: boolean) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const w = pickWeight(f, 400);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { previewFont(f.f, w); io.disconnect(); } });
    io.observe(el);
    return () => io.disconnect();
  }, [f.f, w]);
  return (
    <button ref={ref} type="button" className={"il-font" + (on ? " on" : "")} onClick={onPick} title={f.f} onMouseEnter={() => onPeek?.(true)} onMouseLeave={() => onPeek?.(false)}>
      <span className="il-font-s" style={{ fontFamily: `'${f.f}'`, fontWeight: w }}>{text || f.f}</span>
      {text && <span className="il-font-n">{f.f}</span>}
    </button>
  );
}

/** Template card: the layout drawn small, clip art filled in once it loads. */
function TemplateCard({ t, onUse }: { t: Template; onUse: () => void }) {
  const [art, setArt] = useState<Record<number, ClipIcon | null>>({});
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(async (es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const out: Record<number, ClipIcon | null> = {};
      await Promise.all(t.layers.map(async (l, i) => { if (l.kind === "art") out[i] = await firstIcon(l.art); }));
      setArt(out);
      t.layers.forEach((l) => { if (l.kind === "text") void loadFont(l.font, l.weight ?? fontOf(l.font).weight); });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [t]);
  return (
    <button ref={ref} type="button" className="il-tpl" onClick={onUse}>
      <svg viewBox={`0 60 ${W} ${H - 160}`}>
        {t.layers.map((l, i) => {
          if (l.kind === "text") {
            const L = { id: `t${t.key}${i}`, kind: "text", text: l.text, font: l.font, weight: l.weight, size: l.size, color: l.color || "#111111", stroke: l.stroke || "", strokeW: l.strokeW || 0, spacing: l.spacing || 0, arc: l.arc || 0, x: l.x ?? W / 2, y: l.y, rot: l.rot || 0, s: 1 } as Layer;
            return <g key={i} transform={place(L)}><Inner l={L} /></g>;
          }
          const ic = art[i];
          if (!ic) return null;
          const L = { ...artLayer(ic, l.color || "#111111", l.w, l.x ?? W / 2, l.y), rot: l.rot || 0, id: `t${t.key}${i}` } as Layer;
          return <g key={i} transform={place(L)}><Inner l={L} /></g>;
        })}
      </svg>
      <span>{t.label}</span>
    </button>
  );
}

/**
 * The Idea Lab: text, clip art, pictures and design ideas on the shirt's print area.
 * Saving gives back an SVG (the art, fonts built in), a PNG (for mockups and previews), the editable layers and where it sits.
 */
export default function ShirtDesigner({ start, logos = [], shirt, onSave, onClose, saveLabel = "Save design" }: {
  start?: { doc?: DesignDoc | null; imageUrl?: string; name?: string; /** where a picture sits now (artboard units: center + width) */ at?: { x: number; y: number; w: number } };
  shirt?: LabShirt | null;
  logos?: { id: string; name: string; url: string }[];
  onSave: (out: DesignerOut) => Promise<string | void> | string | void;
  onClose?: () => void;
  saveLabel?: string;
}) {
  const [layers, setLayersRaw] = useState<Layer[]>(() => start?.doc?.layers?.map((l) => ({ ...l })) || []);
  const [sel, setSel] = useState("");
  const [name, setName] = useState(start?.name || "");
  const [bg, setBg] = useState(shirt?.hex || SHIRT_BG[0].hex);
  const [tool, setTool] = useState<Tool | "">(start?.doc || start?.imageUrl ? "" : "ideas");
  const [tplCat, setTplCat] = useState(TEMPLATE_CATS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [guide, setGuide] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [distress, setDistress] = useState(!!start?.doc?.distress);
  const [roster, setRoster] = useState<RosterRow[]>(() => start?.doc?.roster || []);
  // several things selected at once (shift-click, Ctrl+A); sel is the last one clicked
  const [multi, setMulti] = useState<string[]>([]);
  // hovering a font or color previews it on the selected text / art before it's picked
  const [peek, setPeek] = useState<{ font?: string; weight?: number; color?: string } | null>(null);
  const clip = useRef<Layer[]>([]);
  const [credits, setCredits] = useState<ClipSet[]>([]);
  const [fonts, setFonts] = useState<WebFont[]>([]);
  const [, setFontTick] = useState(0);
  // with a shirt photo, show some of the shirt around the print area
  const BASE = shirt ? { x: -170, y: -250, w: 940, h: 1080 } : { x: 0, y: 0, w: W, h: H };
  // zoom in on the selection (or the middle) for fine work; the frame keeps its size
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<{ x: number; y: number }>({ x: W / 2, y: H / 2 });
  const VB = (() => {
    if (zoom === 1) return BASE;
    const w = BASE.w / zoom, h = BASE.h / zoom;
    const x = Math.max(BASE.x, Math.min(BASE.x + BASE.w - w, focus.x - w / 2)), y = Math.max(BASE.y, Math.min(BASE.y + BASE.h - h, focus.y - h / 2));
    return { x, y, w, h };
  })();
  const past = useRef<Layer[][]>([]), future = useRef<Layer[][]>([]), lastKey = useRef({ k: "", t: 0 });
  const svgRef = useRef<SVGSVGElement>(null), contentRef = useRef<SVGGElement>(null);
  const innerRefs = useRef<Record<string, SVGGElement | null>>({});
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [all, setAll] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [svgW, setSvgW] = useState(600);
  const vs = svgW / VB.w || 1; // screen px per artboard unit
  const drag = useRef<{ mode: "move" | "size" | "turn"; id: string; px: number; py: number; l0: Layer; snap: Layer[]; moved: boolean; group?: { id: string; x: number; y: number }[]; gcx?: number } | null>(null);

  useEffect(() => { clipCredits().then(setCredits); loadFontList().then(setFonts); }, []);
  // work in progress is kept in this browser, so closing the Idea Lab by accident doesn't lose it
  const DRAFT = "idea-lab-draft";
  const [draft, setDraft] = useState<Layer[] | null>(null);
  useEffect(() => {
    if (start?.doc || start?.imageUrl) return;
    try { const d = JSON.parse(localStorage.getItem(DRAFT) || "null"); if (d && Array.isArray(d.layers) && d.layers.length) setDraft(d.layers); } catch { /* private window */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!layers.length) return;
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ at: Date.now(), layers: layers.filter((l) => l.kind !== "img") })); } catch { /* full or private */ } }, 800);
    return () => clearTimeout(t);
  }, [layers]);
  // fonts: load every font in use; redraw when they arrive (curved text is measured with them)
  const fontKey = layers.filter((l) => l.kind === "text").map((l) => (l.kind === "text" ? `${l.font}:${weightOf(l)}` : "")).join("|");
  useEffect(() => {
    let live = true;
    layers.forEach((l) => { if (l.kind === "text") loadFont(l.font, weightOf(l)).then(() => { if (live) setFontTick((t) => t + 1); }); });
    return () => { live = false; };
  }, [fontKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // starting from an existing logo (no saved layers): it comes in as a picture layer, where it sits on the shirt
  useEffect(() => {
    if (!start?.imageUrl || start?.doc) return;
    (async () => {
      try {
        const img = await loadImg(start.imageUrl!);
        const s = await shrink(img);
        const at = start.at, fit = at ? at.w / s.w : Math.min(440 / s.w, 300 / s.h);
        setLayersRaw((ls) => [...ls, { id: uidOf(), kind: "img", src: s.url, w: s.w * fit, h: s.h * fit, x: at ? at.x : W / 2, y: at ? at.y : 230, rot: 0, s: 1, name: start.name || "Logo" }]);
      } catch { setMsg("Couldn't load that logo into the Idea Lab."); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSvgW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // measure the selected layer (its own box) and the whole design (size readout, print-area check)
  useLayoutEffect(() => {
    const g = sel ? innerRefs.current[sel] : null;
    let b: { x: number; y: number; w: number; h: number } | null = null;
    try { if (g) { const r = g.getBBox(); b = { x: r.x, y: r.y, w: r.width, h: r.height }; } } catch { b = null; }
    if (JSON.stringify(b) !== JSON.stringify(box)) setBox(b);
    let a: { x: number; y: number; w: number; h: number } | null = null;
    try { const r = contentRef.current?.getBBox(); if (r && r.width) a = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; } catch { a = null; }
    if (JSON.stringify(a) !== JSON.stringify(all)) setAll(a);
  });

  const cur = layers.find((l) => l.id === sel) || null;
  const picked = multi.length > 1 ? multi.filter((id) => layers.some((l) => l.id === id)) : sel ? [sel] : [];
  const group = picked.length > 1 ? layers.filter((l) => picked.includes(l.id)) : [];
  useEffect(() => { if (!sel || (multi.length && !multi.includes(sel))) setMulti([]); setPeek(null); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A layer's box on the artboard (after its move/turn/size). */
  const boundsOf = (l: Layer) => {
    const g = innerRefs.current[l.id];
    let r: { x: number; y: number; width: number; height: number };
    try { r = g!.getBBox(); } catch { return null; }
    const a = (l.rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), fx = l.flip ? -1 : 1;
    const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]].map(([x, y]) => {
      const X = x * l.s * fx, Y = y * l.s;
      return [l.x + X * c - Y * sn, l.y + X * sn + Y * c];
    });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const unionOf = (ls: Layer[]) => {
    const bs = ls.map(boundsOf).filter(Boolean) as { x: number; y: number; w: number; h: number }[];
    if (!bs.length) return null;
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };
  const groupBox = group.length ? unionOf(group) : null;
  /** Change several layers at once (one undo step). */
  const editMany = (ids: string[], f: (l: Layer) => Partial<Layer>, key = "") => commit(layers.map((l) => (ids.includes(l.id) ? ({ ...l, ...f(l) } as Layer) : l)), key ? `many:${key}` : "");
  useEffect(() => { if (!cur || cur.kind !== "text") setFontOpen(false); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const duplicate = (id: string) => { const l = layers.find((x) => x.id === id); if (!l) return; const n = { ...l, id: uidOf(), x: l.x + 20, y: l.y + 20, lock: false } as Layer; commit([...layers, n]); setSel(n.id); };
  const move = (id: string, dir: 1 | -1) => {
    const i = layers.findIndex((l) => l.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const n = [...layers]; [n[i], n[j]] = [n[j], n[i]]; commit(n);
  };
  /** Paste copied layers (a little down and to the right) and select them. */
  const pasteLayers = () => {
    const copies = clip.current.map((l) => ({ ...l, id: uidOf(), x: l.x + 20, y: l.y + 20, lock: false } as Layer));
    commit([...layers, ...copies]);
    clip.current = copies;
    setMulti(copies.map((c) => c.id)); setSel(copies[copies.length - 1]?.id || "");
  };
  const nextY = () => (all ? Math.min(H - 60, all.y + all.h + 60) : 220);
  const dark = deltaE(bg, "#111111") < 30;
  const ink = dark ? "#FFFFFF" : "#111111";

  // keyboard: delete, nudge, undo/redo, duplicate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); const ids = layers.filter((l) => !l.hidden).map((l) => l.id); setMulti(ids); setSel(ids[ids.length - 1] || ""); return; }
      if (mod && e.key.toLowerCase() === "v" && clip.current.length) { e.preventDefault(); pasteLayers(); return; }
      if (!cur) return;
      if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); clip.current = layers.filter((l) => picked.includes(l.id)); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); if (group.length) { clip.current = group; pasteLayers(); } else duplicate(cur.id); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (group.length) { commit(layers.filter((l) => !picked.includes(l.id))); setSel(""); } else remove(cur.id); return; }
      if (e.key === "Escape") { setSel(""); return; }
      if (group.length) {
        const n = e.shiftKey ? 10 : 2;
        const d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
        if (d) { e.preventDefault(); editMany(picked, (l) => (l.lock ? {} : { x: l.x + d[0], y: l.y + d[1] }), "nudge"); }
        return;
      }
      if (cur.lock) return;
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
    // shift-click adds to (or takes out of) the selection
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      const now = picked.includes(l.id) ? picked.filter((x) => x !== l.id) : [...picked, l.id];
      setMulti(now); setSel(now[now.length - 1] || "");
      return;
    }
    const inGroup = mode === "move" && picked.length > 1 && picked.includes(l.id);
    if (!inGroup) setMulti([]);
    setSel(l.id);
    if (l.lock && !inGroup) return;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = toPt(e);
    const gb = inGroup ? unionOf(group) : null;
    drag.current = { mode, id: l.id, px: p.x, py: p.y, l0: l, snap: layers, moved: false,
      ...(inGroup ? { group: group.filter((g) => !g.lock).map((g) => ({ id: g.id, x: g.x, y: g.y })), gcx: gb ? gb.x + gb.w / 2 : W / 2 } : {}) };
  };
  const pan = useRef<{ x: number; y: number; f: { x: number; y: number } } | null>(null);
  const onMoveEv = (e: RPointerEvent) => {
    const pn = pan.current;
    if (pn) { setFocus({ x: pn.f.x - (e.clientX - pn.x) / vs, y: pn.f.y - (e.clientY - pn.y) / vs }); return; }
    const d = drag.current; if (!d) return;
    const p = toPt(e), l0 = d.l0;
    let patch: Partial<Layer> = {};
    if (d.mode === "move" && d.group) {
      let dx = p.x - d.px; const dy = p.y - d.py;
      const near = Math.abs((d.gcx ?? 0) + dx - W / 2) < 12 / vs;
      if (near) dx = W / 2 - (d.gcx ?? 0);
      setGuide(near);
      d.moved = true;
      const g = d.group;
      setLayersRaw((ls) => ls.map((l) => { const s0 = g.find((q) => q.id === l.id); return s0 ? ({ ...l, x: s0.x + dx, y: s0.y + dy } as Layer) : l; }));
      return;
    }
    if (d.mode === "move") {
      let x = l0.x + p.x - d.px; const y = l0.y + p.y - d.py;
      const near = Math.abs(x - W / 2) < 12 / vs;
      if (near) x = W / 2;
      setGuide(near);
      patch = { x, y };
    } else if (d.mode === "size") {
      const d0 = Math.hypot(d.px - l0.x, d.py - l0.y) || 1, d1 = Math.hypot(p.x - l0.x, p.y - l0.y);
      patch = { s: Math.max(0.05, Math.min(20, (l0.s * d1) / d0)) };
    } else {
      let a = (Math.atan2(p.y - l0.y, p.x - l0.x) * 180) / Math.PI + 90;
      a = ((a + 540) % 360) - 180;
      for (const snap of [-180, -90, -45, 0, 45, 90, 180]) if (Math.abs(a - snap) < 4) a = snap;
      patch = { rot: Math.round(a) };
    }
    d.moved = true;
    setLayersRaw((ls) => ls.map((l) => (l.id === d.id ? ({ ...l, ...patch } as Layer) : l)));
  };
  const onUpEv = () => {
    if (pan.current) { pan.current = null; return; }
    const d = drag.current; drag.current = null; setGuide(false);
    if (d?.moved) { past.current.push(d.snap); future.current = []; lastKey.current = { k: "", t: 0 }; }
  };

  /* ---------- adding things ---------- */
  const addText = (text: string, font: string, size: number, weight?: number) => {
    add({ kind: "text", text, font, weight, size, color: ink, stroke: "", strokeW: 0, spacing: 0, arc: 0, x: W / 2, y: nextY(), rot: 0, s: 1 });
    setTool(""); setFontOpen(false);
    setTimeout(() => { const el = document.getElementById("il-text") as HTMLTextAreaElement | null; el?.focus(); el?.select(); }, 30);
  };
  const addArt = (ic: ClipIcon) => { add(artLayer(ic, ink, 160, W / 2, nextY())); };
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
    if (!file) return setMsg("That file type can't go in the Idea Lab. Try a PNG, JPG, SVG or PDF.");
    await addPicture(await blobToDataUrl(file), f.name.replace(/\.[^.]+$/, ""), /jpe?g/i.test(file.type));
  };
  const addLogo = async (lg: { name: string; url: string }) => {
    try { const b = await (await fetch(lg.url)).blob(); await addPicture(await blobToDataUrl(b), lg.name, /jpe?g/i.test(b.type)); }
    catch { setMsg("Couldn't load that logo."); }
  };
  const applyTemplate = async (t: Template) => {
    const out: Layer[] = [];
    for (const l of t.layers) {
      if (l.kind === "text") {
        out.push({ id: uidOf(), kind: "text", text: l.text, font: l.font, weight: l.weight, size: l.size, color: l.color || "#111111", stroke: l.stroke || "", strokeW: l.strokeW || 0, spacing: l.spacing || 0, arc: l.arc || 0, x: l.x ?? W / 2, y: l.y, rot: l.rot || 0, s: 1 });
      } else {
        const ic = await firstIcon(l.art);
        if (ic) out.push({ ...artLayer(ic, l.color || "#111111", l.w, l.x ?? W / 2, l.y), rot: l.rot || 0, id: uidOf() } as Layer);
      }
    }
    // dark shirts: black ink becomes white so the idea shows up
    if (dark) out.forEach((l) => { if ((l.kind === "text" || l.kind === "art") && deltaE(l.color, bg) < 25) l.color = "#FFFFFF"; });
    commit(out);
    setSel(""); setTool("");
    setMsg(layers.length ? "Design idea added in place of your design. Undo brings yours back." : "Click any words to change them.");
  };

  /* ---------- checks: colors, small text, outside the print area, blurry pictures ---------- */
  const used = useMemo(() => {
    const hex = new Set<string>(); let pictures = false;
    layers.filter((l) => !l.hidden).forEach((l) => {
      if (l.kind === "text") { hex.add(l.color.toUpperCase()); if (l.strokeW && l.stroke) hex.add(l.stroke.toUpperCase()); if (l.shadow) hex.add(l.shadow.toUpperCase()); }
      else if (l.kind === "art") { if (l.full) pictures = true; else hex.add(l.color.toUpperCase()); }
      else pictures = true;
    });
    return { hex: [...hex], pictures };
  }, [layers]);
  const outside = !!all && (all.x < -2 || all.y < -2 || all.x + all.w > W + 2 || all.y + all.h > H + 2);
  const checks: string[] = [];
  if (cur && cur.kind !== "img" && !(cur.kind === "art" && cur.full) && deltaE(bg, cur.color) < 12) checks.push("This color is close to the shirt color and may not show up.");
  if (cur?.kind === "text" && box && (box.h * cur.s) / UNITS_PER_IN / Math.max(1, cur.text.split("\n").length) < 0.3) checks.push("This text is very small (under ⅓\" tall) and may not print clearly.");
  if (cur?.kind === "img" && box) {
    const src = layers.find((l) => l.id === cur.id);
    if (src && src.kind === "img") {
      const im = new Image(); im.src = src.src;
      const dpi = im.naturalWidth ? im.naturalWidth / ((box.w * cur.s) / UNITS_PER_IN) : 300;
      if (dpi < 150) checks.push(`This picture is low resolution at this size (about ${Math.round(dpi)} dpi) and may print blurry.`);
    }
  }
  if (outside) checks.push("Part of the design is outside the print area and won't print.");

  /* ---------- saving ---------- */
  async function save() {
    if (!layers.some((l) => !l.hidden)) return setMsg("Add some text, clip art or a picture first.");
    setBusy(true); setMsg(""); setSel("");
    await new Promise((r) => setTimeout(r, 30)); // let the selection box disappear
    try {
      const g = contentRef.current!;
      const r = g.getBBox();
      const pad = 4 + Math.max(0, ...layers.map((l) => (l.kind === "text" ? (l.strokeW + (l.shadow ? l.shadowD ?? 6 : 0)) * l.s : 0)));
      const vb = { x: Math.floor(r.x - pad), y: Math.floor(r.y - pad), w: Math.ceil(r.width + pad * 2), h: Math.ceil(r.height + pad * 2) };
      const fontsCss = await embeddedFonts(layers.filter((l) => l.kind === "text" && !l.hidden).map((l) => (l.kind === "text" ? { font: l.font, weight: weightOf(l) } : { font: "", weight: 400 })));
      const inner = new XMLSerializer().serializeToString(g);
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="${(vb.w / UNITS_PER_IN).toFixed(2)}in" height="${(vb.h / UNITS_PER_IN).toFixed(2)}in"><defs><style>${fontsCss}</style></defs>${inner}</svg>`;
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
        doc: { v: 1, w: W, h: H, layers, distress, ...(hasRoster && roster.length ? { roster } : {}) },
        ...(hasRoster && roster.length ? { roster } : {}),
        box: vb,
        name: name.trim() || "Custom design",
        colors: used.pictures ? Math.max(used.hex.length, 4) : Math.max(1, used.hex.length),
        inks: inkList.join(", ") + (used.pictures ? (inkList.length ? ", " : "") + "full-color art" : ""),
      };
      const err = await onSave(out);
      if (err) setMsg(err);
      else { try { localStorage.removeItem(DRAFT); } catch { /* private window */ } }
    } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }

  /* ---------- panels ---------- */
  const swatches = (value: string, pick: (hex: string) => void, preview = false) => (
    <div className="sd-inks" onMouseLeave={() => preview && setPeek(null)}>
      {INKS.map(([n, h]) => <button key={n} type="button" title={n} aria-label={n} className={"sd-ink" + ((value || "").toLowerCase() === h.toLowerCase() ? " on" : "")} style={{ background: h }} onClick={() => { setPeek(null); pick(h); }} onMouseEnter={() => preview && setPeek({ color: h })} />)}
      <label className="sd-ink custom" title="Any color (custom ink)"><input type="color" value={value || "#000000"} onChange={(e) => pick(e.target.value.toUpperCase())} />+</label>
    </div>
  );
  const sizeOf = (l: Layer) => {
    const g = innerRefs.current[l.id];
    try { const r = g?.getBBox(); if (r) return { w: (r.width * l.s) / UNITS_PER_IN, h: (r.height * l.s) / UNITS_PER_IN, bw: r.width }; } catch { /* not drawn yet */ }
    return null;
  };
  const hs = (l: Layer) => 9 / (vs * l.s); // handle size in the layer's own units, ~9 screen px
  const curFont = cur?.kind === "text" ? fonts.find((f) => f.f === cur.font) : undefined;
  const panelTitle: Record<Tool, string> = { ideas: "Design ideas", text: "Add text", art: "Clip art", upload: "Upload a picture", names: "Names & numbers", ai: "AI art" };
  /** Add the name or number field (styled once, printed from the list for each shirt). */
  const addRosterField = (k: "name" | "number") => {
    const have = layers.find((l) => l.kind === "text" && l.roster === k);
    if (have) { setSel(have.id); return; }
    add(k === "name"
      ? { kind: "text", text: "NAME", font: "Graduate", size: 70, color: ink, stroke: "", strokeW: 0, spacing: 4, arc: 20, roster: "name", x: W / 2, y: 110, rot: 0, s: 1 }
      : { kind: "text", text: "00", font: "Graduate", size: 260, color: ink, stroke: "", strokeW: 0, spacing: 0, arc: 0, roster: "number", x: W / 2, y: 300, rot: 0, s: 1 });
  };
  const hasRoster = layers.some((l) => l.kind === "text" && !!l.roster);
  const sizeCounts = SIZES.map((z) => [z, roster.filter((r) => r.size === z).length] as [string, number]).filter(([, n]) => n);
  const [pasteText, setPasteText] = useState("");

  return (
    <div className="sd il">
      <div className="sd-top">
        <input className="sd-name" type="text" placeholder="Name this design" value={name} onChange={(e) => setName(e.target.value)} aria-label="Design name" />
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn sm ghost" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button type="button" className="btn sm ghost" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        </div>
        {!shirt && <div className="sd-shirts" role="group" aria-label="Preview on shirt color">
          <span className="faint">Shirt</span>
          {SHIRT_BG.map((s) => <button key={s.hex} type="button" title={s.name} aria-label={s.name} className={"sd-shirt" + (bg === s.hex ? " on" : "")} style={{ background: s.hex }} onClick={() => setBg(s.hex)} />)}
        </div>}
        <label className="check il-vintage" title="A worn-in, vintage print look"><input type="checkbox" checked={distress} onChange={(e) => setDistress(e.target.checked)} /> Vintage look</label>
        <span className="il-inkchip" title="Screen printing prices by the number of ink colors">{used.hex.length ? `${used.hex.length} ink color${used.hex.length === 1 ? "" : "s"}` : "No ink colors yet"}{used.pictures ? " + full color" : ""}</span>
        <span className="spacer" />
        {onClose && <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>}
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : saveLabel}</button>
      </div>
      {msg && <div className="banner" style={{ margin: "0 0 10px" }}>{msg}</div>}
      {draft && !layers.length && (
        <div className="confirm-bar" style={{ marginBottom: 10 }}>
          <span>Pick up where you left off? You have an unsaved design from earlier.</span>
          <button type="button" className="btn sm primary" onClick={() => { setLayersRaw(draft.map((l) => ({ ...l }))); setDraft(null); setTool(""); }}>Restore it</button>
          <button type="button" className="btn sm ghost" onClick={() => { setDraft(null); try { localStorage.removeItem(DRAFT); } catch { /* private window */ } }}>Start fresh</button>
        </div>
      )}

      <div className={"il-body" + (tool ? " open" : "")}>
        <nav className="il-rail" aria-label="Idea Lab tools">
          {RAIL.map((r) => <button key={r.k} type="button" className={"il-rail-b" + (tool === r.k ? " on" : "")} onClick={() => setTool(tool === r.k ? "" : r.k)} aria-pressed={tool === r.k}>{r.icon}<span>{r.label}</span></button>)}
        </nav>
        {tool && (
          <aside className="il-panel panel">
            <div className="il-panel-h"><b>{panelTitle[tool]}</b><button type="button" className="btn icon ghost" aria-label="Close" onClick={() => setTool("")}>✕</button></div>
            {tool === "ideas" && (
              <div className="il-panel-b">
                <div className="il-subs">{TEMPLATE_CATS.map((c) => <button key={c} type="button" className={"chip" + (tplCat === c ? " on" : "")} onClick={() => setTplCat(c)}>{c}</button>)}</div>
                <div className="il-tpls">{TEMPLATES.filter((t) => t.cat === tplCat).map((t) => <TemplateCard key={t.key} t={t} onUse={() => applyTemplate(t)} />)}</div>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>Pick an idea, then click any words or art to change them.</p>
              </div>
            )}
            {tool === "text" && (
              <div className="il-panel-b">
                <button type="button" className="sd-addtext big" onClick={() => addText("YOUR TEXT", "Anton", 90)}>Add a heading</button>
                <button type="button" className="sd-addtext mid" onClick={() => addText("Add a subheading", "Oswald", 46, 600)}>Add a subheading</button>
                <button type="button" className="sd-addtext small" onClick={() => addText("Add small text", "Oswald", 28, 500)}>Add small text</button>
                <div className="lbl" style={{ marginTop: 6 }}>OR START WITH A FONT</div>
                <FontPicker value="" sample="" onPick={(f, w) => addText(FONT_STYLES[3].fonts.includes(f) ? "Your Text" : "YOUR TEXT", f, 80, w)} />
              </div>
            )}
            {tool === "art" && <ClipArtPanel onAdd={addArt} />}
            {tool === "upload" && (
              <div className="il-panel-b">
                <label className="btn primary" style={{ cursor: "pointer", justifyContent: "center" }}>Choose a picture…<input type="file" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.heic,.heif,.tif,.tiff,.bmp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadFile(f); }} /></label>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>PNG, JPG, SVG, PDF or AI. White backgrounds on JPGs are removed for you. For the sharpest print, use a large picture or vector art.</p>
                {logos.length > 0 && (
                  <>
                    <div className="lbl">YOUR LOGOS</div>
                    <div className="sd-logos">
                      {logos.map((lg) => <button key={lg.id} type="button" className="sd-logo" title={lg.name} onClick={() => addLogo(lg)}><img src={lg.url} alt={lg.name} /><span>{lg.name}</span></button>)}
                    </div>
                  </>
                )}
              </div>
            )}
            {tool === "names" && (
              <div className="il-panel-b">
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>Every shirt gets its own name and number. Style the sample on the design once; we print each shirt from your list.</p>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn sm primary" onClick={() => addRosterField("name")}>+ Names</button>
                  <button type="button" className="btn sm primary" onClick={() => addRosterField("number")}>+ Numbers</button>
                </div>
                <div className="lbl">YOUR LIST · {roster.length} {roster.length === 1 ? "shirt" : "shirts"}</div>
                <div className="il-roster">
                  {roster.map((r, i) => (
                    <div key={i} className="il-roster-row">
                      <input type="text" placeholder="Name" value={r.name} aria-label={`Name ${i + 1}`} onChange={(e) => setRoster((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <input type="text" inputMode="numeric" placeholder="#" value={r.number} aria-label={`Number ${i + 1}`} onChange={(e) => setRoster((rs) => rs.map((x, j) => (j === i ? { ...x, number: e.target.value.slice(0, 3) } : x)))} />
                      <select value={r.size} aria-label={`Size ${i + 1}`} onChange={(e) => setRoster((rs) => rs.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}>{SIZES.map((z) => <option key={z}>{z}</option>)}</select>
                      <button type="button" className="btn icon ghost" aria-label="Remove" onClick={() => setRoster((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="btn sm" onClick={() => setRoster((rs) => [...rs, { name: "", number: "", size: rs[rs.length - 1]?.size || "L" }])}>+ Add a shirt</button>
                </div>
                <details className="il-paste">
                  <summary>Paste a list</summary>
                  <textarea rows={4} placeholder={"SMITH, 23, L\nJONES, 7, M"} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                  <button type="button" className="btn sm" onClick={() => {
                    const rows = pasteText.split(/\n+/).map((ln) => ln.split(/[,\t]+/).map((x) => x.trim())).filter((c) => c.some(Boolean)).map(([a = "", b = "", c = ""]) => {
                      const num = /^\d{1,3}$/.test(a) ? a : b, nm = /^\d{1,3}$/.test(a) ? b : a;
                      const size = SIZES.find((z) => z.toLowerCase() === (c || "").toLowerCase().replace(/^xxl$/, "2xl").replace(/^xxxl$/, "3xl")) || "L";
                      return { name: nm, number: num, size };
                    });
                    setRoster((rs) => [...rs, ...rows]); setPasteText("");
                  }}>Add these</button>
                </details>
                {sizeCounts.length > 0 && <div className="faint" style={{ fontSize: 12 }}>Sizes: {sizeCounts.map(([z, n]) => `${n} ${z}`).join(" · ")}</div>}
                {roster.length > 0 && !hasRoster && <div className="ink-warn" style={{ margin: 0 }}>Add names or numbers to the design above so they print.</div>}
              </div>
            )}
            {tool === "ai" && (
              <div className="il-panel-b">
                <div className="il-soon">
                  <b>AI art is coming to the Idea Lab</b>
                  <span>Describe an idea (“a wolf howling at the moon”) and get shirt-ready art in a few seconds. Words are added as real text so they&apos;re always spelled right.</span>
                </div>
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>Until then, try Clip art: search “wolf” or “moon”, then add your words with Add text.</p>
              </div>
            )}
          </aside>
        )}

        <div className="sd-stage il-stage">
          {!layers.length && !tool && (
            <div className="il-empty">
              <b>What do you want to make?</b>
              <div className="row" style={{ gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn sm primary" onClick={() => setTool("ideas")}>Start from a design idea</button>
                <button type="button" className="btn sm" onClick={() => setTool("text")}>Add text</button>
                <button type="button" className="btn sm" onClick={() => setTool("art")}>Add clip art</button>
                <button type="button" className="btn sm" onClick={() => setTool("upload")}>Upload a picture</button>
              </div>
            </div>
          )}
          <svg ref={svgRef} className="sd-svg" viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} onPointerMove={onMoveEv} onPointerUp={onUpEv} onPointerCancel={onUpEv}
            onPointerDown={(e) => {
              if (!(e.target === svgRef.current || (e.target as Element).classList?.contains("sd-bg"))) return;
              setSel("");
              // zoomed in: drag the background to look around
              if (zoom > 1) { pan.current = { x: e.clientX, y: e.clientY, f: { ...focus } }; svgRef.current?.setPointerCapture?.(e.pointerId); }
            }}
            style={{ ...(shirt ? { aspectRatio: `${VB.w} / ${VB.h}`, maxWidth: `min(760px, calc((100vh - 200px) * ${(VB.w / VB.h).toFixed(3)}))`, background: "#fff" } : {}), cursor: zoom > 1 ? "grab" : undefined }}>
            {shirt ? (() => {
              const k = W / shirt.area.w;
              return <image className="sd-bg" href={shirt.src} x={-shirt.area.x * k} y={-shirt.area.y * k} width={1000 * k} height={1250 * k} />;
            })() : <rect className="sd-bg" x={0} y={0} width={W} height={H} fill={bg} />}
            <rect x={1} y={1} width={W - 2} height={H - 2} fill="none" stroke={outside ? "#C8102E" : dark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.2)"} strokeWidth={outside ? 2 : 1} vectorEffect="non-scaling-stroke" strokeDasharray="6 6" pointerEvents="none" />
            <g ref={contentRef}>
              {distress && (
                <defs>
                  <filter id="il-distress" x="-5%" y="-5%" width="110%" height="110%" filterUnits="objectBoundingBox">
                    <feTurbulence type="fractalNoise" baseFrequency="0.085" numOctaves="3" seed="11" result="n" />
                    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  14 0 0 0 -5.1" result="holes" />
                    <feComposite in="SourceGraphic" in2="holes" operator="in" />
                  </filter>
                </defs>
              )}
              <g filter={distress ? "url(#il-distress)" : undefined}>
              {layers.filter((l) => !l.hidden).map((l) => (
                <g key={l.id} transform={place(l)} style={{ cursor: l.lock ? "default" : "move" }} onPointerDown={(e) => begin(e, "move", l)}
                  onDoubleClick={() => { if (l.kind === "text") setTimeout(() => document.getElementById("il-text")?.focus(), 0); }}>
                  <g ref={(el) => { innerRefs.current[l.id] = el; }}><Inner l={l.kind === "text" && l.roster && roster[0] && (l.roster === "name" ? roster[0].name : roster[0].number) ? ({ ...l, text: l.roster === "name" ? roster[0].name.toUpperCase() : roster[0].number } as Layer) : peek && picked.includes(l.id) ? ({ ...l, ...(l.kind === "text" && peek.font ? { font: peek.font, weight: peek.weight } : {}), ...(peek.color && l.kind !== "img" ? { color: peek.color } : {}) } as Layer) : l} /></g>
                </g>
              ))}
              </g>
            </g>
            {guide && <line x1={W / 2} y1={VB.y} x2={W / 2} y2={VB.y + VB.h} stroke="#0A7BA6" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 4" pointerEvents="none" />}
            {group.length > 0 && groupBox && (
              <g pointerEvents="none">
                {group.map((l) => { const b = boundsOf(l); return b ? <rect key={l.id} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#0A7BA6" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null; })}
                <rect x={groupBox.x - 4} y={groupBox.y - 4} width={groupBox.w + 8} height={groupBox.h + 8} fill="none" stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </g>
            )}
            {!group.length && cur && box && !cur.hidden && (
              <g transform={place({ ...cur, flip: false })}>
                <rect x={box.x * (cur.flip ? -1 : 1) - (cur.flip ? box.w : 0) - 3 / cur.s} y={box.y - 3 / cur.s} width={box.w + 6 / cur.s} height={box.h + 6 / cur.s} fill="none" stroke={cur.lock ? "#7A8599" : "#0A7BA6"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray={cur.lock ? "4 3" : undefined} pointerEvents="none" />
                {!cur.lock && (() => {
                  const bx = cur.flip ? -box.x - box.w : box.x;
                  return (<>
                    <line x1={bx + box.w / 2} y1={box.y - 3 / cur.s} x2={bx + box.w / 2} y2={box.y - 26 / (vs * cur.s)} stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    <circle cx={bx + box.w / 2} cy={box.y - 26 / (vs * cur.s)} r={hs(cur) * 0.8} fill="#fff" stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "grab" }} onPointerDown={(e) => begin(e, "turn", cur)} />
                    <rect x={bx + box.w + 3 / cur.s - hs(cur) / 2} y={box.y + box.h + 3 / cur.s - hs(cur) / 2} width={hs(cur)} height={hs(cur)} fill="#fff" stroke="#0A7BA6" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => begin(e, "size", cur)} />
                  </>);
                })()}
              </g>
            )}
          </svg>
          <div className="il-zoom" role="group" aria-label="Zoom">
            <button type="button" className="btn sm ghost" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 1.5))} aria-label="Zoom out">−</button>
            <button type="button" className="btn sm ghost" onClick={() => { if (zoom === 1) { const l = cur; setFocus(l ? { x: l.x, y: l.y } : { x: W / 2, y: H / 2 }); } setZoom(1); }} title="Show the whole print area">{Math.round(zoom * 100)}%</button>
            <button type="button" className="btn sm ghost" disabled={zoom >= 3.3} onClick={() => { if (zoom === 1) setFocus(cur ? { x: cur.x, y: cur.y } : all ? { x: all.x + all.w / 2, y: all.y + all.h / 2 } : { x: W / 2, y: H / 2 }); setZoom((z) => Math.min(3.375, z * 1.5)); }} aria-label="Zoom in">+</button>
          </div>
          <div className="sd-under faint">
            {shirt && <><b>{shirt.label}</b> · </>}
            {all ? <>Design is about {(all.w / UNITS_PER_IN).toFixed(1)}&quot; × {(all.h / UNITS_PER_IN).toFixed(1)}&quot; on a 12&quot; × 14&quot; print area</> : "12\" × 14\" print area"}
          </div>
          {credits.some((c) => /BY/.test(c.license)) && layers.some((l) => l.kind === "art" && l.art.startsWith("game-icons:")) && (
            <div className="faint il-credit">Some clip art by {credits.filter((c) => /BY/.test(c.license)).map((c) => `${c.by} (${c.license})`).join(", ")}.</div>
          )}
        </div>

        <aside className="sd-props panel">
          {group.length ? (
            <div className="sd-prop-b">
              <b>{group.length} things selected</b>
              <span className="faint" style={{ fontSize: 12 }}>Drag any of them to move them together. Shift-click to add or remove one.</span>
              {group.some((l) => l.kind !== "img") && (<><div className="lbl">COLOR FOR ALL</div>{swatches("", (h) => editMany(picked, (l) => (l.kind === "img" || (l.kind === "art" && l.full) ? {} : { color: h })))}</>)}
              <div className="lbl">ARRANGE</div>
              <div className="sd-actions">
                <button type="button" className="btn sm" onClick={() => { const gb = unionOf(group); if (gb) editMany(picked, (l) => ({ x: l.x + W / 2 - (gb.x + gb.w / 2) })); }}>⇔ Center on shirt</button>
                <button type="button" className="btn sm" onClick={() => editMany(picked, () => ({ x: W / 2 }))}>Line up centers</button>
                <button type="button" className="btn sm" onClick={() => { const gb = unionOf(group); if (!gb) return; editMany(picked, (l) => { const b = boundsOf(l); return b ? { x: l.x + gb.x - b.x } : {}; }); }}>Align left</button>
                <button type="button" className="btn sm" onClick={() => { const gb = unionOf(group); if (!gb) return; editMany(picked, (l) => { const b = boundsOf(l); return b ? { x: l.x + gb.x + gb.w - (b.x + b.w) } : {}; }); }}>Align right</button>
              </div>
              <div className="lbl">SIZE</div>
              <div className="sd-actions">
                {([["Smaller", 0.9], ["Bigger", 1.1]] as [string, number][]).map(([t, k]) => (
                  <button key={t} type="button" className="btn sm" onClick={() => { const gb = unionOf(group); if (!gb) return; const cx = gb.x + gb.w / 2, cy = gb.y + gb.h / 2; editMany(picked, (l) => ({ s: l.s * k, x: cx + (l.x - cx) * k, y: cy + (l.y - cy) * k }), "gs"); }}>{t}</button>
                ))}
                {groupBox && <span className="faint" style={{ fontSize: 12, alignSelf: "center" }}>{(groupBox.w / UNITS_PER_IN).toFixed(1)}&quot; × {(groupBox.h / UNITS_PER_IN).toFixed(1)}&quot;</span>}
              </div>
              <div className="sd-actions">
                <button type="button" className="btn sm" onClick={() => { clip.current = group; pasteLayers(); }}>Duplicate</button>
                <button type="button" className="btn sm ghost danger" onClick={() => { commit(layers.filter((l) => !picked.includes(l.id))); setSel(""); }}>Delete all</button>
                <button type="button" className="btn sm ghost" onClick={() => setSel("")}>Done</button>
              </div>
            </div>
          ) : cur ? (
            <div className="sd-prop-b">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{cur.kind === "text" ? "Text" : cur.kind === "art" ? cur.label || clipartOf(cur.art)?.label || "Clip art" : "Picture"}</b>
                <button type="button" className="btn icon ghost" title={cur.lock ? "Unlock" : "Lock in place"} aria-label={cur.lock ? "Unlock" : "Lock"} onClick={() => edit(cur.id, { lock: !cur.lock })}>{cur.lock ? "🔒" : "🔓"}</button>
              </div>
              {checks.map((c) => <div key={c} className="ink-warn" style={{ margin: 0 }}>{c}</div>)}
              {cur.kind === "text" && (
                <>
                  {cur.roster
                    ? <div className="faint" style={{ fontSize: 12 }}>{cur.roster === "name" ? "Names" : "Numbers"} come from your list (Names &amp; numbers). Style this sample: font, color, outline, curve.</div>
                    : <textarea id="il-text" rows={Math.min(4, cur.text.split("\n").length + 1)} value={cur.text} onChange={(e) => edit(cur.id, { text: e.target.value }, "text")} aria-label="Text" />}
                  <div className="il-fontbtn-row">
                    <button type="button" className="il-fontbtn" onClick={() => setFontOpen(!fontOpen)} aria-expanded={fontOpen}>
                      <span style={{ fontFamily: `'${cur.font}'`, fontWeight: weightOf(cur) }}>{cur.font}</span><span className="faint">{fontOpen ? "▴" : "▾"}</span>
                    </button>
                    {(hasBold(curFont, pickWeight(curFont, 400)) || weightOf(cur) > pickWeight(curFont, 400)) && (
                      <button type="button" className={"btn sm" + (weightOf(cur) > pickWeight(curFont, 400) ? " primary" : "")} title="Bold" onClick={() => { const reg = pickWeight(curFont, 400); edit(cur.id, { weight: weightOf(cur) > reg ? reg : boldOf(curFont, reg) }); }}><b>B</b></button>
                    )}
                  </div>
                  {fontOpen && <FontPicker value={cur.font} sample={cur.text} onPick={(f, w) => edit(cur.id, { font: f, weight: w })} onPeek={(f, w) => setPeek(f ? { font: f, weight: w } : null)} />}
                  {cur.text.includes("\n") && (
                    <div className="il-presets" role="group" aria-label="Line alignment">
                      {(["left", "center", "right"] as const).map((a) => <button key={a} type="button" className={"chip" + ((cur.align || "center") === a ? " on" : "")} onClick={() => edit(cur.id, { align: a })}>{a === "left" ? "⫷ Left" : a === "center" ? "☰ Center" : "Right ⫸"}</button>)}
                    </div>
                  )}
                </>
              )}
              {cur.kind !== "img" && !(cur.kind === "art" && cur.full) && (
                <>
                  <div className="lbl">COLOR <span className="faint" style={{ fontWeight: 400 }}>{inkName(cur.color) || cur.color}</span></div>
                  {swatches(cur.color, (h) => edit(cur.id, { color: h }), true)}
                </>
              )}
              {cur.kind === "art" && cur.full && <div className="faint" style={{ fontSize: 12 }}>Full-color art prints digitally (DTF). For screen printing, pick a one-color version in Clip art.</div>}
              {cur.kind === "text" && (
                <>
                  <label className="sd-range">Curve <input type="range" min={-350} max={350} step={5} value={cur.arc} onChange={(e) => edit(cur.id, { arc: +e.target.value }, "arc")} /><span>{cur.arc ? `${cur.arc > 0 ? "arch" : "smile"} ${Math.abs(cur.arc)}°` : "none"}</span></label>
                  <div className="il-presets">
                    {([["Straight", 0], ["Arch", 60], ["Big arch", 120], ["Smile", -60], ["Big smile", -120], ["Circle", 350]] as [string, number][]).map(([t, v]) => <button key={t} type="button" className={"chip" + (cur.arc === v ? " on" : "")} onClick={() => edit(cur.id, { arc: v })}>{t}</button>)}
                  </div>
                  {cur.text.includes("\n") && cur.arc !== 0 && <div className="faint" style={{ fontSize: 12 }}>Curves work on one line of text.</div>}
                  <label className="sd-range">Spacing <input type="range" min={-5} max={40} step={1} value={cur.spacing} onChange={(e) => edit(cur.id, { spacing: +e.target.value }, "sp")} /><span>{cur.spacing}</span></label>
                  <label className="sd-range">Outline <input type="range" min={0} max={20} step={1} value={cur.strokeW} onChange={(e) => edit(cur.id, { strokeW: +e.target.value, stroke: cur.stroke || (deltaE(cur.color, "#111111") < 25 ? "#FFFFFF" : "#111111") }, "ow")} /><span>{cur.strokeW || "none"}</span></label>
                  {cur.strokeW > 0 && (<><div className="lbl">OUTLINE COLOR <span className="faint" style={{ fontWeight: 400 }}>{inkName(cur.stroke) || cur.stroke}</span></div>{swatches(cur.stroke, (h) => edit(cur.id, { stroke: h }))}</>)}
                  <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={!!cur.shadow} onChange={(e) => edit(cur.id, { shadow: e.target.checked ? (dark ? "#53565A" : "#8A8D8F") : undefined })} /> Drop shadow</label>
                  {cur.shadow && (<>
                    <label className="sd-range">Distance <input type="range" min={2} max={20} step={1} value={cur.shadowD ?? 6} onChange={(e) => edit(cur.id, { shadowD: +e.target.value }, "sd")} /><span>{cur.shadowD ?? 6}</span></label>
                    {swatches(cur.shadow, (h) => edit(cur.id, { shadow: h }))}
                  </>)}
                </>
              )}
              {cur.kind === "img" && cur.alt !== undefined && (
                <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={!!cur.knocked} onChange={() => edit(cur.id, { src: cur.alt!, alt: cur.src, knocked: !cur.knocked })} /> Remove the white background</label>
              )}
              {(() => {
                const sz = sizeOf(cur);
                const setW = (inches: number) => { if (!sz || !inches) return; edit(cur.id, { s: Math.max(0.05, (inches * UNITS_PER_IN) / sz.bw) }, "w"); };
                return (
                  <div className="il-size">
                    <label>W <input type="number" min={0.25} max={16} step={0.1} value={sz ? sz.w.toFixed(1) : ""} onChange={(e) => setW(+e.target.value)} aria-label="Width in inches" />&quot;</label>
                    <label>H <input type="number" min={0.25} max={16} step={0.1} value={sz ? sz.h.toFixed(1) : ""} onChange={(e) => { if (sz) setW((+e.target.value * sz.w) / (sz.h || 1)); }} aria-label="Height in inches" />&quot;</label>
                    <label>↻ <input type="number" min={-180} max={180} step={1} value={cur.rot} onChange={(e) => edit(cur.id, { rot: Math.max(-180, Math.min(180, +e.target.value || 0)) }, "rot")} aria-label="Rotation in degrees" />°</label>
                  </div>
                );
              })()}
              <label className="sd-range">Size <input type="range" min={0.1} max={4} step={0.01} value={cur.s} onChange={(e) => edit(cur.id, { s: +e.target.value }, "s")} /><span>{Math.round(cur.s * 100)}%</span></label>
              <div className="sd-actions">
                <button type="button" className="btn sm" onClick={() => edit(cur.id, { x: W / 2 })} title="Center left to right">⇔ Center</button>
                <button type="button" className="btn sm" onClick={() => edit(cur.id, { flip: !cur.flip })} title="Mirror left to right">⇋ Flip</button>
                <button type="button" className="btn sm" onClick={() => duplicate(cur.id)}>Duplicate</button>
                <button type="button" className="btn sm" onClick={() => move(cur.id, 1)} title="Bring forward">Forward</button>
                <button type="button" className="btn sm" onClick={() => move(cur.id, -1)} title="Send backward">Back</button>
                <button type="button" className="btn sm ghost danger" onClick={() => remove(cur.id)}>Delete</button>
              </div>
            </div>
          ) : (
            <div className="sd-prop-b faint" style={{ fontSize: 13 }}>
              Click anything on the design to change it. Drag to move, drag the corner square to resize, the circle on top to turn.
              <span style={{ display: "block", marginTop: 6 }}>Shift-click to pick several things, Ctrl+A for everything (then drag it all at once). Arrow keys nudge; Ctrl+C / Ctrl+V copy; Ctrl+Z undoes.</span>
              {layers.length > 1 && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => { const ids = layers.filter((l) => !l.hidden).map((l) => l.id); setMulti(ids); setSel(ids[ids.length - 1]); }}>Select everything</button>}
            </div>
          )}
          {layers.length > 0 && (
            <div className="sd-layers">
              <div className="lbl">LAYERS</div>
              {[...layers].reverse().map((l) => (
                <div key={l.id} className={"sd-layer" + (l.id === sel ? " on" : "")}>
                  <button type="button" className="sd-layer-n" onClick={() => setSel(l.id)}>
                    <span className="sd-layer-k">{l.kind === "text" ? "T" : l.kind === "art" ? "★" : "▣"}</span>{layerLabel(l)}{l.lock ? " 🔒" : ""}
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

