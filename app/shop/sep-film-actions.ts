"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The films record (sep_films; Nick, Nov 23 2026: "we're not logging what we actually were able to use… at the end,
 * what did we use… here was the art, here's what I made… and every night you can learn"). Every Print Films is a try
 * that waits for "Printed right / Something's wrong" (components/FilmCheck.tsx, bottom-right on every shop page); the
 * films that went on press, whoever made them, are saved on the separation (components/FilmsRecord.tsx).
 */
export type MadeBy = "studio" | "separo" | "illustrator" | "customer" | "other";
export type SepFilm = {
  id: string; separation_id: string; order_id: string | null; made_by: MadeBy; result: "pending" | "ok" | "bad"; problems: string[]; note: string;
  files: { path: string; name: string; size?: number }[]; dropbox: string; used: boolean; width_in: number | null; height_in: number | null;
  colors: number | null; method: string | null; by: string; created_at: string; checked_at: string | null; checked_by: string | null;
};
export type PendingFilm = SepFilm & { label: string; location: string };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { email: String(v.email || "").toLowerCase(), admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

/** Print Films pressed in our Studio: a try waiting to be checked */
export async function logStudioFilms(sepId: string, p: { width: number; height: number; colors: number; method: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { email, admin } = await staff();
    const { data: s } = await admin.from("separations").select("order_id").eq("id", sepId).maybeSingle();
    // a second Print Films before the first was checked: that one is replaced by this one, never two cards
    await admin.from("sep_films").delete().eq("separation_id", sepId).eq("made_by", "studio").eq("result", "pending");
    const { data, error } = await admin.from("sep_films").insert({ separation_id: sepId, order_id: (s?.order_id as string) || null, made_by: "studio", result: "pending", width_in: +p.width.toFixed(2), height_in: +p.height.toFixed(2), colors: p.colors, method: p.method, by: email }).select("id").single();
    if (error || !data) throw new Error(error?.message || "Couldn't log the films.");
    return { ok: true, id: data.id as string };
  } catch (e) { return fail(e); }
}

/** the films this person printed that nobody has checked yet (the corner cards) */
export async function myPendingFilms(): Promise<{ ok: true; rows: PendingFilm[] } | { ok: false; error: string }> {
  try {
    const { email, admin } = await staff();
    const since = new Date(Date.now() - 14 * 86400000).toISOString(), now = new Date().toISOString();
    const { data } = await admin.from("sep_films").select("*").eq("by", email).eq("result", "pending").gt("created_at", since).or(`snooze_until.is.null,snooze_until.lt.${now}`).order("created_at").limit(4);
    const rows = (data || []) as SepFilm[];
    const sids = [...new Set(rows.map((r) => r.separation_id))];
    const { data: ss } = sids.length ? await admin.from("separations").select("id, number, location, order_id").in("id", sids) : { data: [] };
    const oids = [...new Set(((ss || []) as { order_id: string | null }[]).map((s) => s.order_id).filter(Boolean))] as string[];
    const { data: os } = oids.length ? await admin.from("orders").select("id, number").in("id", oids) : { data: [] };
    const num = new Map(((os || []) as { id: string; number: number }[]).map((o) => [o.id, o.number]));
    const sep = new Map(((ss || []) as { id: string; number: number; location: string; order_id: string | null }[]).map((s) => [s.id, s]));
    return { ok: true, rows: rows.map((r) => { const s = sep.get(r.separation_id); const n = s?.order_id ? num.get(s.order_id) : null; return { ...r, label: n ? `#${n}` : `S-${s?.number ?? ""}`, location: s?.location || "" }; }) };
  } catch (e) { return fail(e); }
}

/** "Printed right" / "Something's wrong" (with what was wrong) */
export async function checkFilms(id: string, ok: boolean, problems: string[] = [], note = ""): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { email, admin } = await staff();
    const { data: r } = await admin.from("sep_films").select("separation_id").eq("id", id).maybeSingle();
    if (!r) throw new Error("Those films aren't here.");
    // printed right: these are the films on press (unless another set is already marked used)
    if (ok) await admin.from("sep_films").update({ used: false }).eq("separation_id", r.separation_id);
    const { error } = await admin.from("sep_films").update({ result: ok ? "ok" : "bad", used: ok, problems: problems.slice(0, 12), note: note.slice(0, 1000), checked_at: new Date().toISOString(), checked_by: email, snooze_until: null }).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function snoozeFilms(id: string, minutes = 30): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { admin } = await staff();
    await admin.from("sep_films").update({ snooze_until: new Date(Date.now() + minutes * 60000).toISOString() }).eq("id", id);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** every try for a separation, newest first */
export async function filmRecord(sepId: string): Promise<{ ok: true; rows: SepFilm[] } | { ok: false; error: string }> {
  try {
    const { admin } = await staff();
    const { data } = await admin.from("sep_films").select("*").eq("separation_id", sepId).order("created_at", { ascending: false }).limit(30);
    return { ok: true, rows: (data || []) as SepFilm[] };
  } catch (e) { return fail(e); }
}

/** "What went on press": films made another way (Separo, Illustrator, the customer's), with their files and/or a Dropbox
 *  link; or our own Studio films (the newest try) */
export async function saveFinalFilms(sepId: string, p: { madeBy: MadeBy; files: { path: string; name: string; size?: number }[]; dropbox: string; note: string; width?: number | null; height?: number | null; colors?: number | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { email, admin } = await staff();
    const { data: s } = await admin.from("separations").select("order_id").eq("id", sepId).maybeSingle();
    await admin.from("sep_films").update({ used: false }).eq("separation_id", sepId);
    const now = new Date().toISOString();
    if (p.madeBy === "studio") {
      const { data: last } = await admin.from("sep_films").select("id").eq("separation_id", sepId).eq("made_by", "studio").order("created_at", { ascending: false }).limit(1);
      const id = ((last || [])[0] as { id: string } | undefined)?.id;
      if (id) { await admin.from("sep_films").update({ used: true, result: "ok", checked_at: now, checked_by: email, ...(p.note ? { note: p.note.slice(0, 1000) } : {}) }).eq("id", id); return { ok: true, id }; }
    }
    const { data, error } = await admin.from("sep_films").insert({
      separation_id: sepId, order_id: (s?.order_id as string) || null, made_by: p.madeBy, result: "ok", used: true, files: p.files.slice(0, 40),
      dropbox: p.dropbox.trim().slice(0, 500), note: p.note.trim().slice(0, 1000), width_in: p.width ?? null, height_in: p.height ?? null, colors: p.colors ?? null,
      by: email, checked_at: now, checked_by: email,
    }).select("id").single();
    if (error || !data) throw new Error(error?.message || "Couldn't save the films.");
    return { ok: true, id: data.id as string };
  } catch (e) { return fail(e); }
}
