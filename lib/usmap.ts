/**
 * A real US map without map libraries: decode the us-atlas TopoJSON (counties + states, already projected to a
 * 975×610 Albers USA canvas) into SVG paths, and project a longitude/latitude onto that same canvas (d3's
 * geoAlbersUsa at scale 1300, translate [487.5, 305], with the Alaska and Hawaii insets).
 */
export type Pt = [number, number];
export type TopoGeom = { type: "Polygon" | "MultiPolygon" | null; id?: string; properties?: { name?: string }; arcs?: number[][] | number[][][] };
export type Topo = { type: "Topology"; transform?: { scale: Pt; translate: Pt }; arcs: number[][][]; objects: Record<string, { type: "GeometryCollection"; geometries: TopoGeom[] }> };
export const MAP_W = 975, MAP_H = 610;
export const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json";

/** Absolute coordinates for every arc (TopoJSON stores them quantized and delta-encoded). */
export function decodeArcs(t: Topo): Pt[][] {
  const tr = t.transform;
  return t.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map((p) => { if (!tr) return [p[0], p[1]] as Pt; x += p[0]; y += p[1]; return [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]] as Pt; });
  });
}
function ring(arcs: Pt[][], idx: number[]): Pt[] {
  const out: Pt[] = [];
  idx.forEach((i, k) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (let j = k ? 1 : 0; j < a.length; j++) out.push(a[j]); });
  return out;
}
/** A geometry as polygons → rings → points. */
export function polygons(arcs: Pt[][], g: TopoGeom): Pt[][][] {
  if (!g.arcs) return [];
  if (g.type === "Polygon") return [(g.arcs as number[][]).map((r) => ring(arcs, r))];
  if (g.type === "MultiPolygon") return (g.arcs as number[][][]).map((p) => p.map((r) => ring(arcs, r)));
  return [];
}
const f = (n: number) => (Math.round(n * 10) / 10).toString();
export function pathD(polys: Pt[][][]): string {
  let d = "";
  for (const p of polys) for (const r of p) { if (r.length < 3) continue; d += "M" + r.map(([x, y]) => f(x) + "," + f(y)).join("L") + "Z"; }
  return d;
}
/** Center of the biggest piece (area-weighted), and that piece's size. */
export function centroid(polys: Pt[][][]): { x: number; y: number; area: number } {
  let best = { x: 0, y: 0, area: 0 };
  for (const p of polys) {
    const r = p[0]; if (!r || r.length < 3) continue;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const k = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += k; cx += (r[j][0] + r[i][0]) * k; cy += (r[j][1] + r[i][1]) * k; }
    a /= 2;
    if (Math.abs(a) > best.area && a !== 0) best = { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
  }
  return best;
}

/* ---------- Albers USA (matches the us-atlas "albers" files) ---------- */
const RAD = Math.PI / 180;
function conicEqualArea(parallels: Pt) {
  const sy0 = Math.sin(parallels[0] * RAD), n = (sy0 + Math.sin(parallels[1] * RAD)) / 2, c = 1 + sy0 * (2 * n - sy0), r0 = Math.sqrt(c) / n;
  return (x: number, y: number): Pt => { const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(y))) / n; const xn = x * n; return [r * Math.sin(xn), r0 - r * Math.cos(xn)]; };
}
function projection(o: { rotate: number; center: Pt; parallels: Pt; scale: number; translate: Pt }) {
  const raw = conicEqualArea(o.parallels);
  const c = raw(o.center[0] * RAD, o.center[1] * RAD);
  return (lon: number, lat: number): Pt => {
    const l = ((((lon + o.rotate + 180) % 360) + 360) % 360) - 180;
    const p = raw(l * RAD, lat * RAD);
    return [o.translate[0] + o.scale * (p[0] - c[0]), o.translate[1] - o.scale * (p[1] - c[1])];
  };
}
const K = 1300, TX = 487.5, TY = 305;
const lower48 = projection({ rotate: 96, center: [-0.6, 38.7], parallels: [29.5, 45.5], scale: K, translate: [TX, TY] });
const alaska = projection({ rotate: 154, center: [-2, 58.5], parallels: [55, 65], scale: K * 0.35, translate: [TX - 0.307 * K, TY + 0.201 * K] });
const hawaii = projection({ rotate: 157, center: [-3, 19.9], parallels: [8, 18], scale: K, translate: [TX - 0.205 * K, TY + 0.212 * K] });
/** Longitude/latitude → the map canvas. */
export function albersUsa(lon: number, lat: number, state?: string): Pt {
  if (state === "AK" || (!state && lat > 50 && lon < -129)) return alaska(lon, lat);
  if (state === "HI" || (!state && lat < 23 && lon < -150)) return hawaii(lon, lat);
  return lower48(lon, lat);
}

/** County / state FIPS → postal code (the 50 states + DC). */
export const FIPS: Record<string, string> = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };
export const US51 = new Set(Object.values(FIPS));

/** A 3-digit ZIP area: where it is on the map and the ZIP we price to. */
export type Zip3 = { zip3: string; st: string; zip: string; city: string; x: number; y: number; zips: number };

/** 3-digit ZIP areas from a ZIP list (lat/lon per ZIP): center of its ZIPs, and the real ZIP closest to that center. */
export function zip3Areas(codes: { zip: string; latitude: number; longitude: number; city: string; state: string }[]): Zip3[] {
  const g = new Map<string, { st: string; pts: { zip: string; city: string; x: number; y: number }[] }>();
  for (const z of codes) {
    if (!US51.has(z.state) || !/^\d{5}$/.test(z.zip) || typeof z.latitude !== "number") continue;
    const [x, y] = albersUsa(z.longitude, z.latitude, z.state);
    const k = z.zip.slice(0, 3);
    const e = g.get(k) || { st: z.state, pts: [] };
    e.pts.push({ zip: z.zip, city: z.city, x, y }); g.set(k, e);
  }
  const out: Zip3[] = [];
  for (const [zip3, e] of g) {
    // the state most of its ZIPs are in
    const cx = e.pts.reduce((a, p) => a + p.x, 0) / e.pts.length, cy = e.pts.reduce((a, p) => a + p.y, 0) / e.pts.length;
    let best = e.pts[0], bd = Infinity;
    for (const p of e.pts) { const d = (p.x - cx) ** 2 + (p.y - cy) ** 2; if (d < bd) { bd = d; best = p; } }
    out.push({ zip3, st: e.st, zip: best.zip, city: best.city, x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10, zips: e.pts.length });
  }
  return out.sort((a, b) => a.zip3.localeCompare(b.zip3));
}
