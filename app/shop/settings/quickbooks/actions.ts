"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { qboEnv } from "@/lib/qbo/config";
import { loadTokens, Qbo } from "@/lib/qbo/client";
import { customerDiff, OWNED_FIELDS, ownedFromOurs, ownedFromQbo, type OurCustomer, type Owned, type OwnedField, type QboSettings } from "@/lib/qbo/map";
import { claimLock, loadQboSettings, releaseLock, runQueue } from "@/lib/qbo/runner";
import { adoptExisting, confirmProposals, runMatching, setPrimary } from "@/lib/qbo/matchRun";
import { SITE_URL } from "@/lib/config";

/** Settings → QuickBooks (owner only). Every action checks the viewer is the owner before using the server client. */

type R<T = undefined> = { ok: true; data?: T; msg?: string } | { ok: false; error: string };
async function owner() {
  const v = await getViewer();
  if (!v.user || v.role !== "owner") throw new Error("Only the owner can do this.");
  return { admin: createAdminClient(), email: v.email };
}
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

export type QboStatus = {
  env: ReturnType<typeof qboEnv>; webhookUrl: string; callbackUrl: string;
  connected: boolean; realm: string; company: string; connectedBy: string; connectedAt: string; accessExpires: string; refreshExpires: string; tokenEnv: string;
  settings: QboSettings; counts: Record<string, number>; lastRunAt: string | null; lastError: string | null; lastErrorAt: string | null; matchedAt: string | null; cdcAt: string | null; locked: boolean;
  realmWarning: string | null; previousRealm: string; liveSince: string | null; envMismatch: string | null;
};

export async function qboStatus(): Promise<R<QboStatus>> {
  try {
    const { admin } = await owner();
    const env = qboEnv();
    const t = await loadTokens(admin);
    const { data: s } = await admin.from("qbo_settings").select("*").eq("id", 1).maybeSingle();
    const counts: Record<string, number> = {};
    await Promise.all(["pending", "running", "error", "needs_review", "done", "skipped"].map(async (st) => {
      const { count } = await admin.from("qbo_queue").select("id", { count: "exact", head: true }).eq("status", st);
      counts[st] = count || 0;
    }));
    const settings = await loadQboSettings(admin);
    delete (settings as { token?: string }).token;
    return { ok: true, data: {
      env, webhookUrl: `${SITE_URL}/api/qbo/webhook`, callbackUrl: env.redirectUri,
      connected: !!t, realm: t?.realm_id || "", company: String(s?.company_name || ""), connectedBy: t?.connected_by || "", connectedAt: t?.connected_at || "",
      accessExpires: t?.access_expires_at || "", refreshExpires: t?.refresh_expires_at || "", tokenEnv: t?.env || "",
      settings, counts, lastRunAt: s?.last_run_at || null, lastError: s?.last_error || null, lastErrorAt: s?.last_error_at || null,
      matchedAt: s?.matched_at || null, cdcAt: s?.cdc_at || null, locked: !!(s?.lock_until && new Date(s.lock_until).getTime() > Date.now()),
      realmWarning: s?.realm_warning || null, previousRealm: String(s?.previous_realm_id || ""), liveSince: s?.live_since || null,
      envMismatch: t?.env && env.env && t.env !== env.env ? `The QuickBooks sign-in is for ${t.env}, but QBO_ENV is ${env.env}. Nothing runs until you connect again.` : null,
    } };
  } catch (e) { return fail(e); }
}

/** Checks the connection by reading the company's name. */
export async function qboTest(): Promise<R<{ company: string }>> {
  try {
    const { admin } = await owner();
    const c = await new Qbo(admin, { entity: "test" }).companyInfo();
    await admin.from("qbo_settings").update({ company_name: c?.CompanyName || "" }).eq("id", 1);
    return { ok: true, data: { company: c?.CompanyName || "" }, msg: `Connected to ${c?.CompanyName || "QuickBooks"}.` };
  } catch (e) { return fail(e); }
}

export type Option = { id: string; name: string; note?: string };
export type QboLists = { items: Option[]; depositAccounts: Option[]; discountAccounts: Option[]; methods: Option[]; terms: Option[]; taxCodes: Option[]; classes: Option[]; departments: Option[]; customFields: Option[]; ast: boolean | null };
/** The pick lists for the settings form, read from QuickBooks. */
export async function qboLists(): Promise<R<QboLists>> {
  try {
    const { admin } = await owner();
    const q = new Qbo(admin, { entity: "lists" });
    type N = { Id: string; Name?: string; FullyQualifiedName?: string; Type?: string; AccountType?: string; AccountSubType?: string; Active?: boolean };
    const nm = (x: N) => x.FullyQualifiedName || x.Name || x.Id;
    const items = await q.query<N>("Item", "WHERE Active = true");
    const accounts = await q.query<N>("Account", "WHERE Active = true");
    const methods = await q.query<N>("PaymentMethod");
    const terms = await q.query<N>("Term");
    const taxCodes = await q.query<N>("TaxCode").catch(() => [] as N[]);
    const classes = await q.query<N>("Class").catch(() => [] as N[]);
    const departments = await q.query<N>("Department").catch(() => [] as N[]);
    const prefs = await q.preferences().catch(() => null) as { SalesFormsPrefs?: { CustomField?: { CustomField?: { Name?: string; StringValue?: string; Type?: string }[] }[] }; TaxPrefs?: { PartnerTaxEnabled?: boolean } } | null;
    const customFields: Option[] = [];
    for (const g of prefs?.SalesFormsPrefs?.CustomField || []) for (const f of g.CustomField || []) {
      const m = /SalesFormsPrefs\.SalesCustomName(\d)/.exec(String(f.Name || ""));
      if (m && f.StringValue) customFields.push({ id: m[1], name: f.StringValue });
    }
    return { ok: true, data: {
      items: items.filter((x) => x.Type !== "Category").map((x) => ({ id: x.Id, name: nm(x), note: x.Type })).sort((a, b) => a.name.localeCompare(b.name)),
      depositAccounts: accounts.filter((a) => a.AccountType === "Bank" || a.AccountType === "Other Current Asset").map((x) => ({ id: x.Id, name: nm(x), note: x.AccountSubType })),
      discountAccounts: accounts.filter((a) => a.AccountType === "Income" || a.AccountType === "Other Income").map((x) => ({ id: x.Id, name: nm(x) })),
      methods: methods.map((x) => ({ id: x.Id, name: nm(x) })), terms: terms.map((x) => ({ id: x.Id, name: nm(x) })),
      taxCodes: taxCodes.map((x) => ({ id: x.Id, name: nm(x) })), classes: classes.map((x) => ({ id: x.Id, name: nm(x) })), departments: departments.map((x) => ({ id: x.Id, name: nm(x) })),
      customFields, ast: prefs?.TaxPrefs?.PartnerTaxEnabled ?? null,
    } };
  } catch (e) { return fail(e); }
}

const EDITABLE = ["enabled", "mode", "live_from_number", "adopt_from_number", "item_map", "deposit_account_id", "payment_method_map", "tax_mode", "tax_code_id", "exemption_reason_id", "term_map", "default_term_id", "discount_account_id", "po_field_id", "po_field_name", "class_id", "department_id"] as const;
/** The SQL that starts order numbers at `n` (Nicholas runs it at the cutover; the portal never changes numbering itself). */
const restartSql = (n: number) => `alter sequence public.order_number_seq restart with ${n};`;

export async function qboSaveSettings(patch: Partial<QboSettings>, opts: { allowLowLiveFrom?: boolean } = {}): Promise<R> {
  try {
    const { admin, email } = await owner();
    const row: Record<string, unknown> = {};
    for (const k of EDITABLE) if (patch[k] !== undefined) row[k] = patch[k];
    if (row.mode && !["preview", "live"].includes(String(row.mode))) return { ok: false, error: "Mode is preview or live." };
    if (row.tax_mode && !["qbo_ast", "tax_line", "none"].includes(String(row.tax_mode))) return { ok: false, error: "Unknown sales tax setting." };
    for (const k of ["live_from_number", "adopt_from_number"] as const) if (row[k] !== undefined && !(Number.isInteger(+row[k]!) && +row[k]! > 0)) return { ok: false, error: "Order numbers must be whole numbers." };
    const cur = await loadQboSettings(admin);
    const next = { ...cur, ...row } as QboSettings & { realm_warning?: string | null };
    if (next.adopt_from_number > next.live_from_number) return { ok: false, error: "Printavo's invoices can't start above the number our own invoices start at." };
    if (next.live_from_number < 50000 && !opts.allowLowLiveFrom) return { ok: false, error: `Invoices from #${next.live_from_number}: below #50,000 means the portal would make QuickBooks invoices for transition orders Printavo also sends. Confirm to save it anyway.` };
    if (next.adopt_from_number < 40000 && !opts.allowLowLiveFrom) return { ok: false, error: "Printavo's invoices from below #40,000 would touch Printavo's own history. Confirm to save it anyway." };
    const wasLive = cur.enabled && cur.mode === "live", goingLive = next.enabled && next.mode === "live" && !wasLive;
    if (goingLive) {
      if (!(await loadTokens(admin))) return { ok: false, error: "Connect QuickBooks before turning live sending on." };
      const { data: s0 } = await admin.from("qbo_settings").select("realm_warning").eq("id", 1).maybeSingle();
      if (s0?.realm_warning) return { ok: false, error: "QuickBooks was connected to a different company than before. Check the warning at the top (and run Customer matching again) before going live." };
      // new orders must already be numbered from live_from up, or they'd be treated as Printavo's and never invoiced
      const { data: nextNo, error: seqErr } = await admin.rpc("qbo_next_order_number");
      if (seqErr) return { ok: false, error: `Couldn't check the order numbering: ${seqErr.message}` };
      if (+(nextNo as number) < next.live_from_number) {
        return { ok: false, error: `New orders are still numbered #${(+(nextNo as number)).toLocaleString("en-US")}. Start numbering at ${next.live_from_number.toLocaleString("en-US")} first (Supabase → SQL editor: ${restartSql(next.live_from_number)}), then switch to Live.` };
      }
      row.live_since = new Date().toISOString();
    }
    const { error } = await admin.from("qbo_settings").update({ ...row, updated_at: new Date().toISOString(), updated_by: email }).eq("id", 1);
    if (error) return { ok: false, error: error.message };
    return { ok: true, msg: goingLive ? "Saved: live from now on." : "Saved." };
  } catch (e) { return fail(e); }
}

/** The next order number (for the cutover checklist). */
export async function qboNextOrderNumber(): Promise<R<{ next: number; sql: string }>> {
  try {
    const { admin } = await owner();
    const qs = await loadQboSettings(admin);
    const { data, error } = await admin.rpc("qbo_next_order_number");
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { next: +(data as number), sql: restartSql(qs.live_from_number) } };
  } catch (e) { return fail(e); }
}

/** Clear the "connected to a different company" warning once the owner has looked at it. */
export async function qboDismissRealmWarning(): Promise<R> {
  try { const { admin, email } = await owner(); await admin.from("qbo_settings").update({ realm_warning: null, updated_by: email }).eq("id", 1); return { ok: true }; } catch (e) { return fail(e); }
}

/* ---------- queue ---------- */

export type QueueItem = { id: number; entity: string; local_id: string; op: string; status: string; reason: string; attempts: number; last_error: string | null; payload_preview: unknown; result: unknown; updated_at: string; created_at: string; previewed_at: string | null; label: string; href: string };
export async function qboQueue(status: string, limit = 100): Promise<R<QueueItem[]>> {
  try {
    const { admin } = await owner();
    let q = admin.from("qbo_queue").select("id, entity, local_id, op, status, reason, attempts, last_error, payload_preview, result, updated_at, created_at, previewed_at").order("updated_at", { ascending: false }).limit(Math.min(limit, 300));
    if (status && status !== "all") q = status === "open" ? q.in("status", ["pending", "error", "needs_review", "running"]) : q.eq("status", status);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data || []) as Omit<QueueItem, "label" | "href">[];
    const ids = (e: string) => [...new Set(rows.filter((r) => r.entity === e).map((r) => r.local_id))];
    const [{ data: cs }, { data: os }, { data: ps }] = await Promise.all([
      ids("customer").length ? admin.from("customers").select("id, company, name").in("id", ids("customer")) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ids("invoice").length ? admin.from("orders").select("id, number, nickname").in("id", ids("invoice")) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ids("payment").length ? admin.from("payments").select("id, order_id, amount, method, paid_on").in("id", ids("payment")) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const payOrders = [...new Set((ps || []).map((p) => String(p.order_id)))];
    const { data: po } = payOrders.length ? await admin.from("orders").select("id, number").in("id", payOrders) : { data: [] as Record<string, unknown>[] };
    type Row = Record<string, unknown>;
    const toMap = (xs: Row[] | null) => new Map<string, Row>((xs || []).map((x) => [String(x.id), x] as [string, Row]));
    const cMap = toMap(cs as Row[] | null), oMap = toMap(os as Row[] | null), pMap = toMap(ps as Row[] | null), poMap = toMap(po as Row[] | null);
    return { ok: true, data: rows.map((r) => {
      let label = r.local_id, href = "";
      if (r.entity === "customer") { const c = cMap.get(r.local_id); label = c ? String(c.company || c.name || "Customer") : "Customer (deleted)"; href = c ? `/shop/customers/${r.local_id}` : ""; }
      else if (r.entity === "invoice") { const o = oMap.get(r.local_id); label = o ? `#${o.number}${o.nickname ? " " + o.nickname : ""}` : "Order (deleted)"; href = o ? `/shop/orders/${r.local_id}` : ""; }
      else { const p = pMap.get(r.local_id); const o = p ? poMap.get(String(p.order_id)) : null; label = p ? `${(+(p.amount as number)).toFixed(2)} ${p.method || ""} on #${o?.number ?? "?"} (${p.paid_on || ""})` : "Payment (deleted)"; href = p ? `/shop/orders/${p.order_id}` : ""; }
      return { ...r, label, href };
    }) };
  } catch (e) { return fail(e); }
}

/** Retry / skip / resolve one row. Resolutions: force_fields (ours wins), keep_qbo (QuickBooks keeps those fields), link_qbo_id, force, void. */
export async function qboQueueAction(id: number, action: "retry" | "skip" | "resolve", resolution?: Record<string, unknown>): Promise<R> {
  try {
    const { admin, email } = await owner();
    const { data: row } = await admin.from("qbo_queue").select("*").eq("id", id).maybeSingle();
    if (!row) return { ok: false, error: "Not found." };
    const t = new Date().toISOString();
    if (action === "skip") {
      const { error } = await admin.from("qbo_queue").update({ status: "skipped", reason: `Skipped by ${email}. ${row.reason || ""}`.slice(0, 2000), done_at: t, updated_at: t }).eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true, msg: "Skipped." };
    }
    let res = { ...((row.resolution as Record<string, unknown>) || {}) };
    if (action === "resolve" && resolution) {
      if (Array.isArray(resolution.keep_qbo) && row.entity === "customer") {
        // these fields now belong to QuickBooks for this customer: we stop sending them
        const keep = (resolution.keep_qbo as string[]).filter((f) => (OWNED_FIELDS as readonly string[]).includes(f));
        const qs = await loadQboSettings(admin);
        const { data: l } = await admin.from("qbo_links").select("id, qbo_owned_fields").eq("realm_id", qs.realm_id).eq("entity", "customer").eq("local_id", row.local_id).eq("is_primary", true).maybeSingle();
        if (l) await admin.from("qbo_links").update({ qbo_owned_fields: [...new Set([...(l.qbo_owned_fields || []), ...keep])], updated_at: t }).eq("id", l.id);
      }
      res = { ...res, ...resolution };
    }
    const { error } = await admin.from("qbo_queue").update({ status: "pending", run_after: t, resolution: res, updated_at: t, attempts: 0 }).eq("id", id);
    if (error) return { ok: false, error: /duplicate|open_uq/.test(error.message) ? "A newer change for the same record is already waiting." : error.message };
    return { ok: true, msg: "Back in line: it runs with the next sync (or press Run now)." };
  } catch (e) { return fail(e); }
}

/** Work through the queue now: as set (live or preview), or a preview only. Sends nothing in preview. */
export async function qboRunNow(preview: boolean): Promise<R<Record<string, unknown>>> {
  try {
    const { admin } = await owner();
    const lockId = await claimLock(admin);
    if (!lockId) return { ok: false, error: "A sync is running right now; try again in a minute." };
    try {
      const qs = await loadQboSettings(admin);
      const mode = preview || !qs.enabled ? "preview" : "auto";
      const stats = await runQueue(admin, { mode, deadline: Date.now() + 240000, lockId });
      return { ok: true, data: stats as unknown as Record<string, unknown>, msg: `${stats.mode === "live" ? "Sent" : "Previewed"} ${stats.processed}: ${Object.entries(stats.byStatus).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") || "nothing waiting"}.${stats.error ? " " + stats.error : ""}` };
    } finally { await releaseLock(admin, lockId); }
  } catch (e) { return fail(e); }
}

/** Queue every order from adopt-from up, its customer and its payments (already-waiting rows are just woken up). */
export async function qboQueueAll(): Promise<R> {
  try {
    const { admin } = await owner();
    const { data, error } = await admin.rpc("qbo_enqueue_all");
    return error ? { ok: false, error: error.message } : { ok: true, msg: `Queued ${data} records.` };
  } catch (e) { return fail(e); }
}

/* ---------- matching ---------- */

export async function qboRunMatching(): Promise<R> {
  try {
    const { admin, email } = await owner();
    const r = await runMatching(admin, email);
    const s = r.stats;
    return { ok: true, msg: `Read ${s.qboCustomers} QuickBooks customers and ${s.qboInvoices} invoices (${s.invoicesOnFile} match an order number we have). ${s.proposals} proposals (${s.high} high confidence) for ${s.localsMatched} of our customers; ${r.unmatched} QuickBooks customers unmatched.` };
  } catch (e) { return fail(e); }
}

export type ProposalRow = { id: number; qbo_id: string; qbo_name: string; qbo_active: boolean; local_id: string | null; local_name: string; method: string; confidence: number; evidence: Record<string, unknown>; is_primary: boolean; last_invoice_date: string | null; status: string };
export type LinkRow = { id: number; local_id: string; local_name: string; qbo_id: string; qbo_name: string; is_primary: boolean; source: string; confidence: number | null; changed_in_qbo: Record<string, unknown> | null; qbo_owned_fields: string[]; last_pushed_at: string | null };
export async function qboMatching(): Promise<R<{ proposals: ProposalRow[]; links: LinkRow[]; ourWithout: { id: string; name: string; orders: number }[]; runAt: string | null }>> {
  try {
    const { admin } = await owner();
    const qs = await loadQboSettings(admin);
    const { data: last } = await admin.from("qbo_match_proposals").select("run_at").eq("realm_id", qs.realm_id).order("run_at", { ascending: false }).limit(1);
    const runAt = last?.[0]?.run_at || null;
    const { data: props } = runAt ? await admin.from("qbo_match_proposals").select("*").eq("realm_id", qs.realm_id).eq("run_at", runAt).order("local_name").limit(5000) : { data: [] };
    const { data: links } = await admin.from("qbo_links").select("id, local_id, qbo_id, is_primary, source, confidence, changed_in_qbo, qbo_owned_fields, last_pushed_at, last_seen_qbo").eq("realm_id", qs.realm_id).eq("entity", "customer").order("local_id").limit(5000);
    const localIds = [...new Set((links || []).map((l) => String(l.local_id)))];
    const names = new Map<string, string>();
    for (let i = 0; i < localIds.length; i += 300) {
      const { data: cs } = await admin.from("customers").select("id, company, name").in("id", localIds.slice(i, i + 300));
      for (const c of cs || []) names.set(String(c.id), String(c.company || c.name || ""));
    }
    const qName = new Map((props || []).map((p) => [String(p.qbo_id), String(p.qbo_name)]));
    // ours with an order from adopt-from up and no QuickBooks customer linked: made in QuickBooks with their first invoice
    const linked = new Set(localIds);
    const { data: recent } = await admin.from("orders").select("customer_id").gte("number", qs.adopt_from_number).not("customer_id", "is", null).limit(5000);
    const counts = new Map<string, number>();
    for (const o of recent || []) if (!linked.has(String(o.customer_id))) counts.set(String(o.customer_id), (counts.get(String(o.customer_id)) || 0) + 1);
    const wo = [...counts.keys()];
    const { data: woc } = wo.length ? await admin.from("customers").select("id, company, name, is_test").in("id", wo.slice(0, 500)) : { data: [] };
    return { ok: true, data: {
      runAt, proposals: (props || []) as ProposalRow[],
      links: (links || []).map((l) => ({ id: l.id, local_id: String(l.local_id), local_name: names.get(String(l.local_id)) || "", qbo_id: String(l.qbo_id), qbo_name: String((l.last_seen_qbo as { DisplayName?: string } | null)?.DisplayName || qName.get(String(l.qbo_id)) || ""), is_primary: l.is_primary, source: l.source, confidence: l.confidence, changed_in_qbo: l.changed_in_qbo, qbo_owned_fields: l.qbo_owned_fields || [], last_pushed_at: l.last_pushed_at })),
      ourWithout: (woc || []).filter((c) => !c.is_test).map((c) => ({ id: String(c.id), name: String(c.company || c.name || ""), orders: counts.get(String(c.id)) || 0 })).sort((a, b) => b.orders - a.orders),
    } };
  } catch (e) { return fail(e); }
}

export async function qboConfirm(sel: { ids?: number[]; minConfidence?: number }): Promise<R> {
  try {
    const { admin, email } = await owner();
    const r = await confirmProposals(admin, email, sel);
    return { ok: true, msg: `Linked ${r.linked}.${r.skipped.length ? ` Not linked: ${r.skipped.slice(0, 5).join("; ")}${r.skipped.length > 5 ? "…" : ""}` : ""}` };
  } catch (e) { return fail(e); }
}
export async function qboReject(ids: number[]): Promise<R> {
  try {
    const { admin, email } = await owner();
    await admin.from("qbo_match_proposals").update({ status: "rejected", decided_by: email, decided_at: new Date().toISOString() }).in("id", ids).eq("status", "proposed");
    return { ok: true, msg: "Rejected." };
  } catch (e) { return fail(e); }
}
export async function qboSetPrimary(linkId: number): Promise<R> {
  try { const { admin } = await owner(); await setPrimary(admin, linkId); return { ok: true, msg: "New invoices for this customer go to that QuickBooks customer now." }; } catch (e) { return fail(e); }
}
/** Unlink one QuickBooks customer from ours (the QuickBooks customer and its history are not touched). */
export async function qboUnlink(linkId: number): Promise<R> {
  try {
    const { admin } = await owner();
    const { data: l } = await admin.from("qbo_links").select("*").eq("id", linkId).eq("entity", "customer").maybeSingle();
    if (!l) return { ok: false, error: "Not found." };
    const { error } = await admin.from("qbo_links").delete().eq("id", linkId);
    if (error) return { ok: false, error: error.message };
    if (l.is_primary) {
      const { data: rest } = await admin.from("qbo_links").select("id").eq("realm_id", l.realm_id).eq("entity", "customer").eq("local_id", l.local_id).limit(1);
      if (rest?.[0]) await admin.from("qbo_links").update({ is_primary: true }).eq("id", rest[0].id);
    }
    await admin.from("qbo_match_proposals").update({ status: "proposed" }).eq("realm_id", l.realm_id).eq("qbo_id", l.qbo_id).eq("status", "confirmed");
    return { ok: true, msg: "Unlinked." };
  } catch (e) { return fail(e); }
}
/** Link one of ours to a QuickBooks customer by its Id (from the unmatched list or QuickBooks' customer page). */
export async function qboLinkManual(localId: string, qboId: string): Promise<R> {
  try {
    const { admin, email } = await owner();
    const qs = await loadQboSettings(admin);
    const id = String(qboId || "").trim();
    if (!/^\d+$/.test(id)) return { ok: false, error: "The QuickBooks customer number is the digits at the end of its page's address (…/customerdetail?nameId=123)." };
    const rec = await new Qbo(admin, { entity: "customer", localId }).read<{ Id: string; SyncToken: string; DisplayName?: string }>("Customer", id);
    if (!rec) return { ok: false, error: `No QuickBooks customer #${id}.` };
    const { data: ex } = await admin.from("qbo_links").select("local_id").eq("realm_id", qs.realm_id).eq("entity", "customer").eq("qbo_id", id).maybeSingle();
    if (ex) return { ok: false, error: `"${rec.DisplayName}" is already linked${ex.local_id === localId ? " to this customer" : " to another customer"}.` };
    const { data: has } = await admin.from("qbo_links").select("id").eq("realm_id", qs.realm_id).eq("entity", "customer").eq("local_id", localId).eq("is_primary", true).maybeSingle();
    // baselines on both sides: only what changes here from now on is sent (Differences lists the rest)
    const { data: ours } = await admin.from("customers").select("id, company, name, email, phone, address, ship_address, tax_exempt, payment_terms").eq("id", localId).maybeSingle();
    if (!ours) return { ok: false, error: "That customer of ours wasn't found." };
    const { error } = await admin.from("qbo_links").insert({ realm_id: qs.realm_id, entity: "customer", local_id: localId, qbo_id: id, source: "manual", is_primary: !has, sync_token: rec.SyncToken, last_seen_qbo: rec, last_seen_at: new Date().toISOString(), created_by: email, ours_base: ownedFromOurs(ours as OurCustomer, qs), last_sent: ownedFromQbo(rec as Parameters<typeof ownedFromQbo>[0]) });
    if (error) return { ok: false, error: error.message };
    await admin.from("qbo_match_proposals").update({ status: "confirmed", local_id: localId, decided_by: email, decided_at: new Date().toISOString() }).eq("realm_id", qs.realm_id).eq("qbo_id", id).in("status", ["proposed", "unmatched"]);
    return { ok: true, msg: `Linked to "${rec.DisplayName}".` };
  } catch (e) { return fail(e); }
}
export async function qboAdopt(): Promise<R> {
  try {
    const { admin } = await owner();
    const r = await adoptExisting(admin);
    return { ok: true, msg: `Looked for ${r.looked} order numbers in QuickBooks: linked ${r.invoices} invoices and ${r.payments} payments Printavo had already sent.` };
  } catch (e) { return fail(e); }
}
/** Clear the "changed in QuickBooks" flag on a link once the owner has looked at it. */
export async function qboClearChanged(linkId: number): Promise<R> {
  try { const { admin } = await owner(); await admin.from("qbo_links").update({ changed_in_qbo: null }).eq("id", linkId); return { ok: true }; } catch (e) { return fail(e); }
}
export async function qboFindCustomers(q: string): Promise<R<{ id: string; name: string }[]>> {
  try {
    const { admin } = await owner();
    const t = String(q || "").trim().replace(/[%,()]/g, " ");
    if (t.length < 2) return { ok: true, data: [] };
    const { data } = await admin.from("customers").select("id, company, name").or(`company.ilike.%${t}%,name.ilike.%${t}%`).limit(15);
    return { ok: true, data: (data || []).map((c) => ({ id: String(c.id), name: String(c.company || c.name || "") })) };
  } catch (e) { return fail(e); }
}

/* ---------- log ---------- */

export type LogRow = { id: number; at: string; method: string; path: string; entity: string | null; local_id: string | null; qbo_id: string | null; ok: boolean; status: number | null; ms: number | null; error: string | null };
export async function qboLog(onlyErrors: boolean): Promise<R<LogRow[]>> {
  try {
    const { admin } = await owner();
    let q = admin.from("qbo_log").select("id, at, method, path, entity, local_id, qbo_id, ok, status, ms, error").order("id", { ascending: false }).limit(200);
    if (onlyErrors) q = q.eq("ok", false);
    const { data } = await q;
    return { ok: true, data: (data || []) as LogRow[] };
  } catch (e) { return fail(e); }
}

/* ---------- differences between ours and QuickBooks (linked customers) ---------- */

/** Field groups the owner can opt in to send, all at once. */
const FIELD_GROUPS: Record<string, OwnedField[]> = { names: ["DisplayName", "CompanyName"], emails: ["PrimaryEmailAddr"], phones: ["PrimaryPhone"], addresses: ["BillAddr", "ShipAddr"], terms: ["SalesTermRef"], taxable: ["Taxable"] };
export type DiffRow = { linkId: number; localId: string; localName: string; qboId: string; fields: { field: string; label: string; ours: string; qbo: string }[]; seenAt: string | null };

/** Linked customers (primary links) whose QuickBooks values differ from ours in fields that weren't changed here since linking. */
export async function qboDifferences(): Promise<R<{ rows: DiffRow[]; unread: number }>> {
  try {
    const { admin } = await owner();
    const qs = await loadQboSettings(admin);
    const { data: links } = await admin.from("qbo_links").select("id, local_id, qbo_id, last_sent, last_seen_qbo, last_seen_at, qbo_owned_fields, ours_base").eq("realm_id", qs.realm_id).eq("entity", "customer").eq("is_primary", true).limit(5000);
    const ls = links || [];
    const ids = [...new Set(ls.map((l) => String(l.local_id)))];
    const cs = new Map<string, OurCustomer>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await admin.from("customers").select("id, company, name, email, phone, address, ship_address, tax_exempt, payment_terms").in("id", ids.slice(i, i + 300));
      for (const c of (data || []) as OurCustomer[]) cs.set(c.id, c);
    }
    const rows: DiffRow[] = [];
    let unread = 0;
    for (const l of ls) {
      const c = cs.get(String(l.local_id));
      if (!c) continue;
      if (!l.last_seen_qbo) { unread++; continue; }
      const cur = l.last_seen_qbo as Parameters<typeof ownedFromQbo>[0] & { Id: string; SyncToken: string };
      const d = customerDiff(c, cur, (l.last_sent as Owned) || ownedFromQbo(cur), qs, l.qbo_owned_fields || [], [], (l.ours_base as Owned) || ownedFromOurs(c, qs));
      if (d.differences.length) rows.push({ linkId: l.id, localId: c.id, localName: String(c.company || c.name || ""), qboId: String(l.qbo_id), fields: d.differences, seenAt: l.last_seen_at });
    }
    rows.sort((a, b) => a.localName.localeCompare(b.localName));
    return { ok: true, data: { rows, unread } };
  } catch (e) { return fail(e); }
}

/** Read every linked customer from QuickBooks (100 at a time) so the differences are current. Read only. */
export async function qboReadLinkedCustomers(): Promise<R> {
  try {
    const { admin } = await owner();
    const qs = await loadQboSettings(admin);
    const { data: links } = await admin.from("qbo_links").select("id, qbo_id, last_sent").eq("realm_id", qs.realm_id).eq("entity", "customer").limit(5000);
    const byQ = new Map<string, Record<string, unknown>>((links || []).map((l: Record<string, unknown>) => [String(l.qbo_id), l] as [string, Record<string, unknown>]));
    const q = new Qbo(admin, { entity: "customer" });
    const all = [...byQ.keys()];
    let n = 0;
    for (let i = 0; i < all.length; i += 100) {
      const recs = await q.query<{ Id: string; SyncToken: string }>("Customer", `WHERE Id IN (${all.slice(i, i + 100).map((x) => `'${x}'`).join(", ")}) AND Active IN (true, false)`);
      for (const r of recs) {
        const l = byQ.get(String(r.Id)); if (!l) continue;
        await admin.from("qbo_links").update({ last_seen_qbo: r, last_seen_at: new Date().toISOString(), sync_token: r.SyncToken, ...(l.last_sent ? {} : { last_sent: ownedFromQbo(r as Parameters<typeof ownedFromQbo>[0]) }) }).eq("id", l.id);
        n++;
      }
    }
    return { ok: true, msg: `Read ${n} linked customers from QuickBooks.` };
  } catch (e) { return fail(e); }
}

/**
 * Opt in: send ours for a group of fields (names, emails, phones, addresses, terms, taxable), for every linked customer
 * with a difference there, or only the ones given. Their baseline for those fields is cleared so the next run sends ours.
 */
export async function qboSendOurs(group: string, linkIds?: number[]): Promise<R> {
  try {
    const { admin } = await owner();
    const fields = FIELD_GROUPS[group];
    if (!fields) return { ok: false, error: "Unknown field group." };
    const r = await qboDifferences();
    if (!r.ok) return r;
    const pick = r.data!.rows.filter((x) => (!linkIds || linkIds.includes(x.linkId)) && x.fields.some((f) => fields.includes(f.field as OwnedField)));
    for (const x of pick) {
      const { data: l } = await admin.from("qbo_links").select("ours_base").eq("id", x.linkId).maybeSingle();
      const base = { ...((l?.ours_base as Record<string, unknown>) || {}) };
      for (const f of fields) delete base[f];
      await admin.from("qbo_links").update({ ours_base: base, updated_at: new Date().toISOString() }).eq("id", x.linkId);
      await admin.rpc("qbo_enqueue", { p_entity: "customer", p_local_id: x.localId, p_op: "upsert", p_reason: `send ours: ${group}` });
    }
    return { ok: true, msg: `${pick.length} customer${pick.length === 1 ? "" : "s"} queued to send our ${group}. They go with the next run (preview first, if the sync is in preview).` };
  } catch (e) { return fail(e); }
}
