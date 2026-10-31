import type { SupabaseClient } from "@supabase/supabase-js";
import { nextSewCode, tajimaName, type SewFile, type SewKind } from "@/lib/brands";
import type { Design } from "@/lib/pricing";

/** a digitizer's file renamed for the Tajima (D10316E5.DST, its EMB, "D10316E5 worksheet.pdf"); a DST's own header name too */
export async function tajimaFile(f: File, code: string): Promise<File> {
  const ext = (f.name.match(/\.[^.]+$/)?.[0] || "").toUpperCase();
  const buf = new Uint8Array(await f.arrayBuffer());
  if (ext === ".DST" && String.fromCharCode(buf[0], buf[1], buf[2]) === "LA:") buf.set(new TextEncoder().encode(code.padEnd(16, " ").slice(0, 16)), 3);
  return new File([buf], `${code}${ext === ".PDF" ? " worksheet.pdf" : ext}`, { type: f.type || "application/octet-stream" });
}

/**
 * Sew files onto a logo (Oct 31, Nick: "add these embroidery files to the MEI logo… these are specifically for sewing a
 * bag"): every DST dropped in, each with its own EMB and worksheet (matched by file name: MEI01AB.DST, .EMB, .pdf), is
 * its own sew file E5, E6…, named for the Tajima, for the kind of goods picked (a bag group sews the Bag files). One
 * helper for every place sew files are added (the logo's page, the customer's brands).
 */
export async function addSewFiles(sb: SupabaseClient, d: Pick<Design, "id" | "number" | "specs">, list: File[], o: { kind: SewKind; placement?: string }): Promise<SewFile[]> {
  const { expandFiles, takeDigitized } = await import("@/lib/digitizedFiles");
  const files = await expandFiles(list);
  const stem = (n: string) => n.replace(/\.[^.]+$/, "").replace(/\s*(worksheet|sheet)$/i, "").trim().toLowerCase();
  const dsts = files.filter((f) => /\.dst$/i.test(f.name));
  if (!dsts.length) throw new Error("No DST in those files. The digitizer's zip should have one (the machine file).");
  // each DST with the EMB and worksheet of the same name; one DST takes everything that came with it
  const sets = dsts.map((dst) => [dst, ...files.filter((f) => f !== dst && !/\.dst$/i.test(f.name) && (dsts.length === 1 || stem(f.name) === stem(dst.name)))]);
  const { data } = await sb.from("designs").select("specs").eq("id", d.id).maybeSingle();
  const sp = (data?.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[] };
  const have = [...(em.files || [])], added: SewFile[] = [];
  for (const set0 of sets) {
    const code = nextSewCode([...have, ...added]), name = tajimaName(d.number, Number(code.slice(1)));
    const named = await Promise.all(set0.map((f) => tajimaFile(f, name)));
    const { set } = await takeDigitized(sb, d.id, named, { link: false });
    added.push({ ...set, code, kind: o.kind, ...(o.placement?.trim() ? { placement: o.placement.trim() } : {}) });
  }
  const specs = { ...sp, embroidery: { ...em, files: [...have, ...added] } };
  const { error } = await sb.from("designs").update({ specs }).eq("id", d.id);
  if (error) throw new Error(error.message);
  return added;
}
