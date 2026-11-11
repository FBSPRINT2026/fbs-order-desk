/**
 * Reading a Wilcom EMB file, the digitizer's editable file (Nov 10, Nick: "how can we get the portal to read .emb files
 * like dsts"). An EMB is a Microsoft compound file (the same container as old .doc / .xls). Its stitches are in an
 * encrypted stream we can't open, but its open streams carry everything the worksheet would:
 *  - "\u0005WilcomDesignInformationDDD": a property set with the stitch count, the size, the colorway and every color
 *    stop with its thread (code, name, chart) and stitches, the fabric, the backing and the machine format;
 *  - "TRUEVIEW_ICON": Wilcom's TrueView picture of the sewn design (a zlib-packed JPEG);
 *  - "\u0005SummaryInformation": the design's title.
 * So an EMB stands in for the DST's numbers and the worksheet's threads; the DST still runs the machine and draws the
 * stitches (lib/dst.ts). Works in the browser and on the server (no packages).
 */
import type { Stop, Worksheet, SheetThread } from "@/lib/worksheet";

export type EmbInfo = {
  title: string;
  stitches: number; wIn: number; hIn: number;
  colors: number; stops: number; trims: number;
  /** the worksheet the EMB carries: its stop sequence and threads */ ws: Worksheet;
  colorway: string; fabric: string; backing: string; machine: string;
  /** Wilcom's TrueView picture (JPEG bytes), when it has one */ preview: Uint8Array | null;
};

const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffa;

/** the named streams of a compound file */
function compound(buf: ArrayBuffer): Map<string, Uint8Array> {
  const u = new Uint8Array(buf), v = new DataView(buf);
  if (u.length < 512 || SIG.some((b, i) => u[i] !== b)) throw new Error("That isn't an EMB file (not a Wilcom design).");
  const ss = 1 << v.getUint16(30, true), mss = 1 << v.getUint16(32, true);
  const nFat = v.getUint32(44, true), dirStart = v.getUint32(48, true), cutoff = v.getUint32(56, true), miniStart = v.getUint32(60, true);
  const difatStart = v.getUint32(68, true), nDifat = v.getUint32(72, true);
  const sector = (n: number) => u.subarray(512 + n * ss, 512 + (n + 1) * ss);
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) fatSectors.push(v.getUint32(76 + i * 4, true));
  for (let s = difatStart, k = 0; k < nDifat && s < END && fatSectors.length < nFat; k++) {
    const sec = sector(s), dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let i = 0; i < ss / 4 - 1 && fatSectors.length < nFat; i++) fatSectors.push(dv.getUint32(i * 4, true));
    s = dv.getUint32(ss - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSectors) { const sec = sector(s), dv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength); for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(i * 4, true)); }
  const chain = (start: number) => { const out: number[] = []; for (let s = start; s < END && out.length < 1e6; s = fat[s] ?? END) out.push(s); return out; };
  const join = (parts: Uint8Array[]) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const dir = join(chain(dirStart).map(sector));
  const ents: { name: string; type: number; start: number; size: number }[] = [];
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  for (let i = 0; i + 128 <= dir.length; i += 128) {
    const nl = dv.getUint16(i + 64, true);
    let name = ""; for (let k = 0; k + 1 < Math.max(0, nl - 2); k += 2) name += String.fromCharCode(dv.getUint16(i + k, true));
    ents.push({ name, type: dir[i + 66], start: dv.getUint32(i + 116, true), size: dv.getUint32(i + 120, true) });
  }
  const root = ents[0];
  const mini = root ? join(chain(root.start).map(sector)) : new Uint8Array(0);
  const miniFat: number[] = [];
  if (miniStart < END) for (const s of chain(miniStart)) { const sec = sector(s), d2 = new DataView(sec.buffer, sec.byteOffset, sec.byteLength); for (let i = 0; i < ss / 4; i++) miniFat.push(d2.getUint32(i * 4, true)); }
  const out = new Map<string, Uint8Array>();
  for (const e of ents) {
    if (e.type !== 2) continue;
    if (e.size < cutoff) { const parts: Uint8Array[] = []; for (let s = e.start; s < END && parts.length < 1e5; s = miniFat[s] ?? END) parts.push(mini.subarray(s * mss, (s + 1) * mss)); out.set(e.name, join(parts).subarray(0, e.size)); }
    else out.set(e.name, join(chain(e.start).map(sector)).subarray(0, e.size));
  }
  return out;
}

/** a property set's values by id (strings and numbers only) */
function propertySet(b: Uint8Array): Map<number, string | number> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map<number, string | number>();
  if (b.length < 48) return out;
  const off = v.getUint32(44, true), n = v.getUint32(off + 4, true);
  const latin = (a: Uint8Array) => { let s = ""; for (const c of a) { if (!c) break; s += String.fromCharCode(c); } return s; };
  for (let i = 0; i < n && off + 8 + i * 8 + 8 <= b.length; i++) {
    const id = v.getUint32(off + 8 + i * 8, true), p = off + v.getUint32(off + 12 + i * 8, true);
    if (p + 8 > b.length) continue;
    const vt = v.getUint16(p, true);
    if (vt === 30) { const len = v.getUint32(p + 4, true); out.set(id, latin(b.subarray(p + 8, p + 8 + len))); }
    else if (vt === 31) { const len = v.getUint32(p + 4, true); let s = ""; for (let k = 0; k < len; k++) { const c = v.getUint16(p + 8 + k * 2, true); if (!c) break; s += String.fromCharCode(c); } out.set(id, s); }
    else if (vt === 3 || vt === 22 || vt === 23 || vt === 19) out.set(id, v.getInt32(p + 4, true));
    else if (vt === 2) out.set(id, v.getInt16(p + 4, true));
    else if (vt === 4) out.set(id, v.getFloat32(p + 4, true));
    else if (vt === 5) out.set(id, v.getFloat64(p + 4, true));
  }
  return out;
}

/** a zlib-packed stream (4 bytes of unpacked length, then zlib) */
async function unpack(b: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream("deflate");
    const w = ds.writable.getWriter(); void w.write(b.slice(4)); void w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  } catch { return null; }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function readEmb(buf: ArrayBuffer): Promise<EmbInfo> {
  const s = compound(buf);
  const ddd = [...s.entries()].find(([k]) => /WilcomDesignInformation/i.test(k))?.[1];
  if (!ddd) throw new Error("This EMB has no design information (an older Wilcom version?).");
  const p = propertySet(ddd);
  const sum = [...s.entries()].find(([k]) => /SummaryInformation/i.test(k))?.[1];
  const title = String((sum && propertySet(sum).get(2)) || "");
  const num = (id: number) => { const x = p.get(id); return typeof x === "number" ? x : +String(x || 0) || 0; };
  const str = (id: number) => String(p.get(id) ?? "").trim();
  // the color stops, one a line: stop, needle, (empty), stitches, thread length, code, name, chart, …, color
  const seq: Stop[] = str(34).split(/\r?\n/).map((l) => l.split("\t")).filter((c) => c.length >= 8 && /^\d+$/.test(c[0]))
    .map((c) => ({ n: +c[0], needle: +c[1] || +c[0], stitches: +c[3] || 0, code: (c[5] || "").trim(), name: (c[6] || "").trim(), chart: (c[7] || "").trim() || "Default" }));
  const threads: SheetThread[] = [];
  for (const x of seq) {
    const k = threads.find((t) => t.code === x.code && t.chart === x.chart);
    if (k) { k.stitches += x.stitches; k.stops++; } else threads.push({ needle: x.needle, code: x.code, name: x.name, chart: x.chart, stitches: x.stitches, stops: 1 });
  }
  // the size: Wilcom's extents in 1/65536 mm (Richardson Landscape: 7,342,536 × 2,416,199 = 4.41" × 1.45")
  const wIn = r2(num(8) / 65536 / 25.4), hIn = r2(num(9) / 65536 / 25.4);
  const stitches = num(6) || seq.reduce((a, x) => a + x.stitches, 0);
  const ws: Worksheet = { stitches, wIn, hIn, colors: threads.length, changes: Math.max(0, seq.length - 1), stops: seq.length, trims: num(7),
    sequence: seq, threads, real: threads.some((t) => !/^default$/i.test(t.chart)) };
  const tv = s.get("TRUEVIEW_ICON");
  const preview = tv ? await unpack(tv) : null;
  const backing = str(38).replace(/\s+/g, " ").replace(/^Topping:\s*Backing:/i, "Backing:").trim();
  return { title, stitches, wIn, hIn, colors: threads.length, stops: seq.length, trims: num(7), ws,
    colorway: str(33), fabric: str(37), backing, machine: str(19), preview: preview && preview[0] === 0xff && preview[1] === 0xd8 ? preview : null };
}
