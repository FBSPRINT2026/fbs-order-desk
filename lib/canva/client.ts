import "server-only";
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as edVerify, type KeyObject } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/lib/config";

/**
 * Canva Connect API client (server only). Nick's Canva sign-in is kept in integration_tokens, name 'canva' (row
 * security on, no policies; never sent to a browser or logged): access token (about 4 hours) and refresh token.
 * Canva's refresh tokens are single use: every refresh returns a new one, always saved. Several server instances can
 * run at once, so a refresh holds a short lease and saves only if the refresh token is still the one used
 * (compare-and-swap), the same as QuickBooks (lib/qbo/client.ts).
 *
 * Settings, from Vercel's Environment Variables (never in code):
 *   CANVA_CLIENT_ID, CANVA_CLIENT_SECRET  the Canva integration's credentials (canva.com/developers → Your integrations)
 *   CANVA_REDIRECT_URI                    optional; default https://portal.fbsprint.com/api/canva/callback
 *   CANVA_RETURN_URL                      optional; default https://portal.fbsprint.com/api/canva/return
 */

export const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
export const CANVA_API = "https://api.canva.com/rest/v1";
export const CANVA_SCOPES = ["design:content:read", "design:content:write", "design:meta:read", "asset:read", "asset:write", "profile:read"];

export type CanvaEnv = { configured: boolean; missing: string[]; clientId: string; redirectUri: string; returnUrl: string };
export function canvaEnv(): CanvaEnv {
  const e = process.env as Record<string, string | undefined>;
  const missing: string[] = [];
  if (!e.CANVA_CLIENT_ID?.trim()) missing.push("CANVA_CLIENT_ID");
  if (!e.CANVA_CLIENT_SECRET?.trim()) missing.push("CANVA_CLIENT_SECRET");
  return {
    configured: !missing.length, missing, clientId: (e.CANVA_CLIENT_ID || "").trim(),
    redirectUri: (e.CANVA_REDIRECT_URI || "").trim() || `${SITE_URL}/api/canva/callback`,
    returnUrl: (e.CANVA_RETURN_URL || "").trim() || `${SITE_URL}/api/canva/return`,
  };
}

export type CanvaTokens = { access_token: string; refresh_token: string; access_expires_at: string; scope?: string; connected_by: string; connected_at: string; display_name?: string; user_id?: string; team_id?: string };

export class CanvaError extends Error {
  constructor(message: string, public status = 0, public code = "", public transient = false) { super(message); }
  /** Canva says this account can't open the design (or can't see it at all) */
  get noAccess() { return this.status === 403 || this.status === 404 || this.code === "permission_denied" || this.code === "design_not_found"; }
}
export class CanvaNotConnected extends CanvaError {}

/** What staff are told when Nick's Canva account can't open a customer's design */
export const NO_ACCESS_MSG = "Canva says this design isn't shared with the shop's Canva account. Open the customer's Canva link once while signed in to Canva (it joins your account), then press Get the design from Canva again.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const basic = () => "Basic " + Buffer.from(`${process.env.CANVA_CLIENT_ID?.trim()}:${process.env.CANVA_CLIENT_SECRET?.trim()}`).toString("base64");

/* ---------------- sign-in (OAuth 2.0 with PKCE) ---------------- */

/** A fresh PKCE verifier (43–128 URL-safe characters) and its S256 challenge, and the OAuth state. */
export function newPkce() {
  const verifier = randomBytes(48).toString("base64url"); // 64 characters
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  return { verifier, challenge, state };
}

/** The verifier and state ride in an httpOnly cookie, signed with the app secret so the callback knows it came from us. */
const signCookie = (v: string) => createHmac("sha256", `canva-oauth:${process.env.CANVA_CLIENT_SECRET || ""}`).update(v).digest("base64url");
export function oauthCookie(state: string, verifier: string) { const v = `${state}.${verifier}`; return `${v}.${signCookie(v)}`; }
export function readOauthCookie(cookie: string | undefined, state: string | null): string | null {
  if (!cookie || !state) return null;
  const [s, verifier, sig] = cookie.split(".");
  if (!s || !verifier || !sig || s !== state) return null;
  const want = Buffer.from(signCookie(`${s}.${verifier}`)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? verifier : null;
}

export function authorizeUrl(state: string, challenge: string) {
  const env = canvaEnv();
  const u = new URL(CANVA_AUTH_URL);
  u.searchParams.set("client_id", env.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", env.redirectUri);
  u.searchParams.set("scope", CANVA_SCOPES.join(" "));
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  // spaces between scopes as %20 (Canva's own example), not "+"; nothing else here can hold a "+"
  return u.toString().replace(/\+/g, "%20");
}

async function tokenCall(params: Record<string, string>) {
  let r: Response;
  try {
    r = await fetch(`${CANVA_API}/oauth/token`, { method: "POST", headers: { Authorization: basic(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (e) { throw new CanvaError(`Canva sign-in: ${e instanceof Error ? e.message : String(e)}`, 0, "network", true); }
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string; code?: string; message?: string };
  if (!r.ok || !j.access_token || !j.refresh_token) throw new CanvaError(`Canva sign-in: ${j.error_description || j.message || j.error || j.code || r.status}`, r.status, j.error || j.code || "", r.status === 429 || r.status >= 500);
  return { access_token: j.access_token, refresh_token: j.refresh_token, access_expires_at: new Date(Date.now() + (j.expires_in || 14400) * 1000).toISOString(), ...(j.scope ? { scope: j.scope } : {}) };
}

export async function loadTokens(admin: SupabaseClient): Promise<CanvaTokens | null> {
  const { data } = await admin.from("integration_tokens").select("data").eq("name", "canva").maybeSingle();
  const d = (data?.data || {}) as Partial<CanvaTokens>;
  return d.refresh_token && d.access_token ? (d as CanvaTokens) : null;
}

/** Back from Canva's sign-in: trade the code (with the PKCE verifier) for tokens, keep them, note whose account it is. */
export async function connectWithCode(admin: SupabaseClient, code: string, verifier: string, by: string) {
  const t = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: canvaEnv().redirectUri });
  const tokens: CanvaTokens = { ...t, connected_by: by, connected_at: new Date().toISOString() };
  const { error } = await admin.from("integration_tokens").upsert({ name: "canva", data: tokens, updated_at: new Date().toISOString(), updated_by: by });
  if (error) throw new CanvaError(`Couldn't save the Canva sign-in: ${error.message}`);
  cache = { token: t.access_token, until: new Date(t.access_expires_at).getTime() - 5 * 60000 };
  // whose Canva account (shown in Settings); best effort
  const c = new Canva(admin);
  const [p, me] = await Promise.all([
    c.request<{ profile?: { display_name?: string } }>("GET", "/users/me/profile").catch(() => null),
    c.request<{ team_user?: { user_id?: string; team_id?: string } }>("GET", "/users/me").catch(() => null),
  ]);
  const extra = { display_name: p?.profile?.display_name || "", user_id: me?.team_user?.user_id || "", team_id: me?.team_user?.team_id || "" };
  const cur = await loadTokens(admin);
  if (cur) await admin.from("integration_tokens").update({ data: { ...cur, ...extra } }).eq("name", "canva").eq("data->>refresh_token", cur.refresh_token);
  return { name: extra.display_name };
}

/** Disconnect: revoke at Canva (best effort) and forget the tokens. Designs already saved stay. */
export async function disconnect(admin: SupabaseClient, by: string) {
  const t = await loadTokens(admin);
  if (t && canvaEnv().configured) {
    await fetch(`${CANVA_API}/oauth/revoke`, { method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: t.refresh_token }), cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  }
  cache = null;
  await admin.from("integration_tokens").upsert({ name: "canva", data: { disconnected_at: new Date().toISOString(), previous_name: t?.display_name || "" }, updated_at: new Date().toISOString(), updated_by: by });
}

/** Canva is set up in Vercel and connected (doesn't call Canva). */
export async function canvaConnected(admin: SupabaseClient) { return canvaEnv().configured && !!(await loadTokens(admin)); }

let cache: { token: string; until: number } | null = null;
let refreshing: Promise<string> | null = null;

/**
 * A current access token (refreshed when it has under 5 minutes left, or when `force`). The token row is re-read first
 * (another instance may have refreshed already); one refresher at a time holds a 30-second lease; the new tokens are
 * saved only if the refresh token is still the one used. A refresh Canva refuses means connecting again.
 */
async function accessToken(admin: SupabaseClient, force = false): Promise<string> {
  if (!force && cache && cache.until > Date.now()) return cache.token;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const env = canvaEnv();
    if (!env.configured) throw new CanvaNotConnected(`Canva isn't set up: add ${env.missing.join(" and ")} in Vercel.`);
    const fresh = (t: CanvaTokens) => new Date(t.access_expires_at).getTime() - 5 * 60000 > Date.now();
    for (let attempt = 0; attempt < 8; attempt++) {
      const t = await loadTokens(admin);
      if (!t) throw new CanvaNotConnected("Canva isn't connected (Settings → Canva → Connect).");
      if (fresh(t) && !(force && attempt === 0)) {
        cache = { token: t.access_token, until: new Date(t.access_expires_at).getTime() - 5 * 60000 };
        return t.access_token;
      }
      const { data: lease } = await admin.rpc("integration_token_lease", { p_name: "canva", p_seconds: 30 });
      if (!lease) { await sleep(1500); force = false; continue; } // another instance is refreshing: use its result
      let n: Awaited<ReturnType<typeof tokenCall>>;
      try { n = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token }); }
      catch (e) {
        await admin.from("integration_tokens").update({ data: { ...t, refresh_lease_until: null } }).eq("name", "canva").eq("data->>refresh_token", t.refresh_token);
        if (e instanceof CanvaError && !e.transient) throw new CanvaNotConnected(`Canva refused the sign-in refresh (${e.message}): connect again in Settings → Canva.`);
        throw e;
      }
      const next: CanvaTokens = { ...t, ...n };
      const { data: swapped } = await admin.rpc("integration_token_swap", { p_name: "canva", p_old_refresh: t.refresh_token, p_new: next });
      if (!swapped) { force = false; continue; } // someone else saved a newer one meanwhile: re-read and use theirs
      cache = { token: next.access_token, until: new Date(next.access_expires_at).getTime() - 5 * 60000 };
      return next.access_token;
    }
    throw new CanvaError("Couldn't get a Canva sign-in (another refresh kept it busy). Try again.", 0, "", true);
  })();
  try { return await refreshing; } finally { refreshing = null; }
}

/* ---------------- requests ---------------- */

export type CanvaDesign = { id: string; title?: string; urls?: { edit_url?: string; view_url?: string }; page_count?: number; thumbnail?: { url?: string; width?: number; height?: number } };
type Fmt = "pdf" | "png";

/** Canva's design id from a design link: https://www.canva.com/design/DAHXQayiugo/fkG391…/edit → DAHXQayiugo */
export function designIdFrom(url: string): string | null {
  try { const m = new URL(url).pathname.match(/\/design\/([A-Za-z0-9_-]{6,})/); return m ? m[1] : null; } catch { return null; }
}

export class Canva {
  constructor(private admin: SupabaseClient) {}

  /** One API call: refreshes once on 401; retries 429 / 5xx / network with backoff (Retry-After honored, capped at 10 s). */
  async request<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let token = await accessToken(this.admin);
    let refreshed = false;
    for (let attempt = 1; ; attempt++) {
      let r: Response | null = null, j: Record<string, unknown> = {}, netErr = "";
      try {
        r = await fetch(`${CANVA_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(30_000) });
        j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      } catch (e) { netErr = e instanceof Error ? e.message : String(e); }
      if (r?.ok) return j as T;
      const status = r?.status || 0, code = String(j.code || ""), message = String(j.message || "") || netErr || `HTTP ${status}`;
      if (status === 401 && !refreshed) { refreshed = true; token = await accessToken(this.admin, true); continue; }
      const transient = !!netErr || status === 429 || status >= 500 || status === 0;
      if (transient && attempt < 4) {
        const ra = Math.min(10, Number(r?.headers.get("retry-after")) || 0);
        await sleep(ra ? ra * 1000 : [0, 1500, 4000, 9000][attempt]);
        continue;
      }
      throw new CanvaError(`Canva: ${message}${code ? ` (${code})` : ""}`, status, code, transient);
    }
  }

  async getDesign(designId: string): Promise<CanvaDesign> {
    const r = await this.request<{ design: CanvaDesign }>("GET", `/designs/${encodeURIComponent(designId)}`);
    return r.design;
  }

  /** A new blank design, `w` × `h` pixels (Canva: 40–8000 each, 25 million px² at most). Its edit link lasts 30 days. */
  async createDesign(widthPx: number, heightPx: number, title: string): Promise<CanvaDesign> {
    const clamp = (v: number) => Math.max(40, Math.min(8000, Math.round(v)));
    const r = await this.request<{ design: CanvaDesign }>("POST", "/designs", { design_type: { type: "custom", width: clamp(widthPx), height: clamp(heightPx) }, title: title.slice(0, 255) || "Design" });
    return r.design;
  }

  /**
   * Export a design and download it. PDF: print quality ("pro"), vector where the design is vector. PNG: see-through
   * background, lossless, first page only. Canva makes the file in the background: the job is checked until it's done
   * (about 2 minutes at most). Download links last 24 hours; the file is fetched right away.
   */
  async exportDesign(designId: string, fmt: Fmt): Promise<{ buf: Buffer; type: string; pages: number }> {
    const format = fmt === "pdf"
      ? { type: "pdf", export_quality: "pro" }
      : { type: "png", export_quality: "pro", transparent_background: true, lossless: true, pages: [1] };
    let job = (await this.request<{ job: { id: string; status: string; urls?: string[]; error?: { code?: string; message?: string } } }>("POST", "/exports", { design_id: designId, format })).job;
    const t0 = Date.now();
    for (let i = 0; job.status === "in_progress" && Date.now() - t0 < 110_000; i++) {
      await sleep(Math.min(4000, 1000 + i * 500));
      job = (await this.request<{ job: typeof job }>("GET", `/exports/${encodeURIComponent(job.id)}`)).job;
    }
    if (job.status === "in_progress") throw new CanvaError("Canva is still making the file. Try again in a minute.", 0, "timeout", true);
    if (job.status !== "success" || !job.urls?.length) {
      const c = job.error?.code || "";
      throw new CanvaError(c === "license_required" ? "Canva says this design uses something that needs a Canva license (Pro elements). Open it in Canva once, then try again." : `Canva couldn't export the design: ${job.error?.message || c || job.status}`, 0, c);
    }
    const r = await fetch(job.urls[0], { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new CanvaError(`Couldn't download the file from Canva (${r.status}).`, r.status, "download", r.status >= 500);
    const buf = Buffer.from(await r.arrayBuffer());
    const type = fmt === "pdf" ? "application/pdf" : "image/png";
    return { buf, type, pages: job.urls.length };
  }
}

/* ---------------- Return navigation ---------------- */

/** Canva's signing keys (Ed25519), cached for an hour; fetched again for a key id we haven't seen. */
let keys: { at: number; byKid: Map<string, KeyObject> } | null = null;
async function canvaKey(kid: string): Promise<KeyObject | null> {
  if (!keys || Date.now() - keys.at > 3600_000 || !keys.byKid.has(kid)) {
    const r = await fetch(`${CANVA_API}/connect/keys`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const j = r && r.ok ? ((await r.json().catch(() => ({}))) as { keys?: { kid: string; kty: string; crv: string; x: string }[] }) : {};
    const byKid = new Map<string, KeyObject>();
    for (const k of j.keys || []) {
      try { byKid.set(k.kid, createPublicKey({ key: { kty: k.kty, crv: k.crv, x: k.x }, format: "jwk" })); } catch { /* unsupported key */ }
    }
    if (byKid.size) keys = { at: Date.now(), byKid };
  }
  return keys?.byKid.get(kid) || null;
}

export type ReturnClaims = { aud: string; exp: number; sub?: string; team_id?: string; type: string; jti?: string; design_id: string; correlation_state: string };

/** Check the correlation_jwt Canva sends back with Return: Canva's signature, our client id, type "rti", not expired. */
export async function verifyReturnJwt(jwt: string): Promise<ReturnClaims> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new CanvaError("That return from Canva isn't valid.");
  const dec = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  let header: { alg?: string; kid?: string }, claims: ReturnClaims;
  try { header = dec(parts[0]); claims = dec(parts[1]); } catch { throw new CanvaError("That return from Canva isn't valid."); }
  if ((header.alg !== "EdDSA" && header.alg !== "Ed25519") || !header.kid) throw new CanvaError(`That return from Canva isn't signed the way Canva signs (${header.alg || "no algorithm"}).`);
  const key = await canvaKey(header.kid);
  if (!key) throw new CanvaError("Couldn't get Canva's signing key to check the return. Try again.", 0, "keys", true);
  const ok = edVerify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new CanvaError("That return from Canva didn't pass the signature check.");
  const aud = Array.isArray(claims.aud) ? (claims.aud as unknown as string[]) : [claims.aud];
  if (!aud.includes(canvaEnv().clientId)) throw new CanvaError("That return from Canva is for a different integration.");
  if (claims.type !== "rti") throw new CanvaError("That return from Canva isn't a return-navigation token.");
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new CanvaError("That return from Canva has expired. Open the design from the Mockup Creator again.");
  if (!claims.design_id || !claims.correlation_state) throw new CanvaError("That return from Canva is missing the design.");
  return claims;
}

/** Canva's edit link with our correlation_state, so Return comes back to this trip */
export function withCorrelation(editUrl: string, state: string) {
  const u = new URL(editUrl);
  u.searchParams.set("correlation_state", state);
  return u.toString();
}
