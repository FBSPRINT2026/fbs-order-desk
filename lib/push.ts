import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phone notifications (Oct 12, Nick: "alert me on my phone without having the system open"): standard Web Push, the
 * same thing installed web apps use. iPhones get them from the portal's Home Screen icon (iOS 16.4+). No outside
 * service and no keys to paste: the portal makes its own signing keys once (VAPID, kept server-only in app_keys) and
 * sends each notification encrypted for the phone it's going to (RFC 8291 / 8188, aes128gcm).
 */

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

type Vapid = { publicKey: string; privateJwk: crypto.JsonWebKey };

/** the portal's push keys: made once, kept in app_keys (RLS on, no policies: server only) */
export async function vapidKeys(admin: SupabaseClient): Promise<Vapid> {
  const { data } = await admin.from("app_keys").select("value").eq("name", "vapid").maybeSingle();
  if (data?.value) return data.value as Vapid;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as crypto.JsonWebKey;
  const raw = Buffer.concat([Buffer.from([4]), unb64u(jwk.x!), unb64u(jwk.y!)]);
  const v: Vapid = { publicKey: b64u(raw), privateJwk: privateKey.export({ format: "jwk" }) as crypto.JsonWebKey };
  // two first calls at once: whichever saved first wins, and both use that one
  await admin.from("app_keys").upsert({ name: "vapid", value: v }, { onConflict: "name", ignoreDuplicates: true });
  const { data: again } = await admin.from("app_keys").select("value").eq("name", "vapid").maybeSingle();
  return (again?.value as Vapid) || v;
}

function vapidAuth(endpoint: string, v: Vapid) {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://portal.fbsprint.com" })));
  const key = crypto.createPrivateKey({ key: v.privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

/** RFC 8291: the message encrypted for one browser (its p256dh key and auth secret) */
export function encryptFor(p256dh: string, auth: string, payload: Buffer, salt = crypto.randomBytes(16), ecdh = crypto.createECDH("prime256v1")) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (!ecdh.getPublicKey) throw new Error("no ECDH");
  try { ecdh.getPrivateKey(); } catch { ecdh.generateKeys(); }
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const prkKey = hmac(secret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]);
}

export type PushMsg = { title: string; body: string; url?: string; tag?: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** send one notification to every phone/computer a person turned alerts on for; dead subscriptions are dropped */
export async function pushTo(admin: SupabaseClient, email: string, msg: PushMsg) {
  const { data } = await admin.from("push_subs").select("id, endpoint, p256dh, auth").eq("email", email.toLowerCase());
  const subs = (data || []) as Sub[];
  if (!subs.length) return { sent: 0, devices: 0, errors: [] as string[] };
  const v = await vapidKeys(admin);
  const body = Buffer.from(JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 400), url: msg.url || "/shop", tag: msg.tag || undefined }));
  let sent = 0; const errors: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, { method: "POST", headers: { Authorization: vapidAuth(s.endpoint, v), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" }, body: new Uint8Array(encryptFor(s.p256dh, s.auth, body)), signal: AbortSignal.timeout(10000) });
      if (r.status === 404 || r.status === 410) { await admin.from("push_subs").delete().eq("id", s.id); return; }
      if (!r.ok) { const t = (await r.text().catch(() => "")).slice(0, 200); errors.push(`${r.status} ${t}`); await admin.from("push_subs").update({ last_error: `${r.status} ${t}`.slice(0, 300) }).eq("id", s.id); return; }
      sent++; await admin.from("push_subs").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("id", s.id);
    } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }));
  return { sent, devices: subs.length, errors };
}
