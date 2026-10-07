import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Restore point: every table in the database, saved as plain files in the private "backups" bucket
 * (folder full/<time>/), to download and keep. Made first on Oct 7, 2026, before customers started moving off
 * Printavo (code: branch release/v1.0-before-customer-move; deployment dpl_47JZgoLFSn59vPRyhnTvABSkAcxk).
 *   <table>.ndjson.gz (or <table>-2.ndjson.gz … for big ones)  every row, one JSON row per line
 *   manifest.json   tables, row counts and a SHA-256 checksum per file
 *   README.txt      what it is and how to restore
 * Artwork and other files stay where they are in storage (nothing in the move deletes them); they're not copied.
 * POST builds it in rounds (each call works ~4 minutes; the page calls again until it's done). Owner only.
 */

/** table → its primary key columns (rows are read in that order, 1,000 at a time) */
const TABLES: Record<string, string> = {
  settings: "id", staff: "email", customers: "id", customer_private: "customer_id", customer_contacts: "id",
  orders: "id", order_internal: "order_id", order_events: "id", order_goods: "order_id", payments: "id", payment_notices: "id",
  proofs: "id", messages: "id", art_files: "id", job_files: "id", mockups: "id", designs: "id", separations: "id",
  sep_feedback: "id", sep_lessons: "id", activities: "id", ai_suggestions: "id", ai_runs: "id",
  garments: "id", sanmar_styles: "style", sanmar_sync: "id", supplier_accounts: "id", supplier_manifest_lines: "id",
  blank_orders: "id", blank_shipments: "id", goods_checkins: "id", goods_shipments: "id", shipments: "id",
  ship_transit: "state,carrier,service", ship_transit_zip3: "zip3,carrier,service", ship_zip3: "zip3",
  production_slots: "id", production_slot_log: "id", production_days_off: "id", production_extra_shifts: "id",
  production_equipment: "machine", production_equipment_log: "id", production_holds: "id", press_actuals: "id",
  print_jobs: "id", print_relays: "id", job_assignments: "id", job_time: "id",
  ink_formulas: "id", stock_inks: "id", ink_counts: "id", ink_batches: "id",
  projects: "id", project_tasks: "id", programs: "id", program_items: "id",
  merch_stores: "id", merch_products: "id", merch_orders: "id", merch_order_items: "id",
  employees: "id", employee_pay: "employee_id", employee_pins: "employee_id", shifts: "id", time_punches: "id",
  time_off: "id", time_periods: "starts_on", timeclock_devices: "id", uattend_sync: "id",
  mail_accounts: "id", mail_senders: "email", mail_sync: "id", ui_translations: "lang,src", data_backups: "id",
  printavo_sync: "id", printavo_customers: "printavo_id", printavo_index: "printavo_id", printavo_census: "printavo_id",
  archived_orders: "id",
};
/** left out on purpose: sign-in sessions and the sync's short-lived locks (nothing to restore) */
const SKIPPED = ["employee_sessions", "printavo_sync_locks"];
const PART_ROWS = 4000;
const BUDGET_MS = 230_000;

type Row = { id: string; folder: string; status: string; manifest: Manifest };
type FileRec = { path: string; name: string; bytes: number; rows: number; sha256: string; table: string };
type Manifest = { kind: "full"; made?: string; folder: string; done: string[]; files: FileRec[]; rows: Record<string, number>; skipped: string[] };

async function owner() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const admin = createAdminClient();
  const { data: me } = await admin.from("staff").select("role").ilike("email", v.email).maybeSingle();
  return me?.role === "owner" ? { admin, who: v.email as string } : null;
}

export async function GET() {
  const a = await owner();
  if (!a) return NextResponse.json({ error: "Only the owner can see restore points." }, { status: 403 });
  const { data } = await a.admin.from("data_backups").select("*").eq("kind", "full").order("created_at", { ascending: false }).limit(10);
  const out: Record<string, unknown>[] = [];
  for (const b of data || []) {
    const m = (b.manifest || {}) as Partial<Manifest>;
    const files = (m.files || []).concat(b.status === "done" ? [{ path: `${b.folder}/manifest.json`, name: "manifest.json", bytes: 0, rows: 0, sha256: "", table: "" }, { path: `${b.folder}/README.txt`, name: "README.txt", bytes: 0, rows: 0, sha256: "", table: "" }] : []);
    const links: { name: string; bytes: number; url: string }[] = [];
    if (b.status === "done") {
      const { data: s } = await a.admin.storage.from("backups").createSignedUrls(files.map((f) => f.path), 3600);
      files.forEach((f, i) => { if (s?.[i]?.signedUrl) links.push({ name: f.name, bytes: f.bytes, url: s[i].signedUrl }); });
    }
    out.push({ id: b.id, status: b.status, created_at: b.created_at, finished_at: b.finished_at, created_by: b.created_by, error: b.error, label: (m as { label?: string }).label || "", tables: Object.keys(TABLES).length, done: (m.done || []).length, rows: Object.values(m.rows || {}).reduce((x, y) => x + y, 0), links });
  }
  return NextResponse.json({ backups: out });
}

export async function POST(req: Request) {
  const a = await owner();
  if (!a) return NextResponse.json({ error: "Only the owner can make a restore point." }, { status: 403 });
  const { admin } = a;
  const body = await req.json().catch(() => ({}));
  const t0 = Date.now();
  let id = typeof body.id === "string" ? body.id : "";
  let row: Row | null = null;
  if (id) {
    const { data } = await admin.from("data_backups").select("id, folder, status, manifest").eq("id", id).eq("kind", "full").maybeSingle();
    row = (data as Row | null) || null;
    if (!row) return NextResponse.json({ error: "That restore point wasn't found." }, { status: 404 });
    if (row.status === "done") return NextResponse.json({ id, status: "done", done: row.manifest.done.length, total: Object.keys(TABLES).length });
  } else {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const folder = `full/${stamp}`;
    const manifest = { kind: "full", folder, done: [], files: [], rows: {}, skipped: SKIPPED, label: String(body.label || "").slice(0, 120) } as Manifest & { label: string };
    const { data, error } = await admin.from("data_backups").insert({ kind: "full", folder, created_by: a.who, status: "building", manifest }).select("id, folder, status, manifest").single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Couldn't start the backup." }, { status: 500 });
    row = data as Row; id = row.id;
  }
  const m = row!.manifest;
  try {
    for (const table of Object.keys(TABLES)) {
      if (m.done.includes(table)) continue;
      if (Date.now() - t0 > BUDGET_MS) break;
      // read the whole table in key order, 1,000 rows a page; write it in parts of 4,000 rows
      const keys = TABLES[table].split(",");
      let from = 0, part = 1, buf: unknown[] = [], total = 0;
      const files: FileRec[] = [];
      const flush = async () => {
        if (!buf.length && part > 1) return;
        const name = part === 1 && buf.length < PART_ROWS ? `${table}.ndjson.gz` : `${table}-${part}.ndjson.gz`;
        const gz = gzipSync(Buffer.from(buf.map((r) => JSON.stringify(r)).join("\n") + (buf.length ? "\n" : ""), "utf8"));
        const path = `${m.folder}/${name}`;
        const up = await admin.storage.from("backups").upload(path, gz, { contentType: "application/gzip", upsert: true });
        if (up.error) throw new Error(`${table}: ${up.error.message}`);
        files.push({ path, name, bytes: gz.length, rows: buf.length, sha256: createHash("sha256").update(gz).digest("hex"), table });
        part++; buf = [];
      };
      for (;;) {
        let q = admin.from(table).select("*");
        for (const k of keys) q = q.order(k, { ascending: true });
        const { data, error } = await q.range(from, from + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        const rows = data || [];
        buf.push(...rows); total += rows.length; from += rows.length;
        if (buf.length >= PART_ROWS) await flush();
        if (rows.length < 1000) break;
      }
      await flush();
      m.files = [...m.files.filter((f) => f.table !== table), ...files];
      m.rows = { ...m.rows, [table]: total };
      m.done = [...m.done, table];
      await admin.from("data_backups").update({ manifest: m }).eq("id", id);
    }
    const left = Object.keys(TABLES).filter((t) => !m.done.includes(t));
    if (left.length) return NextResponse.json({ id, status: "building", done: m.done.length, total: Object.keys(TABLES).length, next: left[0] });
    // finished: manifest and README beside the data
    m.made = new Date().toISOString();
    const rowsAll = Object.values(m.rows).reduce((x, y) => x + y, 0);
    const readme = [
      "FBS Order Desk: restore point (every database table)",
      `Made ${m.made} by ${a.who}. Folder: ${m.folder}`,
      (m as Manifest & { label?: string }).label ? `Label: ${(m as Manifest & { label?: string }).label}` : "",
      "",
      `${m.done.length} tables, ${rowsAll.toLocaleString()} rows. Each <table>.ndjson.gz (or <table>-N.ndjson.gz) holds one full row per line, as JSON.`,
      "manifest.json lists every file with its table, row count and SHA-256 checksum (check: sha256sum <file>).",
      `Not included: ${SKIPPED.join(", ")} (sign-in sessions and short-lived locks). Staff sign-ins (Supabase Auth) and the`,
      "artwork / mockup / proof files in storage are not in this package; they stay in Supabase storage.",
      "",
      "SENSITIVE: this includes customer details, pay rates, PIN hashes and encrypted mailbox passwords. Keep the",
      "downloaded copy somewhere private.",
      "",
      "To restore a table: load its rows back with the Supabase service key, e.g. for each line",
      "  insert into public.<table> select * from json_populate_record(null::public.<table>, '<line>'::json)",
      "  on conflict do nothing;  (or upsert to put changed rows back). Do it in a quiet moment, owner present.",
      "The matching code is GitHub branch release/v1.0-before-customer-move, live as Vercel deployment",
      "dpl_47JZgoLFSn59vPRyhnTvABSkAcxk (Vercel → Deployments → … → Instant Rollback puts it back).",
    ].filter((x, i, xs) => x !== "" || xs[i - 1] !== "").join("\n");
    const put = async (name: string, text: string, type: string) => admin.storage.from("backups").upload(`${m.folder}/${name}`, Buffer.from(text, "utf8"), { contentType: type, upsert: true });
    await put("manifest.json", JSON.stringify(m, null, 1), "application/json");
    await put("README.txt", readme, "text/plain");
    await admin.from("data_backups").update({ manifest: m, status: "done", finished_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ id, status: "done", done: m.done.length, total: Object.keys(TABLES).length, rows: rowsAll });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("data_backups").update({ manifest: m, error: msg.slice(0, 500) }).eq("id", id);
    return NextResponse.json({ id, status: "building", error: msg, done: m.done.length, total: Object.keys(TABLES).length }, { status: 500 });
  }
}
