import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QBO_AUTH_URL, QBO_MINOR_VERSION, QBO_REVOKE_URL, QBO_SCOPE, QBO_TOKEN_URL, qboEnv } from "@/lib/qbo/config";

/**
 * QuickBooks Online API client (server only). The sign-in is kept in integration_tokens, name 'quickbooks'
 * (row security on, no policies): realm, access token (1 hour), refresh token (100 days, and a new one comes with
 * every refresh: always saved). Requests are paced well under Intuit's ~500/minute per company, retried on 429 / 5xx
 * with backoff, never retried on validation errors. Every request is logged to qbo_log as a summary (never a token).
 */

export type QboTokens = { realm_id: string; access_token: string; refresh_token: string; access_expires_at: string; refresh_expires_at: string; connected_by: string; connected_at: string; env: string };
export type QboFaultError = { Message?: string; Detail?: string; code?: string; element?: string };

export class QboError extends Error {
  constructor(message: string, public status = 0, public code = "", public transient = false, public detail = "", public errors: QboFaultError[] = []) { super(message); }
  /** QuickBooks refused the data itself (validation, duplicate name, stale object…): retrying won't help */
  get validation() { return !this.transient && this.status >= 400 && this.status < 500 && this.status !== 401 && this.status !== 403; }
}
export class QboNotConnected extends QboError {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const basic = () => "Basic " + Buffer.from(`${process.env.QBO_CLIENT_ID?.trim()}:${process.env.QBO_CLIENT_SECRET?.trim()}`).toString("base64");

/* ---------------- sign-in ---------------- */

/**
 * Intuit's sign-in addresses, read from its discovery document (as Intuit asks apps to), kept for a day per server.
 * The built-in addresses are the fallback if the document can't be read.
 */
type Endpoints = { auth: string; token: string; revoke: string };
let endpoints: { env: string; at: number; e: Endpoints } | null = null;
export async function oauthEndpoints(): Promise<Endpoints> {
  const env = qboEnv().env || "production";
  if (endpoints && endpoints.env === env && Date.now() - endpoints.at < 86_400_000) return endpoints.e;
  const fallback = { auth: QBO_AUTH_URL, token: QBO_TOKEN_URL, revoke: QBO_REVOKE_URL };
  try {
    const url = env === "sandbox" ? "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration" : "https://developer.api.intuit.com/.well-known/openid_configuration";
    const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { authorization_endpoint?: string; token_endpoint?: string; revocation_endpoint?: string };
    const e = { auth: j.authorization_endpoint || fallback.auth, token: j.token_endpoint || fallback.token, revoke: j.revocation_endpoint || fallback.revoke };
    endpoints = { env, at: Date.now(), e };
    return e;
  } catch { return fallback; }
}

export async function authorizeUrl(state: string) {
  const env = qboEnv();
  const u = new URL((await oauthEndpoints()).auth);
  u.searchParams.set("client_id", process.env.QBO_CLIENT_ID!.trim());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", QBO_SCOPE);
  u.searchParams.set("redirect_uri", env.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenCall(params: Record<string, string>) {
  const r = await fetch((await oauthEndpoints()).token, { method: "POST", headers: { Authorization: basic(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token || !j.refresh_token) throw new QboError(`QuickBooks sign-in: ${j.error_description || j.error || r.status}`, r.status, j.error || "", r.status >= 500);
  const now = Date.now();
  return { access_token: j.access_token, refresh_token: j.refresh_token, access_expires_at: new Date(now + (j.expires_in || 3600) * 1000).toISOString(), refresh_expires_at: new Date(now + (j.x_refresh_token_expires_in || 8640000) * 1000).toISOString() };
}

export async function loadTokens(admin: SupabaseClient): Promise<QboTokens | null> {
  const { data } = await admin.from("integration_tokens").select("data").eq("name", "quickbooks").maybeSingle();
  const d = (data?.data || {}) as Partial<QboTokens>;
  return d.realm_id && d.refresh_token ? (d as QboTokens) : null;
}
async function saveTokens(admin: SupabaseClient, t: QboTokens, by: string) {
  const { error } = await admin.from("integration_tokens").upsert({ name: "quickbooks", data: t, updated_at: new Date().toISOString(), updated_by: by });
  if (error) throw new QboError(`Couldn't save the QuickBooks sign-in: ${error.message}`);
  cache = { realm: t.realm_id, token: t.access_token, until: new Date(t.access_expires_at).getTime() - 5 * 60000 };
}

/** Back from Intuit's sign-in: trade the code for tokens and keep them with the company (realm) id. */
export async function connectWithCode(admin: SupabaseClient, code: string, realmId: string, by: string) {
  const env = qboEnv();
  const { data: was } = await admin.from("qbo_settings").select("realm_id, previous_realm_id").eq("id", 1).maybeSingle();
  const { data: tokWas } = await admin.from("integration_tokens").select("data").eq("name", "quickbooks").maybeSingle();
  const before = String(was?.realm_id || (tokWas?.data as { previous_realm_id?: string } | null)?.previous_realm_id || "");
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: env.redirectUri });
  const tokens: QboTokens = { realm_id: realmId, ...t, connected_by: by, connected_at: new Date().toISOString(), env: env.env };
  await saveTokens(admin, tokens, by);
  let company = "";
  try { const c = await new Qbo(admin).companyInfo(); company = c?.CompanyName || ""; } catch { /* shown as unknown */ }
  // a different QuickBooks company than before: the sync is turned off and back to preview, and the page warns
  // (links, matching and the queue belong to the old company; nothing is sent to the new one until the owner checks)
  const changed = !!before && before !== realmId;
  await admin.from("qbo_settings").update({
    realm_id: realmId, company_name: company, updated_at: new Date().toISOString(), updated_by: by,
    ...(changed ? { enabled: false, mode: "preview", live_since: null, previous_realm_id: before, realm_warning: `Connected to a different QuickBooks company (${company || realmId}) than before (company ${before}). The sync was turned off and set to preview. Links and matching from the other company don't apply here: run Customer matching again before turning it back on.` } : {}),
  }).eq("id", 1);
  return { realmId, company, changed };
}

/** Disconnect: revoke at Intuit (best effort) and forget the tokens. Links and history stay. */
export async function disconnect(admin: SupabaseClient, by: string) {
  const t = await loadTokens(admin);
  if (t && qboEnv().configured) {
    await fetch((await oauthEndpoints()).revoke, { method: "POST", headers: { Authorization: basic(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ token: t.refresh_token }), cache: "no-store" }).catch(() => null);
  }
  cache = null;
  await admin.from("integration_tokens").upsert({ name: "quickbooks", data: { disconnected_at: new Date().toISOString(), realm_id: "", previous_realm_id: t?.realm_id || "" }, updated_at: new Date().toISOString(), updated_by: by });
}

let cache: { realm: string; token: string; until: number } | null = null;
let refreshing: Promise<{ realm: string; token: string }> | null = null;

/**
 * A current access token (refreshed when it has under 5 minutes left, or when `force`). Several server instances can
 * run at once: the token row is re-read first (another may have refreshed already), one refresher at a time holds a
 * short lease, and the new tokens are saved only if the refresh token is still the one used (compare-and-swap).
 */
async function accessToken(admin: SupabaseClient, force = false): Promise<{ realm: string; token: string }> {
  if (!force && cache && cache.until > Date.now()) return cache;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const env = qboEnv();
    if (!env.configured) throw new QboNotConnected(`QuickBooks isn't set up: add ${[...env.missing, ...env.problems].join(", ")} in Vercel.`);
    const fresh = (t: QboTokens) => new Date(t.access_expires_at).getTime() - 5 * 60000 > Date.now();
    for (let attempt = 0; attempt < 8; attempt++) {
      const t = await loadTokens(admin);
      if (!t) throw new QboNotConnected("QuickBooks isn't connected (Settings → QuickBooks → Connect).");
      if (t.env && env.env && t.env !== env.env) throw new QboNotConnected(`The QuickBooks sign-in is for ${t.env}, but QBO_ENV is ${env.env}. Connect again (Settings → QuickBooks).`);
      if (fresh(t) && !(force && attempt === 0)) {
        cache = { realm: t.realm_id, token: t.access_token, until: new Date(t.access_expires_at).getTime() - 5 * 60000 };
        return cache;
      }
      if (new Date(t.refresh_expires_at).getTime() < Date.now()) throw new QboNotConnected("The QuickBooks sign-in expired (100 days unused): connect again in Settings → QuickBooks.");
      const { data: lease } = await admin.rpc("qbo_token_lease", { p_seconds: 30 });
      if (!lease) { await sleep(1500); force = false; continue; } // another instance is refreshing: use its result
      let n: Awaited<ReturnType<typeof tokenCall>>;
      try { n = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token }); }
      catch (e) {
        await admin.from("integration_tokens").update({ data: { ...t, refresh_lease_until: null } }).eq("name", "quickbooks").eq("data->>refresh_token", t.refresh_token);
        if (e instanceof QboError && !e.transient) throw new QboNotConnected(`QuickBooks refused the sign-in refresh (${e.message}): connect again in Settings → QuickBooks.`);
        throw e;
      }
      const next: QboTokens = { ...t, ...n };
      const { data: swapped } = await admin.rpc("qbo_token_swap", { p_old_refresh: t.refresh_token, p_new: next });
      if (!swapped) { force = false; continue; } // someone else saved a newer one meanwhile: re-read and use theirs
      cache = { realm: next.realm_id, token: next.access_token, until: new Date(next.access_expires_at).getTime() - 5 * 60000 };
      return cache;
    }
    throw new QboError("Couldn't get a QuickBooks sign-in (another refresh kept it busy). Will try again.", 0, "", true);
  })();
  try { return await refreshing; } finally { refreshing = null; }
}
/** Refresh the sign-in now (keeps the 100-day refresh token from lapsing while the sync is off). */
export async function keepAlive(admin: SupabaseClient) { await accessToken(admin, true); }

/* ---------------- requests ---------------- */

// pacing: at most ~7 requests a second from one server (Intuit allows ~500 a minute per company)
let nextAt = 0;
async function pace() { const now = Date.now(), wait = Math.max(0, nextAt - now); nextAt = Math.max(now, nextAt) + 140; if (wait) await sleep(wait); }

export type Ctx = { entity?: string; localId?: string; qboId?: string; queueId?: number };
type Resp = Record<string, unknown>;

export class Qbo {
  constructor(private admin: SupabaseClient, private ctx: Ctx = {}) {}
  with(ctx: Ctx) { return new Qbo(this.admin, { ...this.ctx, ...ctx }); }

  async request<T = Resp>(method: "GET" | "POST", path: string, opts: { params?: Record<string, string>; body?: unknown; label?: string } = {}): Promise<T> {
    const env = qboEnv();
    let auth = await accessToken(this.admin);
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      const u = new URL(`${env.apiBase}/v3/company/${auth.realm}/${path}`);
      u.searchParams.set("minorversion", QBO_MINOR_VERSION);
      for (const [k, v] of Object.entries(opts.params || {})) u.searchParams.set(k, v);
      await pace();
      const t0 = Date.now();
      let r: Response | null = null, j: Resp = {}, netErr = "";
      try {
        r = await fetch(u.toString(), { method, headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, cache: "no-store" });
        j = (await r.json().catch(() => ({}))) as Resp;
      } catch (e) { netErr = e instanceof Error ? e.message : String(e); }
      const ms = Date.now() - t0, status = r?.status || 0;
      const fault = (j.Fault || j.fault) as { Error?: QboFaultError[]; error?: QboFaultError[]; type?: string } | undefined;
      const errs = fault?.Error || fault?.error || [];
      const msg = netErr || (errs.length ? errs.map((e) => [e.Message, e.Detail].filter(Boolean).join(": ") + (e.code ? ` (code ${e.code})` : "")).join("; ") : r && !r.ok ? `HTTP ${status}` : "");
      const ok = !!r && r.ok && !fault;
      await this.log({ method, path: (opts.label || path).slice(0, 400), ok, status, ms, error: ok ? null : msg.slice(0, 1000), tid: r?.headers.get("intuit_tid") || null });
      if (ok) return j as T;
      // the access token was refused: refresh once and try again
      if (status === 401 && !refreshed) { refreshed = true; auth = await accessToken(this.admin, true); continue; }
      const transient = !!netErr || status === 429 || status >= 500 || status === 0;
      if (transient && attempt < 4) {
        // capped so a run can't sleep past its lock (QuickBooks' Retry-After can be long: the row just retries later)
        const ra = Math.min(10, Number(r?.headers.get("retry-after")) || 0);
        await sleep(ra ? ra * 1000 : [0, 1000, 3000, 8000][attempt]);
        continue;
      }
      throw new QboError(msg || "QuickBooks request failed", status, String(errs[0]?.code || ""), transient, String(errs[0]?.Detail || ""), errs);
    }
  }

  private async log(x: { method: string; path: string; ok: boolean; status: number; ms: number; error: string | null; tid: string | null }) {
    await this.admin.from("qbo_log").insert({ method: x.method, path: x.path, entity: this.ctx.entity || null, local_id: this.ctx.localId || null, qbo_id: this.ctx.qboId || null, queue_id: this.ctx.queueId || null, ok: x.ok, status: x.status, ms: x.ms, error: x.error, intuit_tid: x.tid });
  }

  /** A query, all pages (1,000 at a time). `where` is everything after FROM <entity>, e.g. "WHERE DocNumber = '50012'". */
  async query<T = Resp>(entity: string, where = "", max = 100000, fields = "*"): Promise<T[]> {
    const out: T[] = [];
    for (let start = 1; out.length < max; start += 1000) {
      const q = `SELECT ${fields} FROM ${entity} ${where} STARTPOSITION ${start} MAXRESULTS 1000`.replace(/\s+/g, " ");
      const r = await this.request<{ QueryResponse?: Record<string, unknown> }>("GET", "query", { params: { query: q }, label: `query ${q}` });
      const page = ((r.QueryResponse || {})[entity] || []) as T[];
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }
  async count(entity: string, where = ""): Promise<number> {
    const q = `SELECT COUNT(*) FROM ${entity} ${where}`.trim();
    const r = await this.request<{ QueryResponse?: { totalCount?: number } }>("GET", "query", { params: { query: q }, label: `query ${q}` });
    return r.QueryResponse?.totalCount || 0;
  }
  async read<T = Resp>(entity: string, id: string): Promise<T | null> {
    try {
      const r = await this.with({ qboId: id }).request<Resp>("GET", `${entity.toLowerCase()}/${encodeURIComponent(id)}`);
      return (r[entity] || null) as T | null;
    } catch (e) {
      if (e instanceof QboError && (e.status === 404 || e.code === "610")) return null; // gone / made inactive and deleted
      throw e;
    }
  }
  /** Create. `requestId` makes it idempotent: QuickBooks answers a repeat of the same request id with the first result. */
  async create<T = Resp>(entity: string, body: Record<string, unknown>, requestId: string): Promise<T> {
    const r = await this.request<Resp>("POST", entity.toLowerCase(), { params: { requestid: requestId.slice(0, 50) }, body, label: `create ${entity}` });
    return r[entity] as T;
  }
  /** Sparse update (only the fields given). A stale SyncToken (someone saved in between) is re-read and tried once more. */
  async sparseUpdate<T = Resp>(entity: string, id: string, syncToken: string, fields: Record<string, unknown>): Promise<T> {
    const send = (st: string) => this.with({ qboId: id }).request<Resp>("POST", entity.toLowerCase(), { body: { ...fields, Id: id, SyncToken: st, sparse: true }, label: `update ${entity} ${id}` });
    try { return (await send(syncToken))[entity] as T; }
    catch (e) {
      if (!(e instanceof QboError) || e.code !== "5010") throw e;
      const cur = await this.read<{ SyncToken: string }>(entity, id);
      if (!cur) throw e;
      return (await send(cur.SyncToken))[entity] as T;
    }
  }
  async voidInvoice(id: string, syncToken: string) {
    const r = await this.with({ qboId: id }).request<Resp>("POST", "invoice", { params: { operation: "void" }, body: { Id: id, SyncToken: syncToken }, label: `void Invoice ${id}` });
    return r.Invoice as Resp;
  }
  async deleteEntity(entity: string, id: string, syncToken: string) {
    return this.with({ qboId: id }).request<Resp>("POST", entity.toLowerCase(), { params: { operation: "delete" }, body: { Id: id, SyncToken: syncToken }, label: `delete ${entity} ${id}` });
  }
  /** Change data capture: what changed since a time (up to 30 days back), by entity. */
  async cdc(entities: string[], since: string): Promise<Record<string, Resp[]>> {
    const r = await this.request<{ CDCResponse?: { QueryResponse?: Record<string, Resp[]>[] }[] }>("GET", "cdc", { params: { entities: entities.join(","), changedSince: since }, label: `cdc ${entities.join(",")} since ${since}` });
    const out: Record<string, Resp[]> = {};
    for (const qr of r.CDCResponse?.[0]?.QueryResponse || []) for (const [k, v] of Object.entries(qr)) if (Array.isArray(v)) out[k] = [...(out[k] || []), ...v];
    return out;
  }
  async companyInfo(): Promise<{ CompanyName?: string; LegalName?: string; Country?: string } | null> {
    const t = await accessToken(this.admin);
    return this.read("CompanyInfo", t.realm);
  }
  async preferences(): Promise<Resp | null> {
    const r = await this.request<{ QueryResponse?: { Preferences?: Resp[] } }>("GET", "query", { params: { query: "SELECT * FROM Preferences" }, label: "query Preferences" });
    return r.QueryResponse?.Preferences?.[0] || null;
  }
  async realm() { return (await accessToken(this.admin)).realm; }
}

/** QuickBooks is set up and connected (doesn't call Intuit). */
export async function qboConnected(admin: SupabaseClient) { return qboEnv().configured && !!(await loadTokens(admin)); }
