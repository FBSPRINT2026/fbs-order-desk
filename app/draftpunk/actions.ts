"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrewer } from "@/lib/draftpunk/server";
import { libKey } from "@/lib/draftpunk/beersmith";

/**
 * A club admin adds a member: their sign-in is made (confirmed, no email sent from here) and they're put in the club.
 * They then sign in at /draftpunk with their email and the code it sends. Someone who already has a sign-in (a portal
 * customer, staff) is just added to the club.
 */
export async function addMember(rawEmail: string, rawName: string, role: "member" | "admin" = "member"): Promise<{ ok: boolean; msg: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, msg: "Only a club admin can add members" };
  const email = rawEmail.trim().toLowerCase(), name = rawName.trim() || email.split("@")[0];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, msg: "That email doesn't look right" };
  const admin = createAdminClient();
  let userId = "";
  const made = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (made.data.user) userId = made.data.user.id;
  else {
    // already has a sign-in: find it
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const hit = data?.users.find((u) => (u.email || "").toLowerCase() === email);
      if (hit) userId = hit.id;
      if (!data || data.users.length < 1000) break;
    }
  }
  if (!userId) return { ok: false, msg: made.error?.message || "Couldn't add them" };
  const { error } = await admin.from("dp_brewers").upsert({ user_id: userId, name, club_role: role });
  return error ? { ok: false, msg: error.message } : { ok: true, msg: `${name} is in. They sign in at portal.fbsprint.com/draftpunk with ${email}.` };
}

/** a club admin takes someone out of the club (their recipes stay with their sign-in) */
export async function removeMember(userId: string): Promise<{ ok: boolean; msg: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, msg: "Only a club admin can do that" };
  if (userId === me.userId) return { ok: false, msg: "You can't remove yourself" };
  const { error } = await createAdminClient().from("dp_brewers").delete().eq("user_id", userId);
  return error ? { ok: false, msg: error.message } : { ok: true, msg: "Removed from the club" };
}

/** the signed-in brewer's private Tilt logging address (made the first time it's asked for) */
export async function tiltUrl(): Promise<string> {
  const me = await getBrewer();
  if (!me.brewer) return "";
  const admin = createAdminClient();
  const { data } = await admin.from("dp_brewers").select("tilt_key").eq("user_id", me.userId).maybeSingle();
  let key = (data?.tilt_key as string) || "";
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
    await admin.from("dp_brewers").update({ tilt_key: key }).eq("user_id", me.userId);
  }
  const { SITE_URL } = await import("@/lib/config");
  return `${SITE_URL}/api/draftpunk/tilt?k=${key}`;
}

/**
 * The club's ingredient library: lists brought in from BeerSmith (its Hops / Fermentables / Yeast / MISC exports, or a
 * backup) are kept once for every member (dp_ingredients with no owner). A name already in the library for that kind
 * is updated with the newer numbers, never added twice. Club admins only; sent in batches by the importer.
 */
export async function addToLibrary(kind: "fermentable" | "hop" | "yeast" | "misc" | "water", items: { name: string; [k: string]: unknown }[]): Promise<{ ok: boolean; added: number; updated: number; msg?: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, added: 0, updated: 0, msg: "Only a club admin can add to the club's library" };
  if (!["fermentable", "hop", "yeast", "misc", "water"].includes(kind) || !Array.isArray(items) || items.length > 500) return { ok: false, added: 0, updated: 0, msg: "Send at most 500 at a time" };
  const admin = createAdminClient();
  const names = [...new Set(items.map((i) => String(i.name || "").trim()).filter(Boolean))];
  // what's there already: by its full key (name, maker, country, code); a row saved before makers were kept (no
  // supplier) is filled in by the first item of its name, so a re-import upgrades the library instead of doubling it
  const have = new Map<string, string>(), older = new Map<string, string[]>();
  for (let i = 0; i < names.length; i += 100) {
    const { data } = await admin.from("dp_ingredients").select("id, name, data").is("owner_id", null).eq("kind", kind).in("name", names.slice(i, i + 100));
    for (const r of data || []) {
      const d: Record<string, string> & { name: string } = { ...(r.data as Record<string, string>), name: r.name as string };
      have.set(libKey(d), r.id as string);
      if (kind === "fermentable" && !d.supplier) older.set(d.name.toLowerCase(), [...(older.get(d.name.toLowerCase()) || []), r.id as string]);
    }
  }
  const clean = (i: { name: string; [k: string]: unknown }) => { const d: { name: string; [k: string]: unknown } = { ...i, name: String(i.name).trim() }; if (typeof d.notes === "string" && d.notes.length > 2000) d.notes = d.notes.slice(0, 2000) + "…"; return d; };
  const fresh: { owner_id: null; kind: string; name: string; data: object }[] = [];
  let updated = 0;
  for (const it of items.filter((i) => String(i.name || "").trim())) {
    const d = clean(it), k = libKey(d as { name: string });
    let id = have.get(k);
    if (!id) { const old = older.get(d.name.toLowerCase()); if (old?.length) id = old.shift(); }
    if (id) { if (id !== "new") { await admin.from("dp_ingredients").update({ data: d }).eq("id", id); updated++; } have.set(k, "new"); }
    else { have.set(k, "new"); fresh.push({ owner_id: null, kind, name: d.name, data: d }); }
  }
  if (fresh.length) { const { error } = await admin.from("dp_ingredients").insert(fresh); if (error) return { ok: false, added: 0, updated, msg: error.message }; }
  return { ok: true, added: fresh.length, updated };
}

/**
 * The trophy case: an award the club won, with the picture it was given to use (the AHA's Ninkasi Award artwork; Nick,
 * Nov 24 2026). Club admins only. The picture is kept in the database as the file it was (PNG, JPEG or WebP, up to
 * 2 MB), never in the site's code.
 */
export async function addAward(form: FormData): Promise<{ ok: boolean; msg?: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, msg: "Only a club admin can add to the trophy case" };
  const title = String(form.get("title") || "").trim().slice(0, 120);
  const year = Number(form.get("year")) || null;
  const place = String(form.get("place") || "");
  const f = form.get("image");
  if (!title) return { ok: false, msg: "Give the award a name" };
  let image = "";
  if (f && typeof f !== "string" && f.size) {
    if (f.size > 2_000_000) return { ok: false, msg: "The picture must be under 2 MB" };
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes[8] === 0x57 && bytes[9] === 0x45 ? "image/webp" : "";
    if (!type) return { ok: false, msg: "Use a PNG, JPEG or WebP picture" };
    image = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  }
  const { error } = await createAdminClient().from("dp_awards").insert({ title, year, place: ["", "gold", "silver", "bronze", "hm", "bos", "ninkasi"].includes(place) ? place : "", image, notes: String(form.get("notes") || "").slice(0, 500), created_by: me.userId });
  return error ? { ok: false, msg: error.message } : { ok: true };
}

export async function removeAward(id: string): Promise<{ ok: boolean; msg?: string }> {
  const me = await getBrewer();
  if (me.brewer?.club_role !== "admin") return { ok: false, msg: "Only a club admin can change the trophy case" };
  const { error } = await createAdminClient().from("dp_awards").delete().eq("id", id);
  return error ? { ok: false, msg: error.message } : { ok: true };
}
