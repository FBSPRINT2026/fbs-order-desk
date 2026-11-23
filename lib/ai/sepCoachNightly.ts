import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import type { Settings } from "@/lib/pricing";

/**
 * The nightly separations coach (Nick, Nov 23 2026: "every night you can learn… we're getting stuck because we're not
 * learning… for sure in 2 months you've learned all the tricks… anytime you get over 2 colors he doesn't even try to
 * use your separations"). Reads the day's films record (sep_films: what was printed, by whom, printed right or what was
 * wrong, the films that went on press and what was changed), compares them with what our Studio made, and keeps the
 * lessons (sep_lessons, used by every new separation and the coach). The owner gets one card on My Day: how often our
 * films went on press, by how many colors, and what was learned.
 */
type Row = { id: string; separation_id: string; made_by: string; result: string; problems: string[]; note: string; files: { path: string; name: string }[]; used: boolean; width_in: number | null; height_in: number | null; colors: number | null; method: string | null; created_at: string };
const WHO: Record<string, string> = { studio: "our Studio", separo: "Separo", illustrator: "Illustrator by hand", customer: "the customer's films", other: "another way" };

export async function sepCoachNightly(admin: SupabaseClient, s: Settings): Promise<{ ok: true; jobs: number; lessons: number } | { ok: false; error: string }> {
  const { data: fresh } = await admin.from("sep_films").select("*").is("learned_at", null).neq("result", "pending").order("created_at").limit(120);
  const rows = (fresh || []) as Row[];
  // the month's numbers: how often our Studio's films went on press, by colors
  const { data: month } = await admin.from("sep_films").select("separation_id, made_by, used, colors, result").gt("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).limit(2000);
  const usedRows = ((month || []) as Row[]).filter((r) => r.used);
  const bucket = (n: number | null) => (!n ? "?" : n <= 2 ? "1–2 colors" : n <= 4 ? "3–4 colors" : "5+ colors");
  const stats: Record<string, { ours: number; all: number }> = {};
  for (const r of usedRows) { const k = bucket(r.colors); stats[k] = stats[k] || { ours: 0, all: 0 }; stats[k].all++; if (r.made_by === "studio") stats[k].ours++; }
  const statLine = Object.entries(stats).map(([k, v]) => `${k}: ours on press ${v.ours} of ${v.all}`).join(" · ") || "nothing recorded yet";
  if (!rows.length) return { ok: true, jobs: 0, lessons: 0 };

  const sids = [...new Set(rows.map((r) => r.separation_id))].slice(0, 12);
  const { data: seps } = await admin.from("separations").select("id, number, location, garment_color, method, settings, order_id, design_id").in("id", sids);
  const { data: lessons } = await admin.from("sep_lessons").select("lesson").eq("active", true).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(60);
  const images: { media_type: "image/png" | "image/jpeg"; data: string; label: string }[] = [];
  const pic = async (path: string, label: string) => {
    if (images.length >= 8) return;
    const { data } = await admin.storage.from("proofs").download(path);
    if (!data || data.size > 3_500_000) return;
    images.push({ media_type: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png", data: Buffer.from(await data.arrayBuffer()).toString("base64"), label });
  };
  const blocks: string[] = [];
  for (const sp of (seps || []) as { id: string; number: number; location: string; garment_color: string; method: string; settings: Record<string, unknown> }[]) {
    const mine = rows.filter((r) => r.separation_id === sp.id);
    const st = sp.settings as { widthIn?: number; inks?: { name: string; hex: string; noPrint?: boolean; shirt?: boolean }[]; method?: string };
    blocks.push([
      `JOB S-${sp.number} · ${sp.location} · shirt ${sp.garment_color || "?"} · ${st.method || sp.method || "spot"} · ${st.widthIn || "?"}" wide`,
      `Our Studio's inks: ${(st.inks || []).map((k) => `${k.name}${k.noPrint || k.shirt ? " (left to the shirt)" : ""}`).join(", ") || "none"}`,
      ...mine.map((r) => `- ${WHO[r.made_by] || r.made_by}: ${r.result === "ok" ? "printed right" : `WRONG (${r.problems.join(", ") || "not said"})`}${r.used ? " · USED ON PRESS" : ""}${r.colors ? ` · ${r.colors} films` : ""}${r.width_in ? ` · ${r.width_in}" × ${r.height_in}"` : ""}${r.note ? ` · said: "${r.note.slice(0, 400)}"` : ""}${r.files.length ? ` · files: ${r.files.map((f) => f.name).join(", ")}` : ""}`),
    ].join("\n"));
    await pic(`separations/${sp.id}/preview.png`, `S-${sp.number}: our Studio's proof`);
    for (const r of mine.filter((x) => x.used && x.made_by !== "studio")) for (const f of r.files.filter((x) => /\.(png|jpe?g)$/i.test(x.path)).slice(0, 1)) await pic(f.path, `S-${sp.number}: the ${WHO[r.made_by]} films that went on press (${f.name})`);
  }

  const r = await askClaude<{ summary: string; lessons: { text: string; tags?: string[] }[]; engine_notes?: string[] }>({
    task: "sep_coach_nightly", model: s.assistant.ai.model || "claude-sonnet-5", maxTokens: 1800, timeoutMs: 55_000, admin, images,
    system: [
      "You coach FBS Print's own screen-print separation software (the Separation Studio) every night. The shop wants our films to go on press as they are, with no Separo or Illustrator fix-ups, within two months. Today they mostly don't for art over 2 colors.",
      "From the day's films record (what our Studio printed, whether it printed right and what was wrong, and what the shop used instead and why) work out what our Studio should do differently.",
      "summary: 2–4 plain sentences for the owner: what went on press today, what went wrong with ours, and the one thing most worth fixing.",
      "lessons: 0–4 rules for new separations, in shop terms, that would have avoided today's problems. Don't repeat one already learned; refine it instead.",
      "engine_notes: 0–4 specific, testable notes for the developer of the separation engine (a bug or a missing ability), when a lesson can't fix it.",
      "Only say what the record and pictures show. Never mention money.",
    ].join("\n"),
    prompt: [`THIS MONTH, films on press by colors: ${statLine}`, "", ...blocks, "", (lessons || []).length ? "ALREADY LEARNED:" : "", ...((lessons || []) as { lesson: string }[]).map((l) => `- ${l.lesson}`)].join("\n"),
    tool: { name: "coach", description: "What today's films teach our separations.", input_schema: { type: "object", properties: {
      summary: { type: "string" },
      lessons: { type: "array", items: { type: "object", properties: { text: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["text"] } },
      engine_notes: { type: "array", items: { type: "string" } },
    }, required: ["summary"] } },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const ls = (r.data.lessons || []).filter((l) => l && l.text).slice(0, 4);
  for (const l of ls) await admin.from("sep_lessons").insert({ lesson: l.text.trim().slice(0, 400), tags: ["nightly", ...(l.tags || []).map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 2)], by: "nightly coach" });
  await admin.from("sep_films").update({ learned_at: new Date().toISOString() }).in("id", rows.map((x) => x.id));
  const { data: own } = await admin.from("staff").select("email").eq("role", "owner").limit(1).maybeSingle();
  const notes = [r.data.summary, "", `This month: ${statLine}`, ls.length ? `\nLearned:\n${ls.map((l) => `• ${l.text}`).join("\n")}` : "", (r.data.engine_notes || []).length ? `\nFor the separation engine:\n${(r.data.engine_notes || []).map((n) => `• ${n}`).join("\n")}` : ""].join("\n");
  if (own?.email) await admin.from("tasks").insert({ owner: String(own.email).toLowerCase(), title: `Separations coach: ${sids.length} job${sids.length === 1 ? "" : "s"} yesterday`.slice(0, 200), notes: notes.slice(0, 3800), area: "shop", status: "open", source: "ai", url: "/shop/separations", created_by: "assistant" });
  return { ok: true, jobs: sids.length, lessons: ls.length };
}
