import type { SupabaseClient } from "@supabase/supabase-js";
import { download, listFolder, type DbxEntry } from "@/lib/dropbox";
import type { SewFile, SewKind } from "@/lib/brands";

/**
 * Portal Quick Drop (Nov 17, Amanda: "a Dropbox folder, like a quick drop, where you can access it and add things if we
 * have like complicated orders like this"). A shared Dropbox folder, "Portal Quick Drop", seen through the portal's
 * Dropbox connection: staff drop a job's files in a folder there (one subfolder per logo: "Anniversary", "Hydraulic"…),
 * and a quick-drop request (table quick_drops, a row Claude or staff add) brings them in. Each sew set, a DST with the
 * EMB and PDF worksheet of the same name, goes onto its logo through the one sew-file setup every place uses
 * (lib/sewAdd.ts addSewFiles: read, renamed for the Tajima, filed as E1, E2…). A logo that isn't on the customer's
 * account yet is made from its EMB's TrueView picture. Running a request again adds only what isn't there yet.
 * The cron route /api/quick-drop runs waiting requests (pg_cron → quick_drop_tick).
 */

export const QUICK_DROP_ROOT = "/Portal Quick Drop";

/** what to do with each logo folder ("Anniversary"): its logo on the account (design_id), or the name to make it by */
export type QuickDropPlan = {
  /** list the folder only: nothing is brought in */ list?: boolean;
  /** another root than /Portal Quick Drop */ root?: string;
  /** the customer's brand the logos are saved under ("RMS" under Cedar Promos), made when it isn't there yet */ brand?: string;
  /** save each logo locked as a master logo (its art set in stone, saved to the account), as on the logo's page */ master?: boolean;
  logos?: Record<string, { design_id?: string; name?: string; kind?: SewKind; /** the sew set whose TrueView is the logo's picture */ picture?: string; skip?: boolean }>;
};
export type QuickDropRow = { id: number; folder: string; customer_id: string | null; order_id: string | null; plan: QuickDropPlan | null; requested_by: string | null };
export type DropSew = { code?: string; file: string; stitches: number; colors: number; wIn: number; hIn: number; threads: string[]; emb: boolean; sheet: boolean };
export type DropLogo = { key: string; design_id: string; number: number; name: string; made: boolean; added: DropSew[]; skipped: string[] };
export type DropResult = { path: string; brand?: { id: string; name: string; made: boolean }; files: { path: string; size: number }[]; logos: DropLogo[]; other: string[]; notes: string[] };

const SEW = /\.(dst|emb|pdf)$/i;
const stem = (n: string) => n.replace(/\.[^.]+$/, "").replace(/\s*(worksheet|sheet)$/i, "").trim().toLowerCase();
const safe = (n: string) => n.replace(/[^\w.-]+/g, "_");

/** the folder's files, grouped by logo: each subfolder is one logo; loose files at the top, one logo per file name */
export function groupDrop(base: string, files: DbxEntry[]): Map<string, DbxEntry[]> {
  const out = new Map<string, DbxEntry[]>();
  const lb = base.toLowerCase().replace(/\/+$/, "");
  for (const f of files) {
    const rel = f.path_lower.startsWith(lb + "/") ? f.path_display.slice(lb.length + 1) : f.path_display;
    const parts = rel.split("/");
    const key = parts.length > 1 ? parts[0] : stem(parts[0]);
    out.set(key, [...(out.get(key) || []), f]);
  }
  return out;
}

async function asFile(admin: SupabaseClient, e: DbxEntry): Promise<File> {
  const { buf } = await download(admin, e.id || e.path_lower);
  return new File([buf], e.name, { type: /\.pdf$/i.test(e.name) ? "application/pdf" : "application/octet-stream" });
}

/** a new logo on the account, its picture the EMB's TrueView (the browser's upload draws it; here the EMB carries it) */
async function makeLogo(admin: SupabaseClient, customerId: string, brandId: string | null, name: string, files: File[], pick: string | undefined, by: string) {
  const { readEmb } = await import("@/lib/embFile");
  const embs = files.filter((f) => /\.emb$/i.test(f.name)).sort((a, b) => (pick && stem(a.name) === pick.toLowerCase() ? -1 : pick && stem(b.name) === pick.toLowerCase() ? 1 : a.name.localeCompare(b.name)));
  let preview_path = "", file_path = "", file_name = "", colors = 1, inks = "";
  const key = crypto.randomUUID();
  for (const e of embs) {
    const info = await readEmb(await e.arrayBuffer()).catch(() => null);
    if (!info?.preview) continue;
    file_path = `designs/${key}/${safe(e.name)}`; file_name = e.name;
    await admin.storage.from("proofs").upload(file_path, e, { contentType: "application/octet-stream" });
    preview_path = `designs/${key}/preview-${safe(e.name.replace(/\.emb$/i, ""))}.jpg`;
    const u = await admin.storage.from("proofs").upload(preview_path, new Blob([info.preview as BlobPart], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    if (u.error) preview_path = "";
    colors = info.ws.threads.length || info.colors || 1;
    inks = info.ws.threads.map((t) => `Madeira ${t.code} ${t.name}`.trim()).join(", ");
    break;
  }
  const { data, error } = await admin.from("designs").insert({
    customer_id: customerId, name, file_path, file_name, file_type: file_name ? "application/octet-stream" : "", preview_path,
    method: "embroidery", colors, inks, created_by: by, saved: true, notes: "From Portal Quick Drop", ...(brandId ? { brand_id: brandId } : {}),
  }).select("id, number, name, specs").single();
  if (error) throw new Error(error.message);
  return data as { id: string; number: number; name: string; specs: Record<string, unknown> };
}

export async function runQuickDrop(admin: SupabaseClient, row: QuickDropRow): Promise<DropResult> {
  const plan = row.plan || {};
  const root = (plan.root || QUICK_DROP_ROOT).replace(/\/+$/, "");
  const path = row.folder.trim() ? `${root}/${row.folder.trim().replace(/^\/+|\/+$/g, "")}` : root;
  const entries = await listFolder(admin, path, true).catch((e) => {
    throw new Error(`Can't open ${path} in the portal's Dropbox (${(e as Error).message.slice(0, 160)}). The folder has to be shared with the account the portal is connected to, and accepted there.`);
  });
  const files = entries.filter((e) => e[".tag"] === "file");
  const res: DropResult = { path, files: files.map((f) => ({ path: f.path_display, size: f.size || 0 })), logos: [], other: [], notes: [] };
  if (plan.list) return res;

  let customerId = row.customer_id;
  if (!customerId && row.order_id) customerId = ((await admin.from("orders").select("customer_id").eq("id", row.order_id).maybeSingle()).data?.customer_id as string) || null;
  if (!customerId) throw new Error("The request needs a customer or an order, so the logos go on the right account.");

  // the brand the logos go under: the customer's brand of that name, or a new one
  let brandId: string | null = null;
  if (plan.brand?.trim()) {
    const bn = plan.brand.trim();
    const { data: b0 } = await admin.from("brands").select("id, name").eq("customer_id", customerId).ilike("name", bn).is("archived_at", null).limit(1);
    let b = (b0 || [])[0] as { id: string; name: string } | undefined, made = false;
    if (!b) {
      const { data: nb, error } = await admin.from("brands").insert({ customer_id: customerId, name: bn }).select("id, name").single();
      if (error) throw new Error(`Couldn't make the brand ${bn}: ${error.message}`);
      b = nb as { id: string; name: string }; made = true;
    }
    brandId = b.id; res.brand = { id: b.id, name: b.name, made };
  }
  const { addSewFiles } = await import("@/lib/sewAdd");
  const { readDst } = await import("@/lib/dst");
  for (const [key, list] of groupDrop(path, files)) {
    const want = plan.logos?.[key] || {};
    const sew = list.filter((f) => SEW.test(f.name));
    res.other.push(...list.filter((f) => !SEW.test(f.name)).map((f) => f.path_display));
    if (want.skip) { res.notes.push(`${key}: skipped (the plan says so)`); continue; }
    if (!sew.some((f) => /\.(dst|emb)$/i.test(f.name))) { if (sew.length) res.other.push(...sew.map((f) => f.path_display)); continue; }
    const got = await Promise.all(sew.map((f) => asFile(admin, f)));
    // the logo: the one the plan names, else the account's logo of that name, else a new one
    const name = (want.name || key).trim();
    type Logo = { id: string; number: number; name: string; specs: Record<string, unknown> };
    let d: Logo | null = null;
    if (want.design_id) d = ((await admin.from("designs").select("id, number, name, specs").eq("id", want.design_id).maybeSingle()).data as Logo | null) || null;
    if (!d) d = (((await admin.from("designs").select("id, number, name, specs").eq("customer_id", customerId).ilike("name", name).is("archived_at", null).order("created_at", { ascending: false }).limit(1)).data || []) as Logo[])[0] || null;
    const made = !d;
    if (!d) d = await makeLogo(admin, customerId, brandId, name, got, want.picture, row.requested_by || "Quick Drop");
    else if (brandId) await admin.from("designs").update({ brand_id: brandId }).eq("id", d.id);
    // a DST already on the logo (same stitch count, size and threads) isn't added again, so a request can run twice; the
    // threads count because one design is often digitized once per thread color (RMS's ANNI01AP / ANNI03AP: same
    // stitches, black or white)
    const have = (((d.specs || {}) as { embroidery?: { files?: SewFile[] } }).embroidery?.files || []);
    const { readEmb } = await import("@/lib/embFile");
    const codes = (ts: { code: string }[] | undefined) => (ts || []).map((t) => t.code).join(",");
    const skipped: string[] = [];
    const keep: File[] = [];
    const dsts = got.filter((f) => /\.dst$/i.test(f.name));
    for (const f of dsts) {
      const i = readDst(await f.arrayBuffer());
      const embF = got.find((g) => /\.emb$/i.test(g.name) && stem(g.name) === stem(f.name));
      const th = embF ? codes((await readEmb(await embF.arrayBuffer()).catch(() => null))?.ws.threads) : "";
      const dup = have.find((h) => !h.embOnly && Math.abs((h.stitches || 0) - i.stitches) <= 1 && Math.abs((h.wIn || 0) - i.wIn) < 0.05
        && (!th || !h.ws?.threads?.length || codes(h.ws.threads) === th));
      if (dup) { skipped.push(`${f.name} (already ${dup.code || dup.name})`); continue; }
      keep.push(f, ...got.filter((g) => g !== f && !/\.dst$/i.test(g.name) && stem(g.name) === stem(f.name)));
    }
    if (!dsts.length) keep.push(...got);
    const added = keep.length ? await addSewFiles(admin, d, keep, { kind: want.kind || "flat" }) : [];
    // locked as a master logo, as the logo page's switch does (saved to the account; its art can't be replaced or deleted)
    if (plan.master) {
      const { data: now } = await admin.from("designs").select("specs").eq("id", d.id).maybeSingle();
      const sp = (now?.specs || {}) as Record<string, unknown>;
      if (!sp.master) await admin.from("designs").update({ saved: true, specs: { ...sp, master: { at: new Date().toISOString(), by: row.requested_by || "Quick Drop" } } }).eq("id", d.id);
    }
    res.logos.push({
      key, design_id: d.id, number: d.number, name: d.name, made, skipped,
      added: added.map((s) => ({ code: s.code, file: s.name, stitches: s.stitches, colors: s.colors, wIn: s.wIn, hIn: s.hIn, threads: (s.ws?.threads || []).map((t) => `${t.code} ${t.name}`.trim()), emb: !!s.emb, sheet: !!s.sheet })),
    });
  }
  return res;
}
