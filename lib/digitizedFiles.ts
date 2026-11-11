import type { SupabaseClient } from "@supabase/supabase-js";
import { readDst, type DstInfo } from "@/lib/dst";
import { unzip } from "@/lib/unzip";
import { parseWorksheet, type Worksheet } from "@/lib/worksheet";

/**
 * The files a digitizer sends back (Oct 23, Nick: Volikes Creative's "RUSH Order Gateway Rebrand.zip": the DST for the
 * machine, the EMB to edit in Wilcom, and the PDF production worksheet with the stitch count, size and stop sequence).
 * Dropped in as the zip or the loose files: the DST is read (lib/dst.ts), all three are kept with the logo
 * (designs.specs.embroidery.files) so every reorder of it has them.
 */
export type DigitizedSet = { path: string; name: string; stitches: number; colors: number; wIn: number; hIn: number; at: string;
  /** the editable Wilcom file and the worksheet, when they came with it */ emb?: { path: string; name: string }; sheet?: { path: string; name: string };
  /** what the worksheet says: the totals and the stop sequence (needle, thread, stitches at each stop) */ ws?: Worksheet;
  /** only the EMB came (no DST): path is the EMB; the picture is Wilcom's TrueView (pic). The DST is still needed to sew */ embOnly?: boolean; pic?: { path: string } };

/** the files, with any zip opened up */
export async function expandFiles(list: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of list) {
    if (/\.zip$/i.test(f.name) || f.type === "application/zip") out.push(...(await unzip(f)));
    else out.push(f);
  }
  return out;
}

const safe = (n: string) => n.replace(/[^\w.-]+/g, "_");
export async function takeDigitized(sb: SupabaseClient, designId: string | null, list: File[], o: { save?: boolean; /** false: the caller files the set on the logo itself (with its code, E1/E2), so it isn't added twice */ link?: boolean } = {}): Promise<{ set: DigitizedSet; info: DstInfo }> {
  const files = await expandFiles(list);
  const dst = files.find((f) => /\.dst$/i.test(f.name));
  const emb = files.find((f) => /\.emb$/i.test(f.name)), sheet = files.find((f) => /\.pdf$/i.test(f.name));
  if (!dst && !emb) throw new Error("No DST or EMB in those files. The digitizer's zip should have one.");
  // the EMB is read too (lib/embFile.ts, Nov 10): its threads stand in for a missing worksheet, and with no DST its size,
  // stitches and TrueView picture make the sew file on their own
  const { readEmb } = await import("@/lib/embFile");
  const embInfo = emb ? await readEmb(await emb.arrayBuffer()).catch(() => null) : null;
  if (!dst && !embInfo) throw new Error("Couldn't read that EMB (an older Wilcom file?). Add its DST.");
  const info: DstInfo = dst ? readDst(await dst.arrayBuffer())
    : { name: embInfo!.title || emb!.name, stitches: embInfo!.stitches, sewn: embInfo!.stitches, changes: Math.max(0, embInfo!.stops - 1), colors: embInfo!.colors, jumps: 0, trims: embInfo!.trims, wIn: embInfo!.wIn, hIn: embInfo!.hIn, header: {}, blocks: [] };
  const at = new Date().toISOString(), stamp = Date.now(), dir = `embroidery/${designId || "loose"}/${stamp}`;
  const up = async (f: File | undefined, type: string) => {
    if (!f || o.save === false) return undefined;
    const path = `${dir}-${safe(f.name)}`;
    const r = await sb.storage.from("proofs").upload(path, f, { contentType: type });
    return r.error ? undefined : { path, name: f.name };
  };
  const d = await up(dst, "application/octet-stream"), e = await up(emb, "application/octet-stream"), s = await up(sheet, "application/pdf");
  // the TrueView picture, when there's no DST to draw the stitches from
  const pic = !dst && embInfo?.preview && o.save !== false ? await (async () => { const path = `${dir}-trueview.jpg`; const r = await sb.storage.from("proofs").upload(path, new Blob([embInfo.preview as BlobPart], { type: "image/jpeg" }), { contentType: "image/jpeg" }); return r.error ? undefined : { path }; })() : undefined;
  // the worksheet's stop sequence: which thread sews at each of the DST's stops (the DST itself only has the stops); the
  // EMB carries the same sequence when no worksheet came
  let ws: Worksheet | null = null;
  if (sheet) {
    try { const { pdfText } = await import("@/lib/printavoArt"); ws = parseWorksheet(await pdfText(await sheet.arrayBuffer())); } catch { ws = null; }
  }
  if (!ws && embInfo?.ws.sequence.length) ws = embInfo.ws;
  const main = dst ? d : e;
  const set: DigitizedSet = { path: main?.path || "", name: (dst || emb)!.name, stitches: info.stitches, colors: ws?.threads.length || info.colors, wIn: info.wIn, hIn: info.hIn, at, ...(e ? { emb: e } : {}), ...(s ? { sheet: s } : {}), ...(ws ? { ws } : {}), ...(pic ? { pic } : {}), ...(!dst ? { embOnly: true } : {}) };
  if (designId && d && o.save !== false && o.link !== false) {
    const { data } = await sb.from("designs").select("specs").eq("id", designId).maybeSingle();
    const sp = (data?.specs || {}) as Record<string, unknown>;
    const em = (sp.embroidery || {}) as { files?: unknown[] };
    await sb.from("designs").update({ specs: { ...sp, embroidery: { ...em, files: [set, ...(em.files || [])].slice(0, 10) } } }).eq("id", designId);
  }
  return { set, info };
}
