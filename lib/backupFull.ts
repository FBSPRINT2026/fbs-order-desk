import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dropboxConfigured, uploadFile } from "@/lib/dropbox";

/**
 * A full copy of the database, built in rounds (each call works ~4 minutes, then the next call carries on).
 * Used by the owner's Restore point button (/api/backup/full) and the weekly backup (/api/cron/backup, Nov 9 2026:
 * "a physical copy as a redundancy… just use Dropbox").
 *   <table>.ndjson.gz (or <table>-N.ndjson.gz)  every row, one JSON row per line
 *   manifest.json   tables, row counts and a SHA-256 checksum per file;  README.txt  what it is and how to restore
 * The files go to the private "backups" bucket, then (when Dropbox is connected) to Dropbox /Portal backups/<stamp>/,
 * so a copy lives outside Supabase; with the Dropbox app on a computer that folder also lands on a local drive.
 *
 * Every table is included by itself (backup_tables() lists them, with their primary key and row size): a table added
 * next month is in next week's backup without anyone listing it. Left out by name, as a rule, not one by one:
 * sign-in sessions and short-lived locks (nothing to restore), caches (rebuilt by themselves), and stored keys and
 * tokens (app connections are re-made by signing in again; secrets don't go into a file copy).
 */
export const SKIP_RULE = /(_sessions?|_locks?|_cache|(^|_)tokens?|(^|_)keys?|(^|_)secrets?)$/;
const PART_ROWS = 4000;
const BUDGET_MS = 230_000;
export const DROPBOX_ROOT = "/Portal backups";

type TableInfo = { name: string; pk: string | null; avg_bytes: number; est_rows: number };
type FileRec = { path: string; name: string; bytes: number; rows: number; sha256: string; table: string };
export type Manifest = {
  kind: "full"; made?: string; folder: string; label?: string; done: string[]; files: FileRec[]; rows: Record<string, number>;
  skipped: string[]; tables?: string[]; cur?: { table: string; after?: Record<string, unknown> | null; part: number; total: number; from?: number } | null;
};
type Row = { id: string; folder: string; status: string; manifest: Manifest; dropbox?: { copied?: string[]; done?: boolean; error?: string; root?: string } };

/** rows per database request: about 1.5 MB a page, so tables with big rows don't time out */
const pageFor = (t: TableInfo) => Math.max(50, Math.min(1000, Math.floor(1_500_000 / Math.max(1, t.avg_bytes))));

export async function tableList(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("backup_tables");
  if (error) throw new Error("backup_tables: " + error.message);
  const all = (data || []) as TableInfo[];
  return { take: all.filter((t) => !SKIP_RULE.test(t.name)), skipped: all.filter((t) => SKIP_RULE.test(t.name)).map((t) => t.name) };
}

export async function startBackup(admin: SupabaseClient, who: string, label: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const folder = `full/${stamp}`;
  const { take, skipped } = await tableList(admin);
  const manifest: Manifest = { kind: "full", folder, label: label.slice(0, 120), done: [], files: [], rows: {}, skipped, tables: take.map((t) => t.name) };
  const { data, error } = await admin.from("data_backups").insert({ kind: "full", folder, created_by: who, status: "building", manifest }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Couldn't start the backup.");
  return data.id as string;
}

export async function loadBackup(admin: SupabaseClient, id: string) {
  const { data } = await admin.from("data_backups").select("id, folder, status, manifest, dropbox").eq("id", id).eq("kind", "full").maybeSingle();
  return (data as Row | null) || null;
}

/** one round of saving tables; returns where it got to */
async function backupRound0(admin: SupabaseClient, id: string, who: string) {
  const t0 = Date.now();
  const row = await loadBackup(admin, id);
  if (!row) throw new Error("That backup wasn't found.");
  const m = row.manifest;
  const { take } = await tableList(admin);
  // the tables chosen when it started (a table added part way through waits for next week)
  const info = new Map(take.map((t) => [t.name, t]));
  const names = (m.tables || take.map((t) => t.name)).filter((n) => info.has(n));
  if (row.status === "done") return { id, status: "done" as const, done: m.done.length, total: names.length };
  try {
    for (const table of names) {
      if (m.done.includes(table)) continue;
      if (Date.now() - t0 > BUDGET_MS) break;
      const t = info.get(table)!;
      // read in primary-key order after the last row read (backup_page: keys of any number of columns, fast at any
      // depth; a table without a key pages by position), in parts of 4,000 rows. A table that runs past this round's
      // time picks up where it stopped (m.cur) on the next round
      const keys = t.pk ? t.pk.split(",") : [], page = pageFor(t);
      const cur = m.cur?.table === table ? m.cur : null;
      let from = cur?.from || 0, part = cur?.part || 1, buf: unknown[] = [], total = cur?.total || 0;
      let after: Record<string, unknown> | null = (cur?.after as Record<string, unknown> | undefined) ?? null;
      const files: FileRec[] = [];
      const flush = async (final: boolean) => {
        if (!buf.length && (part > 1 || !final)) return;
        const name = part === 1 && final && buf.length < PART_ROWS ? `${table}.ndjson.gz` : `${table}-${part}.ndjson.gz`;
        const gz = gzipSync(Buffer.from(buf.map((r) => JSON.stringify(r)).join("\n") + (buf.length ? "\n" : ""), "utf8"));
        const path = `${m.folder}/${name}`;
        const up = await admin.storage.from("backups").upload(path, gz, { contentType: "application/gzip", upsert: true });
        if (up.error) throw new Error(`${table}: ${up.error.message}`);
        files.push({ path, name, bytes: gz.length, rows: buf.length, sha256: createHash("sha256").update(gz).digest("hex"), table });
        part++; buf = [];
      };
      let finished = false;
      for (;;) {
        const { data, error } = await admin.rpc("backup_page", { tbl: table, after, n: page, skip: from });
        if (error) throw new Error(`${table}: ${error.message}`);
        const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
        buf.push(...rows); total += rows.length; from += rows.length;
        if (rows.length && keys.length) { const l = rows[rows.length - 1]; after = Object.fromEntries(keys.map((k) => [k, l[k]])); }
        if (buf.length >= PART_ROWS) await flush(false);
        if (rows.length < page) { finished = true; break; }
        if (Date.now() - t0 > BUDGET_MS) break;
      }
      if (!finished) {
        await flush(false);
        m.files = [...m.files, ...files];
        m.cur = { table, after, part, total, from };
        await admin.from("data_backups").update({ manifest: m, error: null }).eq("id", id);
        break;
      }
      await flush(true);
      m.files = [...m.files.filter((f) => f.table !== table || (cur && f.name !== `${table}.ndjson.gz` && files.every((x) => x.path !== f.path))), ...files];
      m.rows = { ...m.rows, [table]: total };
      m.done = [...m.done, table];
      m.cur = null;
      await admin.from("data_backups").update({ manifest: m, error: null }).eq("id", id);
    }
    const left = names.filter((n) => !m.done.includes(n));
    if (left.length) return { id, status: "building" as const, done: m.done.length, total: names.length, next: left[0] };
    m.made = new Date().toISOString();
    const rowsAll = Object.values(m.rows).reduce((x, y) => x + y, 0);
    const readme = [
      "FBS Order Desk: full copy of the database (every table)",
      `Made ${m.made} by ${who}. Folder: ${m.folder}`,
      m.label ? `Label: ${m.label}` : "",
      "",
      `${m.done.length} tables, ${rowsAll.toLocaleString()} rows. Each <table>.ndjson.gz (or <table>-N.ndjson.gz) holds one full row per line, as JSON.`,
      "manifest.json lists every file with its table, row count and SHA-256 checksum (check: sha256sum <file>).",
      `Not included: ${m.skipped.join(", ")}.`,
      "(Sign-in sessions, locks and caches have nothing to restore; stored keys and tokens are re-made by connecting the app again.)",
      "Staff sign-ins (Supabase Auth) and the artwork / mockup / proof files in storage are not in this package.",
      "",
      "SENSITIVE: this includes customer details, pay rates and PIN hashes. Keep it somewhere private.",
      "",
      "To restore a table: load its rows back with the Supabase service key, e.g. for each line",
      "  insert into public.<table> select * from json_populate_record(null::public.<table>, '<line>'::json)",
      "  on conflict do nothing;  (or upsert to put changed rows back). Do it in a quiet moment, owner present.",
      "For the whole database at a moment in time, Supabase's Point-in-Time Recovery is quicker (owner, from the dashboard).",
    ].filter((x, i, xs) => x !== "" || xs[i - 1] !== "").join("\n");
    const put = async (name: string, text: string, type: string) => admin.storage.from("backups").upload(`${m.folder}/${name}`, Buffer.from(text, "utf8"), { contentType: type, upsert: true });
    await put("manifest.json", JSON.stringify(m, null, 1), "application/json");
    await put("README.txt", readme, "text/plain");
    await admin.from("data_backups").update({ manifest: m, status: "done", finished_at: new Date().toISOString() }).eq("id", id);
    return { id, status: "done" as const, done: m.done.length, total: names.length, rows: rowsAll };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("data_backups").update({ manifest: m, error: msg.slice(0, 500) }).eq("id", id);
    throw new Error(msg);
  }
}

/** one round of copying a finished backup's files to Dropbox (only what isn't there yet) */
async function dropboxRound0(admin: SupabaseClient, id: string) {
  const t0 = Date.now();
  const row = await loadBackup(admin, id);
  if (!row || row.status !== "done") return { copied: 0, left: -1, done: false };
  if (!dropboxConfigured()) return { copied: 0, left: -1, done: false, error: "Dropbox isn't set up" };
  const d = row.dropbox || {};
  const copied = new Set(d.copied || []);
  const stamp = row.folder.split("/").pop();
  const root = `${DROPBOX_ROOT}/${stamp}${row.manifest.label ? " " + row.manifest.label.replace(/[\\/:*?"<>|]/g, "").slice(0, 40) : ""}`;
  const want = [...row.manifest.files.map((f) => f.name), "manifest.json", "README.txt"];
  let n = 0;
  try {
    for (const name of want) {
      if (copied.has(name)) continue;
      if (Date.now() - t0 > BUDGET_MS) break;
      const { data, error } = await admin.storage.from("backups").download(`${row.folder}/${name}`);
      if (error || !data) throw new Error(`${name}: ${error?.message || "missing"}`);
      await uploadFile(admin, `${root}/${name}`, new Uint8Array(await data.arrayBuffer()));
      copied.add(name); n++;
      await admin.from("data_backups").update({ dropbox: { copied: [...copied], root } }).eq("id", id);
    }
    const left = want.filter((x) => !copied.has(x)).length;
    await admin.from("data_backups").update({ dropbox: { copied: [...copied], root, done: left === 0 } }).eq("id", id);
    return { copied: n, left, done: left === 0, root };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("data_backups").update({ dropbox: { copied: [...copied], root, error: msg.slice(0, 300) } }).eq("id", id);
    return { copied: n, left: want.length - copied.size, done: false, error: msg };
  }
}

/** One round at a time per backup (Nov 12 night: two rounds of one backup ran together, a cron and a page, or a page
 *  twice, and the second saved its manifest over the first's, losing tables). A round claims the backup for a bit over
 *  its time budget (data_backups.round_until, migration 311); another call meanwhile does nothing and says so. */
async function withLease<T>(admin: SupabaseClient, id: string, busy: T, fn: () => Promise<T>): Promise<T> {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("data_backups").update({ round_until: new Date(Date.now() + BUDGET_MS + 90_000).toISOString() }).eq("id", id).or(`round_until.is.null,round_until.lt.${now}`).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) return busy;
  try { return await fn(); } finally { await admin.from("data_backups").update({ round_until: null }).eq("id", id); }
}
export async function backupRound(admin: SupabaseClient, id: string, who: string) {
  const busy = { id, status: "building" as const, busy: true, done: 0, total: 0 } as unknown as Awaited<ReturnType<typeof backupRound0>>;
  return withLease(admin, id, busy, () => backupRound0(admin, id, who));
}
export async function dropboxRound(admin: SupabaseClient, id: string) {
  const busy = { copied: 0, left: 1, done: false, busy: true } as unknown as Awaited<ReturnType<typeof dropboxRound0>>;
  return withLease(admin, id, busy, () => dropboxRound0(admin, id));
}
