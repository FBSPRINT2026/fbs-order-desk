import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDst } from "@/lib/dst";
import { parseWorksheet } from "@/lib/worksheet";
import { pdfTextServer } from "@/lib/pdfTextServer";
import { nextSewCode, type SewFile } from "@/lib/brands";
import type { Group } from "@/lib/pricing";

/**
 * The digitizer's files added on their own (Oct 28, Nick: "we got digitized files back from Volikes… you should be
 * looking at Amanda's email and automatically pulling in those files and adding them to the digitizing page… move it
 * to need sew out"). The mail check catches their reply (lib/mail/process.ts digitizerReply) and calls this for each
 * logo the request was for; the cron sweep (sweepDigitizerReplies) picks up any reply that came before this existed.
 *
 * For each logo: its DST (with the EMB and worksheet of the same name), read like a file dropped on Digitizing
 * (lib/digitizedFiles.ts takeDigitized): copied to the logo, its size and stitches read, the worksheet's threads read,
 * kept on the logo as its next sew file (E1, E2…), and the order's print takes the stitch count. One reply for several
 * logos is split by name (the D-number, the location or the logo's name in the file name). The logo then shows under
 * Needs sew-out. Nothing is sent to anyone.
 */
type RFile = { name: string; path: string; type: string; size: number };
type Reply = { at: string; from: string; subject: string; files: RFile[]; order_id?: string; imprint_id?: string; activity?: string; added_at?: string; add_error?: string };
const base = (n: string) => n.replace(/\.[^.]+$/, "").trim().toLowerCase();
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** the reply's files that belong to this logo (all of them when only one DST came) */
function filesFor(files: RFile[], d: { number: number | null; name: string }, location: string, others: number): RFile[] {
  const dsts = files.filter((f) => /\.dst$/i.test(f.name));
  if (dsts.length <= 1 && others <= 1) return files;
  const num = d.number ? String(d.number) : "", loc = words(location), nm = words(d.name || "");
  const score = (f: RFile) => { const w = words(f.name); return (num && w.includes(num) ? 4 : 0) + (loc && w.includes(loc) ? 2 : 0) + (nm && nm.length > 3 && w.includes(nm) ? 1 : 0); };
  const best = dsts.map((f) => ({ f, s: score(f) })).sort((a, b) => b.s - a.s)[0];
  if (!best || best.s === 0) return [];
  const b = base(best.f.name);
  return files.filter((f) => base(f.name) === b);
}

export async function addReplyFiles(admin: SupabaseClient, designId: string, opts: { others?: number } = {}): Promise<{ ok: boolean; note: string }> {
  const { data: d } = await admin.from("designs").select("id, number, name, specs").eq("id", designId).maybeSingle();
  if (!d) return { ok: false, note: "no logo" };
  const sp = (d.specs || {}) as Record<string, unknown>, emb = (sp.embroidery || {}) as { files?: SewFile[]; reply?: Reply | null };
  const reply = emb.reply;
  if (!reply?.files?.length || reply.added_at) return { ok: false, note: "nothing to add" };
  const { data: o } = reply.order_id ? await admin.from("orders").select("id, groups").eq("id", reply.order_id).maybeSingle() : { data: null };
  const im = ((o?.groups || []) as Group[]).flatMap((g) => g.imprints || []).find((x) => x.id === reply.imprint_id);
  const mine = filesFor(reply.files, { number: d.number as number | null, name: String(d.name || "") }, im?.location || "", opts.others ?? 1);
  const dst = mine.find((f) => /\.dst$/i.test(f.name));
  const mark = async (extra: Record<string, unknown>) => {
    const { data: fresh } = await admin.from("designs").select("specs").eq("id", designId).maybeSingle();
    const s2 = (fresh?.specs || {}) as Record<string, unknown>, e2 = (s2.embroidery || {}) as Record<string, unknown>;
    await admin.from("designs").update({ specs: { ...s2, embroidery: { ...e2, ...extra, reply: { ...((e2.reply || {}) as object), ...(extra.reply as object || {}) } } } }).eq("id", designId);
  };
  if (!dst) { await mark({ reply: { add_error: "No DST for this logo in their reply: add it by hand" } }); return { ok: false, note: "no DST" }; }
  const dl = async (p: string) => { const { data } = await admin.storage.from("proofs").download(p); return data ? new Uint8Array(await data.arrayBuffer()) : null; };
  const buf = await dl(dst.path);
  if (!buf) return { ok: false, note: "couldn't open the DST" };
  const info = readDst(buf.slice().buffer);
  const stamp = Date.now(), dir = `embroidery/${designId}/${stamp}`;
  const copy = async (f: RFile | undefined) => {
    if (!f) return undefined;
    const to = `${dir}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const r = await admin.storage.from("proofs").copy(f.path, to);
    return r.error ? undefined : { path: to, name: f.name };
  };
  const b = base(dst.name);
  const embF = mine.find((f) => /\.emb$/i.test(f.name) && base(f.name) === b) || mine.find((f) => /\.emb$/i.test(f.name));
  const sheetF = mine.find((f) => /\.pdf$/i.test(f.name) && base(f.name) === b) || mine.find((f) => /\.pdf$/i.test(f.name));
  const [dp, ep, shp] = await Promise.all([copy(dst), copy(embF), copy(sheetF)]);
  if (!dp) return { ok: false, note: "couldn't save the DST" };
  let ws = null;
  if (sheetF) { const sb = await dl(sheetF.path); if (sb) ws = parseWorksheet(await pdfTextServer(sb).catch(() => "")); }
  const files = emb.files || [];
  const set: SewFile = { path: dp.path, name: dst.name, stitches: info.stitches, colors: ws?.threads.length || info.colors, wIn: info.wIn, hIn: info.hIn, at: new Date().toISOString(),
    ...(ep ? { emb: ep } : {}), ...(shp ? { sheet: shp } : {}), ...(ws ? { ws } : {}), code: nextSewCode(files), kind: "flat", ...(im?.location ? { placement: im.location } : {}) };
  await mark({ files: [...files, set], reply: { added_at: new Date().toISOString(), add_error: undefined } });
  // the order's print takes the file's stitch count (its price follows), like a file dropped on Digitizing
  if (o && im) {
    const groups = ((o.groups || []) as Group[]).map((g) => ({ ...g, imprints: (g.imprints || []).map((x) => (x.id === im.id ? { ...x, stitches: info.stitches, emb: { ...(x.emb || {}), stitchesFrom: "file" as const, file: set } } : x)) }));
    await admin.from("orders").update({ groups }).eq("id", o.id);
  }
  return { ok: true, note: `${dst.name}: ${info.wIn}" × ${info.hIn}", ${info.stitches.toLocaleString()} stitches` };
}

/** replies that came in but were never added (before this existed, or a hiccup): added now. Run by the mail check. */
export async function sweepDigitizerReplies(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("designs").select("id, specs").not("specs->embroidery->reply", "is", null).limit(200);
  // not added yet: a first file, or the fixed one after "Send back for changes" (request.changes)
  const due = ((data || []) as { id: string; specs: { embroidery?: { reply?: Reply; files?: unknown[]; request?: { changes?: string } | null } } }[])
    .filter((x) => { const e = x.specs?.embroidery, r = e?.reply; return r?.files?.length && !r.added_at && !r.add_error && (!(e?.files || []).length || !!e?.request?.changes); });
  // how many logos share each reply (one reply for several logos is split by name)
  const per = new Map<string, number>();
  for (const x of due) { const k = x.specs.embroidery?.reply?.activity || x.id; per.set(k, (per.get(k) || 0) + 1); }
  let n = 0;
  for (const x of due.slice(0, 10)) {
    const r = await addReplyFiles(admin, x.id, { others: per.get(x.specs.embroidery?.reply?.activity || x.id) || 1 }).catch(() => ({ ok: false }));
    if (r.ok) n++;
  }
  return n;
}
