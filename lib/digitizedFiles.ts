import type { SupabaseClient } from "@supabase/supabase-js";
import { readDst, type DstInfo } from "@/lib/dst";
import { unzip } from "@/lib/unzip";

/**
 * The files a digitizer sends back (Oct 23, Nick: Volikes Creative's "RUSH Order Gateway Rebrand.zip": the DST for the
 * machine, the EMB to edit in Wilcom, and the PDF production worksheet with the stitch count, size and stop sequence).
 * Dropped in as the zip or the loose files: the DST is read (lib/dst.ts), all three are kept with the logo
 * (designs.specs.embroidery.files) so every reorder of it has them.
 */
export type DigitizedSet = { path: string; name: string; stitches: number; colors: number; wIn: number; hIn: number; at: string;
  /** the editable Wilcom file and the worksheet, when they came with it */ emb?: { path: string; name: string }; sheet?: { path: string; name: string } };

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
export async function takeDigitized(sb: SupabaseClient, designId: string | null, list: File[], o: { save?: boolean } = {}): Promise<{ set: DigitizedSet; info: DstInfo }> {
  const files = await expandFiles(list);
  const dst = files.find((f) => /\.dst$/i.test(f.name));
  if (!dst) throw new Error("No DST in those files. The digitizer's zip should have one (the machine file).");
  const info = readDst(await dst.arrayBuffer());
  const emb = files.find((f) => /\.emb$/i.test(f.name)), sheet = files.find((f) => /\.pdf$/i.test(f.name));
  const at = new Date().toISOString(), stamp = Date.now(), dir = `embroidery/${designId || "loose"}/${stamp}`;
  const up = async (f: File | undefined, type: string) => {
    if (!f || o.save === false) return undefined;
    const path = `${dir}-${safe(f.name)}`;
    const r = await sb.storage.from("proofs").upload(path, f, { contentType: type });
    return r.error ? undefined : { path, name: f.name };
  };
  const d = await up(dst, "application/octet-stream"), e = await up(emb, "application/octet-stream"), s = await up(sheet, "application/pdf");
  const set: DigitizedSet = { path: d?.path || "", name: dst.name, stitches: info.stitches, colors: info.colors, wIn: info.wIn, hIn: info.hIn, at, ...(e ? { emb: e } : {}), ...(s ? { sheet: s } : {}) };
  if (designId && d && o.save !== false) {
    const { data } = await sb.from("designs").select("specs").eq("id", designId).maybeSingle();
    const sp = (data?.specs || {}) as Record<string, unknown>;
    const em = (sp.embroidery || {}) as { files?: unknown[] };
    await sb.from("designs").update({ specs: { ...sp, embroidery: { ...em, files: [set, ...(em.files || [])].slice(0, 10) } } }).eq("id", designId);
  }
  return { set, info };
}
