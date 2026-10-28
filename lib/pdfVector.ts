/**
 * PDF and Illustrator .ai art → vector art (the same shapes-per-color form as lib/svgVector.ts), so the shop can
 * upload its Illustrator files as they are. An .ai file saved with "Create PDF Compatible File" (Illustrator's
 * default) is a PDF inside; this reads its first page:
 *   - objects (plain, or packed in object streams), the page's content streams (Flate), its Form XObjects
 *   - paths: m l c v y h re; fills f F f* (strokes, text, images, gradients and patterns can't be separated as
 *     shapes: `ok` is false with the reason, and the Studio asks for a picture instead)
 *   - colors: gray / RGB / CMYK (shown as coated press color), ICC-based by component count, and spot colors
 *     (Separation): the swatch name is kept on the shape (`ink`, e.g. "PANTONE 186 C"), so the inks can be named
 *     from the art's own swatches
 *   - q / Q / cm transforms; clipping is ignored (Illustrator's clip to the artboard)
 *   - customer mockups: art drawn on a photo of a shirt. A placed picture under all the art that covers most of the
 *     page is the shirt: it's left out, with anything drawn under it (hidden in the mockup anyway, e.g. a "BG" box),
 *     and the art is read as shapes (`mockup` says what was left out). A picture inside the art still can't be.
 *   - Lab colors (Illustrator writes PANTONE swatches' look in Lab, as /Lab or an ICC Lab profile)
 *   - distress layers (Oct 16, Nick: "a large layer of distress… it doesn't print, we lay it over the art and it
 *     creates a distressed effect; these colors don't print and we knock out"): a near-white picture with see-through
 *     parts (a soft mask) drawn over the art is the grunge. It's kept as a knockout mask (`distress`): where it's
 *     solid, the ink under it is taken out so the shirt shows through, in the preview, the mockups and the films.
 * Coordinates come out like SVG: y down, from the top-left of the crop box.
 */
import type { VArt, VShape } from "./svgVector";
import { cmykHex } from "./epsVector";

type Obj = null | boolean | number | string | { n: string } | { r: number } | Obj[] | { [k: string]: Obj } | { stream: Uint8Array; dict: Record<string, Obj> };
type Dict = Record<string, Obj>;
type Inflate = (u8: Uint8Array) => Promise<Uint8Array>;
type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

const isName = (o: Obj): o is { n: string } => !!o && typeof o === "object" && !Array.isArray(o) && "n" in o;
const isRef = (o: Obj): o is { r: number } => !!o && typeof o === "object" && !Array.isArray(o) && "r" in o;
const isStream = (o: Obj): o is { stream: Uint8Array; dict: Dict } => !!o && typeof o === "object" && !Array.isArray(o) && "stream" in o;

/* ---------- a small PDF object parser ---------- */
class Lexer {
  i = 0;
  constructor(public s: string) {}
  ws() { const s = this.s; for (;;) { while (this.i < s.length && /[\s\0]/.test(s[this.i])) this.i++; if (s[this.i] === "%") { while (this.i < s.length && s[this.i] !== "\n" && s[this.i] !== "\r") this.i++; } else break; } }
  value(): Obj {
    this.ws(); const s = this.s, c = s[this.i];
    if (c === "<" && s[this.i + 1] === "<") {
      this.i += 2; const d: Dict = {};
      for (;;) { this.ws(); if (s[this.i] === ">" && s[this.i + 1] === ">") { this.i += 2; break; } if (this.i >= s.length) break; const k = this.value(); const v = this.value(); if (isName(k)) d[k.n] = v; }
      return d;
    }
    if (c === "[") { this.i++; const a: Obj[] = []; for (;;) { this.ws(); if (s[this.i] === "]") { this.i++; break; } if (this.i >= s.length) break; a.push(this.value()); } return a; }
    if (c === "/") { let j = this.i + 1; while (j < s.length && !/[\s/[\]<>(){}%]/.test(s[j])) j++; const n = s.slice(this.i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); this.i = j; return { n }; }
    if (c === "(") { let depth = 0, j = this.i, out = ""; for (; j < s.length; j++) { const ch = s[j]; if (ch === "\\") { out += s[++j]; continue; } if (ch === "(") { if (depth++) out += ch; continue; } if (ch === ")") { if (--depth === 0) break; out += ch; continue; } out += ch; } this.i = j + 1; return out; }
    if (c === "<") { const j = s.indexOf(">", this.i); const hex = s.slice(this.i + 1, j).replace(/\s/g, ""); this.i = j + 1; let out = ""; for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16)); return out; }
    const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(this.i, this.i + 40));
    if (m) {
      // an indirect reference: "12 0 R"
      const r = /^(\d+)\s+(\d+)\s+R(?![A-Za-z])/.exec(s.slice(this.i, this.i + 40));
      if (r) { this.i += r[0].length; return { r: +r[1] }; }
      this.i += m[0].length; return +m[0];
    }
    let j = this.i; while (j < s.length && !/[\s/[\]<>(){}%]/.test(s[j])) j++;
    const w = s.slice(this.i, j); this.i = j === this.i ? j + 1 : j;
    return w === "true" ? true : w === "false" ? false : null;
  }
}
const latin1 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return s; };

export async function parsePdf(bytes: Uint8Array, inflate: Inflate, opts: { /** keep stroked outlines as stroke shapes (VShape.stroke) */ strokes?: boolean } = {}): Promise<VArt> {
  const fail = (why: string): VArt => ({ ok: false, why, x: 0, y: 0, w: 1, h: 1, shapes: [] });
  const src = latin1(bytes);
  if (!src.startsWith("%PDF")) return fail(src.startsWith("%!PS") ? "is an old PostScript-style Illustrator file (save it with PDF compatibility, or as EPS)" : "isn't a PDF");
  // every "N 0 obj" in the file (later ones win, like incremental saves)
  const objs = new Map<number, Obj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let mt: RegExpExecArray | null;
  const raw: { num: number; at: number }[] = [];
  while ((mt = re.exec(src))) raw.push({ num: +mt[1], at: mt.index + mt[0].length });
  const readAt = (at: number): Obj => {
    const lx = new Lexer(src); lx.i = at; const v = lx.value(); lx.ws();
    if (src.startsWith("stream", lx.i) && v && typeof v === "object" && !Array.isArray(v)) {
      let p = lx.i + 6; if (src[p] === "\r") p++; if (src[p] === "\n") p++;
      const d = v as Dict; let len = typeof d.Length === "number" ? d.Length : -1;
      if (len < 0 || src.slice(p + len, p + len + 12).indexOf("endstream") < 0) len = src.indexOf("endstream", p) - p;
      return { stream: bytes.subarray(p, p + len), dict: d };
    }
    return v;
  };
  for (const r of raw) objs.set(r.num, readAt(r.at));
  const get = (o: Obj): Obj => (isRef(o) ? objs.get(o.r) ?? null : o);
  const decode = async (st: { stream: Uint8Array; dict: Dict }) => {
    const f = get(st.dict.Filter), filters = Array.isArray(f) ? f.map((x) => (isName(x) ? x.n : "")) : isName(f) ? [f.n] : [];
    let data = st.stream;
    for (const fl of filters) { if (fl === "FlateDecode") data = await inflate(data); else throw new Error(`uses ${fl} compression, which isn't supported yet`); }
    return data;
  };
  // objects packed in object streams (PDF 1.5+, how Illustrator saves)
  for (const o of [...objs.values()]) {
    if (!isStream(o) || !isName(o.dict.Type) || o.dict.Type.n !== "ObjStm") continue;
    const txt = latin1(await decode(o)), N = get(o.dict.N) as number, first = get(o.dict.First) as number;
    const head = txt.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < N; k++) { const num = head[2 * k], off = head[2 * k + 1]; if (!objs.has(num)) { const lx = new Lexer(txt); lx.i = first + off; objs.set(num, lx.value()); } }
  }
  // the first page
  const cat = [...objs.values()].find((o) => o && typeof o === "object" && !Array.isArray(o) && !isStream(o) && isName((o as Dict).Type) && ((o as Dict).Type as { n: string }).n === "Catalog") as Dict | undefined;
  let node = cat ? (get(cat.Pages) as Dict) : null, guard = 0;
  while (node && guard++ < 50 && isName(node.Type) && node.Type.n === "Pages") { const kids = get(node.Kids) as Obj[]; node = kids && kids.length ? (get(kids[0]) as Dict) : null; }
  if (!node) return fail("has no page");
  const page = node;
  const inh = (k: string) => { let p: Dict | null = page; for (let g = 0; p && g < 20; g++) { if (p[k] !== undefined) return get(p[k]); p = get(p.Parent) as Dict | null; } return null; };
  const box = ((inh("CropBox") || inh("MediaBox")) as number[] | null)?.map((v) => get(v) as number) || [0, 0, 612, 792];
  const [llx, lly, urx, ury] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  const contents = get(page.Contents), parts = Array.isArray(contents) ? contents.map(get) : [contents];
  let content = "";
  for (const c of parts) if (isStream(c)) content += latin1(await decode(c)) + "\n";

  const shapes: VShape[] = [];
  let why = "";
  const note = (w: string) => { why ||= w; };
  // placed pictures: where in the drawing order (how many shapes were drawn before) and how much of the page they cover
  const pics: { at: number; cover: number }[] = [];
  const imgs: { at: number; m: M; xo: { stream: Uint8Array; dict: Dict } }[] = [];
  const pageArea = Math.max(1, (urx - llx) * (ury - lly));
  const picAt = (m: M) => {
    const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
    const w = Math.min(urx, Math.max(...xs)) - Math.max(llx, Math.min(...xs)), h = Math.min(ury, Math.max(...ys)) - Math.max(lly, Math.min(...ys));
    // a picture off the page box isn't on the art (a guide's color swatches beside a logo cut out of it)
    if (w > 0 && h > 0) pics.push({ at: shapes.length, cover: (w * h) / pageArea });
  };
  // ICC profiles that hold Lab (by their header), cached
  const labIcc = new Map<Obj, boolean>();
  const isLabIcc = async (c: Obj[]) => {
    const st = get(c[1]); if (!isStream(st)) return false;
    if (!labIcc.has(st)) { let lab = false; try { const b = await decode(st); lab = latin1(b.subarray(16, 20)) === "Lab "; } catch { /* unreadable profile */ } labIcc.set(st, lab); }
    return labIcc.get(st)!;
  };
  type Col = { hex: string; ink?: string } | null;
  const colorOf = async (cs: Obj, comps: number[]): Promise<Col> => {
    const c = get(cs);
    const nm = isName(c) ? c.n : Array.isArray(c) && isName(c[0]) ? c[0].n : "";
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
    if (nm === "DeviceGray" || nm === "CalGray" || (nm === "ICCBased" && comps.length === 1)) return { hex: hex(comps[0], comps[0], comps[0]) };
    if (nm === "Lab" || (nm === "ICCBased" && comps.length === 3 && Array.isArray(c) && (await isLabIcc(c)))) return { hex: labHex(comps[0], comps[1], comps[2]) };
    if (nm === "DeviceRGB" || nm === "CalRGB" || (nm === "ICCBased" && comps.length === 3)) return { hex: hex(comps[0], comps[1], comps[2]) };
    if (nm === "DeviceCMYK" || (nm === "ICCBased" && comps.length === 4)) return { hex: cmykHex(clamp(comps[0]), clamp(comps[1]), clamp(comps[2]), clamp(comps[3])) };
    if (nm === "Separation" && Array.isArray(c)) {
      const ink = isName(c[1]) ? c[1].n : "", t = clamp(comps[0] ?? 1), alt = get(c[2]), fn = get(c[3]);
      // the swatch's look: the tint function's full-strength color (Type 2 functions; otherwise mid gray)
      let full: Col = null;
      const fd = isStream(fn) ? fn.dict : (fn as Dict | null);
      if (fd && get(fd.FunctionType) === 2) { const c1 = ((get(fd.C1) as number[]) || [1]).map((v) => get(v) as number); full = await colorOf(alt, c1); }
      else if (fd && get(fd.FunctionType) === 4 && isStream(fn)) {
        // a PostScript calculator function: Illustrator writes "{ dup 0.2 mul exch dup 0.9 mul exch ... }" for tints;
        // evaluate the simple multiply form at full strength
        const code = latin1(await decode(fn)); const nums = [...code.matchAll(/([\d.]+)\s+mul/g)].map((m) => +m[1]);
        const n = isName(alt) ? (alt.n === "DeviceCMYK" ? 4 : alt.n === "DeviceRGB" ? 3 : 1) : 4;
        if (nums.length >= n) full = await colorOf(alt, nums.slice(0, n));
      }
      if (ink === "All") return { hex: "#000000" };
      if (ink === "None") return null;
      const f = full?.hex || "#808080";
      // a tint lightens toward paper
      const fr = parseInt(f.slice(1, 3), 16) / 255, fg = parseInt(f.slice(3, 5), 16) / 255, fb = parseInt(f.slice(5, 7), 16) / 255;
      return { hex: hex(1 - t * (1 - fr), 1 - t * (1 - fg), 1 - t * (1 - fb)), ink: t >= 0.98 ? ink : `${ink} ${Math.round(t * 100)}%` };
    }
    if (nm === "Pattern") { note("has a pattern or gradient fill"); return null; }
    if (nm === "DeviceN") { note("has a multi-ink (DeviceN) color"); return null; }
    if (nm === "Indexed") { note("has an indexed color"); return null; }
    return null;
  };

  const run = async (code: string, res: Dict | null, ctm0: M, depth: number) => {
    if (depth > 12) return;
    const csRes = (get(res?.ColorSpace ?? null) as Dict | null) || {}, xoRes = (get(res?.XObject ?? null) as Dict | null) || {};
    let ctm: M = ctm0, fillCS: Obj = { n: "DeviceGray" }, fill: Col = { hex: "#000000" };
    let strokeCS: Obj = { n: "DeviceGray" }, strokeC: Col = { hex: "#000000" }, lw = 1, cap = 0, join = 0;
    const stack: { ctm: M; fillCS: Obj; fill: Col; strokeCS: Obj; strokeC: Col; lw: number; cap: number; join: number }[] = [];
    /** a stroked path kept as a stroke shape, its width in page units (the CTM's scale) */
    const pushStroke = () => { if (!opts.strokes || !path || !strokeC) return; const k = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1; shapes.push({ fill: "none", evenodd: false, ops: path, stroke: { hex: strokeC.hex, w: Math.max(0.05, lw * k), cap, join }, ...(strokeC.ink ? { ink: strokeC.ink } : {}) }); };
    let path = "", cx = 0, cy = 0, sx = 0, sy = 0;
    const P = (x: number, y: number) => { const X = ctm[0] * x + ctm[2] * y + ctm[4], Y = ctm[1] * x + ctm[3] * y + ctm[5]; return `${(X - llx).toFixed(3)} ${(ury - Y).toFixed(3)}`; };
    const lx = new Lexer(code); const ops: Obj[] = [];
    const nums = (k: number) => ops.slice(-k).map((v) => (typeof v === "number" ? v : 0));
    while (lx.i < code.length) {
      lx.ws(); if (lx.i >= code.length) break;
      const ch = code[lx.i];
      if (ch === "/" || ch === "[" || ch === "(" || ch === "<" || /[\d+.-]/.test(ch)) {
        ops.push(lx.value()); continue;
      }
      let j = lx.i; while (j < code.length && !/[\s/[\]<>(){}%]/.test(code[j])) j++;
      const op = code.slice(lx.i, j); lx.i = j === lx.i ? j + 1 : j;
      switch (op) {
        case "q": stack.push({ ctm, fillCS, fill, strokeCS, strokeC, lw, cap, join }); break;
        case "Q": { const s = stack.pop(); if (s) ({ ctm, fillCS, fill, strokeCS, strokeC, lw, cap, join } = s); break; }
        case "cm": ctm = mul(nums(6) as M, ctm); break;
        case "m": { const [x, y] = nums(2); cx = sx = x; cy = sy = y; path += `${P(x, y)} m\n`; break; }
        case "l": { const [x, y] = nums(2); cx = x; cy = y; path += `${P(x, y)} l\n`; break; }
        case "c": { const [a, b, c2, d, x, y] = nums(6); path += `${P(a, b)} ${P(c2, d)} ${P(x, y)} c\n`; cx = x; cy = y; break; }
        case "v": { const [c2, d, x, y] = nums(4); path += `${P(cx, cy)} ${P(c2, d)} ${P(x, y)} c\n`; cx = x; cy = y; break; }
        case "y": { const [a, b, x, y] = nums(4); path += `${P(a, b)} ${P(x, y)} ${P(x, y)} c\n`; cx = x; cy = y; break; }
        case "h": path += "h\n"; cx = sx; cy = sy; break;
        case "re": { const [x, y, w, h] = nums(4); path += `${P(x, y)} m\n${P(x + w, y)} l\n${P(x + w, y + h)} l\n${P(x, y + h)} l\nh\n`; break; }
        case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*":
          if (/[Bb]/.test(op) && !opts.strokes) note("has strokes (outline them in Illustrator: Object → Path → Outline Stroke)");
          if (path && fill) shapes.push({ fill: fill.hex, evenodd: op.includes("*"), ops: path, ...(fill.ink ? { ink: fill.ink } : {}) });
          if (/[Bb]/.test(op)) { if (op[0] === "b") path += "h\n"; pushStroke(); }
          path = ""; break;
        case "S": case "s": if (!opts.strokes) note("has strokes (outline them in Illustrator: Object → Path → Outline Stroke)"); if (op === "s") path += "h\n"; pushStroke(); path = ""; break;
        case "w": lw = nums(1)[0]; break;
        case "J": cap = nums(1)[0]; break;
        case "j": join = nums(1)[0]; break;
        case "G": strokeCS = { n: "DeviceGray" }; strokeC = await colorOf(strokeCS, nums(1)); break;
        case "RG": strokeCS = { n: "DeviceRGB" }; strokeC = await colorOf(strokeCS, nums(3)); break;
        case "K": strokeCS = { n: "DeviceCMYK" }; strokeC = await colorOf(strokeCS, nums(4)); break;
        case "CS": { const n = ops[ops.length - 1]; strokeCS = isName(n) ? (csRes[n.n] ?? n) : n; const c = get(strokeCS); const nm = isName(c) ? c.n : Array.isArray(c) && isName(c[0]) ? c[0].n : "";
          strokeC = await colorOf(strokeCS, nm === "DeviceCMYK" ? [0, 0, 0, 1] : nm === "DeviceRGB" ? [0, 0, 0] : [nm === "Separation" ? 1 : 0]); break; }
        case "SC": case "SCN": {
          const last = ops[ops.length - 1];
          if (isName(last)) { strokeC = null; break; }
          const vals: number[] = []; for (let k = ops.length - 1; k >= 0 && typeof ops[k] === "number"; k--) vals.unshift(ops[k] as number);
          strokeC = await colorOf(strokeCS, vals); break;
        }
        case "n": path = ""; break;
        case "W": case "W*": break;
        case "g": fillCS = { n: "DeviceGray" }; fill = await colorOf(fillCS, nums(1)); break;
        case "rg": fillCS = { n: "DeviceRGB" }; fill = await colorOf(fillCS, nums(3)); break;
        case "k": fillCS = { n: "DeviceCMYK" }; fill = await colorOf(fillCS, nums(4)); break;
        case "cs": { const n = ops[ops.length - 1]; fillCS = isName(n) ? (csRes[n.n] ?? n) : n; const c = get(fillCS); const nm = isName(c) ? c.n : Array.isArray(c) && isName(c[0]) ? c[0].n : "";
          fill = await colorOf(fillCS, nm === "DeviceCMYK" ? [0, 0, 0, 1] : nm === "DeviceRGB" ? [0, 0, 0] : [nm === "Separation" ? 1 : 0]); break; }
        case "sc": case "scn": {
          const last = ops[ops.length - 1];
          if (isName(last)) { note("has a pattern or gradient fill"); fill = null; break; }
          const vals: number[] = []; for (let k = ops.length - 1; k >= 0 && typeof ops[k] === "number"; k--) vals.unshift(ops[k] as number);
          fill = await colorOf(fillCS, vals); break;
        }
        case "Do": {
          const n = ops[ops.length - 1]; const xo = isName(n) ? get(xoRes[n.n]) : null;
          if (isStream(xo) && isName(xo.dict.Subtype) && xo.dict.Subtype.n === "Form") {
            const mtx = ((get(xo.dict.Matrix) as number[]) || [1, 0, 0, 1, 0, 0]).map((v) => get(v) as number) as M;
            await run(latin1(await decode(xo)), (get(xo.dict.Resources) as Dict) || res, mul(mtx, ctm), depth + 1);
          } else if (isStream(xo)) { picAt(ctm); imgs.push({ at: shapes.length, m: ctm, xo }); }
          break;
        }
        case "BT": {
          const e = code.indexOf("ET", lx.i), blk = code.slice(lx.i, e < 0 ? code.length : e);
          // text set off the page box (a guide's titles and labels around a logo cut out of it) isn't part of the art
          const at = [...blk.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g)].map((m) => [+m[5], +m[6]]);
          const off = at.length > 0 && at.every(([x, y]) => { const X = ctm[0] * x + ctm[2] * y + ctm[4], Y = ctm[1] * x + ctm[3] * y + ctm[5]; return Y < lly - 2 || Y > ury + 2 || X > urx; });
          if (!off) note("has live text (outline it: Type → Create Outlines)");
          lx.i = e < 0 ? code.length : e + 2;
        } break;
        case "BI": picAt(ctm); { const e = code.indexOf("EI", lx.i); lx.i = e < 0 ? code.length : e + 2; } break;
        case "sh": note("has gradients"); break;
        default: break; // gs, d, M, i, ri, BDC/BMC/EMC/MP/DP…
      }
      ops.length = 0;
    }
  };
  await run(content, (inh("Resources") as Dict) || null, [1, 0, 0, 1, 0, 0], 0);
  const W = urx - llx, H = ury - lly;
  // distress: near-white pictures with a soft mask, drawn over (most of) the art
  const distress: NonNullable<VArt["distress"]> = [];
  for (const im of imgs) {
    if (!shapes.length || im.at < shapes.length * 0.5) continue;
    const d = await distressOf(im.xo, get, decode).catch(() => null);
    const [a, b, c, dd, e, f] = im.m;
    if (!d || Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0 || dd <= 0) continue;
    distress.push({ x: e - llx, y: ury - (f + dd), w: a, h: dd, href: d });
    const k = pics.findIndex((p) => p.at === im.at);
    if (k >= 0) pics.splice(k, 1);
  }
  if (distress.length) note("has a distress layer (it's knocked out of the art, not printed)");
  // a customer mockup: every picture is drawn before the art, and one covers most of the page (the shirt photo)
  let mockup: string | undefined, art = shapes;
  if (pics.length) {
    const last = Math.max(...pics.map((p) => p.at));
    const shirt = pics.some((p) => p.cover >= 0.4) && shapes.length - last >= 3;
    if (shirt) {
      art = shapes.slice(last);
      const hidden = last;
      mockup = `It's a mockup on a shirt: the shirt picture${hidden ? ` and ${hidden} shape${hidden === 1 ? "" : "s"} under it` : ""} left out, the art kept as shapes`;
    } else note("has a placed image");
  }
  // shapes wholly off the page box aren't part of the art: a page cut down to one logo keeps the rest of the sheet out
  // of sight, and it mustn't come back as extra colors (Oct 27: MEI's guide cut into one file per logo)
  art = art.filter((s) => {
    const n = (s.ops.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (n.length < 2) return true;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); }
    return !(x1 < 0 || y1 < 0 || x0 > W || y0 > H);
  });
  if (!art.length) return fail(why || "has no filled shapes");
  return { ok: !why, ...(why ? { why } : {}), x: 0, y: 0, w: W, h: H, shapes: art, ...(mockup ? { mockup } : {}), ...(distress.length ? { distress } : {}) };
}

/**
 * A distress layer's knockout as a PNG data URL (gray: white = keep the ink, black = knock it out), or null when the
 * picture isn't one: it has to be near-white (paper color) everywhere and have a soft mask (the grunge's see-through).
 */
async function distressOf(xo: { stream: Uint8Array; dict: Dict }, get: (o: Obj) => Obj, decode: (st: { stream: Uint8Array; dict: Dict }) => Promise<Uint8Array>): Promise<string | null> {
  const D = xo.dict, w = get(D.Width) as number, h = get(D.Height) as number, bpc = get(D.BitsPerComponent) as number;
  const sm = get(D.SMask ?? null);
  if (!isStream(sm) || !w || !h || bpc !== 8) return null;
  // the picture's colors: near-white
  const cs = get(D.ColorSpace ?? null);
  const nm = isName(cs) ? cs.n : Array.isArray(cs) && isName(get(cs[0])) ? (get(cs[0]) as { n: string }).n : "";
  const light = (base: string, v: number[]) => (base === "DeviceCMYK" ? v.every((x) => x <= 0.1) : base === "DeviceGray" ? v[0] >= 0.9 : base === "DeviceRGB" ? v.every((x) => x >= 0.9) : false);
  if (nm === "Indexed" && Array.isArray(cs)) {
    const baseO = get(cs[1]), base = isName(baseO) ? baseO.n : "", n = base === "DeviceCMYK" ? 4 : base === "DeviceRGB" ? 3 : base === "DeviceGray" ? 1 : 0;
    const lk = get(cs[3]);
    const tbl = isStream(lk) ? await decode(lk) : typeof lk === "string" ? Uint8Array.from(lk, (ch) => ch.charCodeAt(0)) : null;
    if (!n || !tbl) return null;
    for (let i = 0; i + n <= tbl.length; i += n) if (!light(base, Array.from(tbl.subarray(i, i + n), (x) => x / 255))) return null;
  } else if (["DeviceCMYK", "DeviceRGB", "DeviceGray"].includes(nm)) {
    const px = await decode(xo), n = nm === "DeviceCMYK" ? 4 : nm === "DeviceRGB" ? 3 : 1;
    if (px.length < w * h * n) return null;
    let bad = 0, seen = 0;
    for (let i = 0; i < w * h; i += 37) { seen++; if (!light(nm, Array.from(px.subarray(i * n, i * n + n), (x) => x / 255))) bad++; }
    if (bad > seen * 0.02) return null;
  } else return null;
  // the soft mask: 8-bit gray, how solid the grunge is
  const SD = sm.dict;
  if ((get(SD.BitsPerComponent) as number) !== 8 || (get(SD.Width) as number) !== w || (get(SD.Height) as number) !== h) return null;
  let a = await decode(sm);
  const parms = get(SD.DecodeParms ?? null) as Dict | null, pred = parms ? (get(parms.Predictor ?? null) as number) || 1 : 1;
  if (pred >= 10) a = unPng(a, w, h);
  if (a.length < w * h) return null;
  const keep = new Uint8Array(w * h);
  let any = 0;
  for (let i = 0; i < w * h; i++) { keep[i] = 255 - a[i]; if (a[i] > 24) any++; }
  if (any < w * h * 0.01) return null;
  return pngGray(w, h, keep);
}
/** undo PNG row filters (Predictor 10–15), one gray byte per pixel */
function unPng(d: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const t = d[y * (w + 1)], src = y * (w + 1) + 1;
    for (let x = 0; x < w; x++) {
      const raw = d[src + x], left = x ? out[y * w + x - 1] : 0, up = y ? out[(y - 1) * w + x] : 0, ul = x && y ? out[(y - 1) * w + x - 1] : 0;
      let v = raw;
      if (t === 1) v = raw + left; else if (t === 2) v = raw + up; else if (t === 3) v = raw + ((left + up) >> 1);
      else if (t === 4) { const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul); v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul); }
      out[y * w + x] = v & 255;
    }
  }
  return out;
}
/** a gray PNG as a data URL, stored without compression (small enough, and works anywhere without a zlib) */
function pngGray(w: number, h: number, px: Uint8Array): string {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, y * w + w), y * (w + 1) + 1);
  // zlib with stored blocks
  const blocks = Math.ceil(raw.length / 65535) || 1, z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535)), n = part.length;
    z[o++] = i === blocks - 1 ? 1 : 0; z[o++] = n & 255; z[o++] = n >> 8; z[o++] = ~n & 255; z[o++] = (~n >> 8) & 255;
    z.set(part, o); o += n;
  }
  let s1 = 1, s2 = 0;
  for (let i = 0; i < raw.length; i++) { s1 = (s1 + raw[i]) % 65521; s2 = (s2 + s1) % 65521; }
  const ad = ((s2 << 16) | s1) >>> 0;
  z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255;
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const chunk = (type: string, data: Uint8Array) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    let c = 0xffffffff; for (let i = 4; i < 8 + data.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
    dv.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return b;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z.subarray(0, o)), chunk("IEND", new Uint8Array(0))];
  let bin = "";
  for (const pt of parts) for (let i = 0; i < pt.length; i += 8192) bin += String.fromCharCode(...pt.subarray(i, i + 8192));
  return "data:image/png;base64," + btoa(bin);
}

/** CIE Lab (D50, as PDF and ICC use it) → sRGB hex: XYZ, Bradford to D65, then sRGB */
function labHex(L: number, a: number, b: number): string {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.9642 * f(fx), Y = 1 * f(fy), Z = 0.8251 * f(fz);
  // D50 → D65 (Bradford)
  const x = 0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z, y = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z, z = 0.0122982 * X - 0.020483 * Y + 1.3299098 * Z;
  const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  return "#" + lin.map((v) => { const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0"); }).join("").toUpperCase();
}

/** Flate for the browser (PDF streams are zlib-wrapped; a few writers leave junk after the end, so fall back to raw) */
export async function browserInflate(u8: Uint8Array): Promise<Uint8Array> {
  const run = async (fmt: "deflate" | "deflate-raw", data: Uint8Array) => new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer());
  try { return await run("deflate", u8); } catch { return run("deflate-raw", u8.subarray(2)); }
}
