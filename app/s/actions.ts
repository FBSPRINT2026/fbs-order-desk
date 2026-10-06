"use server";
import { cookies } from "next/headers";
import { changeOrder, placeOrder, publicStore, requestChange, type CheckoutInput } from "@/lib/merchServer";

/** Shoppers (no sign-in): place an order, change it, or ask FBS for a change. Everything is checked again on the server. */
export async function checkout(input: CheckoutInput) {
  const pass = (await cookies()).get(`sp_${input.slug}`)?.value || input.pass || "";
  return placeOrder({ ...input, pass });
}

export async function changeMyOrder(token: string, ch: { items: { id: string; color: string; size: string }[]; answers: Record<string, string> }) {
  return changeOrder(token, ch);
}

export async function askForChange(token: string, message: string) {
  return requestChange(token, message);
}

/** a store with a password: remember it on this browser for the visit */
export async function unlockStore(slug: string, pass: string): Promise<{ ok: boolean; error?: string }> {
  const got = await publicStore(slug, pass);
  if (!got || got.store.locked) return { ok: false, error: "That password isn't right." };
  (await cookies()).set(`sp_${slug}`, pass.trim(), { httpOnly: true, sameSite: "lax", secure: true, path: `/s/${slug}`, maxAge: 60 * 60 * 24 * 30 });
  return { ok: true };
}
