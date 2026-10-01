import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The Printavo history backup: everything Printavo created before 2026 (locked in the database by migration 082),
 * written as a package of plain files in the private "backups" bucket, so it can be downloaded and kept anywhere:
 *   orders-2018.ndjson.gz … orders-2025.ndjson.gz  every archived order, one full database row per line
 *   customers.ndjson.gz                              the customers on those orders, their contacts, the Printavo links
 *   files.csv.gz                                     every artwork file: order, name, our copy's path, the original link
 *   manifest.json                                    counts, dollar totals and a SHA-256 checksum for each file
 *   README.txt                                       what's in it and how to restore from it
 * POST builds a new package (owner only, or the sync's schedule token); GET lists the packages with download links.
 */
const FROM_YEAR = 2018;

async function allowed(req: Request) {
  const admin = createAdminClient();
  const tok = req.headers.get("x-sync-token");
  if (tok) { const { data } = await admin.from("printavo_sync").select("token").eq("id", 1).maybeSingle(); if (data?.token && data.token === tok) return { admin, who: "schedule" }; }
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const { data: me } = await admin.from("staff").select("role").ilike("email", v.email).maybeSingle();
  return me?.role === "owner" ? { admin, who: v.email } : null;
}

export async function GET(req: Request) {
  const a = await allowed(req);
  if (!a) return NextResponse.json({ error: "Only the owner can see the backups." }, { status: 403 });
  const { data } = await a.admin.from("data_backups").select("*").eq("kind", "printavo-history").order("created_at", { ascending: false }).limit(10);
  const out = [];
  for (const b of data || []) {
    const parts = ((b.manifest as { files?: { path: string; name: string; bytes: number }[] } | null)?.files || []);
    const links: { name: string; bytes: number; url: string }[] = [];
    for (const p of parts) {
      const { data: s } = await a.admin.storage.from("backups").createSignedUrl(p.path, 3600, { download: p.name });
      if (s?.signedUrl) links.push({ name: p.name, bytes: p.bytes, url: s.signedUrl });
    }
    out.push({ id: b.id, status: b.status, created_at: b.created_at, finished_at: b.finished_at, created_by: b.created_by, error: b.error, summary: (b.manifest as { summary?: unknown } | null)?.summary || null, links });
  }
  return NextResponse.json({ backups: out });
}

export async function POST(req: Request) {
  const a = await allowed(req);
  if (!a) return NextResponse.json({ error: "Only the owner can make a backup." }, { status: 403 });
  const { admin } = a;
  const { data: cfg } = await admin.from("printavo_sync").select("freeze_before").eq("id", 1).maybeSingle();
  const cutoff = (cfg?.freeze_before as string) || "2026-01-01";
  const toYear = +cutoff.slice(0, 4) - 1;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const folder = `printavo-history-${FROM_YEAR}-${toYear}/${stamp}`;
  const { data: row, error: e0 } = await admin.from("data_backups").insert({ kind: "printavo-history", folder, created_by: a.who }).select("id").single();
  if (e0 || !row) return NextResponse.json({ error: e0?.message || "Couldn't start the backup." }, { status: 500 });
  const files: { name: string; path: string; bytes: number; sha256: string; rows: number }[] = [];
  const put = async (name: string, text: string, rows: number, gz = true) => {
    const body = gz ? gzipSync(Buffer.from(text, "utf8"), { level: 9 }) : Buffer.from(text, "utf8");
    const path = `${folder}/${name}`;
    const { error } = await admin.storage.from("backups").upload(path, body, { contentType: gz ? "application/gzip" : name.endsWith(".json") ? "application/json" : "text/plain", upsert: false });
    if (error) throw new Error(`${name}: ${error.message}`);
    files.push({ name, path, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), rows });
  };
  try {
    const years: Record<string, { orders: number; invoices: number; quotes: number; total: number; paid: number; files: number; filesCopied: number }> = {};
    const customerIds = new Set<string>();
    const fileLines: string[] = ["archived_order_id,printavo_number,order_date,state,file_name,our_copy,original_link"];
    const csv = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    let locked = 0;
    for (let y = FROM_YEAR; y <= toYear; y++) {
      const lines: string[] = [];
      const sum = { orders: 0, invoices: 0, quotes: 0, total: 0, paid: 0, files: 0, filesCopied: 0 };
      for (let from = 0; ; from += 400) {
        const { data, error } = await admin.from("archived_orders").select("*").eq("locked", true).gte("order_date", `${y}-01-01`).lt("order_date", `${y + 1}-01-01`).order("order_date").order("id").range(from, from + 399);
        if (error) throw new Error(`${y}: ${error.message}`);
        for (const r of data || []) {
          lines.push(JSON.stringify(r));
          sum.orders++; if (r.kind === "quote") sum.quotes++; else sum.invoices++;
          sum.total += +r.total || 0; sum.paid += +r.paid || 0; sum.files += r.files_total || 0; sum.filesCopied += r.files_copied || 0;
          if (r.customer_id) customerIds.add(r.customer_id);
          const names = new Map<string, string>();
          for (const f of ((r.data?.files || []) as { full?: string; name?: string }[])) if (f.full && f.name) names.set(f.full, f.name);
          for (const [url, p] of Object.entries((r.files || {}) as Record<string, string>)) {
            const state = p === "failed" || p === "too-big" ? p : "copied";
            const name = names.get(url) || (state === "copied" ? p.split("/").pop() : decodeURIComponent(url.split("?")[0].split("/").pop() || ""));
            fileLines.push([r.id, r.visual_id, r.order_date, state, name, state === "copied" ? `proofs/${p}` : "", url].map(csv).join(","));
          }
        }
        if (!data || data.length < 400) break;
      }
      locked += sum.orders;
      sum.total = Math.round(sum.total * 100) / 100; sum.paid = Math.round(sum.paid * 100) / 100;
      years[y] = sum;
      await put(`orders-${y}.ndjson.gz`, lines.join("\n") + (lines.length ? "\n" : ""), lines.length);
    }
    // the customers on those orders, their contacts and the Printavo customer links
    const ids = [...customerIds], custLines: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [c, cc, pc] = await Promise.all([
        admin.from("customers").select("*").in("id", chunk),
        admin.from("customer_contacts").select("*").in("customer_id", chunk),
        admin.from("printavo_customers").select("*").in("customer_id", chunk),
      ]);
      for (const [table, res] of [["customers", c], ["customer_contacts", cc], ["printavo_customers", pc]] as const) {
        if (res.error) throw new Error(`${table}: ${res.error.message}`);
        for (const r of res.data || []) custLines.push(JSON.stringify({ table, row: r }));
      }
    }
    await put("customers.ndjson.gz", custLines.join("\n") + "\n", custLines.length);
    await put("files.csv.gz", fileLines.join("\n") + "\n", fileLines.length - 1);
    const totals = Object.values(years).reduce((s, v) => ({ orders: s.orders + v.orders, total: s.total + v.total, files: s.files + v.files, filesCopied: s.filesCopied + v.filesCopied }), { orders: 0, total: 0, files: 0, filesCopied: 0 });
    const summary = { from: `${FROM_YEAR}-01-01`, before: cutoff, orders: totals.orders, customers: ids.length, dollars: Math.round(totals.total * 100) / 100, files: totals.files, filesCopied: totals.filesCopied, lockedInDatabase: locked };
    await put("README.txt", [
      `FBS Print: Printavo history backup, ${FROM_YEAR} through ${toYear} (everything Printavo created before ${cutoff}).`,
      `Made ${new Date().toISOString()} from portal.fbsprint.com. These orders are locked in the database (they can't change or be deleted).`,
      "",
      "orders-YYYY.ndjson.gz   One archived order per line: the full database row (archived_orders), including `data`, the",
      "                        complete Printavo record (customer, line items and sizes, imprints, fees, payments, notes, tasks,",
      "                        approvals, messages), and `files`, each original file link mapped to our copy.",
      "customers.ndjson.gz     {\"table\": ..., \"row\": ...} lines: customers, customer_contacts, printavo_customers.",
      "files.csv.gz            Every artwork file: order, name, state (copied / failed / too-big), our copy's path in Supabase",
      "                        storage (bucket proofs), and the original Printavo link (dead once Printavo is cancelled).",
      "manifest.json           Counts and dollar totals per year, and a SHA-256 checksum of every file here.",
      "",
      "Open: any .gz unzips with a double-click (or `gunzip`); .ndjson is plain text, one JSON record per line.",
      "Restore: insert each line of orders-YYYY back into archived_orders (same columns), and the customer lines into",
      "their tables. The artwork stays in our storage under proofs/printavo/<archived order id>/ and can't be deleted",
      "while the order is locked.",
    ].join("\n") + "\n", 0, false);
    const manifest = { kind: "printavo-history", made: new Date().toISOString(), folder, summary, years, files };
    await put("manifest.json", JSON.stringify(manifest, null, 2) + "\n", 0, false);
    await admin.from("data_backups").update({ status: "ready", manifest: { ...manifest, files }, finished_at: new Date().toISOString() }).eq("id", row.id);
    return NextResponse.json({ id: row.id, folder, summary });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await admin.from("data_backups").update({ status: "failed", error: msg, finished_at: new Date().toISOString(), manifest: { files } }).eq("id", row.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
