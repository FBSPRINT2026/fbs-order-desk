import "server-only";
import { createHash, createHmac, randomUUID } from "crypto";

/**
 * Inkbird Wi-Fi temperature controllers through the Tuya cloud (Inkbird's app is built on Tuya). Needs a Tuya IoT
 * developer project linked to the Inkbird app account, with TUYA_CLIENT_ID, TUYA_CLIENT_SECRET and TUYA_REGION
 * ("us", "eu", "cn", "in"; default "us") in Vercel's settings (Nick adds them; never in code or chat).
 * The data point names differ by model, so each device's own specification is read to find its current-temperature
 * and setpoint codes and their scale; a model that names them differently is reported, not guessed at.
 */
const BASE: Record<string, string> = { us: "https://openapi.tuyaus.com", eu: "https://openapi.tuyaeu.com", cn: "https://openapi.tuyacn.com", in: "https://openapi.tuyain.com" };
export const tuyaReady = () => !!(process.env.TUYA_CLIENT_ID && process.env.TUYA_CLIENT_SECRET);

let token: { v: string; until: number } | null = null;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function call(method: "GET" | "POST", path: string, body?: unknown, withToken = true): Promise<{ success: boolean; result?: unknown; msg?: string }> {
  const id = process.env.TUYA_CLIENT_ID!, secret = process.env.TUYA_CLIENT_SECRET!;
  const base = BASE[(process.env.TUYA_REGION || "us").toLowerCase()] || BASE.us;
  const t = String(Date.now()), nonce = randomUUID();
  const raw = body ? JSON.stringify(body) : "";
  const access = withToken ? await getToken() : "";
  const stringToSign = [method, sha(raw), "", path].join("\n");
  const sign = createHmac("sha256", secret).update(id + access + t + nonce + stringToSign).digest("hex").toUpperCase();
  const headers: Record<string, string> = { client_id: id, sign, t, nonce, sign_method: "HMAC-SHA256", "Content-Type": "application/json" };
  if (access) headers.access_token = access;
  const res = await fetch(base + path, { method, headers, body: raw || undefined, cache: "no-store" });
  return res.json();
}
async function getToken(): Promise<string> {
  if (token && token.until > Date.now()) return token.v;
  const j = await call("GET", "/v1.0/token?grant_type=1", undefined, false) as { success: boolean; result?: { access_token: string; expire_time: number }; msg?: string };
  if (!j.success || !j.result) throw new Error(`Tuya sign-in failed: ${j.msg || "unknown"}`);
  token = { v: j.result.access_token, until: Date.now() + (j.result.expire_time - 120) * 1000 };
  return token.v;
}

type Spec = { code: string; values: string };
const toF = (v: number, unit: string) => (unit === "c" ? v * 1.8 + 32 : v);
/** what the controller reads now: its temperature, setpoint (°F) and the codes it uses */
export async function inkbirdStatus(deviceId: string) {
  const [st, spec] = await Promise.all([call("GET", `/v1.0/devices/${deviceId}/status`), call("GET", `/v1.0/devices/${deviceId}/specifications`)]);
  if (!st.success) throw new Error(`Tuya status: ${st.msg}`);
  const status = (st.result || []) as { code: string; value: unknown }[];
  const specs = ([...(((spec.result as { status?: Spec[] })?.status) || []), ...(((spec.result as { functions?: Spec[] })?.functions) || [])]);
  const scaleOf = (code: string) => { try { return JSON.parse(specs.find((s) => s.code === code)?.values || "{}").scale || 0; } catch { return 0; } };
  const unitRaw = String(status.find((s) => /unit/.test(s.code))?.value ?? "c").toLowerCase();
  const unit = unitRaw.startsWith("f") ? "f" : "c";
  const curCode = status.find((s) => /temp_current|cur_temp|temp_cur/.test(s.code) && (unit === "c" ? !/_f$/.test(s.code) : true))?.code;
  const setCode = status.find((s) => /temp_set|set_temp|temp_target/.test(s.code))?.code;
  const val = (code?: string) => { const v = status.find((s) => s.code === code)?.value; return typeof v === "number" ? v / 10 ** scaleOf(code!) : undefined; };
  const cur = val(curCode), set = val(setCode);
  return { tempF: cur != null ? toF(cur, unit) : undefined, setF: set != null ? toF(set, unit) : undefined, unit, curCode, setCode, setScale: setCode ? scaleOf(setCode) : 0, codes: status.map((s) => s.code) };
}
/** change the controller's setpoint (°F in; converted to the controller's own unit and scale) */
export async function inkbirdSet(deviceId: string, f: number) {
  const s = await inkbirdStatus(deviceId);
  if (!s.setCode) throw new Error(`This controller has no setpoint code we know (it reports: ${s.codes.join(", ")})`);
  const v = s.unit === "c" ? (f - 32) / 1.8 : f;
  const j = await call("POST", `/v1.0/devices/${deviceId}/commands`, { commands: [{ code: s.setCode, value: Math.round(v * 10 ** s.setScale) }] });
  if (!j.success) throw new Error(`Tuya command: ${j.msg}`);
  return true;
}
