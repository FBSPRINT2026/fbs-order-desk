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
  // each machine file makes a set: the DSTs, or with none, the EMBs (read for their size, stitches, threads and picture)
  const dsts0 = files.filter((f) => /\.dst$/i.test(f.name));
  const dsts = dsts0.length ? dsts0 : files.filter((f) => /\.emb$/i.test(f.name));
  if (!dsts.length) throw new Error("No DST or EMB in those files. The digitizer's zip should have one.");
  // each DST with the EMB and worksheet of the same name; one DST takes everything that came with it
  const sets = dsts.map((dst) => [dst, ...files.filter((f) => f !== dst && !dsts.includes(f) && (dsts.length === 1 || stem(f.name) === stem(dst.name)))]);
  const { data } = await sb.from("designs").select("specs").eq("id", d.id).maybeSingle();
  const sp = (data?.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[] };
  const have = [...(em.files || [])], added: SewFile[] = [], confirmed: SewFile[] = [];
  // a removed file's number isn't used again: the Tajima may still have the old D10316E5 in its memory
  const gone = ((em as { removed?: SewFile[] }).removed || []);
  const { readDst } = await import("@/lib/dst");
  for (const set0 of sets) {
    // a DST for a logo whose file so far is only its EMB (Nov 10, Nick: "embroidery has to confirm the DST… upload it and
    // say this is the right DST"): it confirms that file (same stitches, within 1%), keeping its EMB, number and threads
    const dst0 = set0.find((f) => /\.dst$/i.test(f.name));
    const st0 = dst0 ? await dst0.arrayBuffer().then((b) => readDst(b).stitches).catch(() => 0) : 0;
    const waiting = st0 ? have.findIndex((x) => x.embOnly && Math.abs((x.stitches || 0) - st0) <= Math.max(10, st0 * 0.01)) : -1;
    const code = waiting >= 0 && have[waiting].code ? have[waiting].code! : nextSewCode([...have, ...gone, ...added]), name = tajimaName(d.number, Number(code.slice(1)));
    const named = await Promise.all(set0.map((f) => tajimaFile(f, name)));
    const { set } = await takeDigitized(sb, d.id, named, { link: false });
    if (waiting >= 0) { const w = have[waiting]; have[waiting] = { ...w, ...set, code: w.code, kind: w.kind, placement: w.placement, emb: w.emb || set.emb, ws: set.sheet ? set.ws : w.ws || set.ws, embOnly: false, pic: undefined, confirmedAt: new Date().toISOString() } as SewFile; confirmed.push(have[waiting]); continue; }
    added.push({ ...set, code, kind: o.kind, ...(o.placement?.trim() ? { placement: o.placement.trim() } : {}) });
  }
  const specs = { ...sp, embroidery: { ...em, files: [...have, ...added] } };
  const { error } = await sb.from("designs").update({ specs }).eq("id", d.id);
  if (error) throw new Error(error.message);
  return [...confirmed, ...added];
}

/**
 * Take a sew file off a logo (Oct 31, Nick: "D10316E5 D10316E6 sew files need to be removed… add a remove button"): it
 * leaves the logo's list (no print picks it again) and is kept under specs.embroidery.removed with who and when; its DST,
 * EMB and worksheet stay in storage, and a print that already has it keeps its copy.
 */
export async function removeSewFile(sb: SupabaseClient, designId: string, path: string, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await sb.from("designs").select("specs").eq("id", designId).maybeSingle();
  const sp = (data?.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[]; removed?: (SewFile & { removedAt?: string; removedBy?: string })[] };
  const f = (em.files || []).find((x) => x.path === path);
  if (!f) return { ok: false, error: "That sew file isn't on the logo any more." };
  const specs = { ...sp, embroidery: { ...em, files: (em.files || []).filter((x) => x.path !== path), removed: [...(em.removed || []), { ...f, removedAt: new Date().toISOString(), removedBy: by }] } };
  const { error } = await sb.from("designs").update({ specs }).eq("id", designId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
