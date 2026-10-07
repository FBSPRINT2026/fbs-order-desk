/**
 * Vector art (SVG) kept as vector: every filled shape, with its color and its outline in PDF path operators, so a
 * spot-color separation of a logo like FedEx comes out as the original shapes in spot inks (Separo rasterizes the
 * same file at its tiny nominal size, 373 × 170 px). Handles paths (all commands, arcs too), rect, circle, ellipse,
 * polygon, nested group transforms, fill from attributes / style / <style> classes. Gradients, images, masks and
 * stroked outlines can't be separated this way: `ok` is false and the raster route is used instead.
 */
/** a gradient fill, in art (SVG) coordinates: linear from (x0,y0) to (x1,y1); radial from the circle (x0,y0,r0) to
 *  (x1,y1,r1). `stops` run t = 0…1. */
export type VGrad = { kind: "linear" | "radial"; x0: number; y0: number; x1: number; y1: number; r0?: number; r1?: number; stops: { t: number; hex: string }[] };
export type VShape = { fill: string; evenodd: boolean; ops: string; /** the spot swatch it was filled with (PDF / .ai art), e.g. "PANTONE 186 C" */ ink?: string;
  /** filled with a gradient (then `fill` is its middle color, for anything that only knows flat colors) */
  grad?: VGrad };
export type VArt = { ok: boolean; why?: string; x: number; y: number; w: number; h: number; shapes: VShape[];
  /** a customer mockup: what was left out to get the art off the shirt (PDF / .ai) */
  mockup?: string };

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ID: M = [1, 0, 0, 1, 0, 0];
function parseTransform(s: string | null): M {
  let m = ID;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let t: M = ID;
    if (fn === "matrix" && a.length === 6) t = a as M;
    else if (fn === "translate") t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") { const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r); t = [c, sn, -sn, c, 0, 0]; if (a.length === 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]); }
    else if (fn === "skewX") t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}
const NAMED: Record<string, string> = { black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#008000", blue: "#0000FF", yellow: "#FFFF00", orange: "#FFA500", purple: "#800080", gray: "#808080", grey: "#808080", navy: "#000080", maroon: "#800000", lime: "#00FF00", aqua: "#00FFFF", teal: "#008080", fuchsia: "#FF00FF", silver: "#C0C0C0", gold: "#FFD700" };
function color(v: string | null | undefined): string | null | "none" | "url" {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s || s === "inherit") return null;
  if (s === "none" || s === "transparent") return "none";
  if (s.startsWith("url(")) return "url";
  let m = s.match(/^#([0-9a-f]{3})$/); if (m) return "#" + m[1].split("").map((c) => c + c).join("").toUpperCase();
  m = s.match(/^#([0-9a-f]{6})/); if (m) return "#" + m[1].toUpperCase();
  m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => Math.round(x.endsWith("%") ? (parseFloat(x) * 2.55) : parseFloat(x)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return NAMED[s] || null;
}

/* ---------- path data → absolute cubic segments ---------- */
type Seg = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phi: number, fa: number, fs: number, x2: number, y2: number): Seg[] {
  if (!rx || !ry) return [["L", x2, y2]];
  const r = (phi * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = c * dx + s * dy, y1p = -s * dx + c * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1, num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = sign * Math.sqrt(Math.max(0, num / den)), cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2)), d = dt / n, out: Seg[] = [];
  const pt = (t: number) => [cx + rx * Math.cos(t) * c - ry * Math.sin(t) * s, cy + rx * Math.cos(t) * s + ry * Math.sin(t) * c];
  const der = (t: number) => [-rx * Math.sin(t) * c - ry * Math.cos(t) * s, -rx * Math.sin(t) * s + ry * Math.cos(t) * c];
  const al = (4 / 3) * Math.tan(d / 4);
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d, b = a + d, p0 = pt(a), p1 = pt(b), d0 = der(a), d1 = der(b);
    out.push(["C", p0[0] + al * d0[0], p0[1] + al * d0[1], p1[0] - al * d1[0], p1[1] - al * d1[1], p1[0], p1[1]]);
  }
  return out;
}
function pathSegs(d: string): Seg[] {
  const tok = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out: Seg[] = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = "";
  const num = () => parseFloat(tok[i++]);
  const flag = () => { const t = tok[i]; if (t && /^[01]{2,}/.test(t)) { tok[i] = t.slice(1); return +t[0]; } i++; return +t; };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") { out.push(["Z"]); x = sx; y = sy; prev = "Z"; continue; }
    if (C === "M") { x = ox + num(); y = oy + num(); sx = x; sy = y; out.push(["M", x, y]); cmd = rel ? "l" : "L"; prev = "M"; continue; }
    if (C === "L") { x = ox + num(); y = oy + num(); out.push(["L", x, y]); }
    else if (C === "H") { x = ox + num(); out.push(["L", x, y]); }
    else if (C === "V") { y = oy + num(); out.push(["L", x, y]); }
    else if (C === "C") { const a = ox + num(), b = oy + num(), c2 = ox + num(), d2 = oy + num(); x = ox + num(); y = oy + num(); out.push(["C", a, b, c2, d2, x, y]); lcx = c2; lcy = d2; }
    else if (C === "S") { const a = prev === "C" || prev === "S" ? 2 * x - lcx : x, b = prev === "C" || prev === "S" ? 2 * y - lcy : y; const c2 = ox + num(), d2 = oy + num(); x = ox + num(); y = oy + num(); out.push(["C", a, b, c2, d2, x, y]); lcx = c2; lcy = d2; }
    else if (C === "Q" || C === "T") {
      let qx: number, qy: number;
      if (C === "Q") { qx = ox + num(); qy = oy + num(); } else { qx = prev === "Q" || prev === "T" ? 2 * x - lqx : x; qy = prev === "Q" || prev === "T" ? 2 * y - lqy : y; }
      const nx = ox + num(), ny = oy + num();
      out.push(["C", x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
      lqx = qx; lqy = qy; x = nx; y = ny;
    } else if (C === "A") { const rx = num(), ry = num(), ph = num(), fa = flag(), fs = flag(); const nx = ox + num(), ny = oy + num(); out.push(...arcToCubics(x, y, rx, ry, ph, fa, fs, nx, ny)); x = nx; y = ny; }
    else { i++; }
    prev = C;
  }
  return out;
}
const ellipse = (cx: number, cy: number, rx: number, ry: number): Seg[] => { const k = 0.5522847498; return [["M", cx + rx, cy], ["C", cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry], ["C", cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy], ["C", cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry], ["C", cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy], ["Z"]]; };

/** Parse an SVG's filled shapes (browser: uses DOMParser). */
export function parseSvg(text: string): VArt {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return { ok: false, why: "not an SVG", x: 0, y: 0, w: 0, h: 0, shapes: [] };
  const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  const W = parseFloat(svg.getAttribute("width") || "") || vb[2] || 100, H = parseFloat(svg.getAttribute("height") || "") || vb[3] || 100;
  const box = vb.length === 4 && vb.every((v) => isFinite(v)) ? vb : [0, 0, W, H];
  // class rules from <style>: .st0{fill:#FF5900}
  const cls = new Map<string, Record<string, string>>();
  for (const st of Array.from(doc.querySelectorAll("style"))) for (const [, sel, body] of (st.textContent || "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const props = Object.fromEntries(body.split(";").map((p) => p.split(":").map((x) => x.trim())).filter((p) => p.length === 2 && p[0]));
    for (const s of sel.split(",")) { const m = s.trim().match(/^\.([\w-]+)$/); if (m) cls.set(m[1], { ...(cls.get(m[1]) || {}), ...props }); }
  }
  const prop = (el: Element, name: string): string | null => {
    const style = el.getAttribute("style") || "";
    const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`));
    if (m) return m[1].trim();
    for (const c of (el.getAttribute("class") || "").split(/\s+/)) { const v = cls.get(c)?.[name]; if (v) return v; }
    return el.getAttribute(name);
  };
  const shapes: VShape[] = [];
  let why = "";
  const walk = (el: Element, m: M, fill: string, rule: string, strokeOn: boolean, hidden: boolean) => {
    const tag = el.tagName.toLowerCase().replace(/^svg:/, "");
    if (["defs", "clippath", "mask", "pattern", "lineargradient", "radialgradient", "symbol", "title", "desc", "metadata", "style"].includes(tag)) return;
    if (prop(el, "display") === "none" || prop(el, "visibility") === "hidden") hidden = true;
    const mm = mul(m, parseTransform(el.getAttribute("transform")));
    const f = color(prop(el, "fill")), fr = prop(el, "fill-rule") || rule, sk = color(prop(el, "stroke")), op = parseFloat(prop(el, "opacity") || prop(el, "fill-opacity") || "1");
    const fillHere = f === null ? fill : f;
    const strokeHere = sk === null ? strokeOn : sk !== "none";
    if (tag === "image") { why = "has a picture inside"; return; }
    if (el.getAttribute("clip-path") || el.getAttribute("mask") || prop(el, "clip-path") || prop(el, "mask")) why ||= "uses clipping or masks";
    if (tag === "g" || tag === "svg" || tag === "a") { for (const c of Array.from(el.children)) walk(c, mm, fillHere, fr, strokeHere, hidden); return; }
    if (tag === "use") { why ||= "uses <use> references"; return; }
    let segs: Seg[] | null = null;
    const n = (a: string) => parseFloat(el.getAttribute(a) || "0");
    if (tag === "path") segs = pathSegs(el.getAttribute("d") || "");
    else if (tag === "rect") { const x = n("x"), y = n("y"), w = n("width"), h = n("height"); segs = [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]]; }
    else if (tag === "circle") segs = ellipse(n("cx"), n("cy"), n("r"), n("r"));
    else if (tag === "ellipse") segs = ellipse(n("cx"), n("cy"), n("rx"), n("ry"));
    else if (tag === "polygon" || tag === "polyline") { const p = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number); segs = []; for (let i = 0; i + 1 < p.length; i += 2) segs.push([i ? "L" : "M", p[i], p[i + 1]]); if (tag === "polygon") segs.push(["Z"]); }
    else if (tag === "line") { if (strokeHere) why ||= "has stroked lines"; return; }
    else if (tag === "text") { why ||= "has live text (outline it first)"; return; }
    if (!segs || hidden) return;
    if (strokeHere) why ||= "has stroked outlines (expand the strokes first)";
    if (fillHere === "url") { why ||= "has gradients"; return; }
    if (fillHere === "none" || op <= 0.01) return;
    if (op < 0.99) why ||= "has see-through shapes";
    const t = (x: number, y: number) => [mm[0] * x + mm[2] * y + mm[4], mm[1] * x + mm[3] * y + mm[5]].map((v) => v.toFixed(3)).join(" ");
    let ops = "";
    for (const s of segs) ops += s[0] === "M" ? `${t(s[1], s[2])} m\n` : s[0] === "L" ? `${t(s[1], s[2])} l\n` : s[0] === "C" ? `${t(s[1], s[2])} ${t(s[3], s[4])} ${t(s[5], s[6])} c\n` : "h\n";
    shapes.push({ fill: fillHere || "#000000", evenodd: fr === "evenodd", ops });
  };
  walk(svg, ID, "#000000", "nonzero", false, false);
  return { ok: !why && shapes.length > 0, why: why || (shapes.length ? undefined : "no filled shapes"), x: box[0], y: box[1], w: box[2], h: box[3], shapes };
}
