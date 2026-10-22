"use client";
/**
 * Sales sheet creator (Mockup Creator → Sales tools, Oct 22 2026, Nick: "a sales sheet creator… edit all sorts of
 * things… add any kind of text… 3 or 4 up on a page, make them tight, space between… a really nice graphic editor
 * that lets me create a cool sales sheet", so a customer can send out an image and take orders).
 *
 * The page is drawn on a canvas from the mockup's shirts (each color drawn once by the Mockup Creator, then laid out
 * here): page size and background, how many per row, spacing, shirt size, sides, color names, a header (title,
 * subtitle, our logo, their name) and free text and pictures dragged anywhere. Downloads as a PNG or a PDF. Nothing
 * is saved: it's a picture to send out.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { canvasPage, imagePdf } from "@/lib/imagePdf";

export type SheetColor = { key: string; color: string; style: string; /** the shirt's color, for the art close-up */ hex?: string };
type Sides = "both" | "front" | "back";
type Item = { id: string; kind: "text"; text: string; x: number; y: number; size: number; color: string; bold: boolean; align: CanvasTextAlign }
  | { id: string; kind: "pic"; src: string; name: string; x: number; y: number; w: number };

// shapes for sending out, not paper (Oct 22, Nick: "this is going to be like an email blast… don't think in those kind of
// sizes… draw… how you want it to appear, and then you fill it"); w: 0 = the size you set
const PAGES = {
  fit: { label: "Fits the shirts (email)", w: 0, h: 0 },
  square: { label: "Square post (1080 × 1080)", w: 1080, h: 1080 },
  story: { label: "Story (1080 × 1920)", w: 1080, h: 1920 },
  wide: { label: "Wide banner (1600 × 900)", w: 1600, h: 900 },
  custom: { label: "Custom: drag the corner", w: 0, h: 0 },
  print: { label: "Print (11 × 8.5)", w: 2200, h: 1700 },
} as const;
type PageKey = keyof typeof PAGES;
const uid = () => Math.random().toString(36).slice(2, 9);
const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => no(new Error("picture")); im.src = src; });
const dark = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 110; };

export default function SalesSheet({ colors, views, shirts, title0, customer, shop, onClose, arts = [] }: {
  /** the prints' art as it prints (inks applied), for the art close-up */ arts?: { label: string; url: string }[];
  colors: SheetColor[];
  /** the sides this mockup has prints on */ views: ("front" | "back")[];
  /** one color's shirt(s) side by side, drawn about `h` px tall */ shirts: (key: string, sides: ("front" | "back")[], h: number) => Promise<HTMLCanvasElement>;
  title0: string; customer: string;
  shop: { name: string; line: string; logoUrl: string };
  onClose: () => void;
}) {
  const [page0, setPage] = useSticky<PageKey>("ss.page2", "fit");
  const page: PageKey = page0 in PAGES ? page0 : "fit";
  const [fitW, setFitW] = useSticky<number>("ss.fitW", 1200);
  const [cust, setCust] = useSticky<{ w: number; h: number }>("ss.custom", { w: 1200, h: 1200 });
  /** the sheet's size as last drawn (fits-the-shirts works its height out from the shirts) */
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 1200, h: 1200 });
  const [bg, setBg] = useSticky<string>("ss.bg", "#ffffff");
  const [perRow, setPerRow] = useSticky<number>("ss.perRow", 4), [autoRow, setAutoRow] = useSticky<boolean>("ss.autoRow", true);
  const [gap, setGap] = useSticky<number>("ss.gap", 3);
  const [size, setSize] = useSticky<number>("ss.size", 100);
  const [pairGap, setPairGap] = useSticky<number>("ss.pairGap", 2), [margin, setMargin] = useSticky<number>("ss.margin", 4.5);
  const [sides, setSides] = useSticky<Sides>("ss.sides", "both");
  const [names, setNames] = useSticky<boolean>("ss.names", true);
  const [styleUnder, setStyleUnder] = useSticky<boolean>("ss.style", false);
  const [labelSize, setLabelSize] = useSticky<number>("ss.labelSize", 30);
  const [ours, setOurs] = useSticky<boolean>("ss.ours", false);
  const [theirs, setTheirs] = useSticky<boolean>("ss.theirs", true);
  const [contact, setContact] = useSticky<boolean>("ss.contact", false);
  const [align, setAlign] = useSticky<"left" | "center">("ss.align", "center");
  const [title, setTitle] = useState(title0);
  const [sub, setSub] = useState("");
  const [titleSize, setTitleSize] = useSticky<number>("ss.titleSize", 64);
  const [order, setOrder] = useState<string[]>(colors.map((c) => c.key));
  const [off, setOff] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState("Drawing the shirts…");
  const [err, setErr] = useState("");
  // a featured section on top (Oct 22, Nick: "add a close-up of front and back… or add a close-up of art… and then the
  // images below it"), and the download's format and resolution ("I need to control the resolution")
  const [feature, setFeature] = useSticky<"none" | "pair" | "art">("ss.feature", "none");
  const [featKey, setFeatKey] = useState(colors[0]?.key || "");
  const [featSize, setFeatSize] = useSticky<"big" | "medium" | "small">("ss.featSize", "medium");
  const [fmt, setFmt] = useSticky<"png" | "jpg" | "pdf">("ss.fmt", "png");
  const [res, setRes] = useSticky<number>("ss.res", 3);
  const artImgs = useRef(new Map<string, HTMLImageElement>());
  // each color's front and back drawn on their own, then all trimmed to the same box per side (the photos' white
  // margins out, every color the same size), so "space between" is the real space between shirts
  type Store = { cache: Map<string, HTMLCanvasElement>; f: number };
  const cache = useRef(new Map<string, HTMLCanvasElement>());
  const crop = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const base: Store = { cache: cache.current, f: 1 };
  const pics = useRef(new Map<string, HTMLImageElement>());
  const logo = useRef<HTMLImageElement | null>(null);
  const boxes = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [tick, setTick] = useState(0);
  const sideList: ("front" | "back")[] = sides === "both" ? views : views.includes(sides) ? [sides] : views;
  const P = { w: dims.w, h: dims.h, pt: [dims.w * 0.36, dims.h * 0.36] as const };
  const ink = dark(bg) ? "#ffffff" : "#141D2B", soft = dark(bg) ? "#d5dbe3" : "#5B6678";

  // every color's shirts, drawn once per set of sides
  useEffect(() => {
    let live = true;
    (async () => {
      setBusy("Drawing the shirts…");
      try {
        if (shop.logoUrl && !logo.current) logo.current = await load(shop.logoUrl).catch(() => null);
        for (const c of colors) for (const sd of views) {
          const k = `${c.key}|${sd}`;
          if (!cache.current.has(k)) cache.current.set(k, await shirts(c.key, [sd], 900));
          if (!live) return;
        }
        for (const c of colors) for (const sd of views) { const cv0 = cache.current.get(`${c.key}|${sd}`); if (cv0) clearBg(cv0); }
        for (const a of arts) if (a.url && !artImgs.current.has(a.url)) { const im = await load(a.url).catch(() => null); if (im) artImgs.current.set(a.url, im); }
        // each shirt trimmed to its own outline (the photos' white margins out; 6210 and 3001 photos are framed
        // differently, so one shared box left gaps): all drawn at one scale, standing on the same line
        for (const c of colors) for (const sd of views) {
          const key = `${c.key}|${sd}`, cv0 = cache.current.get(key); if (!cv0 || crop.current[key]) continue;
          let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
          const w = cv0.width, h = cv0.height, d = cv0.getContext("2d")!.getImageData(0, 0, w, h).data;
          for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (d[i + 3] > 20 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          const pad = 4;
          crop.current[key] = x1 > x0 && y1 > y0 ? { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(w, x1 - x0 + 2 * pad), h: Math.min(h, y1 - y0 + 2 * pad) } : { x: 0, y: 0, w, h };
        }
        setBusy(""); setTick((t) => t + 1);
      } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't draw the shirts."); setBusy(""); }
    })();
    return () => { live = false; };
  }, [colors.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the photo's white background made see-through, from the edges in (it stops at the shirt's outline, so a white
   *  shirt keeps its body): shirts can overlap and sit on any page color */
  function clearBg(cv0: HTMLCanvasElement) {
    const z = cv0 as HTMLCanvasElement & { clear?: boolean }; if (z.clear) return;
    const w = cv0.width, h = cv0.height, x2 = cv0.getContext("2d")!, img = x2.getImageData(0, 0, w, h), d = img.data;
    const seen = new Uint8Array(w * h), st: number[] = [];
    const bgl = (i: number) => d[i * 4] >= 250 && d[i * 4 + 1] >= 250 && d[i * 4 + 2] >= 250;
    for (let xx = 0; xx < w; xx++) { st.push(xx, (h - 1) * w + xx); }
    for (let yy = 0; yy < h; yy++) { st.push(yy * w, yy * w + w - 1); }
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
  /** the shirts drawn again, bigger, for a sharp high-resolution download (the same photos, so the same trims × f) */
  async function hiStore(f: number): Promise<Store> {
    const st: Store = { cache: new Map(), f };
    for (const c of shown) for (const sd of views) {
      const cv0 = await shirts(c.key, [sd], Math.round(900 * f));
      clearBg(cv0); st.cache.set(`${c.key}|${sd}`, cv0);
    }
    return st;
  }

  const shown = useMemo(() => order.map((k) => colors.find((c) => c.key === k)).filter((c): c is SheetColor => !!c && !off.has(c.key)), [order, off, colors]);
  const multiStyle = new Set(colors.map((c) => c.style)).size > 1;

  /** the whole sheet on a canvas, at full size; "fits the shirts" is drawn once tall to measure, then at its height */
  function sheetSize() {
    let W: number = PAGES[page].w, H: number = PAGES[page].h;
    if (page === "custom") { W = cust.w; H = cust.h; }
    return { W, H };
  }
  /** R: resolution (2 = twice the pixels each way); st: the shirts drawn at that size */
  function draw(c: HTMLCanvasElement, R = 1, st: Store = base) {
    let { W, H } = sheetSize();
    if (page === "fit") { W = Math.max(400, Math.min(4000, fitW || 1200)); const end = paint(c, W, W * 6, true, 1, base); H = Math.round(end); }
    paint(c, W, H, page === "fit", R, st);
    if (R === 1 && (dims.w !== W || dims.h !== H)) setDims({ w: W, h: H });
  }
  /** draws the sheet at W × H (× R pixels); returns where the content ends (fit: the height the sheet needs) */
  function paint(c: HTMLCanvasElement, W: number, H: number, fit: boolean, R = 1, st: Store = base): number {
    c.width = Math.round(W * R); c.height = Math.round(H * R);
    const x = c.getContext("2d")!;
    x.setTransform(R, 0, 0, R, 0, 0);
    x.imageSmoothingQuality = "high";
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const S = fit ? W : Math.min(W, H);
    const M = Math.round(S * (margin / 100));
    const font = (w: number, s: number) => `${w} ${s}px Helvetica, Arial, sans-serif`;
    const ax = align === "center" ? W / 2 : M;
    x.textAlign = align; x.textBaseline = "alphabetic";
    let y = M;
    // header: our logo and / or their name, the title, the subtitle
    if ((ours && logo.current) || (theirs && customer)) {
      const lh = Math.round(S * 0.045);
      const lw = ours && logo.current ? Math.min(W * 0.3, (logo.current.naturalWidth / (logo.current.naturalHeight || 1)) * lh) : 0;
      x.font = font(800, Math.round(lh * 0.8));
      const nameW = theirs && customer ? x.measureText(customer).width : 0;
      const total = lw + (lw && nameW ? lh * 0.6 : 0) + nameW;
      let lx = align === "center" ? (W - total) / 2 : M;
      if (lw && logo.current) { x.drawImage(logo.current, lx, y, lw, lh); lx += lw + (nameW ? lh * 0.6 : 0); }
      if (nameW) { x.fillStyle = ink; x.textAlign = "left"; x.fillText(customer, lx, y + lh * 0.82); x.textAlign = align; }
      y += lh + Math.round(S * 0.02);
    }
    if (title.trim()) { x.fillStyle = ink; x.font = font(800, titleSize); y += titleSize; x.fillText(title.trim(), ax, y); y += Math.round(titleSize * 0.35); }
    if (sub.trim()) { x.fillStyle = soft; x.font = font(400, Math.round(titleSize * 0.5)); y += Math.round(titleSize * 0.55); x.fillText(sub.trim(), ax, y); y += Math.round(titleSize * 0.3); }
    const footH = contact ? Math.round(S * 0.05) : 0;
    const boxOf = (k0: string, sd: string) => crop.current[`${k0}|${sd}`] || { x: 0, y: 0, w: 600, h: 750 };
    const pg = (pairGap / 100) * W;
    const shirtAt = (key: string, b: { x: number; y: number; w: number; h: number }, dx: number, dy: number, dw: number, dh: number) => {
      const im = st.cache.get(key); if (!im) return;
      x.drawImage(im, b.x * st.f, b.y * st.f, b.w * st.f, b.h * st.f, dx, dy, dw, dh);
    };
    // the featured section: one color's front and back big, or the art up close on its shirt color
    let fTop = y + Math.round(S * 0.025);
    const fk = shown.find((c0) => c0.key === featKey) || shown[0];
    if (feature !== "none" && fk) {
      const fh = fit ? W * { big: 0.62, medium: 0.46, small: 0.32 }[featSize] : (H - fTop - M - footH) * { big: 0.55, medium: 0.42, small: 0.3 }[featSize];
      const lab = Math.round(labelSize * 1.6), boxH = fh - lab;
      x.textAlign = "center";
      if (feature === "pair") {
        const bs = views.map((sd) => boxOf(fk.key, sd)), gp = Math.max(pg, S * 0.02);
        let kf = boxH / Math.max(...bs.map((b) => b.h));
        const totW = (k1: number) => bs.reduce((t, b) => t + b.w * k1, 0) + (bs.length - 1) * gp;
        if (totW(kf) > W - 2 * M) kf = (W - 2 * M - (bs.length - 1) * gp) / bs.reduce((t, b) => t + b.w, 0);
        let sx = (W - totW(kf)) / 2;
        const order0 = views.map((_, j) => j); if (pg < 0) order0.reverse();
        const xs0: number[] = []; for (const b of bs) { xs0.push(sx); sx += b.w * kf + gp; }
        for (const j of order0) { const b = bs[j]; shirtAt(`${fk.key}|${views[j]}`, b, xs0[j], fTop + boxH - b.h * kf, b.w * kf, b.h * kf); }
        if (names) { x.fillStyle = ink; x.font = font(700, Math.round(labelSize * 1.1)); x.fillText(fk.color, W / 2, fTop + boxH + labelSize * 1.25); }
      } else {
        // the art on a panel of the shirt's color
        const pw = W - 2 * M, px = M, r = Math.round(S * 0.02);
        x.fillStyle = fk.hex || "#d9d4ca";
        x.beginPath(); x.roundRect(px, fTop, pw, boxH, r); x.fill();
        const ims = arts.map((a) => ({ a, im: artImgs.current.get(a.url) })).filter((z): z is { a: { label: string; url: string }; im: HTMLImageElement } => !!z.im);
        const pad = boxH * 0.1, cellW = (pw - pad * (ims.length + 1)) / Math.max(1, ims.length), cellH = boxH - pad * 2 - (ims.length > 1 ? labelSize * 1.2 : 0);
        ims.forEach(({ a, im }, i) => {
          const rr = (im.naturalHeight || 1) / (im.naturalWidth || 1);
          let w = cellW, h = w * rr; if (h > cellH) { h = cellH; w = h / rr; }
          const cx = px + pad + i * (cellW + pad) + cellW / 2;
          x.drawImage(im, cx - w / 2, fTop + pad + (cellH - h) / 2, w, h);
          if (ims.length > 1) { x.fillStyle = dark(fk.hex || "#ffffff") ? "#ffffff" : "#141D2B"; x.font = font(600, Math.round(labelSize * 0.8)); x.fillText(a.label, cx, fTop + boxH - pad * 0.6); }
        });
        if (names) { x.fillStyle = ink; x.font = font(700, Math.round(labelSize * 1.1)); x.fillText(`The art · shown on ${fk.color}`, W / 2, fTop + boxH + labelSize * 1.25); }
      }
      fTop += fh + Math.round(S * 0.03);
    }
    const top = fTop, bot = H - M - footH;
    // the grid: one unit per color (its sides side by side, trimmed), as big as fits with the spacing asked for, the
    // whole block centered on the page (Oct 22, Nick: fewer per row should mean bigger shirts, not bigger gaps)
    const n = shown.length;
    const g = (gap / 100) * W, labelH = names ? Math.round(labelSize * (styleUnder && multiStyle ? 2.4 : 1.5)) : 0;
    const ns = sideList.length;
    // the widest and tallest color sets the slot every color is drawn in
    const uw0 = Math.max(1, ...shown.map((c) => sideList.reduce((t, sd) => t + boxOf(c.key, sd).w, 0)));
    const uh0 = Math.max(1, ...shown.map((c) => Math.max(...sideList.map((sd) => boxOf(c.key, sd).h))));
    const fitK = (cols: number) => {
      const rows = Math.max(1, Math.ceil(n / cols));
      const kW = (W - 2 * M - (cols - 1) * g - cols * (ns - 1) * pg) / (cols * uw0);
      const kH = fit ? Infinity : (bot - top - (rows - 1) * g - rows * labelH) / (rows * uh0);
      return Math.min(kW, kH);
    };
    // per row: as asked, or (Auto) whatever makes the shirts biggest
    let cols = Math.max(1, Math.min(perRow || 1, n || 1));
    if (autoRow && !fit) { let best = 0; for (let c2 = 1; c2 <= Math.max(1, n); c2++) { const k2 = fitK(c2); if (k2 > best + 1e-6) { best = k2; cols = c2; } } }
    // fits the shirts: as many per row as make a sheet about 4:5 (tall enough to scroll an email, wide enough to see)
    if (autoRow && fit) { let bestD = Infinity; for (let c2 = 1; c2 <= Math.max(1, n); c2++) { const k2 = fitK(c2), r2 = Math.ceil(n / c2); const hh = top + r2 * (uh0 * k2 + labelH) + (r2 - 1) * g + M + footH; const d2 = Math.abs(Math.log(hh / W / 1.25)); if (d2 < bestD) { bestD = d2; cols = c2; } } }
    const rows = Math.max(1, Math.ceil(n / cols));
    const k = Math.max(0.05, fitK(cols)) * (size / 100);
    const uw = uw0 * k + (ns - 1) * pg, uh = uh0 * k, cellH = uh + labelH;
    const usedH = rows * cellH + (rows - 1) * g, oy = fit ? top : top + Math.max(0, (bot - top - usedH) / 2);
    x.textAlign = "center";
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols;
      const rowW = inRow * uw + (inRow - 1) * g, ux = (W - rowW) / 2 + col * (uw + g), uy = oy + row * (cellH + g);
      const bs = sideList.map((sd) => boxOf(shown[i].key, sd));
      const pairW = bs.reduce((t, b) => t + b.w * k, 0) + (ns - 1) * pg;
      const x0 = ux + (uw - pairW) / 2, xs: number[] = [];
      { let sx = x0; for (const b of bs) { xs.push(sx); sx += b.w * k + pg; } }
      // overlapping (front to back below zero): the back goes behind, the front on top
      const order = sideList.map((sd, j) => j);
      if (pg < 0) order.reverse();
      for (const j of order) {
        const sd = sideList[j], b = bs[j];
        const dw = b.w * k, dh = b.h * k, dy = uy + (uh - dh);
        shirtAt(`${shown[i].key}|${sd}`, b, xs[j], dy, dw, dh);
      }
      const cx = ux + uw / 2;
      if (names) {
        x.fillStyle = ink; x.font = font(700, labelSize); x.fillText(shown[i].color, cx, uy + uh + labelSize * 1.15);
        if (styleUnder && multiStyle) { x.fillStyle = soft; x.font = font(400, Math.round(labelSize * 0.72)); x.fillText(shown[i].style, cx, uy + uh + labelSize * 2.1); }
      }
    }
    if (contact && shop.line) { x.fillStyle = soft; x.font = font(600, Math.round(footH * 0.42)); x.textAlign = "center"; x.fillText(shop.line, W / 2, H - M); }
    // free text and pictures, on top
    const bx: typeof boxes.current = [];
    for (const it of items) {
      if (it.kind === "text") {
        x.font = font(it.bold ? 800 : 400, it.size); x.fillStyle = it.color; x.textAlign = it.align;
        const lines = it.text.split("\n"), lh = it.size * 1.2;
        const w = Math.max(...lines.map((l) => x.measureText(l).width), 10), px = it.x * W, py = it.y * H;
        lines.forEach((l, k) => x.fillText(l, px, py + it.size + k * lh));
        const left = it.align === "center" ? px - w / 2 : it.align === "right" ? px - w : px;
        bx.push({ id: it.id, x: left, y: py, w, h: lh * lines.length });
      } else {
        const im = pics.current.get(it.src); if (!im) continue;
        const w = it.w * W, h = w * (im.naturalHeight / (im.naturalWidth || 1));
        x.drawImage(im, it.x * W, it.y * H, w, h);
        bx.push({ id: it.id, x: it.x * W, y: it.y * H, w, h });
      }
    }
    const s = bx.find((b) => b.id === sel);
    if (s && c === cv.current) { x.setLineDash([12, 8]); x.strokeStyle = "#0E9BD8"; x.lineWidth = 3; x.strokeRect(s.x - 8, s.y - 8, s.w + 16, s.h + 16); x.setLineDash([]); }
    boxes.current = bx;
    return oy + usedH + M + footH;
  }
  useEffect(() => { if (cv.current && !busy) draw(cv.current); });

  // drag text and pictures on the preview
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number; k: number } | null>(null);
  const toPage = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * P.w, y: ((e.clientY - r.top) / r.height) * P.h }; };
  const down = (e: React.PointerEvent) => {
    const p = toPage(e), hit = [...boxes.current].reverse().find((b) => p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10);
    setSel(hit?.id || "");
    if (!hit) return;
    const it = items.find((z) => z.id === hit.id)!;
    drag.current = { id: hit.id, dx: p.x - it.x * P.w, dy: p.y - it.y * P.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = toPage(e);
    setItems((xs) => xs.map((z) => (z.id === d.id ? { ...z, x: Math.max(0, Math.min(1, (p.x - d.dx) / P.w)), y: Math.max(0, Math.min(1, (p.y - d.dy) / P.h)) } : z)));
  };
  const up = () => { drag.current = null; };

  const cur = items.find((z) => z.id === sel);
  const setCur = (f: (z: Item) => Item) => setItems((xs) => xs.map((z) => (z.id === sel ? f(z) : z)));
  const addText = () => { const id = uid(); setItems((xs) => [...xs, { id, kind: "text", text: "Your text", x: 0.5, y: 0.12, size: 48, color: ink, bold: true, align: "center" }]); setSel(id); };
  const addPic = async (f: File | undefined) => {
    if (!f) return;
    const src = URL.createObjectURL(f);
    try { pics.current.set(src, await load(src)); } catch { setErr(`Couldn't open ${f.name}.`); return; }
    const id = uid(); setItems((xs) => [...xs, { id, kind: "pic", src, name: f.name, x: 0.05, y: 0.05, w: 0.18 }]); setSel(id);
  };
  const moveColor = (k: string, by: number) => setOrder((o) => { const i = o.indexOf(k), j = i + by; if (i < 0 || j < 0 || j >= o.length) return o; const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function download() {
    setBusy(fmt === "pdf" ? "Making the PDF…" : "Making the picture…");
    try {
      // bigger than 1×: the shirts are drawn again at that size, so it's really sharper, not a stretched picture
      const R = Math.max(1, Math.min(4, res || 1));
      const st = R > 1.4 ? await hiStore(Math.min(3, R)) : base;
      const c = document.createElement("canvas"); draw(c, R, st);
      const name = `${[customer, title || "sales sheet"].filter(Boolean).join(" ")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "sales-sheet";
      let blob: Blob;
      if (fmt === "png") blob = await new Promise<Blob>((ok) => c.toBlob((b2) => ok(b2!), "image/png"));
      else if (fmt === "jpg") blob = await new Promise<Blob>((ok) => c.toBlob((b2) => ok(b2!), "image/jpeg", 0.93));
      else blob = new Blob([imagePdf([await canvasPage(c, P.pt[0], P.pt[1], 0.97)], title || "Sales sheet") as BlobPart], { type: "application/pdf" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.${fmt}`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make it."); }
    setBusy("");
  }


  return (
    <div className="ss-back" role="dialog" aria-modal="true" aria-label="Sales sheet creator">
      <div className="ss-box">
        <div className="ss-head">
          <div><h2>Sales sheet creator</h2><span className="faint">{shown.length} of {colors.length} colors · drag text and pictures on the sheet</span></div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => void download()}>Download {fmt.toUpperCase()} · {res}×</button>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="ss-body">
          <aside className="ss-ctl">
            <section><h3>Page</h3>
              <label className="mk-f"><span>Page margin: {margin < 2 ? "thin" : margin < 4 ? "small" : margin < 6 ? "medium" : "wide"}</span><input type="range" min={0.5} max={8} step={0.25} value={margin} onChange={(e) => setMargin(+e.target.value)} /></label>
              <label className="mk-f"><span>Shape</span><select value={page} onChange={(e) => setPage(e.target.value as PageKey)}>{(Object.keys(PAGES) as PageKey[]).map((k) => <option key={k} value={k}>{PAGES[k].label}</option>)}</select></label>
              {page === "fit" && <label className="mk-f"><span>Width: {fitW} px (the height follows the shirts)</span><input type="range" min={600} max={2400} step={50} value={fitW} onChange={(e) => setFitW(+e.target.value)} /></label>}
              {page === "custom" && <div className="ss-row"><label className="mk-f" style={{ width: 90 }}><span>Width</span><input type="number" min={300} max={4000} value={cust.w} onChange={(e) => setCust({ ...cust, w: Math.max(300, Math.min(4000, +e.target.value || 300)) })} /></label><span>×</span><label className="mk-f" style={{ width: 90 }}><span>Height</span><input type="number" min={300} max={4000} value={cust.h} onChange={(e) => setCust({ ...cust, h: Math.max(300, Math.min(4000, +e.target.value || 300)) })} /></label><span className="faint">or drag the sheet&apos;s corner</span></div>}
              <div className="ss-row"><span>Background</span>{["#ffffff", "#f3f1ec", "#e9edf2", "#141d2b"].map((c) => <button key={c} type="button" className={"ss-sw" + (bg === c ? " on" : "")} style={{ background: c }} aria-label={`Background ${c}`} onClick={() => setBg(c)} />)}<input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background color" /></div>
            </section>
            <section><h3>Featured on top</h3>
              <div className="chips">{([["none", "None"], ["pair", "Front and back close-up"], ["art", "Art close-up"]] as const).map(([k, t]) => <button key={k} type="button" className={"chip" + (feature === k ? " on" : "")} onClick={() => setFeature(k)}>{t}</button>)}</div>
              {feature !== "none" && <>
                <label className="mk-f"><span>Show it on</span><select value={featKey} onChange={(e) => setFeatKey(e.target.value)}>{colors.map((c) => <option key={c.key} value={c.key}>{c.color}{multiStyle ? ` · ${c.style}` : ""}</option>)}</select></label>
                <div className="chips">{(["big", "medium", "small"] as const).map((k) => <button key={k} type="button" className={"chip" + (featSize === k ? " on" : "")} onClick={() => setFeatSize(k)}>{k === "big" ? "Big" : k === "medium" ? "Medium" : "Small"}</button>)}</div>
                {feature === "art" && !arts.length && <span className="faint">No art on this mockup yet.</span>}
                <span className="faint">Tip: set the shirts below to Front only for a tidy grid.</span>
              </>}
            </section>
            <section><h3>Download</h3>
              <div className="chips">{(["png", "jpg", "pdf"] as const).map((k) => <button key={k} type="button" className={"chip" + (fmt === k ? " on" : "")} onClick={() => setFmt(k)}>{k.toUpperCase()}</button>)}</div>
              <div className="ss-row"><span>Resolution</span>{[1, 2, 3, 4].map((r) => <button key={r} type="button" className={"chip" + (res === r ? " on" : "")} onClick={() => setRes(r)}>{r}×</button>)}</div>
              <span className="faint">{Math.round(P.w * res).toLocaleString()} × {Math.round(P.h * res).toLocaleString()} px · about {Math.max(1, Math.round((P.w * P.h * res * res * (fmt === "png" ? 1.1 : fmt === "jpg" ? 0.22 : 0.3)) / 1e6))} MB{fmt === "pdf" ? " · full quality" : ""}</span>
            </section>
            <section><h3>Shirts</h3>
              <div className="chips">{(views.length > 1 ? (["both", "front", "back"] as Sides[]) : (["front"] as Sides[])).map((k) => <button key={k} type="button" className={"chip" + (sides === k || views.length < 2 ? " on" : "")} onClick={() => setSides(k)}>{k === "both" ? "Front and back" : k === "front" ? "Front" : "Back"}</button>)}</div>
              <label className="check"><input type="checkbox" checked={autoRow} onChange={(e) => setAutoRow(e.target.checked)} /> Per row: Auto (biggest shirts)</label>
              {!autoRow && <label className="mk-f"><span>Per row: {perRow}</span><input type="range" min={1} max={8} step={1} value={perRow} onChange={(e) => setPerRow(+e.target.value)} /></label>}
              <label className="mk-f"><span>Space between: {gap === 0 ? "none" : gap < 1.5 ? "tight" : gap < 4 ? "medium" : "roomy"}</span><input type="range" min={0} max={8} step={0.25} value={gap} onChange={(e) => setGap(+e.target.value)} /></label>
              {sideList.length > 1 && <label className="mk-f"><span>Front to back: {pairGap < 0 ? "overlapping" : pairGap === 0 ? "touching" : pairGap < 1.5 ? "close" : pairGap < 3.5 ? "medium" : "apart"}</span><input type="range" min={-8} max={6} step={0.25} value={pairGap} onChange={(e) => setPairGap(+e.target.value)} /></label>}
              <label className="mk-f"><span>Shirt size: {size}%</span><input type="range" min={50} max={100} step={1} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Color names</label>
              {names && <label className="mk-f"><span>Name size: {labelSize}</span><input type="range" min={16} max={60} step={1} value={labelSize} onChange={(e) => setLabelSize(+e.target.value)} /></label>}
              {names && multiStyle && <label className="check"><input type="checkbox" checked={styleUnder} onChange={(e) => setStyleUnder(e.target.checked)} /> Style under the name</label>}
            </section>
            <section><h3>Colors</h3>
              <ul className="ss-colors">{order.map((k, i) => { const c = colors.find((z) => z.key === k); if (!c) return null; return (
                <li key={k}><label className="check"><input type="checkbox" checked={!off.has(k)} onChange={(e) => setOff((s) => { const n = new Set(s); if (e.target.checked) n.delete(k); else n.add(k); return n; })} /> {c.color}{multiStyle && <span className="faint"> · {c.style}</span>}</label>
                  <span className="ss-ord"><button type="button" className="btn icon ghost" aria-label={`Move ${c.color} up`} disabled={i === 0} onClick={() => moveColor(k, -1)}>↑</button><button type="button" className="btn icon ghost" aria-label={`Move ${c.color} down`} disabled={i === order.length - 1} onClick={() => moveColor(k, 1)}>↓</button></span></li>); })}</ul>
            </section>
            <section><h3>Header</h3>
              <label className="mk-f"><span>Title</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 Club Shirts" /></label>
              <label className="mk-f"><span>Subtitle</span><input type="text" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Pick your color · $25 each · order by Nov 1" /></label>
              <label className="mk-f"><span>Title size: {titleSize}</span><input type="range" min={28} max={120} step={2} value={titleSize} onChange={(e) => setTitleSize(+e.target.value)} /></label>
              <div className="chips"><button type="button" className={"chip" + (align === "center" ? " on" : "")} onClick={() => setAlign("center")}>Centered</button><button type="button" className={"chip" + (align === "left" ? " on" : "")} onClick={() => setAlign("left")}>Left</button></div>
              {customer && <label className="check"><input type="checkbox" checked={theirs} onChange={(e) => setTheirs(e.target.checked)} /> Their name ({customer})</label>}
              <label className="check"><input type="checkbox" checked={ours} onChange={(e) => setOurs(e.target.checked)} /> Our logo</label>
              <label className="check"><input type="checkbox" checked={contact} onChange={(e) => setContact(e.target.checked)} /> Our contact line at the bottom</label>
            </section>
            <section><h3>Text and pictures</h3>
              <div className="row" style={{ gap: 6 }}><button type="button" className="btn sm" onClick={addText}>+ Add text</button><label className="btn sm">+ Add picture<input type="file" accept="image/*" hidden onChange={(e) => { void addPic(e.target.files?.[0]); e.target.value = ""; }} /></label></div>
              {cur?.kind === "text" && (
                <div className="ss-item">
                  <textarea rows={2} value={cur.text} onChange={(e) => setCur((z) => ({ ...z, text: e.target.value }) as Item)} aria-label="Text" />
                  <label className="mk-f"><span>Size: {cur.size}</span><input type="range" min={14} max={160} step={2} value={cur.size} onChange={(e) => setCur((z) => ({ ...z, size: +e.target.value }) as Item)} /></label>
                  <div className="ss-row"><input type="color" value={cur.color} onChange={(e) => setCur((z) => ({ ...z, color: e.target.value }) as Item)} aria-label="Text color" />
                    <label className="check"><input type="checkbox" checked={cur.bold} onChange={(e) => setCur((z) => ({ ...z, bold: e.target.checked }) as Item)} /> Bold</label>
                    {(["left", "center", "right"] as CanvasTextAlign[]).map((a) => <button key={a} type="button" className={"chip" + (cur.align === a ? " on" : "")} onClick={() => setCur((z) => ({ ...z, align: a }) as Item)}>{a === "left" ? "Left" : a === "center" ? "Center" : "Right"}</button>)}</div>
                  <button type="button" className="linkbtn ss-del" onClick={() => { setItems((xs) => xs.filter((z) => z.id !== sel)); setSel(""); }}>Remove this text</button>
                </div>
              )}
              {cur?.kind === "pic" && (
                <div className="ss-item">
                  <span className="faint">{cur.name}</span>
                  <label className="mk-f"><span>Size: {Math.round(cur.w * 100)}%</span><input type="range" min={3} max={100} step={1} value={Math.round(cur.w * 100)} onChange={(e) => setCur((z) => ({ ...z, w: +e.target.value / 100 }) as Item)} /></label>
                  <button type="button" className="linkbtn ss-del" onClick={() => { setItems((xs) => xs.filter((z) => z.id !== sel)); setSel(""); }}>Remove this picture</button>
                </div>
              )}
              {!cur && items.length > 0 && <p className="faint" style={{ margin: 0 }}>Click a text or picture on the sheet to change it.</p>}
            </section>
            {err && <div className="pv-err">{err}</div>}
          </aside>
          <div className="ss-stage">
            {busy && <div className="ss-busy">{busy}</div>}
            <div className="ss-frame">
              <canvas ref={cv} className="ss-canvas" style={{ aspectRatio: `${P.w} / ${P.h}`, cursor: drag.current ? "grabbing" : "default" }} data-tick={tick}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
              {/* draw the sheet's shape: drag its corner (switches to Custom) */}
              <span className="ss-corner" title="Drag to change the sheet's shape" aria-label="Resize the sheet"
                onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); const r = cv.current!.getBoundingClientRect(); resize.current = { x: e.clientX, y: e.clientY, w: P.w, h: P.h, k: P.w / r.width }; if (page !== "custom") { setCust({ w: P.w, h: P.h }); setPage("custom"); } }}
                onPointerMove={(e) => { const z = resize.current; if (!z) return; setCust({ w: Math.round(Math.max(300, Math.min(4000, z.w + (e.clientX - z.x) * z.k * 2))), h: Math.round(Math.max(300, Math.min(4000, z.h + (e.clientY - z.y) * z.k))) }); }}
                onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
