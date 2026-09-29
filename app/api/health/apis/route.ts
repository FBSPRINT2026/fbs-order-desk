import { NextResponse } from "next/server";
import { sanmarConfigured, sanmarPing } from "@/lib/sanmar";

export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };
let cache: { at: number; body: Record<string, Check> } | null = null;

const clip = (s: string) => s.replace(/\s+/g, " ").slice(0, 160);
async function timed(p: Promise<Check>): Promise<Check> {
  return Promise.race([p, new Promise<Check>((res) => setTimeout(() => res({ ok: false, detail: "no answer within 10 seconds" }), 10000))]);
}

/** Printavo: ask who the account is. */
async function printavo(): Promise<Check> {
  const email = process.env.PRINTAVO_EMAIL?.trim(), token = process.env.PRINTAVO_TOKEN?.trim();
  if (!email || !token) return { ok: false, detail: "PRINTAVO_EMAIL or PRINTAVO_TOKEN is missing" };
  try {
    const r = await fetch("https://www.printavo.com/api/v2", { method: "POST", headers: { "Content-Type": "application/json", email, token }, body: JSON.stringify({ query: "{ account { companyName } }" }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}${j?.errors?.[0]?.message ? ": " + clip(j.errors[0].message) : ""}` };
    if (j?.errors?.length) return { ok: false, detail: clip(j.errors[0].message || "error") };
    return { ok: true, detail: `connected to ${j?.data?.account?.companyName || "the account"}` };
  } catch (e) { return { ok: false, detail: clip(e instanceof Error ? e.message : String(e)) }; }
}

/** Stax: look up the merchant the key belongs to, and whether the web payments token is that merchant's. */
async function stax(): Promise<Check> {
  const key = process.env.STAX_API_KEY?.trim(), web = process.env.STAX_WEB_PAYMENTS_TOKEN?.trim();
  if (!key) return { ok: false, detail: "STAX_API_KEY is missing" };
  try {
    const r = await fetch("https://apiprod.fattlabs.com/self", { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}${j?.message ? ": " + clip(String(j.message)) : ""}` };
    const m = j?.merchant || {};
    const name = m.company_name || m.dba || "the merchant";
    const status = m.status ? `, account ${String(m.status).toLowerCase()}` : "";
    const hosted = m.hosted_payments_token;
    const webNote = !web ? "; STAX_WEB_PAYMENTS_TOKEN is missing" : hosted ? (hosted === web ? "; web payments token matches" : "; web payments token does NOT match this merchant") : "; web payments token is set";
    return { ok: !!web && (!hosted || hosted === web), detail: `connected to ${name}${status}${webNote}` };
  } catch (e) { return { ok: false, detail: clip(e instanceof Error ? e.message : String(e)) }; }
}

/** Claude (Anthropic): list models (free) to prove the key works. */
async function anthropic(): Promise<Check> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, detail: "ANTHROPIC_API_KEY is missing" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}${j?.error?.message ? ": " + clip(j.error.message) : ""}` };
    const ids: string[] = (j?.data || []).map((m: { id: string }) => m.id);
    return { ok: true, detail: `key works; ${ids.length} models available${ids.length ? ` (e.g. ${ids.slice(0, 4).join(", ")})` : ""}` };
  } catch (e) { return { ok: false, detail: clip(e instanceof Error ? e.message : String(e)) }; }
}

/** SanMar: one small price lookup with our web services login. */
async function sanmar(): Promise<Check> {
  if (!sanmarConfigured()) return { ok: false, detail: "SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME or SANMAR_PASSWORD is missing" };
  try { return { ok: true, detail: await sanmarPing() }; } catch (e) { return { ok: false, detail: clip(e instanceof Error ? e.message : String(e)) }; }
}

/**
 * Live connection check for Printavo, Stax and Claude. Shows only ok / not ok and why — never keys.
 * Results are cached for 2 minutes so the page can't be used to hammer the services.
 */
export async function GET() {
  if (cache && Date.now() - cache.at < 120000) return NextResponse.json({ cached: true, ...cache.body });
  const [p, s, a, sm] = await Promise.all([timed(printavo()), timed(stax()), timed(anthropic()), timed(sanmar())]);
  const body = { printavo: p, stax: s, claude: a, sanmar: sm };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
