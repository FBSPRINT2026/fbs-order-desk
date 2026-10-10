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
