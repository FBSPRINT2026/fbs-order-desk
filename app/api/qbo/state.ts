import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/** The OAuth "state", kept in a cookie signed with the app secret so the callback can tell it came from us. */
const sign = (v: string) => createHmac("sha256", `qbo-state:${process.env.QBO_CLIENT_SECRET || ""}`).update(v).digest("base64url");
export function newState() {
  const state = randomBytes(24).toString("base64url");
  return { state, cookie: `${state}.${sign(state)}` };
}
export function checkState(cookie: string | undefined, state: string | null) {
  if (!cookie || !state) return false;
  const [v, sig] = cookie.split(".");
  if (!v || !sig || v !== state) return false;
  const want = Buffer.from(sign(v)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
