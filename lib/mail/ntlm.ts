import "server-only";
import { createHash, createHmac, randomBytes, X509Certificate } from "node:crypto";
import type { TLSSocket } from "node:tls";
import https from "node:https";

/**
 * NTLM sign-in (NTLMv2) for Exchange Web Services (Oct 13): Nick's mailbox turns down the plain (Basic) sign-in over
 * EWS but the server also offers NTLM, the way Outlook for Windows signs in. The handshake needs the same connection
 * for its two steps, so it runs on its own one-socket keep-alive agent.
 */

/** MD4 (the NT password hash; Node's crypto no longer includes it) */
function md4(input: Buffer): Buffer {
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  const len = input.length, nBlocks = ((len + 8) >>> 6) + 1;
  const words = new Uint32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= input[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[nBlocks * 16 - 2] = (len * 8) >>> 0;
  words[nBlocks * 16 - 1] = Math.floor((len * 8) / 2 ** 32);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const F = (x: number, y: number, z: number) => (x & y) | (~x & z), G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z), H = (x: number, y: number, z: number) => x ^ y ^ z;
  for (let i = 0; i < words.length; i += 16) {
    const X = words.subarray(i, i + 16);
    const [aa, bb, cc, dd] = [a, b, c, d];
    for (const k of [0, 4, 8, 12]) {
      a = rotl((a + F(b, c, d) + X[k]) | 0, 3); d = rotl((d + F(a, b, c) + X[k + 1]) | 0, 7);
      c = rotl((c + F(d, a, b) + X[k + 2]) | 0, 11); b = rotl((b + F(c, d, a) + X[k + 3]) | 0, 19);
    }
    for (const k of [0, 1, 2, 3]) {
      a = rotl((a + G(b, c, d) + X[k] + 0x5a827999) | 0, 3); d = rotl((d + G(a, b, c) + X[k + 4] + 0x5a827999) | 0, 5);
      c = rotl((c + G(d, a, b) + X[k + 8] + 0x5a827999) | 0, 9); b = rotl((b + G(c, d, a) + X[k + 12] + 0x5a827999) | 0, 13);
    }
    for (const k of [0, 2, 1, 3]) {
      a = rotl((a + H(b, c, d) + X[k] + 0x6ed9eba1) | 0, 3); d = rotl((d + H(a, b, c) + X[k + 8] + 0x6ed9eba1) | 0, 9);
      c = rotl((c + H(d, a, b) + X[k + 4] + 0x6ed9eba1) | 0, 11); b = rotl((b + H(c, d, a) + X[k + 12] + 0x6ed9eba1) | 0, 15);
    }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  const out = Buffer.alloc(16);
  [a, b, c, d].forEach((v, i) => out.writeInt32LE(v, i * 4));
  return out;
}
export const md4Hex = (s: string) => md4(Buffer.from(s, "utf8")).toString("hex"); // for checking against known values

// unicode, OEM, request target, NTLM, always sign, extended session security, target info, version, 128-bit, 56-bit
const FLAGS = 0xa2888207;
const u16 = (s: string) => Buffer.from(s, "utf16le");
const VERSION = Buffer.from([10, 0, 0x61, 0x4a, 0, 0, 0, 15]); // Windows 10.0.19041, NTLM revision 15

function type1(): Buffer {
  const b = Buffer.alloc(40);
  b.write("NTLMSSP\0", 0, "ascii"); b.writeUInt32LE(1, 8); b.writeUInt32LE(FLAGS >>> 0, 12);
  // domain and workstation: none (length 0, offset 40); then the version
  b.writeUInt32LE(40, 20); b.writeUInt32LE(40, 28); VERSION.copy(b, 32);
  return b;
}

/**
 * The answer to the server's challenge (NTLMv2, MS-NLMP 3.1.5.1.2), with what servers that check "Extended Protection"
 * require (Oct 14: the first version, without these, was turned down even for Amanda, whose password works): the TLS
 * channel binding (the server certificate's hash), the target name, and the message integrity code.
 */
function type3(t1: Buffer, ch: Buffer, user: string, pass: string, host: string, cert: Buffer | null): Buffer {
  if (ch.toString("ascii", 0, 7) !== "NTLMSSP" || ch.readUInt32LE(8) !== 2) throw new Error("Not an NTLM challenge");
  const serverChallenge = ch.subarray(24, 32);
  const tiLen = ch.readUInt16LE(40), tiOff = ch.readUInt32LE(44);
  const ti = tiLen ? ch.subarray(tiOff, tiOff + tiLen) : Buffer.alloc(0);
  // the server's AV pairs, minus the end and any flags (ours are added below)
  const pairs: { id: number; v: Buffer }[] = [];
  let ts: Buffer | null = null;
  for (let p = 0; p + 4 <= ti.length;) {
    const id = ti.readUInt16LE(p), l = ti.readUInt16LE(p + 2);
    if (id === 0) break;
    const v = ti.subarray(p + 4, p + 4 + l);
    if (id === 7 && l === 8) ts = Buffer.from(v);
    if (id !== 6) pairs.push({ id, v });
    p += 4 + l;
  }
  const withMic = !!ts;
  if (!ts) { ts = Buffer.alloc(8); ts.writeBigUInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n); }
  if (withMic) { const f = Buffer.alloc(4); f.writeUInt32LE(2, 0); pairs.push({ id: 6, v: f }); }
  // channel binding: MD5 of gss_channel_bindings_struct with "tls-server-end-point:" + the certificate's hash
  if (cert) {
    const app = Buffer.concat([Buffer.from("tls-server-end-point:", "ascii"), createHash(certHash(cert)).update(cert).digest()]);
    const cb = Buffer.alloc(20 + app.length); cb.writeUInt32LE(app.length, 16); app.copy(cb, 20);
    pairs.push({ id: 10, v: createHash("md5").update(cb).digest() });
  }
  pairs.push({ id: 9, v: u16(`HTTP/${host}`) });
  const tiOut = Buffer.concat([...pairs.map(({ id, v }) => { const h = Buffer.alloc(4); h.writeUInt16LE(id, 0); h.writeUInt16LE(v.length, 2); return Buffer.concat([h, v]); }), Buffer.alloc(4)]);

  // "DOMAIN\\name" (an old Windows login, Oct 14): the domain and the name apart; a UPN sign-in ("name@domain"): the
  // whole address is the user, the domain is empty
  const bs = user.indexOf("\\");
  const domain = bs > 0 ? user.slice(0, bs) : "", name = bs > 0 ? user.slice(bs + 1) : user;
  const keyNT = createHmac("md5", md4(u16(pass))).update(u16(name.toUpperCase() + domain)).digest();
  const cc = randomBytes(8);
  const blob = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), ts, cc, Buffer.alloc(4), tiOut, Buffer.alloc(4)]);
  const proof = createHmac("md5", keyNT).update(Buffer.concat([serverChallenge, blob])).digest();
  const nt = Buffer.concat([proof, blob]);
  const lm = withMic ? Buffer.alloc(24) : Buffer.concat([createHmac("md5", keyNT).update(Buffer.concat([serverChallenge, cc])).digest(), cc]);
  const sessionKey = createHmac("md5", keyNT).update(proof).digest();
  const dom = u16(domain), usr = u16(name), ws = u16("PORTAL");
  const head = 88; // the fixed part, the version (64) and the MIC (72)
  const parts = [dom, usr, ws, lm, nt];
  const offs: number[] = [];
  let off = head;
  for (const p of parts) { offs.push(off); off += p.length; }
  const b = Buffer.alloc(head);
  b.write("NTLMSSP\0", 0, "ascii"); b.writeUInt32LE(3, 8);
  const sec = (at: number, buf: Buffer, o: number) => { b.writeUInt16LE(buf.length, at); b.writeUInt16LE(buf.length, at + 2); b.writeUInt32LE(o, at + 4); };
  sec(12, lm, offs[3]); sec(20, nt, offs[4]); sec(28, dom, offs[0]); sec(36, usr, offs[1]); sec(44, ws, offs[2]);
  sec(52, Buffer.alloc(0), off); // no session key exchange
  b.writeUInt32LE(((ch.readUInt32LE(20) & FLAGS) | 1) >>> 0, 60);
  VERSION.copy(b, 64);
  const msg = Buffer.concat([b, ...parts]);
  if (withMic) createHmac("md5", sessionKey).update(Buffer.concat([t1, ch, msg])).digest().copy(msg, 72);
  return msg;
}

/** the hash the channel binding uses: the certificate's own signature hash, SHA-256 for MD5 / SHA-1 ones */
function certHash(der: Buffer): string {
  try {
    const x = new X509Certificate(der) as X509Certificate & { signatureAlgorithm?: string };
    const alg = (x.signatureAlgorithm || "").toLowerCase();
    if (/sha384/.test(alg)) return "sha384";
    if (/sha512/.test(alg)) return "sha512";
  } catch { /* SHA-256 */ }
  return "sha256";
}

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string; cert?: Buffer | null };
function send(agent: https.Agent, url: URL, headers: Record<string, string>, body: string, timeoutMs: number): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request({ agent, method: "POST", hostname: url.hostname, path: url.pathname, port: 443, headers: { ...headers, "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      let cert: Buffer | null = null;
      try { cert = ((res.socket as TLSSocket).getPeerCertificate?.() as { raw?: Buffer } | undefined)?.raw || null; } catch { /* none */ }
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), cert }));
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("The mail server took too long.")));
    req.on("error", reject);
    req.end(body);
  });
}

/** POST with NTLM sign-in; returns the final response */
export async function ntlmPost(urlStr: string, user: string, pass: string, contentType: string, body: string, timeoutMs = 25000): Promise<Res> {
  const url = new URL(urlStr);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const t1 = type1();
    const first = await send(agent, url, { "Content-Type": contentType, Authorization: `NTLM ${t1.toString("base64")}` }, "", timeoutMs);
    const www = ([] as string[]).concat(first.headers["www-authenticate"] || []).join(",");
    const m = www.match(/NTLM\s+([A-Za-z0-9+/=]+)/);
    if (first.status !== 401 || !m) return first;
    const t3 = type3(t1, Buffer.from(m[1], "base64"), user, pass, url.hostname, first.cert || null);
    return await send(agent, url, { "Content-Type": contentType, Authorization: `NTLM ${t3.toString("base64")}` }, body, timeoutMs);
  } finally { agent.destroy(); }
}
