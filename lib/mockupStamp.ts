"use client";
import { makePreview, pdfPageTotal } from "./artPrep";

/**
 * A customer's own mockup, kept in the job's Production files as a reference: the picture with "CUSTOMER SUPPLIED
 * MOCKUP" repeated across it in gray, so nobody mistakes it for our mockup (we remake it in the Mockup Creator so
 * the separations and print sizes come from our own). PDFs / AI / HEIC are drawn as pictures, every page of a PDF its
 * own picture (Nick, Nov 16 2026, #50094: a 2-page cart PDF showed only its first page, the OGIO jacket on page 2 never).
 */
export const STAMP_TAG = "Customer mockup";
const TEXT = "CUSTOMER SUPPLIED MOCKUP";

/** a short, stable key for a storage path (the stamped file's name carries it, so it's made once) */
export function stampKey(path: string) {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
/** the stamped file's name: "-l" since the stamp went very light (Oct 31); one stamped before is stamped again once */
export const stampName = (path: string, page = 1) => `custmockup-${stampKey(path)}${page > 1 ? `-p${page}` : ""}-l.jpg`;

export async function stampCustomerMockup(blob: Blob, name: string, page = 1): Promise<File | null> {
  let src: Blob = blob;
  if (!/^image\/(png|jpe?g|webp|gif|bmp)/i.test(blob.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) {
    const prev = await makePreview(new File([blob], name, { type: blob.type }), 2400, page);
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
  // very light (Oct 31, Nick: "we should still be able to see it… very, very light gray"): marked, not covered
  x.strokeStyle = "rgba(255,255,255,0.1)"; x.fillStyle = "rgba(128,128,128,0.11)";
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
  // the same file sent twice (a customer who uploaded it again, Nov 16 2026, #50094) is filed once: its bytes decide
  const seenBytes = new Set<string>();
  const sig = async (b: Blob) => { try { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer())); return `${b.size}:${[...h.slice(0, 12)].join(".")}`; } catch { return `${b.size}`; } };
  for (const m of todo) {
    const key = stampKey(m.path);
    const isPdf = /\.(pdf|ai)$/i.test(m.path);
    const done1 = [...have].some((p) => p.includes(`custmockup-${key}-l`));
    // a PDF stamped before this change has its first page only: its other pages are added now
    if (done1 && (!isPdf || [...have].some((p) => p.includes(`custmockup-${key}-p`)))) continue;
    // stamped before in the darker gray: the same file listing gets the light one (the old picture stays in storage)
    const old = [...have].find((p) => p.includes(`custmockup-${key}.jpg`));
    const { data: blob } = await sb.storage.from("proofs").download(m.path);
    if (!blob) continue;
    const s = await sig(blob);
    if (seenBytes.has(s)) continue;
    seenBytes.add(s);
    // an earlier copy of these same bytes already filed (another upload of it): nothing more to add
    const base = (m.name || "mockup").replace(/\.[^.]+$/, "");
    const pages = isPdf ? Math.min(20, await pdfPageTotal(blob)) : 1;
    if (done1 && pages < 2) continue;
    for (let pg = done1 ? 2 : 1; pg <= pages; pg++) {
      const f = await stampCustomerMockup(blob, m.name || m.path.split("/").pop() || "mockup", pg).catch(() => null);
      if (!f) continue;
      const path = `art/${orderId}/${stampName(m.path, pg)}`;
      if (have.has(path)) continue;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: "image/jpeg", upsert: true });
      if (up.error) continue;
      const nm = `Customer supplied mockup - ${base}${pages > 1 ? ` (page ${pg} of ${pages})` : ""}.jpg`;
      const { error } = pg === 1 && old
        ? await sb.from("art_files").update({ file_path: path }).eq("order_id", orderId).eq("file_path", old)
        : await sb.from("art_files").insert({ order_id: orderId, name: nm, file_path: path, file_type: "image/jpeg", category: "customer_mockup" });
      if (!error) { have.add(path); if (pg === 1 && old) have.delete(old); added++; }
    }
  }
  return added;
}
