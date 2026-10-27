import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readDst } from "@/lib/dst";
import { guessProdKind } from "@/lib/productionFileKinds";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * An old Printavo job's files, read (Oct 27, Nick: "pull the files off 33145… show me how you can display a DST").
 * From our own copies (the Printavo import copied every file into storage); Printavo's file store is read only for a
 * file that never copied, and never changed. Each DST is read (lib/dst.ts): its
 * stitches, colors, size and the stitch path, so it can be drawn. With `orderId` and `save`, the files are copied into
 * that order's production files. Staff, or the shop's sync token (for jobs run from the database).
 */
type PvFile = { id?: string; name?: string; full?: string; mime?: string };

export async function POST(req: Request) {
  const admin = createAdminClient();
  const v = await getViewer().catch(() => null);
  let ok = !!(v?.user && v.isStaff);
  if (!ok) { const { data: s } = await admin.from("printavo_sync").select("token").eq("id", 1).single(); ok = !!s && req.headers.get("x-sync-token") === s.token; }
  if (!ok) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { visual?: string; orderId?: string; save?: boolean; only?: string; points?: number };
  const visual = String(b.visual || "").replace(/\D/g, "");
  if (!visual) return NextResponse.json({ error: "Which Printavo job?" }, { status: 400 });
  const { data: a } = await admin.from("archived_orders").select("visual_id, nickname, data, files").eq("visual_id", visual).maybeSingle();
  if (!a) return NextResponse.json({ error: `Printavo #${visual} isn't in the archive.` }, { status: 404 });
  const d = (a.data || {}) as { files?: PvFile[]; productionFiles?: PvFile[] };
  let files = [...(d.files || []), ...(d.productionFiles || [])].filter((f) => f.full && /^https:\/\//.test(f.full));
  if (b.only) { const re = new RegExp(b.only.replace(/[^\w.|*-]/g, ""), "i"); files = files.filter((f) => re.test(f.name || "")); }
  const maxPts = Math.min(20000, Math.max(200, b.points || 4000));
  const out: Record<string, unknown>[] = [];
  for (const f of files.slice(0, 20)) {
    const name = String(f.name || "file").slice(0, 160);
    // our own copy (every Printavo file was copied into storage: archived_orders.files, link → path); Printavo's file
    // store only when a file never copied
    const ours = ((a.files || {}) as Record<string, string>)[f.full!];
    let buf: ArrayBuffer | null = null;
    if (ours && !["failed", "too-big"].includes(ours)) { const { data: blob } = await admin.storage.from("proofs").download(ours); if (blob) buf = await blob.arrayBuffer(); }
    if (!buf) { const r = await fetch(f.full!).catch(() => null); if (r?.ok) buf = await r.arrayBuffer(); }
    if (!buf) { out.push({ name, error: "couldn't open it" }); continue; }
    const row: Record<string, unknown> = { name, bytes: buf.byteLength, from: ours && !["failed", "too-big"].includes(ours) ? "our storage" : "Printavo" };
    if (/\.dst$/i.test(name)) {
      try {
        const info = readDst(buf);
        // the stitch path, thinned to about maxPts points (each color its own list; jumps kept so the drawing lifts)
        const total = info.blocks.reduce((n, x) => n + x.length, 0), step = Math.max(1, Math.ceil(total / maxPts));
        row.dst = { name: info.name, stitches: info.stitches, sewn: info.sewn, colors: info.colors, changes: info.changes, jumps: info.jumps, trims: info.trims, wIn: info.wIn, hIn: info.hIn, header: info.header,
          blocks: info.blocks.map((bl) => bl.filter((p, i) => p.jump || i % step === 0 || i === bl.length - 1).map((p) => [p.x, p.y, p.jump ? 1 : 0])) };
      } catch (e) { row.error = `not a readable DST: ${e instanceof Error ? e.message : e}`; }
    }
    if (b.save && b.orderId) {
      const path = `art/${b.orderId}/${Date.now().toString(36)}-${name.replace(/[^\w.\- ]+/g, "_")}`;
      const up = await admin.storage.from("proofs").upload(path, Buffer.from(buf), { contentType: f.mime && f.mime !== "text/plain" ? f.mime : "application/octet-stream" });
      if (!up.error) {
        await admin.from("art_files").insert({ order_id: b.orderId, name, file_path: path, file_type: f.mime || "application/octet-stream", category: guessProdKind(name) || null, note: `From Printavo #${visual}` });
        row.saved = path;
      } else row.saveError = up.error.message;
    }
    out.push(row);
  }
  return NextResponse.json({ visual, nickname: a.nickname, files: out });
}
