"use client";
/**
 * Sales sheet creator (Mockup Creator → Sales tools, Oct 22 2026, Nick: "a sales sheet creator… edit all sorts of
 * things… a really nice graphic editor that lets me create a cool sales sheet", so a customer can send out an image and
 * take orders).
 *
 * Rebuilt as an editor (Oct 24, Nick: "it's gotten a little jumbled… it needs to be like an editable… click your logo and
 * move it anywhere on the page… click like, oh, final test and just rename it… The only thing you shouldn't be able to
 * edit is the mock-up contents. But if you want to just like make it smaller or larger on the page, you can… add the
 * details, the imprint locations… easily edit it"). Everything on the sheet is a piece: click it to pick it, drag it
 * anywhere, drag its corner to size it, double-click a text (or a shirt's color name) to type over it. The shirts are the
 * mockup's pictures: moved and sized, never changed. Auto-arrange lays it all out again. Downloads as PNG, JPG or PDF;
 * nothing is saved.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { canvasPage, imagePdf } from "@/lib/imagePdf";

export type SheetColor = { key: string; color: string; style: string; /** the shirt's color, for the art close-up */ hex?: string };
type Sides = "both" | "front" | "back";
type Align = "left" | "center" | "right";
type Role = "title" | "sub" | "contact" | "details" | "text" | "logo" | "art" | "pic";
type Base = { id: string; x: number; y: number; w: number; h: number };
type TextEl = Base & { kind: "text"; role: Role; text: string; size: number; color: string; bold: boolean; align: Align };
type ImgEl = Base & { kind: "img"; role: Role; src: string; name: string };
type ShirtEl = Base & { kind: "shirt"; key: string; label: string; labelSize: number; showLabel: boolean };
type El = TextEl | ImgEl | ShirtEl;

// shapes for sending out, not paper (Oct 22, Nick: "this is going to be like an email blast"); w: 0 = the width you set
const PAGES = {
  fit: { label: "Fits the shirts (email)", w: 0, h: 0 },
  square: { label: "Square post (1080 × 1080)", w: 1080, h: 1080 },
  story: { label: "Story (1080 × 1920)", w: 1080, h: 1920 },
  wide: { label: "Wide banner (1600 × 900)", w: 1600, h: 900 },
  print: { label: "Print (11 × 8.5)", w: 2200, h: 1700 },
  custom: { label: "Custom: drag the sheet's corner", w: 0, h: 0 },
} as const;
type PageKey = keyof typeof PAGES;
const FONT = "Helvetica, Arial, sans-serif";
const LH = 1.2;
const uid = () => Math.random().toString(36).slice(2, 9);
const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => no(new Error("picture")); im.src = src; });
const dark = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 110; };
let measureCtx: CanvasRenderingContext2D | null = null;
const fontOf = (bold: boolean, size: number) => `${bold ? 800 : 400} ${size}px ${FONT}`;
function measure(text: string, size: number, bold: boolean) {
  measureCtx ||= document.createElement("canvas").getContext("2d");
  const x = measureCtx!; x.font = fontOf(bold, size);
  const lines = (text || " ").split("\n");
  return { w: Math.ceil(Math.max(8, ...lines.map((l) => x.measureText(l || " ").width))) + 2, h: Math.ceil(lines.length * size * LH) };
}
/** a text's box follows its words and size; centered text stays centered where it was, right-aligned stays right */
function refit(t: TextEl): TextEl {
  const m = measure(t.text, t.size, t.bold);
  const x = t.align === "center" ? t.x + t.w / 2 - m.w / 2 : t.align === "right" ? t.x + t.w - m.w : t.x;
  return { ...t, x, w: m.w, h: m.h };
}
const ROLE_NAME: Record<Role, string> = { title: "Title", sub: "Subtitle", contact: "Contact line", details: "Details", text: "Text", logo: "Logo", art: "Art", pic: "Picture" };

export default function SalesSheet({ colors, views, shirts, title0, customer, shop, onClose, arts = [], details = [] }: {
  /** the prints' art as it prints (inks applied), for the art close-up */ arts?: { label: string; url: string }[];
  colors: SheetColor[];
  /** the sides this mockup has prints on */ views: ("front" | "back")[];
  /** one color's shirt(s) side by side, drawn about `h` px tall */ shirts: (key: string, sides: ("front" | "back")[], h: number) => Promise<HTMLCanvasElement>;
  title0: string; customer: string;
  shop: { name: string; line: string; logoUrl: string };
  /** the garment and each print (location, method, inks, size) for the Details block */ details?: string[];
  onClose: () => void;
}) {
  const [page0, setPage] = useSticky<PageKey>("ss.page2", "fit");
  const page: PageKey = page0 in PAGES ? page0 : "fit";
  const [fitW, setFitW] = useSticky<number>("ss.fitW", 1200);
  const [cust, setCust] = useSticky<{ w: number; h: number }>("ss.custom", { w: 1200, h: 1200 });
  const [bg, setBg] = useSticky<string>("ss.bg", "#ffffff");
  const [sides, setSides] = useSticky<Sides>("ss.sides", "both");
  const [perRow, setPerRow] = useSticky<number>("ss.perRow2", 0); // 0 = Auto
  const [gap, setGap] = useSticky<number>("ss.gap", 3);
  const [names, setNames] = useSticky<boolean>("ss.names", true);
  const [fmt, setFmt] = useSticky<"png" | "jpg" | "pdf">("ss.fmt", "png");
  const [res, setRes] = useSticky<number>("ss.res", 3);
  const [order, setOrder] = useState<string[]>(colors.map((c) => c.key));
  const [off, setOff] = useState<Set<string>>(new Set());
  const [els, setEls] = useState<El[]>([]);
  const [sheet, setSheet] = useState<{ w: number; h: number }>({ w: 1200, h: 1500 });
  const [sel, setSel] = useState("");
  const [editing, setEditing] = useState("");
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState("Drawing the shirts…");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const ink = dark(bg) ? "#ffffff" : "#141D2B", soft = dark(bg) ? "#d5dbe3" : "#5B6678";
  const sideList: ("front" | "back")[] = sides === "both" ? views : views.includes(sides) ? [sides] : views;
  const sidesKey = sideList.join("+");
  const shown = useMemo(() => order.map((k) => colors.find((c) => c.key === k)).filter((c): c is SheetColor => !!c && !off.has(c.key)), [order, off, colors]);
  const multiStyle = new Set(colors.map((c) => c.style)).size > 1;

  // each color's sides drawn once, the photo's white made see-through and trimmed to the shirt, then joined side by side
  type Store = { cache: Map<string, HTMLCanvasElement>; f: number };
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const crop = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const comps = useRef(new Map<string, { cv: HTMLCanvasElement; url: string }>());
  const imgs = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    let live = true;
    (async () => {
      setBusy("Drawing the shirts…");
      try {
        if (shop.logoUrl && !imgs.current.has(shop.logoUrl)) { const im = await load(shop.logoUrl).catch(() => null); if (im) imgs.current.set(shop.logoUrl, im); }
        for (const a of arts) if (a.url && !imgs.current.has(a.url)) { const im = await load(a.url).catch(() => null); if (im) imgs.current.set(a.url, im); }
        for (const c of colors) for (const sd of views) {
          const k = `${c.key}|${sd}`;
          if (!cache.current.has(k)) { const cv0 = await shirts(c.key, [sd], 900); clearBg(cv0); cache.current.set(k, cv0); trim(k, cv0); }
          if (!live) return;
        }
        setBusy(""); setReady(true);
      } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't draw the shirts."); setBusy(""); }
    })();
    return () => { live = false; };
  }, [colors.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearBg(cv0: HTMLCanvasElement) {
    const z = cv0 as HTMLCanvasElement & { clear?: boolean }; if (z.clear) return;
    const w = cv0.width, h = cv0.height, x2 = cv0.getContext("2d")!, img = x2.getImageData(0, 0, w, h), d = img.data;
    const seen = new Uint8Array(w * h), st: number[] = [];
    const bgl = (i: number) => d[i * 4] >= 250 && d[i * 4 + 1] >= 250 && d[i * 4 + 2] >= 250;
    for (let xx = 0; xx < w; xx++) st.push(xx, (h - 1) * w + xx);
    for (let yy = 0; yy < h; yy++) st.push(yy * w, yy * w + w - 1);
    while (st.length) {
      const i = st.pop()!; if (seen[i]) continue; seen[i] = 1;
      if (!bgl(i)) continue;
      d[i * 4 + 3] = 0;
      const xx = i % w, yy = (i / w) | 0;
      if (xx > 0) st.push(i - 1); if (xx < w - 1) st.push(i + 1); if (yy > 0) st.push(i - w); if (yy < h - 1) st.push(i + w);
    }
    x2.putImageData(img, 0, 0);
    z.clear = true;
  }
  function trim(key: string, cv0: HTMLCanvasElement) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const w = cv0.width, h = cv0.height, d = cv0.getContext("2d")!.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; if (d[i + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const pad = 4;
    crop.current[key] = x1 > x0 && y1 > y0 ? { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(w, x1 - x0 + 2 * pad), h: Math.min(h, y1 - y0 + 2 * pad) } : { x: 0, y: 0, w, h };
  }
  /** one color's sides side by side, standing on one line (from the store's drawings: × f for a sharp download) */
  function composite(key: string, st: Store = { cache: cache.current, f: 1 }) {
    const bs = sideList.map((sd) => crop.current[`${key}|${sd}`] || { x: 0, y: 0, w: 600, h: 750 });
    const g = Math.round(Math.max(...bs.map((b) => b.w)) * 0.05);
    const W = bs.reduce((t, b) => t + b.w, 0) + g * (bs.length - 1), H = Math.max(...bs.map((b) => b.h));
    const c = document.createElement("canvas"); c.width = Math.round(W * st.f); c.height = Math.round(H * st.f);
    const x = c.getContext("2d")!; x.imageSmoothingQuality = "high";
    let sx = 0;
    sideList.forEach((sd, j) => { const b = bs[j], im = st.cache.get(`${key}|${sd}`); if (im) x.drawImage(im, b.x * st.f, b.y * st.f, b.w * st.f, b.h * st.f, sx * st.f, (H - b.h) * st.f, b.w * st.f, b.h * st.f); sx += b.w + g; });
    return c;
  }
  const comp = (key: string) => {
    const k = `${key}|${sidesKey}`;
    let v = comps.current.get(k);
    if (!v) { const cv = composite(key); v = { cv, url: cv.toDataURL("image/png") }; comps.current.set(k, v); }
    return v;
  };

  // ---- laying the sheet out (first open, Auto-arrange, a new shape, sides or colors) ----
  function pageW() { return page === "fit" ? Math.max(400, Math.min(4000, fitW || 1200)) : page === "custom" ? cust.w : PAGES[page].w; }
  function arrange(prev: El[], first = false) {
    const W = pageW();
    const fixedH = page === "fit" ? 0 : page === "custom" ? cust.h : PAGES[page].h;
    const S = fixedH ? Math.min(W, fixedH) : W, M = Math.round(S * 0.045);
    const has = (r: Role) => first || prev.some((e) => e.kind !== "shirt" && e.role === r);
    const old = (r: Role) => prev.find((e): e is TextEl => e.kind === "text" && e.role === r);
    const out: El[] = [];
    let y = M;
    // the header: the logo, the title, the subtitle
    const lg = shop.logoUrl ? imgs.current.get(shop.logoUrl) : null;
    if (lg && has("logo")) {
      const h = Math.round(S * 0.07), w = Math.min(W * 0.4, h * (lg.naturalWidth / (lg.naturalHeight || 1)));
      out.push({ id: prev.find((e) => e.kind === "img" && e.role === "logo")?.id || uid(), kind: "img", role: "logo", src: shop.logoUrl, name: shop.name || "Logo", x: (W - w) / 2, y, w, h: w / (lg.naturalWidth / (lg.naturalHeight || 1)) });
      y += out[out.length - 1].h + Math.round(S * 0.02);
    }
    const txt = (role: Role, text: string, size: number, bold: boolean, color: string): TextEl => {
      const o = old(role);
      return refit({ id: o?.id || uid(), kind: "text", role, text: o?.text ?? text, size: o ? o.size * (W / (sheet.w || W)) : size, bold: o?.bold ?? bold, color: o?.color ?? color, align: "center", x: W / 2, y: 0, w: 0, h: 0 });
    };
    if (has("title") && (old("title")?.text ?? title0).trim()) { const t = txt("title", title0 || "Your title", Math.round(W * 0.05), true, ink); t.x = (W - t.w) / 2; t.y = y; out.push(t); y += t.h + Math.round(S * 0.01); }
    if ((first ? false : has("sub")) && old("sub")) { const t = txt("sub", "", Math.round(W * 0.026), false, soft); t.x = (W - t.w) / 2; t.y = y; out.push(t); y += t.h; }
    y += Math.round(S * 0.025);
    // after the shirts: the details and the contact line
    const det = has("details") && details.length ? txt("details", details.join("\n"), Math.round(W * 0.017), false, soft) : null;
    const con = has("contact") && shop.line ? txt("contact", shop.line, Math.round(W * 0.018), true, soft) : null;
    const tailH = (det ? det.h + Math.round(S * 0.03) : 0) + (con ? con.h + Math.round(S * 0.02) : 0);
    // the shirts: one piece per color, as big as fits with the spacing asked for, the block centered
    const n = shown.length, g = (gap / 100) * W;
    const labelOf = (k: string) => (prev.find((e): e is ShirtEl => e.kind === "shirt" && e.key === k));
    const unit = shown.map((c) => { const cv = comp(c.key).cv; return { w: cv.width, h: cv.height }; });
    const uw0 = Math.max(1, ...unit.map((u) => u.w)), uh0 = Math.max(1, ...unit.map((u) => u.h));
    const lab = names ? Math.round(W * 0.024) : 0, labH = names ? Math.round(lab * 1.5) : 0;
    const top = y, bot = fixedH ? fixedH - M - tailH : Infinity;
    const fitK = (cols: number) => {
      const rows = Math.max(1, Math.ceil(n / cols));
      const kW = (W - 2 * M - (cols - 1) * g) / (cols * uw0);
      const kH = fixedH ? (bot - top - (rows - 1) * g - rows * labH) / (rows * uh0) : Infinity;
      return Math.min(kW, kH);
    };
    let cols = Math.max(1, Math.min(perRow || 1, n || 1));
    if (!perRow) {
      if (fixedH) { let best = 0; for (let c2 = 1; c2 <= Math.max(1, n); c2++) { const k2 = fitK(c2); if (k2 > best + 1e-6) { best = k2; cols = c2; } } }
      else { let bestD = Infinity; for (let c2 = 1; c2 <= Math.max(1, n); c2++) { const k2 = fitK(c2), r2 = Math.ceil(n / c2); const hh = top + r2 * (uh0 * k2 + labH) + (r2 - 1) * g + M + tailH; const d2 = Math.abs(Math.log(hh / W / 1.25)); if (d2 < bestD) { bestD = d2; cols = c2; } } }
    }
    const rows = Math.max(1, Math.ceil(n / cols)), k = Math.max(0.05, fitK(cols));
    const cellW = uw0 * k, cellH = uh0 * k + labH, usedH = rows * cellH + (rows - 1) * g;
    const oy = fixedH ? top + Math.max(0, (bot - top - usedH) / 2) : top;
    shown.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
      const rowW = inRow * cellW + (inRow - 1) * g, ux = (W - rowW) / 2 + col * (cellW + g), uy = oy + row * (cellH + g);
      const u = unit[i], w = u.w * k, ih = u.h * k, o = labelOf(c.key);
      out.push({ id: o?.id || uid(), kind: "shirt", key: c.key, label: o?.label ?? (multiStyle ? `${c.color} · ${c.style}` : c.color), labelSize: lab || Math.round(W * 0.024), showLabel: names,
        x: ux + (cellW - w) / 2, y: uy + (uh0 * k - ih), w, h: ih + labH });
    });
    y = oy + usedH + Math.round(S * 0.03);
    if (det) { det.x = (W - det.w) / 2; det.y = y; out.push(det); y += det.h + Math.round(S * 0.03); }
    const H = fixedH || Math.round(y + (con ? con.h + Math.round(S * 0.02) : 0) + M);
    if (con) { con.x = (W - con.w) / 2; con.y = H - M - con.h; out.push(con); }
    // pictures and free text stay where they were put
    for (const e of prev) if (e.kind !== "shirt" && (e.role === "text" || e.role === "pic" || e.role === "art")) out.push(e);
    setSheet({ w: W, h: H });
    setEls(out);
  }
  const arrangeRef = useRef(arrange); arrangeRef.current = arrange;
  // first layout once the shirts are drawn; again when the shape, sides, colors, per row or spacing change
  const firstDone = useRef(false);
  /** a shirt taken off the sheet by hand: the rest stay where they are (no new layout) */
  const keepLayout = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (keepLayout.current) { keepLayout.current = false; return; }
    arrangeRef.current(els, !firstDone.current);
    firstDone.current = true;
  }, [ready, page, fitW, sidesKey, order.join(), [...off].join(), perRow, gap, names]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- picking, moving, sizing ----
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const fit = () => { const r = stageRef.current?.getBoundingClientRect(); if (!r) return; setScale(Math.max(0.1, Math.min((r.width - 40) / sheet.w, (r.height - 40) / sheet.h, 1))); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, [sheet.w, sheet.h]);
  const cur = els.find((e) => e.id === sel) || null;
  const upd = (id: string, f: (e: El) => El) => setEls((xs) => xs.map((e) => (e.id === id ? f(e) : e)));
  const drag = useRef<{ id: string; mode: "move" | "size" | "page"; sx: number; sy: number; e0: El | null; p0?: { w: number; h: number } } | null>(null);
  const onDown = (e: React.PointerEvent, el: El, mode: "move" | "size") => {
    e.stopPropagation();
    if (editing === el.id) return; // typing in it: the click places the cursor
    e.preventDefault();
    setSel(el.id); if (editing) setEditing("");
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, e0: el };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    if (d.mode === "page" && d.p0) { setCust({ w: Math.round(Math.max(300, Math.min(4000, d.p0.w + dx))), h: Math.round(Math.max(300, Math.min(4000, d.p0.h + dy))) }); setSheet({ w: Math.round(Math.max(300, Math.min(4000, d.p0.w + dx))), h: Math.round(Math.max(300, Math.min(4000, d.p0.h + dy))) }); return; }
    const e0 = d.e0!;
    if (d.mode === "move") {
      let x = e0.x + dx; const y = e0.y + dy;
      // snaps to the middle of the sheet
      const mid = Math.abs(x + e0.w / 2 - sheet.w / 2) < 10 / scale;
      if (mid) x = sheet.w / 2 - e0.w / 2;
      setGuide(mid);
      upd(d.id, (z) => ({ ...z, x, y }));
    } else {
      const w = Math.max(20, e0.w + dx), r = w / e0.w;
      if (e0.kind === "text") upd(d.id, () => refit({ ...e0, x: e0.align === "center" ? e0.x - (e0.w * r - e0.w) / 2 : e0.x, size: Math.max(8, Math.round(e0.size * r)) }));
      else if (e0.kind === "shirt") upd(d.id, () => ({ ...e0, w, h: e0.h * r, labelSize: e0.labelSize * r }));
      else upd(d.id, () => ({ ...e0, w, h: e0.h * r }));
    }
  };
  const onUp = () => { drag.current = null; setGuide(false); };
  // the keyboard: Delete takes the picked piece off, the arrows nudge it
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (!sel || editing) return;
      const t = ev.target as HTMLElement; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); remove(sel); }
      const n = ev.shiftKey ? 10 : 1, mv = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[ev.key];
      if (mv) { ev.preventDefault(); upd(sel, (z) => ({ ...z, x: z.x + mv[0], y: z.y + mv[1] })); }
      if (ev.key === "Escape") setSel("");
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  function remove(id: string) {
    const e = els.find((z) => z.id === id);
    if (e?.kind === "shirt") { keepLayout.current = true; setOff((st) => new Set(st).add(e.key)); }
    setEls((xs) => xs.filter((z) => z.id !== id)); setSel("");
  }
  const layer = (id: string, up: boolean) => setEls((xs) => { const i = xs.findIndex((z) => z.id === id); if (i < 0) return xs; const n = [...xs]; const [z] = n.splice(i, 1); if (up) n.push(z); else n.unshift(z); return n; });

  // ---- adding pieces ----
  const hasRole = (r: Role) => els.some((e) => e.kind !== "shirt" && e.role === r);
  const addText = (role: Role, text: string, size: number, bold: boolean, color: string, y?: number) => {
    const t = refit({ id: uid(), kind: "text", role, text, size, bold, color, align: "center", x: sheet.w / 2, y: 0, w: 0, h: 0 });
    t.x = (sheet.w - t.w) / 2; t.y = y ?? sheet.h * 0.12;
    setEls((xs) => [...xs, t]); setSel(t.id);
  };
  const addImg = (role: Role, src: string, name: string, w: number, y?: number) => {
    const im = imgs.current.get(src); if (!im) return;
    const h = w * ((im.naturalHeight || 1) / (im.naturalWidth || 1));
    const el: ImgEl = { id: uid(), kind: "img", role, src, name, x: (sheet.w - w) / 2, y: y ?? sheet.h * 0.08, w, h };
    setEls((xs) => [...xs, el]); setSel(el.id);
  };
  const addPic = async (f: File | undefined) => {
    if (!f) return;
    const src = URL.createObjectURL(f);
    try { imgs.current.set(src, await load(src)); } catch { setErr(`Couldn't open ${f.name}.`); return; }
    addImg("pic", src, f.name, sheet.w * 0.2);
  };
  const addArt = () => { const ok = arts.filter((a) => imgs.current.has(a.url)); ok.forEach((a, i) => addImg("art", a.url, a.label, sheet.w * 0.28, sheet.h * 0.15 + i * sheet.w * 0.05)); };
  const moveColor = (k: string, by: number) => setOrder((o) => { const i = o.indexOf(k), j = i + by; if (i < 0 || j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  // ---- the download: the same pieces drawn on a canvas ----
  function paint(c: HTMLCanvasElement, R: number, st?: Store) {
    c.width = Math.round(sheet.w * R); c.height = Math.round(sheet.h * R);
    const x = c.getContext("2d")!; x.setTransform(R, 0, 0, R, 0, 0); x.imageSmoothingQuality = "high";
    x.fillStyle = bg; x.fillRect(0, 0, sheet.w, sheet.h);
    for (const e of els) {
      if (e.kind === "text") {
        x.font = fontOf(e.bold, e.size); x.fillStyle = e.color; x.textAlign = e.align; x.textBaseline = "middle";
        const ax = e.align === "center" ? e.x + e.w / 2 : e.align === "right" ? e.x + e.w : e.x;
        e.text.split("\n").forEach((l, i) => x.fillText(l, ax, e.y + e.size * LH * (i + 0.5)));
      } else if (e.kind === "img") {
        const im = imgs.current.get(e.src); if (im) x.drawImage(im, e.x, e.y, e.w, e.h);
      } else {
        const cv = st ? composite(e.key, st) : comp(e.key).cv;
        const lh = e.showLabel ? e.labelSize * 1.5 : 0, ih = e.h - lh;
        x.drawImage(cv, e.x, e.y, e.w, ih);
        if (e.showLabel && e.label) { x.font = fontOf(true, e.labelSize); x.fillStyle = ink; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(e.label, e.x + e.w / 2, e.y + ih + lh / 2); }
      }
    }
  }
  async function hiStore(f: number): Promise<Store> {
    const st: Store = { cache: new Map(), f };
    const keys = [...new Set(els.filter((e): e is ShirtEl => e.kind === "shirt").map((e) => e.key))];
    for (const key of keys) for (const sd of views) { const cv0 = await shirts(key, [sd], Math.round(900 * f)); clearBg(cv0); st.cache.set(`${key}|${sd}`, cv0); }
    return st;
  }
  async function download() {
    setBusy(fmt === "pdf" ? "Making the PDF…" : "Making the picture…"); setSel(""); setEditing("");
    try {
      const R = Math.max(1, Math.min(4, res || 1));
      const st = R > 1.4 ? await hiStore(Math.min(3, R)) : undefined;
      const c = document.createElement("canvas"); paint(c, R, st);
      const titleText = els.find((e): e is TextEl => e.kind === "text" && e.role === "title")?.text || "sales sheet";
      const name = `${[customer, titleText].filter(Boolean).join(" ")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "sales-sheet";
      let blob: Blob;
      if (fmt === "png") blob = await new Promise<Blob>((ok) => c.toBlob((b2) => ok(b2!), "image/png"));
      else if (fmt === "jpg") blob = await new Promise<Blob>((ok) => c.toBlob((b2) => ok(b2!), "image/jpeg", 0.93));
      else blob = new Blob([imagePdf([await canvasPage(c, sheet.w * 0.36, sheet.h * 0.36, 0.97)], titleText) as BlobPart], { type: "application/pdf" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.${fmt}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make it."); }
    setBusy("");
  }

  // ---- typing over a text ----
  const commitText = (id: string, node: HTMLElement) => {
    const v = node.innerText.replace(/\n$/, "");
    upd(id, (z) => (z.kind === "text" ? refit({ ...z, text: v || " " }) : z.kind === "shirt" ? { ...z, label: v.replace(/\n/g, " ") } : z));
    setEditing("");
  };
  const editKeys = (id: string) => (ev: React.KeyboardEvent<HTMLElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); (ev.currentTarget as HTMLElement).blur(); }
    if (ev.key === "Escape") { ev.preventDefault(); setEditing(""); }
    void id;
  };

  const s = scale;
  return (
    <div className="ss-back" role="dialog" aria-modal="true" aria-label="Sales sheet creator">
      <div className="ss-box">
        <div className="ss-head">
          <div><h2>Sales sheet creator</h2><span className="faint">Click anything to pick it · drag to move · drag the corner to size · double-click text to type</span></div>
          <div className="row ss-dl" style={{ gap: 8 }}>
            <select aria-label="File type" value={fmt} onChange={(e) => setFmt(e.target.value as "png" | "jpg" | "pdf")}><option value="png">PNG</option><option value="jpg">JPG</option><option value="pdf">PDF</option></select>
            <select aria-label="Resolution" value={res} onChange={(e) => setRes(+e.target.value)} title={`${Math.round(sheet.w * res).toLocaleString()} × ${Math.round(sheet.h * res).toLocaleString()} px`}>{[1, 2, 3, 4].map((r) => <option key={r} value={r}>{r}× · {Math.round(sheet.w * r).toLocaleString()} px wide</option>)}</select>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void download()}>Download</button>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="ss-body">
          <aside className="ss-ctl">
            {/* the picked piece first: what it is and how to change it */}
            {cur ? (
              <section className="ss-pick">
                <h3>{cur.kind === "shirt" ? `Shirt · ${colors.find((c) => c.key === cur.key)?.color || ""}` : ROLE_NAME[cur.role]}</h3>
                {cur.kind === "text" && <>
                  <textarea rows={Math.min(6, cur.text.split("\n").length + 1)} value={cur.text} aria-label="Text" onChange={(e) => upd(cur.id, (z) => refit({ ...(z as TextEl), text: e.target.value }))} />
                  <label className="mk-f"><span>Size: {cur.size}</span><input type="range" min={10} max={200} step={1} value={cur.size} onChange={(e) => upd(cur.id, (z) => refit({ ...(z as TextEl), size: +e.target.value }))} /></label>
                  <div className="ss-row">
                    <input type="color" value={cur.color} onChange={(e) => upd(cur.id, (z) => ({ ...(z as TextEl), color: e.target.value }))} aria-label="Text color" />
                    <button type="button" className={"chip" + (cur.bold ? " on" : "")} onClick={() => upd(cur.id, (z) => refit({ ...(z as TextEl), bold: !(z as TextEl).bold }))}><b>B</b></button>
                    {(["left", "center", "right"] as Align[]).map((a) => <button key={a} type="button" className={"chip" + (cur.align === a ? " on" : "")} onClick={() => upd(cur.id, (z) => ({ ...(z as TextEl), align: a }))}>{a === "left" ? "Left" : a === "center" ? "Center" : "Right"}</button>)}
                  </div>
                </>}
                {cur.kind === "shirt" && <>
                  <label className="check"><input type="checkbox" checked={cur.showLabel} onChange={(e) => upd(cur.id, (z) => { const t = z as ShirtEl, lh = t.labelSize * 1.5; return { ...t, showLabel: e.target.checked, h: t.h + (e.target.checked ? lh : -lh) }; })} /> Color name under it</label>
                  {cur.showLabel && <input type="text" aria-label="Color name" value={cur.label} onChange={(e) => upd(cur.id, (z) => ({ ...(z as ShirtEl), label: e.target.value }))} />}
                  <span className="faint">The shirt is the mockup itself: move it and size it here, change it in the Mockup Creator.</span>
                </>}
                <div className="ss-row">
                  <button type="button" className="btn sm" onClick={() => upd(cur.id, (z) => ({ ...z, x: (sheet.w - z.w) / 2 }))}>Center it</button>
                  <button type="button" className="btn sm" onClick={() => layer(cur.id, true)}>To front</button>
                  <button type="button" className="btn sm" onClick={() => layer(cur.id, false)}>To back</button>
                  <button type="button" className="btn sm ghost danger" onClick={() => remove(cur.id)}>Remove</button>
                </div>
              </section>
            ) : <p className="faint ss-tip">Click anything on the sheet to change it.</p>}
            <section><h3>Add to the sheet</h3>
              <div className="ss-adds">
                <button type="button" className="btn sm" onClick={() => addText("text", "Your text", Math.round(sheet.w * 0.035), true, ink)}>Text</button>
                {!hasRole("title") && <button type="button" className="btn sm" onClick={() => addText("title", title0 || "Your title", Math.round(sheet.w * 0.05), true, ink, sheet.w * 0.04)}>Title</button>}
                {!hasRole("sub") && <button type="button" className="btn sm" onClick={() => addText("sub", "Pick your color · $25 each · order by Nov 1", Math.round(sheet.w * 0.026), false, soft)}>Subtitle</button>}
                {!hasRole("details") && details.length > 0 && <button type="button" className="btn sm" onClick={() => addText("details", details.join("\n"), Math.round(sheet.w * 0.017), false, soft, sheet.h * 0.8)}>Details</button>}
                {!hasRole("logo") && shop.logoUrl && imgs.current.has(shop.logoUrl) && <button type="button" className="btn sm" onClick={() => addImg("logo", shop.logoUrl, shop.name || "Logo", sheet.w * 0.18, sheet.w * 0.03)}>Logo</button>}
                {!hasRole("contact") && shop.line && <button type="button" className="btn sm" onClick={() => addText("contact", shop.line, Math.round(sheet.w * 0.018), true, soft, sheet.h * 0.94)}>Contact line</button>}
                {arts.some((a) => imgs.current.has(a.url)) && <button type="button" className="btn sm" onClick={addArt}>Art close-up</button>}
                <label className="btn sm">Picture<input type="file" accept="image/*" hidden onChange={(e) => { void addPic(e.target.files?.[0]); e.target.value = ""; }} /></label>
              </div>
            </section>
            <section><h3>Layout</h3>
              <button type="button" className="btn sm" onClick={() => arrange(els)}>Auto-arrange everything</button>
              <label className="mk-f"><span>Shape</span><select value={page} onChange={(e) => setPage(e.target.value as PageKey)}>{(Object.keys(PAGES) as PageKey[]).map((k) => <option key={k} value={k}>{PAGES[k].label}</option>)}</select></label>
              {page === "fit" && <label className="mk-f"><span>Width: {fitW} px</span><input type="range" min={600} max={2400} step={50} value={fitW} onChange={(e) => setFitW(+e.target.value)} /></label>}
              <div className="ss-row"><span>Background</span>{["#ffffff", "#f3f1ec", "#e9edf2", "#141d2b"].map((c) => <button key={c} type="button" className={"ss-sw" + (bg === c ? " on" : "")} style={{ background: c }} aria-label={`Background ${c}`} onClick={() => setBg(c)} />)}<input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background color" /></div>
              {views.length > 1 && <div className="chips">{(["both", "front", "back"] as Sides[]).map((k) => <button key={k} type="button" className={"chip" + (sides === k ? " on" : "")} onClick={() => setSides(k)}>{k === "both" ? "Front and back" : k === "front" ? "Front" : "Back"}</button>)}</div>}
              <div className="ss-row"><span>Per row</span>{[0, 1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={"chip" + (perRow === n ? " on" : "")} onClick={() => setPerRow(n)}>{n || "Auto"}</button>)}</div>
              <label className="mk-f"><span>Space between shirts</span><input type="range" min={0} max={8} step={0.25} value={gap} onChange={(e) => setGap(+e.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Color names under the shirts</label>
            </section>
            <section><h3>Colors</h3>
              <ul className="ss-colors">{order.map((k, i) => { const c = colors.find((z) => z.key === k); if (!c) return null; return (
                <li key={k}><label className="check"><input type="checkbox" checked={!off.has(k)} onChange={(e) => setOff((st) => { const n = new Set(st); if (e.target.checked) n.delete(k); else n.add(k); return n; })} /> {c.color}{multiStyle && <span className="faint"> · {c.style}</span>}</label>
                  <span className="ss-ord"><button type="button" className="btn icon ghost" aria-label={`Move ${c.color} up`} disabled={i === 0} onClick={() => moveColor(k, -1)}>↑</button><button type="button" className="btn icon ghost" aria-label={`Move ${c.color} down`} disabled={i === order.length - 1} onClick={() => moveColor(k, 1)}>↓</button></span></li>); })}</ul>
            </section>
            {err && <div className="pv-err">{err}</div>}
          </aside>
          <div className="ss-stage" ref={stageRef} onPointerDown={() => { setSel(""); if (editing) setEditing(""); }}>
            {busy && <div className="ss-busy">{busy}</div>}
            <div className="ss-sheet" style={{ width: sheet.w * s, height: sheet.h * s, background: bg }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              {guide && <span className="ss-guide" />}
              {els.map((e) => {
                const box = { left: e.x * s, top: e.y * s, width: e.w * s, height: e.h * s };
                const on = sel === e.id, ed = editing === e.id;
                return (
                  <div key={e.id} className={"ss-el ss-" + e.kind + (on ? " on" : "")} style={box}
                    onPointerDown={(ev) => onDown(ev, e, "move")}
                    onDoubleClick={(ev) => { ev.stopPropagation(); if (e.kind === "text" || (e.kind === "shirt" && e.showLabel)) { setSel(e.id); setEditing(e.id); } }}>
                    {e.kind === "text" && (
                      <div className="ss-txt" style={{ font: fontOf(e.bold, e.size * s), lineHeight: LH, color: e.color, textAlign: e.align }}
                        contentEditable={ed} suppressContentEditableWarning spellCheck={false}
                        ref={(n) => { if (n && ed && document.activeElement !== n) { n.focus(); const r = document.createRange(); r.selectNodeContents(n); const sl = window.getSelection(); sl?.removeAllRanges(); sl?.addRange(r); } }}
                        onBlur={(ev) => ed && commitText(e.id, ev.currentTarget)} onKeyDown={editKeys(e.id)}>{e.text}</div>
                    )}
                    {e.kind === "img" && imgs.current.get(e.src) && <img src={e.src} alt={e.name} draggable={false} />}
                    {e.kind === "shirt" && <>
                      <img src={comp(e.key).url} alt={e.label} draggable={false} style={{ height: (e.h - (e.showLabel ? e.labelSize * 1.5 : 0)) * s }} />
                      {e.showLabel && <div className="ss-lab" style={{ font: fontOf(true, e.labelSize * s), color: ink, height: e.labelSize * 1.5 * s, lineHeight: `${e.labelSize * 1.5 * s}px` }}
                        contentEditable={ed} suppressContentEditableWarning spellCheck={false}
                        ref={(n) => { if (n && ed && document.activeElement !== n) n.focus(); }}
                        onBlur={(ev) => ed && commitText(e.id, ev.currentTarget)} onKeyDown={editKeys(e.id)}>{e.label}</div>}
                    </>}
                    {on && !ed && <span className="ss-handle" title="Drag to size it" onPointerDown={(ev) => onDown(ev, e, "size")} />}
                  </div>
                );
              })}
              {/* the sheet's own corner: drag to change its shape (switches to Custom) */}
              <span className="ss-corner" title="Drag to change the sheet's shape" aria-label="Resize the sheet"
                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { id: "", mode: "page", sx: e.clientX, sy: e.clientY, e0: null, p0: { ...sheet } }; if (page !== "custom") { setCust({ ...sheet }); setPage("custom"); } }}
                />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
