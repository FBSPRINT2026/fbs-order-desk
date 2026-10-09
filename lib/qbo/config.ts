import { createHash, timingSafeEqual } from "crypto";
import { SITE_URL } from "@/lib/config";

/**
 * QuickBooks Online app settings, from Vercel's Environment Variables (added by Nicholas; never in code):
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET  the Intuit developer app's keys (Keys & credentials, Production or Development)
 *   QBO_ENV                           "production" or "sandbox" (which QuickBooks the keys are for)
 *   QBO_REDIRECT_URI                  optional; default https://portal.fbsprint.com/api/qbo/callback (register it in the app)
 *   QBO_WEBHOOK_TOKEN                 optional; the webhook "verifier token", to accept QuickBooks' change notices
 * Nothing here returns a secret: only whether each one is set.
 */
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_MINOR_VERSION = "75";

export type QboEnvStatus = { configured: boolean; missing: string[]; env: "production" | "sandbox" | ""; apiBase: string; redirectUri: string; webhook: boolean; problems: string[] };

export function qboEnv(): QboEnvStatus {
  const e = process.env as Record<string, string | undefined>;
  const missing: string[] = [], problems: string[] = [];
  if (!e.QBO_CLIENT_ID?.trim()) missing.push("QBO_CLIENT_ID");
  if (!e.QBO_CLIENT_SECRET?.trim()) missing.push("QBO_CLIENT_SECRET");
  const raw = (e.QBO_ENV || "").trim().toLowerCase();
  const env = raw === "production" || raw === "sandbox" ? raw : "";
  if (!raw) missing.push("QBO_ENV");
  else if (!env) problems.push(`QBO_ENV is "${raw}": it must be "production" or "sandbox".`);
  const redirectUri = (e.QBO_REDIRECT_URI || "").trim() || `${SITE_URL}/api/qbo/callback`;
  return {
    configured: !missing.length && !problems.length, missing, env, problems, redirectUri, webhook: !!e.QBO_WEBHOOK_TOKEN?.trim(),
    apiBase: env === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com",
  };
}

/** Constant-time comparison for the runner's token (x-sync-token). */
export function tokenMatches(given: string | null | undefined, want: string | null | undefined): boolean {
  if (!given || !want) return false;
  const a = createHash("sha256").update(String(given)).digest(), b = createHash("sha256").update(String(want)).digest();
  return timingSafeEqual(a, b);
}
