"use client";
import { makePreview } from "./artPrep";

/**
 * A customer's own mockup, kept in the job's Production files as a reference: the picture with "CUSTOMER SUPPLIED
 * MOCKUP" repeated across it in gray, so nobody mistakes it for our mockup (we remake it in the Mockup Creator so
 * the separations and print sizes come from our own). PDFs / AI / HEIC are drawn from their first page first.
 */
export const STAMP_TAG = "Customer mockup";
const TEXT = "CUSTOMER SUPPLIED MOCKUP";

/** a short, stable key for a storage path (the stamped file's name carries it, so it's made once) */
export function stampKey(path: string) {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export const stampName = (path: string) => `custmockup-${stampKey(path)}.jpg`;

export async function stampCustomerMockup(blob: Blob, name: string): Promise<File | null> {
  let src: Blob = blob;
  if (!/^image\/(png|jpe?g|webp|gif|bmp)/i.test(blob.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) {
    const prev = await makePreview(new File([blob], name, { type: blob.type }));
    if (!prev) return null;
    src = prev;
  }
  const bmp = await createImageBitmap(src).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  // the words, repeated on a slant across the whole picture: gray with a faint light edge so they read on dark shirts too
  const fs = Math.max(14, Math.round(Math.min(c.width, c.height) / 16));
  x.save();
  x.translate(c.width / 2, c.height / 2);
  x.rotate(-Math.PI / 7);
  x.font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  x.textBaseline = "middle";
  const tw = x.measureText(TEXT).width, gapX = tw + fs * 2, gapY = fs * 3, R = Math.hypot(c.width, c.height);
  x.lineJoin = "round"; x.lineWidth = Math.max(2, fs / 9);
  x.strokeStyle = "rgba(255,255,255,0.28)"; x.fillStyle = "rgba(96,96,96,0.34)";
  for (let row = 0, y = -R / 2; y < R / 2; y += gapY, row++) {
    for (let xx = -R / 2 - (row % 2 ? gapX / 2 : 0); xx < R / 2; xx += gapX) { x.strokeText(TEXT, xx, y); x.fillText(TEXT, xx, y); }
  }
  x.restore();
  const out = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.88));
  return out ? new File([out], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : null;
}

type SB = import("@supabase/supabase-js").SupabaseClient;

/**
 * Stamp every customer mockup on an order and put it in the order's Production notes & files (the side panel,
 * `art_files`), skipping ones already there. Returns how many were added. Used right after Inbox → Create order,
 * and again whenever the order is opened.
 * Also moves what was first filed under the bottom "Production files & notes" (job_files, tags "Customer mockup" /
 * "Customer files", Oct 7) into that panel.
 */
export async function stampOrderMockups(sb: SB, orderId: string, groups: { customerMockups?: { path: string; name: string }[] }[]): Promise<number> {
  const { data: af } = await sb.from("art_files").select("file_path").eq("order_id", orderId);
  const have = new Set(((af || []) as { file_path: string }[]).map((x) => x.file_path));
  let added = 0;
  // files filed under job_files earlier today: same storage file, listed in the side panel instead
  const { data: jf } = await sb.from("job_files").select("id, tag, file_name, file_path, file_type").eq("order_id", orderId).eq("archived", false).in("tag", [STAMP_TAG, "Customer files"]);
  for (const f of (jf || []) as { id: string; tag: string; file_name: string; file_path: string; file_type: string }[]) {
    if (!f.file_path) continue;
    if (!have.has(f.file_path)) {
      const { error } = await sb.from("art_files").insert({ order_id: orderId, name: f.tag === STAMP_TAG ? `Customer supplied mockup.jpg` : f.file_name, file_path: f.file_path, file_type: f.file_type });
      if (error) continue;
      have.add(f.file_path); added++;
    }
    await fetch("/api/jobs/files", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, archived: true }) }).catch(() => null);
  }
  const todo = groups.flatMap((g) => g.customerMockups || []);
  for (const m of todo) {
    const key = stampKey(m.path);
    if ([...have].some((p) => p.includes(`custmockup-${key}`))) continue;
    const { data: blob } = await sb.storage.from("proofs").download(m.path);
    if (!blob) continue;
    const f = await stampCustomerMockup(blob, m.name || m.path.split("/").pop() || "mockup").catch(() => null);
    if (!f) continue;
    const path = `art/${orderId}/${stampName(m.path)}`;
    const up = await sb.storage.from("proofs").upload(path, f, { contentType: "image/jpeg", upsert: true });
    if (up.error) continue;
    const base = (m.name || "mockup").replace(/\.[^.]+$/, "");
    const { error } = await sb.from("art_files").insert({ order_id: orderId, name: `Customer supplied mockup - ${base}.jpg`, file_path: path, file_type: "image/jpeg" });
    if (!error) { have.add(path); added++; }
  }
  return added;
}
