import "server-only";
import { createHmac, randomBytes } from "node:crypto";
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

const FLAGS = 0xa2088207; // unicode, OEM, request target, NTLM, always sign, extended session security, target info, 128, 56
const u16 = (s: string) => Buffer.from(s, "utf16le");

function type1() {
  const b = Buffer.alloc(32);
  b.write("NTLMSSP\0", 0, "ascii"); b.writeUInt32LE(1, 8); b.writeUInt32LE(FLAGS >>> 0, 12);
  return b.toString("base64");
}

function type3(challengeB64: string, user: string, pass: string) {
  const ch = Buffer.from(challengeB64, "base64");
  if (ch.toString("ascii", 0, 7) !== "NTLMSSP" || ch.readUInt32LE(8) !== 2) throw new Error("Not an NTLM challenge");
  const serverChallenge = ch.subarray(24, 32);
  const tiLen = ch.readUInt16LE(40), tiOff = ch.readUInt32LE(44);
  const targetInfo = tiLen ? ch.subarray(tiOff, tiOff + tiLen) : Buffer.alloc(0);
  // the server's time from the target info (MsvAvTimestamp), else now, as a Windows FILETIME
  let ts: Buffer | null = null;
  for (let p = 0; p + 4 <= targetInfo.length;) {
    const id = targetInfo.readUInt16LE(p), l = targetInfo.readUInt16LE(p + 2);
    if (id === 0) break;
    if (id === 7 && l === 8) ts = targetInfo.subarray(p + 4, p + 12);
    p += 4 + l;
  }
  if (!ts) { ts = Buffer.alloc(8); const ft = (BigInt(Date.now()) + 11644473600000n) * 10000n; ts.writeBigUInt64LE(ft); }
  // a UPN sign-in ("name@domain"): the whole address is the user, the domain is empty
  const domain = "", name = user;
  const ntHash = md4(u16(pass));
  const v2 = createHmac("md5", ntHash).update(u16(name.toUpperCase() + domain)).digest();
  const cc = randomBytes(8);
  const blob = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), ts, cc, Buffer.alloc(4), targetInfo, Buffer.alloc(4)]);
  const proof = createHmac("md5", v2).update(Buffer.concat([serverChallenge, blob])).digest();
  const nt = Buffer.concat([proof, blob]);
  const lm = Buffer.concat([createHmac("md5", v2).update(Buffer.concat([serverChallenge, cc])).digest(), cc]);
  const dom = u16(domain), usr = u16(name), ws = u16("PORTAL");
  const head = 64;
  const parts = [dom, usr, ws, lm, nt];
  const offs: number[] = [];
  let off = head;
  for (const p of parts) { offs.push(off); off += p.length; }
  const b = Buffer.alloc(head);
  b.write("NTLMSSP\0", 0, "ascii"); b.writeUInt32LE(3, 8);
  const sec = (at: number, buf: Buffer, o: number) => { b.writeUInt16LE(buf.length, at); b.writeUInt16LE(buf.length, at + 2); b.writeUInt32LE(o, at + 4); };
  sec(12, lm, offs[3]); sec(20, nt, offs[4]); sec(28, dom, offs[0]); sec(36, usr, offs[1]); sec(44, ws, offs[2]);
  sec(52, Buffer.alloc(0), off); // no session key
  b.writeUInt32LE((ch.readUInt32LE(20) & FLAGS) >>> 0, 60);
  return Buffer.concat([b, ...parts]).toString("base64");
}

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
function send(agent: https.Agent, url: URL, headers: Record<string, string>, body: string, timeoutMs: number): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request({ agent, method: "POST", hostname: url.hostname, path: url.pathname, port: 443, headers: { ...headers, "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
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
    const first = await send(agent, url, { "Content-Type": contentType, Authorization: `NTLM ${type1()}` }, "", timeoutMs);
    const www = ([] as string[]).concat(first.headers["www-authenticate"] || []).join(",");
    const m = www.match(/NTLM\s+([A-Za-z0-9+/=]+)/);
    if (first.status !== 401 || !m) return first;
    return await send(agent, url, { "Content-Type": contentType, Authorization: `NTLM ${type3(m[1], user, pass)}` }, body, timeoutMs);
  } finally { agent.destroy(); }
}
