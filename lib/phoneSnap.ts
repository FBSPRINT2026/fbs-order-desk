import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A photo taken on a phone for something open on a computer (Oct 29, Nick: "a QR code that pops up so that if someone's
 * on their desktop version… on their phone, they can just add it in like a photo"). The computer makes a short link
 * (/snap/<id>) and shows it as a QR code (components/PhoneSnapAsk.tsx); the phone opens it without signing in, takes the
 * picture, and the computer sees it arrive (phone_snaps.used_at). Each link is for one thing, made by one staff member,
 * and works for 30 minutes. `kind` says what the photo is for: "sewout" (a print's sew-out; target = the imprint id).
 */
export type SnapKind = "sewout";
export type Snap = { id: string; kind: SnapKind; order_id: string; target: string; created_by: string; expires_at: string; used_at: string | null; result: { msg?: string } | null };
const LIFE_MIN = 30;
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export async function makeSnap(admin: SupabaseClient, x: { kind: SnapKind; orderId: string; target: string; by: string }) {
  const id = [...randomBytes(10)].map((b) => ABC[b % ABC.length]).join("");
  const { error } = await admin.from("phone_snaps").insert({ id, kind: x.kind, order_id: x.orderId, target: x.target, created_by: x.by, expires_at: new Date(Date.now() + LIFE_MIN * 60000).toISOString() });
  if (error) throw new Error(error.message);
  return id;
}

/** the link, if it's real and still good */
export async function openSnap(admin: SupabaseClient, id: string): Promise<{ ok: true; snap: Snap } | { ok: false; error: string }> {
  if (!/^[A-Za-z0-9]{6,20}$/.test(id || "")) return { ok: false, error: "This link isn't right. Scan the code on the computer again." };
  const { data } = await admin.from("phone_snaps").select("*").eq("id", id).maybeSingle();
  const s = data as Snap | null;
  if (!s) return { ok: false, error: "This link isn't right. Scan the code on the computer again." };
  if (new Date(s.expires_at).getTime() < Date.now()) return { ok: false, error: "This link has run out (they last 30 minutes). On the computer, click the photo button again for a new code." };
  return { ok: true, snap: s };
}

/** the photo came in: the computer's pop-up closes with this message */
export async function finishSnap(admin: SupabaseClient, id: string, msg: string) {
  await admin.from("phone_snaps").update({ used_at: new Date().toISOString(), result: { msg } }).eq("id", id);
}
