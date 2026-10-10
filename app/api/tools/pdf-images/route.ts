import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Troubleshooting (tooling token only): the pictures inside a stored PDF as pdf.js reads them on the server — size,
 * kind (RGB / RGBA) and how much of each is see-through — to check how Illustrator opacity masks come through.
 * ?path=<proofs path>&t=…  (&img=N&part=P returns picture N as a PNG in base64 pieces)
 */
async function pdfjs() {
  // the worker loaded here (and handed to pdf.js) so Vercel packs it with the function
  const w = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = w;
  const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as { getDocument: (o: Record<string, unknown>) => { promise: Promise<{ getPage: (n: number) => Promise<unknown> }> }; OPS: Record<string, number> };
  return m;
}

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const admin = createAdminClient();
  const { data: tk } = await admin.from("integration_tokens").select("data").eq("name", "tooling").maybeSingle();
  const t = (tk?.data || {}) as { token?: string; expires_at?: string };
  if (!t.token || !t.expires_at || t.expires_at < new Date().toISOString() || q.get("t") !== t.token) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const { data: blob } = await admin.storage.from("proofs").download(q.get("path") || "");
  if (!blob) return NextResponse.json({ error: "No file" }, { status: 404 });
  // a stored PNG: how its coverage (alpha) is spread, in buckets of 10%
  if (q.get("alpha")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require("node:zlib") as typeof import("node:zlib");
    const b = Buffer.from(await blob.arrayBuffer());
    let off = 8, w = 0, h = 0, depth = 0, ctype = 0; const idat: Buffer[] = [];
    while (off < b.length) { const len = b.readUInt32BE(off), type = b.toString("ascii", off + 4, off + 8), d = b.subarray(off + 8, off + 8 + len); if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; } else if (type === "IDAT") idat.push(d); off += 12 + len; }
    if (depth !== 8 || ctype !== 6) return NextResponse.json({ w, h, depth, ctype, note: "not 8-bit RGBA" });
    const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let x = 0; x < stride; x++) {
        const a2 = x >= bpp ? out[y * stride + x - bpp] : 0, up = y ? out[(y - 1) * stride + x] : 0, ul = y && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
        const pa = Math.abs(up - ul), pb = Math.abs(a2 - ul), pc = Math.abs(a2 + up - 2 * ul);
        const pred = f === 1 ? a2 : f === 2 ? up : f === 3 ? (a2 + up) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a2 : pb <= pc ? up : ul) : 0;
        out[y * stride + x] = (src[x] + pred) & 255;
      }
    }
    const buckets = new Array(11).fill(0); const colors = new Map<string, number>();
    for (let i = 0; i < w * h; i++) { const al = out[i * 4 + 3]; buckets[Math.round(al / 25.5)]++; if (al > 200) { const k = `${out[i * 4] >> 4},${out[i * 4 + 1] >> 4},${out[i * 4 + 2] >> 4}`; colors.set(k, (colors.get(k) || 0) + 1); } }
    return NextResponse.json({ w, h, alphaBuckets: buckets, topOpaqueColors: [...colors.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6) });
  }
  try {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    const page = await doc.getPage(1) as { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: { get: (id: string, cb?: (v: unknown) => void) => unknown } };
    const ol = await page.getOperatorList();
    const out: { i: number; op: string; id: string; w?: number; h?: number; kind?: number; clear?: number; err?: string }[] = [];
    const imgs: { w: number; h: number; rgba: Uint8Array }[] = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const name = Object.keys(lib.OPS).find((k) => lib.OPS[k] === fn) || String(fn);
      if (!/paintImage|paintInlineImage|paintJpeg|paintSolidColorImageMask|paintImageMask/.test(name)) continue;
      const id = String((ol.argsArray[i] || [])[0] ?? "");
      const row: (typeof out)[number] = { i, op: name, id };
      try {
        const o = await new Promise<{ width: number; height: number; kind: number; data: Uint8Array }>((res, rej) => { const tm = setTimeout(() => rej(new Error("timeout")), 8000); page.objs.get(id, (v) => { clearTimeout(tm); res(v as never); }); });
        row.w = o.width; row.h = o.height; row.kind = o.kind;
        if (o.data) {
          const n = o.width * o.height; let rgba: Uint8Array;
          if (o.kind === 3) rgba = o.data; else if (o.kind === 2) { rgba = new Uint8Array(n * 4); for (let p = 0; p < n; p++) { rgba[p * 4] = o.data[p * 3]; rgba[p * 4 + 1] = o.data[p * 3 + 1]; rgba[p * 4 + 2] = o.data[p * 3 + 2]; rgba[p * 4 + 3] = 255; } } else rgba = new Uint8Array(0);
          if (rgba.length) { let c = 0; for (let p = 0; p < n; p++) if (rgba[p * 4 + 3] < 128) c++; row.clear = Math.round((c / n) * 1000) / 10; imgs.push({ w: o.width, h: o.height, rgba }); }
        }
      } catch (e) { row.err = e instanceof Error ? e.message : String(e); }
      out.push(row);
    }
    if (q.get("img") != null) {
      const im = imgs[+(q.get("img") || 0)]; if (!im) return NextResponse.json({ error: "no such picture" });
      const b64 = png(im.w, im.h, im.rgba).toString("base64"), size = 60_000, part = +(q.get("part") || 0);
      return new NextResponse(`${part}|${Math.ceil(b64.length / size)}|${b64.slice(part * size, (part + 1) * size)}`, { headers: { "content-type": "text/plain" } });
    }
    return NextResponse.json({ images: out });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.stack || e.message : String(e) }); }
}
