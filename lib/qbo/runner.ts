import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSettings } from "@/lib/pricing";
import { keepAlive, loadTokens, Qbo, QboError, QboNotConnected } from "@/lib/qbo/client";
import { qboEnv } from "@/lib/qbo/config";
import { FIELD_LABEL, invoiceFingerprint, OWNED_FIELDS, ownedFromQbo, qboSettingsOf, type Owned, type QboSettings } from "@/lib/qbo/map";
import { explainQboError, Pusher, type Link, type Outcome, type QRow } from "@/lib/qbo/push";

/**
 * The QuickBooks runner: works through the queue (customers, then invoices, then payments, oldest first), checks
 * what changed in QuickBooks (webhook notices + a change-data-capture poll every 15 minutes), and keeps the sign-in
 * fresh. One run at a time (qbo_claim lock). Called every minute by pg_cron (qbo_sync_tick) while the sync is on.
 *   mode "auto":    live or preview as set in Settings (only when the sync is on)
 *   mode "preview": builds what would be sent, sends nothing (the owner's "Preview now", and testing)
 */
const ORDER: QRow["entity"][] = ["customer", "invoice", "payment"];
const CDC_EVERY = 15 * 60000;

export async function loadQboSettings(admin: SupabaseClient): Promise<QboSettings & { token?: string; cdc_at?: string | null; keepalive_at?: string | null }> {
  const { data } = await admin.from("qbo_settings").select("*").eq("id", 1).maybeSingle();
  return { ...qboSettingsOf(data as Partial<QboSettings>), token: data?.token, cdc_at: data?.cdc_at, keepalive_at: data?.keepalive_at };
}

export type RunStats = { mode: "live" | "preview" | "off"; processed: number; byStatus: Record<string, number>; changes: number; note?: string; error?: string };

export async function runQueue(admin: SupabaseClient, opts: { mode: "auto" | "preview"; deadline: number; max?: number; ids?: number[] }): Promise<RunStats> {
  const qs = await loadQboSettings(admin);
  const stats: RunStats = { mode: "off", processed: 0, byStatus: {}, changes: 0 };
  const connected = qboEnv().configured && !!(await loadTokens(admin));
  if (opts.mode === "auto" && !qs.enabled) {
    // off: only keep the sign-in alive (about once a day)
    if (connected && (!qs.keepalive_at || Date.now() - new Date(qs.keepalive_at).getTime() > 20 * 3600000)) {
      try { await keepAlive(admin); stats.note = "Sign-in refreshed (the sync is off)."; }
      catch (e) { stats.error = e instanceof Error ? e.message : String(e); }
      await admin.from("qbo_settings").update({ keepalive_at: new Date().toISOString() }).eq("id", 1);
    }
    return stats;
  }
  const live = opts.mode === "auto" && qs.enabled && qs.mode === "live" && connected;
  stats.mode = live ? "live" : "preview";
  const qbo = connected ? new Qbo(admin) : null;
  let realm = qs.realm_id;
  if (qbo) { try { realm = await qbo.realm(); } catch (e) { stats.error = e instanceof Error ? e.message : String(e); } }
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const pusher = new Pusher(admin, qs, mergeSettings(st?.data), stats.error ? null : qbo, realm, live && !stats.error);

  // rows left "running" by a run that was cut off: back in line
  await admin.from("qbo_queue").update({ status: "error", last_error: "The run was cut off; trying again." }).eq("status", "running").lt("run_after", new Date(Date.now() - 10 * 60000).toISOString());

  // QuickBooks-side changes first (cheap), so conflicts are known before we push
  if (qbo && !stats.error) { try { stats.changes = await processChanges(admin, qbo, realm, qs); } catch (e) { stats.note = `Change check: ${e instanceof Error ? e.message : String(e)}`; } }

  const max = opts.max ?? 500;
  let stop = false;
  const after: Record<string, number> = { customer: 0, invoice: 0, payment: 0 };
  while (!stop && stats.processed < max && Date.now() < opts.deadline - 15000) {
    let did = 0, fetched = 0;
    for (const entity of ORDER) {
      let q = admin.from("qbo_queue").select("*").eq("entity", entity).gt("id", after[entity]).in("status", ["pending", "error"]).lte("run_after", new Date().toISOString()).order("id").limit(25);
      if (opts.ids?.length) q = admin.from("qbo_queue").select("*").eq("entity", entity).gt("id", after[entity]).in("id", opts.ids).in("status", ["pending", "error", "needs_review"]).order("id").limit(25);
      const { data: rows } = await q;
      fetched += rows?.length || 0;
      for (const row of (rows || []) as (QRow & { previewed_at: string | null; updated_at: string })[]) {
        after[entity] = Math.max(after[entity], row.id);
        // in preview, a row already previewed and unchanged since isn't built again
        if (!live && !opts.ids && row.previewed_at && row.previewed_at >= row.updated_at) continue;
        if (Date.now() > opts.deadline - 15000 || stats.processed >= max) { stop = true; break; }
        const claim = await admin.from("qbo_queue").update({ status: "running", run_after: new Date().toISOString(), ...(live ? { attempts: row.attempts + 1 } : {}) }).eq("id", row.id).in("status", ["pending", "error", "needs_review"]).select("id");
        if (!claim.data?.length) continue;
        const r = { ...row, attempts: live ? row.attempts + 1 : row.attempts };
        let out: Outcome;
        try { out = await pusher.process(r); }
        catch (e) { out = failed(e, r, live); if (e instanceof QboNotConnected) stop = true; }
        await finish(admin, r, out, live);
        stats.processed++; did++;
        stats.byStatus[out.status] = (stats.byStatus[out.status] || 0) + 1;
        if (stop) break;
      }
      if (stop) break;
    }
    if (!fetched) break;
  }
  await admin.from("qbo_settings").update({ last_run_at: new Date().toISOString(), ...(stats.error ? { last_error: stats.error, last_error_at: new Date().toISOString() } : {}) }).eq("id", 1);
  return stats;
}

function failed(e: unknown, row: QRow, live: boolean): Outcome {
  if (e instanceof QboNotConnected) return { status: "pending", reason: e.message, retryMin: 30 };
  if (e instanceof QboError) {
    if (e.validation) {
      const salt = ((row.result as { salt?: number } | null)?.salt || 0) + 1;
      return { status: "needs_review", reason: explainQboError(e), result: { salt, code: e.code, errors: e.errors } };
    }
    if (live && row.attempts >= 8) return { status: "needs_review", reason: `QuickBooks kept failing (${row.attempts} tries): ${e.message}` };
    return { status: "error", reason: e.message, retryMin: Math.min(60, 2 ** Math.max(0, row.attempts)) };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (live && row.attempts >= 8) return { status: "needs_review", reason: `Failed ${row.attempts} times: ${msg}` };
  return { status: "error", reason: msg, retryMin: Math.min(60, 2 ** Math.max(0, row.attempts)) };
}

async function finish(admin: SupabaseClient, row: QRow, out: Outcome, live: boolean) {
  const t = new Date().toISOString();
  const keepResult = out.result ?? (row.result as Record<string, unknown> | null) ?? null;
  const base: Record<string, unknown> = { reason: out.reason.slice(0, 2000), ...(out.preview !== undefined ? { payload_preview: out.preview } : {}), result: keepResult };
  let patch: Record<string, unknown>;
  if (out.status === "pending") {
    // previews and waits stay in line; a preview doesn't count as a change (updated_at stays)
    patch = { ...base, status: "pending", previewed_at: t, run_after: new Date(Date.now() + (out.retryMin || 0) * 60000).toISOString(), ...(live ? { last_error: out.retryMin ? out.reason : null } : {}) };
  } else if (out.status === "error") {
    patch = { ...base, status: "error", last_error: out.reason.slice(0, 2000), previewed_at: t, run_after: new Date(Date.now() + (out.retryMin || 5) * 60000).toISOString() };
  } else {
    patch = { ...base, status: out.status, previewed_at: t, updated_at: t, ...(out.status === "needs_review" ? { last_error: out.reason.slice(0, 2000) } : { last_error: null }), ...(out.status === "done" || out.status === "skipped" ? { done_at: t, resolution: null } : {}) };
  }
  let { error } = await admin.from("qbo_queue").update(patch).eq("id", row.id);
  // a newer change to the same record is already waiting (one open row each): this one is just closed
  if (error && /qbo_queue_open_uq|duplicate key/i.test(error.message)) ({ error } = await admin.from("qbo_queue").update({ ...patch, status: "skipped", reason: `Superseded by a newer change. (${out.reason})`.slice(0, 2000), done_at: t }).eq("id", row.id));
  if (error) throw new Error(`Couldn't update the queue: ${error.message}`);
}

/* ---------- changes made in QuickBooks ---------- */

type QRec = Record<string, unknown> & { Id: string; SyncToken?: string; status?: string };

/** Webhook notices waiting, plus a change-data-capture poll every 15 minutes: linked records re-read and flagged. */
export async function processChanges(admin: SupabaseClient, qbo: Qbo, realm: string, qs: { cdc_at?: string | null }): Promise<number> {
  let n = 0;
  const { data: waiting } = await admin.from("qbo_changes").select("*").is("handled_at", null).order("id").limit(100);
  for (const c of (waiting || []) as { id: number; realm_id: string; entity: string; qbo_id: string; operation: string }[]) {
    let note = "";
    if (c.realm_id && c.realm_id !== realm) note = "other company";
    else if (/^(customer|invoice|payment)$/i.test(c.entity)) {
      const entity = c.entity[0].toUpperCase() + c.entity.slice(1).toLowerCase();
      const link = await linkByQbo(admin, realm, entity.toLowerCase(), c.qbo_id);
      if (!link) note = "not linked";
      else {
        const rec = /delete|merge/i.test(c.operation) ? ({ Id: c.qbo_id, status: "Deleted" } as QRec) : await qbo.with({ entity: entity.toLowerCase(), localId: link.local_id, qboId: c.qbo_id }).read<QRec>(entity, c.qbo_id);
        note = await noteChange(admin, link, rec || ({ Id: c.qbo_id, status: "Deleted" } as QRec));
        n++;
      }
    } else note = "not tracked";
    await admin.from("qbo_changes").update({ handled_at: new Date().toISOString(), note }).eq("id", c.id);
  }
  if (!qs.cdc_at || Date.now() - new Date(qs.cdc_at).getTime() > CDC_EVERY) {
    const since = new Date(Math.max(qs.cdc_at ? new Date(qs.cdc_at).getTime() - 5 * 60000 : Date.now() - 86400000, Date.now() - 29 * 86400000)).toISOString();
    const started = new Date().toISOString();
    const got = await qbo.cdc(["Customer", "Invoice", "Payment"], since);
    for (const [entity, list] of Object.entries(got)) {
      for (const rec of list as QRec[]) {
        const link = await linkByQbo(admin, realm, entity.toLowerCase(), rec.Id);
        if (!link) continue;
        const note = await noteChange(admin, link, rec);
        await admin.from("qbo_changes").insert({ realm_id: realm, entity, qbo_id: rec.Id, operation: rec.status === "Deleted" ? "Delete" : "Update", source: "cdc", handled_at: new Date().toISOString(), note });
        n++;
      }
    }
    await admin.from("qbo_settings").update({ cdc_at: started }).eq("id", 1);
  }
  return n;
}

async function linkByQbo(admin: SupabaseClient, realm: string, entity: string, qboId: string): Promise<Link | null> {
  const { data } = await admin.from("qbo_links").select("*").eq("realm_id", realm).eq("entity", entity).eq("qbo_id", qboId).maybeSingle();
  return (data as Link) || null;
}

/** Keep what QuickBooks has now (last_seen_qbo) and flag anything there that differs from what we last sent. */
async function noteChange(admin: SupabaseClient, link: Link, rec: QRec): Promise<string> {
  const t = new Date().toISOString();
  if (rec.status === "Deleted") {
    await admin.from("qbo_links").update({ changed_in_qbo: { at: t, deleted: true, note: "Deleted in QuickBooks." }, updated_at: t }).eq("id", link.id);
    return "deleted in QuickBooks";
  }
  let changed: Record<string, unknown> | null = null;
  if (link.entity === "customer" && link.last_sent) {
    const sent = link.last_sent as Owned, now = ownedFromQbo(rec);
    const fields = OWNED_FIELDS.filter((f) => !(link.qbo_owned_fields || []).includes(f) && sent[f] !== undefined && norm(sent[f]) !== norm(now[f]))
      .map((f) => ({ field: f, label: FIELD_LABEL[f], sent: sent[f] || "", qbo: now[f] || "" }));
    if (fields.length) changed = { at: t, fields, note: "Changed in QuickBooks: " + fields.map((x) => `${x.label} "${x.sent}" → "${x.qbo}"`).join("; ") };
  } else if (link.entity === "invoice" && link.source === "created") {
    const base = (link.last_sent as { fingerprint?: string } | null)?.fingerprint;
    if (base && invoiceFingerprint(rec) !== base) changed = { at: t, total: rec.TotalAmt, note: `Invoice changed in QuickBooks (total there ${rec.TotalAmt}).` };
  } else if (link.entity === "payment" && link.source === "created") {
    const was = (link.last_seen_qbo as { TotalAmt?: number } | null)?.TotalAmt;
    if (was != null && +was !== +(rec.TotalAmt as number)) changed = { at: t, total: rec.TotalAmt, note: `Payment changed in QuickBooks (${was} → ${rec.TotalAmt}).` };
  }
  await admin.from("qbo_links").update({ last_seen_qbo: rec, last_seen_at: t, sync_token: rec.SyncToken || link.sync_token, ...(changed ? { changed_in_qbo: changed } : {}), updated_at: t }).eq("id", link.id);
  return changed ? String(changed.note) : "seen";
}
const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
