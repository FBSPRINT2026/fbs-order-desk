/**
 * PostScript / PDF smooth shadings (gradients) as Illustrator writes them in an EPS (`shfill` with a ShadingType 2
 * axial or 3 radial dictionary): the dictionary read into plain values, and its color function (sampled type 0,
 * exponential type 2, stitching type 3) evaluated, so a gradient becomes a list of color stops.
 */
export type PSVal = number | boolean | string | { name: string } | PSVal[] | { [k: string]: PSVal } | Uint8Array;

/** ASCII85 (<~ … ~>) → bytes */
export function a85(s: string): Uint8Array {
  const src = s.replace(/^<~/, "").replace(/~>$/, "").replace(/\s+/g, "");
  const out: number[] = [];
  let tup: number[] = [];
  for (const ch of src) {
    if (ch === "z" && !tup.length) { out.push(0, 0, 0, 0); continue; }
    const c = ch.charCodeAt(0) - 33; if (c < 0 || c > 84) continue;
    tup.push(c);
    if (tup.length === 5) { let v = 0; for (const t of tup) v = v * 85 + t; out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); tup = []; }
  }
  if (tup.length) {
    const n = tup.length; while (tup.length < 5) tup.push(84);
    let v = 0; for (const t of tup) v = v * 85 + t;
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...b.slice(0, n - 1));
  }
  return Uint8Array.from(out);
}
const hexBytes = (s: string) => { const h = s.replace(/[<>\s]/g, ""); const o = new Uint8Array(h.length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; };

/** read one value starting at tokens[i]; returns the value and the index after it */
export function readVal(tk: string[], i: number): [PSVal, number] {
  const t = tk[i];
  if (t === "<<") {
    const d: { [k: string]: PSVal } = {}; i++;
    while (i < tk.length && tk[i] !== ">>") {
      const k = tk[i]; if (k[0] !== "/") { i++; continue; }
      const [v, j] = readVal(tk, i + 1); d[k.slice(1)] = v; i = j;
    }
    return [d, i + 1];
  }
  if (t === "[") {
    const a: PSVal[] = []; i++;
    while (i < tk.length && tk[i] !== "]") { const [v, j] = readVal(tk, i); a.push(v); i = j; }
    return [a, i + 1];
  }
  if (t === "{") { let depth = 0; for (; i < tk.length; i++) { if (tk[i] === "{") depth++; else if (tk[i] === "}" && --depth === 0) break; } return ["{proc}", i + 1]; }
  if (t.startsWith("<~")) return [a85(t), i + 1];
  if (t[0] === "<") return [hexBytes(t), i + 1];
  if (t === "true" || t === "false") return [t === "true", i + 1];
  if (t[0] === "/") return [{ name: t.slice(1) }, i + 1];
  const v = Number(t);
  return [Number.isNaN(v) ? t : v, i + 1];
}

type Dict = { [k: string]: PSVal };
const nums = (v: PSVal | undefined): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : []);

/** the color function: t → component values */
export function makeFn(f: Dict): ((t: number) => number[]) | null {
  const type = f.FunctionType as number;
  const dom = nums(f.Domain).length >= 2 ? nums(f.Domain) : [0, 1];
  const clampT = (t: number) => Math.max(dom[0], Math.min(dom[1], t));
  if (type === 2) {
    const c0 = nums(f.C0).length ? nums(f.C0) : [0], c1 = nums(f.C1).length ? nums(f.C1) : [1], N = (f.N as number) ?? 1;
    return (t) => { const x = clampT(t); const p = Math.pow((x - dom[0]) / ((dom[1] - dom[0]) || 1), N); return c0.map((a, k) => a + p * ((c1[k] ?? a) - a)); };
  }
  if (type === 0) {
    const size = nums(f.Size)[0] || 0, bps = (f.BitsPerSample as number) || 8, range = nums(f.Range), nOut = range.length >> 1;
    const enc = nums(f.Encode).length >= 2 ? nums(f.Encode) : [0, size - 1];
    const dec = nums(f.Decode).length ? nums(f.Decode) : range;
    const data = f.DataSource instanceof Uint8Array ? f.DataSource : null;
    if (!data || !size || !nOut || bps !== 8) return null;
    const sample = (j: number, k: number) => { const v = data[Math.max(0, Math.min(size - 1, j)) * nOut + k] ?? 0; return dec[2 * k] + (v / 255) * (dec[2 * k + 1] - dec[2 * k]); };
    return (t) => {
      const x = clampT(t), e = enc[0] + ((x - dom[0]) / ((dom[1] - dom[0]) || 1)) * (enc[1] - enc[0]);
      const e0 = Math.max(0, Math.min(size - 1, Math.floor(e))), e1 = Math.min(size - 1, e0 + 1), fr = Math.max(0, Math.min(1, e - e0));
      const out: number[] = [];
      for (let k = 0; k < nOut; k++) out.push(Math.max(range[2 * k], Math.min(range[2 * k + 1], sample(e0, k) * (1 - fr) + sample(e1, k) * fr)));
      return out;
    };
  }
  if (type === 3) {
    const subs = (Array.isArray(f.Functions) ? f.Functions : []).map((s) => makeFn(s as Dict));
    if (!subs.length || subs.some((s) => !s)) return null;
    const bounds = nums(f.Bounds), enc = nums(f.Encode);
    return (t) => {
      const x = clampT(t);
      let k = 0; while (k < bounds.length && x >= bounds[k]) k++;
      const lo = k === 0 ? dom[0] : bounds[k - 1], hi = k === bounds.length ? dom[1] : bounds[k];
      const e0 = enc[2 * k] ?? 0, e1 = enc[2 * k + 1] ?? 1;
      const u = e0 + ((x - lo) / ((hi - lo) || 1)) * (e1 - e0);
      return subs[k]!(u);
    };
  }
  return null;
}

export type Shading = { kind: "linear" | "radial"; coords: number[]; fn: (t: number) => number[]; comps: number; dom: [number, number] };

/** a ShadingType 2 (axial) or 3 (radial) dictionary → what's needed to draw it */
export function readShading(d: Dict): Shading | null {
  const type = d.ShadingType as number;
  if (type !== 2 && type !== 3) return null;
  const coords = nums(d.Coords);
  if ((type === 2 && coords.length < 4) || (type === 3 && coords.length < 6)) return null;
  const f = d.Function;
  let fn: ((t: number) => number[]) | null = null;
  if (Array.isArray(f)) { const fs = f.map((x) => makeFn(x as Dict)); if (fs.every(Boolean)) fn = (t) => fs.map((g) => g!(t)[0]); }
  else if (f && typeof f === "object") fn = makeFn(f as Dict);
  if (!fn) return null;
  const dom = nums(d.Domain).length >= 2 ? [nums(d.Domain)[0], nums(d.Domain)[1]] as [number, number] : [0, 1] as [number, number];
  const comps = fn((dom[0] + dom[1]) / 2).length;
  return { kind: type === 2 ? "linear" : "radial", coords, fn, comps, dom };
}
