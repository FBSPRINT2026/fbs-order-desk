"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Design } from "@/lib/pricing";
import { cropFileToArt, makePreview } from "@/lib/artPrep";
import { checkSameArt } from "@/lib/sameArt";
import { pickArtboard } from "@/lib/artboards";

/** Files the browser can draw as a preview. AI / EPS / PDF originals need a separate preview image. */
export const PREVIEWABLE = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i;
export const DESIGN_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd,.dst,.emb,.heic,.heif,.tif,.tiff,.bmp";

function imageSize(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 }); URL.revokeObjectURL(url); };
    img.onerror = () => { res(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

const safe = (n: string) => n.replace(/[^\w.\-]+/g, "_");

/** Upload customer art as a new design (original file + preview) and return the saved record. */
export async function uploadDesign(sb: SupabaseClient, opts: { file: File; preview?: File | null; customer_id: string | null; name?: string; colors?: number; inks?: string; notes?: string; method?: string; by?: string;
  /** saved to the customer's logos (their library: Artwork → Saved logos) because someone chose to (Oct 31, Nick);
   *  else it lives in the background with the mockups and orders that use it */ saved?: boolean; /** made by the portal for an order: kept out of the customer's library until the order is sent or approved (migration 166) */ draft?: boolean;
  /** a distressed logo's clean picture (Distress: off), and what the distress is (Oct 22: Peticolas' mask, 3 layers on the film) */ clean?: File | null; distress?: { mask?: string; layers?: number; fit?: "cover" | "stretch"; note?: string };
  /** the files that came with a DST or EMB (its worksheet PDF, the EMB): picked together, or found by name (sewMates) */ with?: File[] }): Promise<Design> {
  // a DST names no colors: its worksheet (or EMB) says which thread sews each stop (Nov 20 2026, A Banner Co's westwood
  // came in seven made-up colors). The ones picked with it, else the customer's files with the same name (sewMates)
  let mates: File[] = (opts.with || []).filter((f) => f !== opts.file && /\.(pdf|emb|dst)$/i.test(f.name));
  let stopHex: string[] | null = null;
  if (/\.dst$/i.test(opts.file.name) && !opts.preview) {
    if (!mates.length && opts.customer_id) mates = await sewMates(sb, opts.customer_id, opts.file.name).catch(() => []);
    const ws = await worksheetOf(mates).catch(() => null);
    if (ws?.sequence.length) {
      const { stopColors } = await import("./needleThreads");
      const { sheetThreadName } = await import("./worksheet");
      stopHex = stopColors(ws, "");
      const names = ws.threads.map((x) => sheetThreadName(x));
      opts = { ...opts, method: opts.method || "embroidery", colors: names.length, inks: opts.inks || names.join(", ") };
    }
  }
  // an EMB alone is a digitized logo (lib/embFile.ts reads it; Nick, Nov 10 + Nov 16 2026: "I just selected the
  // Perkins.emb, and it's just not doing anything"): its TrueView picture is the logo's picture, and the EMB is filed on
  // the logo as its sew file (size, stitches, threads) below
  if (/\.emb$/i.test(opts.file.name) && !opts.preview) {
    const { readEmb } = await import("./embFile");
    const info = await readEmb(await opts.file.arrayBuffer()).catch(() => null);
    if (!info) throw new Error("Couldn't read that EMB (an older Wilcom file?). Upload its DST or a picture of the logo.");
    const pic = info.preview ? new File([info.preview as BlobPart], opts.file.name.replace(/\.emb$/i, "") + ".jpg", { type: "image/jpeg" }) : null;
    opts = { ...opts, method: opts.method || "embroidery", colors: opts.colors || info.colors, ...(pic ? { preview: pic } : {}) };
  }
  // a file with several artboards: which logo is it? (lib/artboards.ts; Oct 27, Nick)
  if (!opts.preview && !opts.clean) opts = { ...opts, file: await pickArtboard(opts.file) };
  // a see-through logo with empty space around it is saved cropped to the art, so it scales to its real print size
  if (!opts.preview) { const cropped = await cropFileToArt(opts.file); if (cropped) opts = { ...opts, file: cropped }; }
  // the same logo already on their account? ask before making another art number (lib/sameArt.ts; Oct 24, Nick)
  let artHashV: string | null = null;
  if (opts.customer_id && !opts.draft && !opts.preview && !opts.clean) {
    const chk = await checkSameArt(opts.file, PREVIEWABLE.test(opts.file.type) ? opts.file : null, opts.name || opts.file.name.replace(/\.[^.]+$/, ""), opts.customer_id, { colorways: true });
    if (chk.use) return chk.use.design as unknown as Design;
    if (chk.colorwayOf) return addColorway(sb, chk.colorwayOf.design as unknown as Design, opts.file, { name: opts.name, inks: opts.inks });
    artHashV = chk.hash;
  }
  const key = crypto.randomUUID();
  const orig = `designs/${key}/${safe(opts.file.name)}`;
  const up = await sb.storage.from("proofs").upload(orig, opts.file, { contentType: opts.file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  // files a browser can't draw (PDF, AI, HEIC, TIFF…) get a PNG preview made automatically when none was given
  // and cropped to the art (Oct 16, Nick: a PDF logo came in as the whole page, the art small in the middle)
  const made0 = !PREVIEWABLE.test(opts.file.type) && !opts.preview ? await makePreview(opts.file, 2400, 1, stopHex) : null;
  const made = made0 ? (await cropFileToArt(made0)) || made0 : null;
  // a preview that was handed in wins (the shirt designer saves an SVG with a PNG preview)
  const pv = opts.preview && PREVIEWABLE.test(opts.preview.type) ? opts.preview : PREVIEWABLE.test(opts.file.type) ? opts.file : made;
  let preview_path = "";
  if (pv === opts.file) preview_path = orig;
  else if (pv) {
    preview_path = `designs/${key}/preview-${safe(pv.name)}`;
    const u2 = await sb.storage.from("proofs").upload(preview_path, pv, { contentType: pv.type });
    if (u2.error) preview_path = "";
  }
  const dims = pv ? await imageSize(pv) : null;
  // a distress layer in the file (Oct 16): the logo is marked distressed (brand standards can print those as a fashion hit)
  // and a clean picture without it, for "Distress: off" in the Mockup Creator (the distress stays a layer, on or off)
  let distressed = false, cleanPreview = "";
  if (/pdf/i.test(opts.file.type) || /\.(pdf|ai)$/i.test(opts.file.name)) {
    try {
      const { parsePdf, browserInflate } = await import("./pdfVector");
      const v = await parsePdf(new Uint8Array(await opts.file.arrayBuffer()), browserInflate);
      distressed = !!v.distress?.length;
      if (distressed && v.shapes.length) {
        const { vartFile } = await import("./artPrep");
        const f0 = await vartFile({ ...v, distress: undefined }, 2400, "clean.png"), f = f0 ? (await cropFileToArt(f0)) || f0 : null;
        if (f) { const path = `designs/${key}/clean-${safe(opts.file.name.replace(/\.[^.]+$/, ""))}.png`; const u = await sb.storage.from("proofs").upload(path, f, { contentType: "image/png" }); if (!u.error) cleanPreview = path; }
      }
    } catch { /* not readable as shapes */ }
  }
  // handed a clean picture (the Helper's distressed art): the distress is a layer, on or off
  if (opts.clean) {
    const path = `designs/${key}/clean-${safe(opts.clean.name.replace(/\.[^.]+$/, ""))}.png`;
    const u = await sb.storage.from("proofs").upload(path, opts.clean, { contentType: opts.clean.type || "image/png" });
    if (!u.error) { distressed = true; cleanPreview = path; }
  }
  const { data, error } = await sb.from("designs").insert({
    customer_id: opts.customer_id, name: (opts.name || opts.file.name.replace(/\.[^.]+$/, "")).trim(),
    file_path: orig, file_name: opts.file.name, file_type: opts.file.type || "", preview_path,
    width_px: dims?.w || null, height_px: dims?.h || null, method: opts.method || "screen",
    colors: opts.colors || 1, inks: opts.inks || "", notes: opts.notes || "", created_by: opts.by || "", draft: !!opts.draft, saved: !!opts.saved && !opts.draft,
    ...(artHashV ? { art_hash: artHashV } : {}),
    ...(distressed ? { specs: { distressed: true, distressLayer: true, ...(cleanPreview ? { cleanPreview } : {}), ...(opts.distress ? { distress: opts.distress } : {}) } } : {}),
  }).select("*").single();
  if (error) throw new Error(error.message);
  // a DST uploaded as the logo is its sew file too: read (size, stitches) and kept on the logo like a digitizer's file
  if (/\.(dst|emb)$/i.test(opts.file.name)) {
    try {
      const { takeDigitized } = await import("@/lib/digitizedFiles");
      await takeDigitized(sb, (data as Design).id, [opts.file, ...mates]);
      const { data: again } = await sb.from("designs").select("*").eq("id", (data as Design).id).single();
      if (again) return again as Design;
    } catch { /* the logo is saved; the sew file can be added on Digitizing */ }
  }
  return data as Design;
}

/** Replace a design's preview image (keeps the original file). */
export async function setDesignPreview(sb: SupabaseClient, d: Design, f0: File): Promise<Design> {
  // cropped to the art, like every other way a logo's picture is made (Nov 10, Nick on #40503: "the art isn't getting
  // clipped right… because we use the order helper": a PDF made into a logo on the server got its picture here, in the
  // Mockup Creator, as the whole page, so the art sat small in a big empty box on the shirt)
  const f = (await cropFileToArt(f0).catch(() => null)) || f0;
  const path = `designs/${d.id}-${crypto.randomUUID().slice(0, 8)}/preview-${safe(f.name)}`;
  const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type });
  if (up.error) throw new Error(up.error.message);
  const dims = await imageSize(f);
  const { data, error } = await sb.from("designs").update({ preview_path: path, width_px: dims?.w || null, height_px: dims?.h || null, art_box: null, specs: { ...(d.specs || {}), cropped: true } }).eq("id", d.id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Design;
}

/**
 * The same logo in other colors, kept on the logo as a colorway (Oct 28, Nick: "if we bring it in again and it's like a
 * different color, you can say like add colorway… blue on a white, and then we did blue… you can see all those different
 * colorways"): its file and picture go on the logo's specs.colorways; the logo keeps its number.
 */
export async function addColorway(sb: SupabaseClient, d: Design, f: File, o: { name?: string; inks?: string } = {}): Promise<Design> {
  const key = `designs/${d.id}-cw-${crypto.randomUUID().slice(0, 8)}`;
  const orig = `${key}/${safe(f.name)}`;
  const up = await sb.storage.from("proofs").upload(orig, f, { contentType: f.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const pv = PREVIEWABLE.test(f.type) ? f : await makePreview(f);
  let preview = pv === f ? orig : "";
  if (pv && pv !== f) { const p2 = `${key}/preview-${safe(pv.name)}`; if (!(await sb.storage.from("proofs").upload(p2, pv, { contentType: pv.type })).error) preview = p2; }
  const { data: fresh } = await sb.from("designs").select("specs, name").eq("id", d.id).maybeSingle();
  const sp = ((fresh?.specs ?? d.specs) || {}) as Record<string, unknown>;
  const list = ((sp.colorways || []) as { name: string }[]);
  const nm = o.name && o.name.trim() && o.name.trim().toLowerCase() !== String(fresh?.name || d.name).trim().toLowerCase() ? o.name.trim() : `Colorway ${list.length + 1}`;
  const cw = { name: nm, inks: (o.inks || "").split(/\s*,\s*/).filter(Boolean), ...(preview ? { preview } : {}), file: { path: orig, name: f.name } };
  const { data, error } = await sb.from("designs").update({ specs: { ...sp, colorways: [...list, cw] } }).eq("id", d.id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Design;
}

/**
 * New art for a logo that's already on file (Oct 28, Nick: "D-10251… that's just the DST. Now let's go in and pull the
 * vector file… you got to be able to do this in reverse… that adds to the group D10251"): the file becomes the logo's
 * art and picture; the old ones are kept on the logo (specs.previous), its number, sew files and history stay.
 */
export async function setLogoArt(sb: SupabaseClient, d: Design, f: File): Promise<Design> {
  // a master logo's art is set in stone (the database refuses too)
  const { data: m } = await sb.from("designs").select("specs").eq("id", d.id).maybeSingle();
  if ((m?.specs as { master?: unknown } | null)?.master) throw new Error(`D-${d.number} is a master logo: its art can't be replaced. Unlock it on its page first (Settings → User Access says who can).`);
  const key = `designs/${d.id}-${crypto.randomUUID().slice(0, 8)}`;
  const orig = `${key}/${safe(f.name)}`;
  const up = await sb.storage.from("proofs").upload(orig, f, { contentType: f.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const pv = PREVIEWABLE.test(f.type) ? f : await makePreview(f);
  let preview_path = pv === f ? orig : "";
  if (pv && pv !== f) { const p2 = `${key}/preview-${safe(pv.name)}`; if (!(await sb.storage.from("proofs").upload(p2, pv, { contentType: pv.type })).error) preview_path = p2; }
  const dims = pv ? await imageSize(pv) : null;
  const sp = (d.specs || {}) as Record<string, unknown>;
  const previous = [...((sp.previous || []) as unknown[]), { file_path: d.file_path, file_name: d.file_name, file_type: d.file_type, preview_path: d.preview_path, at: new Date().toISOString() }];
  const { data, error } = await sb.from("designs").update({ file_path: orig, file_name: f.name, file_type: f.type || "", ...(preview_path ? { preview_path } : {}), width_px: dims?.w || null, height_px: dims?.h || null, specs: { ...sp, previous } }).eq("id", d.id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Design;
}

/** Signed links for design previews, keyed by design id. */
const cwName = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export { printArtUrl, hasColorwayArt } from "@/lib/brands";

export async function previewUrls(sb: SupabaseClient, list: Design[]): Promise<Record<string, string>> {
  const withPv = list.filter((d) => d.preview_path);
  // and each background's own picture (Edit logo → Backgrounds), keyed by its path
  const bgPaths = [...list.flatMap((d) => ((d.specs?.onShirts || []) as { path?: string }[]).map((b) => b.path || "").filter(Boolean)),
    // and the clean picture of a distressed logo (Distress: off)
    ...list.map((d) => (d.specs?.cleanPreview as string | undefined) || "").filter(Boolean)];
  if (!withPv.length && !bgPaths.length) return {};
  const { data } = await sb.storage.from("proofs").createSignedUrls([...withPv.map((d) => d.preview_path), ...bgPaths], 3600);
  const out: Record<string, string> = {};
  (data || []).forEach((r, i) => { if (r.signedUrl) out[i < withPv.length ? withPv[i].id : bgPaths[i - withPv.length]] = r.signedUrl; });
  for (const d of list) { const cp = d.specs?.cleanPreview as string | undefined; if (cp && out[cp]) out[d.id + ":clean"] = out[cp]; }
  // a brand logo's colorways (lib/brands.ts): each version's own picture, keyed "<id>:ink:<its inks>" (a color change
  // tile shows the logo in the thread it changes to, Oct 27)
  // and by its name, "<id>:cw:<name>" (a print switched to that colorway: printArtUrl)
  const cws = list.flatMap((d) => (((d.specs as { colorways?: { name?: string; inks?: string[]; preview?: string }[] } | null)?.colorways) || []).filter((c) => c.preview).map((c) => ({ id: d.id, key: (c.inks || []).join(", ").toLowerCase(), name: cwName(c.name), path: c.preview! })));
  if (cws.length) {
    const { data: cu } = await sb.storage.from("proofs").createSignedUrls(cws.map((c) => c.path), 3600);
    cws.forEach((c, i) => { const u = cu?.[i]?.signedUrl; if (!u) return; if (c.key) out[`${c.id}:ink:${c.key}`] = u; if (c.name) out[`${c.id}:cw:${c.name}`] = u; });
  }
  return out;
}

/**
 * Logos whose picture still has empty space around the art (PDF / .ai pictures made before Oct 16 were the whole page):
 * cropped to the art once, the new picture saved, the logo marked so it isn't checked again. Returns the logos changed.
 */
export async function cropPreviews(sb: SupabaseClient, list: Design[], max = 30): Promise<Design[]> {
  const todo = list.filter((d) => d.preview_path && !d.archived_at && !d.specs?.cropped && /\.png$/i.test(d.preview_path)).slice(0, max);
  const out: Design[] = [];
  for (const d of todo) {
    try {
      const { data: blob } = await sb.storage.from("proofs").download(d.preview_path);
      if (!blob) continue;
      const cropped = await cropFileToArt(new File([blob], "preview.png", { type: "image/png" }));
      const specs = { ...(d.specs || {}), cropped: true };
      if (!cropped) { await sb.from("designs").update({ specs }).eq("id", d.id); continue; }
      const path = `designs/${d.id}-${crypto.randomUUID().slice(0, 8)}/preview-cropped.png`;
      const up = await sb.storage.from("proofs").upload(path, cropped, { contentType: "image/png" });
      if (up.error) continue;
      const dims = await imageSize(cropped);
      // the original file stays as it is; only the picture (what the cards, mockups and separations show) is cropped
      const patch = { preview_path: path, width_px: dims?.w || d.width_px, height_px: dims?.h || d.height_px, art_box: null, specs };
      const { error } = await sb.from("designs").update(patch).eq("id", d.id);
      if (!error) out.push({ ...d, ...patch } as Design);
    } catch { /* leave it as it is */ }
  }
  return out;
}


/** a sew file's name without its extension and the digitizer's stamps ("DO-5868_westwood_20261119171356_a93afc1c" → "do-5868_westwood") */
export const sewStem = (n: string) => { let x = n.replace(/\.[^.]+$/, "").toLowerCase(); for (let i = 0; i < 4; i++) x = x.replace(/[ _.-]+(?:[0-9a-f]{6,}|\d{4,})$/i, ""); return x; };

/**
 * The files that go with a sew file, found by name among what the customer sent (Nov 20 2026): email attachments
 * (emails/<customer>/…) and portal uploads (requests/<customer>/<order>/…) whose name matches the DST's once the
 * digitizer's date and code stamps are off ("…_20261119171402_3b4a1c2a.pdf" and "…_20261119171356_a93afc1c.DST").
 */
export async function sewMates(sb: SupabaseClient, customerId: string, fileName: string): Promise<File[]> {
  const stem = sewStem(fileName), own = fileName.toLowerCase();
  if (stem.length < 3) return [];
  const out: File[] = [];
  const look = async (dir: string) => {
    const { data } = await sb.storage.from("proofs").list(dir, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    for (const o of data || []) {
      const n = o.name.replace(/^[a-z0-9]{6,10}-/i, ""); // emails/… names carry a short prefix
      if (!/\.(pdf|emb)$/i.test(n) || n.toLowerCase() === own || sewStem(n) !== stem) continue;
      if (out.some((f) => f.name.toLowerCase().slice(-4) === n.toLowerCase().slice(-4))) continue; // the newest of each kind
      const { data: b } = await sb.storage.from("proofs").download(`${dir}/${o.name}`);
      if (b) out.push(new File([b], n, { type: /\.pdf$/i.test(n) ? "application/pdf" : "application/octet-stream" }));
    }
  };
  await look(`emails/${customerId}`);
  if (!out.length) {
    const { data: ods } = await sb.storage.from("proofs").list(`requests/${customerId}`, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
    for (const d of (ods || []).slice(0, 10)) { await look(`requests/${customerId}/${d.name}`); if (out.length) break; }
  }
  return out;
}

/** the worksheet among a sew file's companions (its PDF), else the EMB's own sequence */
async function worksheetOf(files: File[]) {
  const sheet = files.find((f) => /\.pdf$/i.test(f.name)), emb = files.find((f) => /\.emb$/i.test(f.name));
  const { parseWorksheet } = await import("./worksheet");
  if (sheet) { try { const { pdfText } = await import("./printavoArt"); const ws = parseWorksheet(await pdfText(await sheet.arrayBuffer())); if (ws?.sequence.length) return ws; } catch { /* the EMB below */ } }
  if (emb) { const { readEmb } = await import("./embFile"); const e = await readEmb(await emb.arrayBuffer()).catch(() => null); if (e?.ws.sequence.length) return e.ws; }
  return null;
}
