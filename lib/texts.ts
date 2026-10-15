import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Customer texts from a Mac (Oct 15, Nick: "texts… adding that stuff into the jobs"). The Mac mini, signed in to
 * Messages with Messages in iCloud, runs FBS Texts (the script at /api/texts/agent). It asks which numbers and emails
 * are customers' (/api/texts/handles), reads only those conversations from the Mac's Messages, and sends them
 * (/api/texts/ingest) with their pictures (/api/texts/file). Personal texts never leave the Mac.
 */

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => "fbst_" + randomBytes(24).toString("base64url");

/** a phone number's last 10 digits (US), or a lowercased email: how a text's sender is matched to a customer */
export function handleKey(h: string | null | undefined): string {
  const s = String(h || "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@")) return s;
  const d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 7 ? d : "";
}

/** the forms a customer's number takes in the Mac's Messages (+12145551234 mostly) */
export function handleForms(key: string): string[] {
  if (key.includes("@")) return [key];
  if (key.length === 10) return [`+1${key}`, `1${key}`, key];
  return [`+${key}`, key];
}

/** every customer's phone numbers and emails (their own and their contacts'), to the customer */
export async function customerHandles(admin: SupabaseClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const [{ data: cs }, { data: cts }] = await Promise.all([
    admin.from("customers").select("id, phone, contact2_phone, email, contact2_email").limit(20000),
    admin.from("customer_contacts").select("customer_id, phone, email").limit(20000),
  ]);
  const add = (v: string | null | undefined, id: string) => {
    for (const part of String(v || "").split(/[,;/]| or /i)) {
      const k = handleKey(part);
      if (!k || /@fbsprint\.com$/.test(k)) continue; // never the shop's own
      if (!out.has(k)) out.set(k, id);
    }
  };
  for (const c of (cs || []) as { id: string; phone: string | null; contact2_phone: string | null; email: string | null; contact2_email: string | null }[]) { add(c.phone, c.id); add(c.contact2_phone, c.id); add(c.email, c.id); add(c.contact2_email, c.id); }
  for (const c of (cts || []) as { customer_id: string; phone: string | null; email: string | null }[]) { add(c.phone, c.customer_id); add(c.email, c.customer_id); }
  return out;
}

export type TextDevice = { id: string; owner: string; name: string; last_rowid: number; handles_v: string };
/** the Mac sending: by its token (Authorization: Bearer fbst_…) */
export async function deviceFor(admin: SupabaseClient, req: Request): Promise<TextDevice | null> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^fbst_[\w-]{20,}$/.test(t)) return null;
  const { data } = await admin.from("text_devices").select("id, owner, name, last_rowid, handles_v").eq("token_hash", sha(t)).is("revoked_at", null).maybeSingle();
  return (data as TextDevice | null) || null;
}

/**
 * The words of a text when Messages kept them only in its "attributedBody" (newer macOS): an archived
 * NSAttributedString. The string follows "NSString", a few marker bytes, then its length (one byte, or 0x81 + two
 * bytes little-endian, or 0x82 + four).
 */
export function decodeAttributed(hex: string | null | undefined): string {
  if (!hex || hex.length < 20) return "";
  const b = Buffer.from(hex, "hex");
  const at = b.indexOf(Buffer.from("NSString"));
  if (at < 0) return "";
  let i = at + 8 + 5;
  if (i >= b.length) return "";
  let len = b[i];
  if (len === 0x81) { len = b.readUInt16LE(i + 1); i += 3; } else if (len === 0x82) { len = b.readUInt32LE(i + 1); i += 5; } else i += 1;
  return b.subarray(i, Math.min(b.length, i + len)).toString("utf8");
}

/** Messages' dates: seconds (older) or nanoseconds (newer) since Jan 1, 2001 */
export function appleDate(v: number | string | null | undefined): string {
  let n = Number(v || 0);
  if (!n) return new Date().toISOString();
  if (n > 1e14) n = n / 1e9;
  return new Date((n + 978307200) * 1000).toISOString();
}
