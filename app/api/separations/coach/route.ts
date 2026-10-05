import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { viewerPerms } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { cleanChange, COACH_SETTINGS, type CoachSetting, type LessonDefault } from "@/lib/sepCoach";

/**
 * "Make Separations Better": the production manager tells the Separation Studio how a separation came out ("good, but
 * the gradients needed more work") and Claude, looking at the proof, the original art and the settings, answers with
 * what to change (applied only when he clicks Apply) and, when it's worth keeping, a lesson. Lessons last 30 days and
 * go into every later answer, and can set a starting value for new separations. Everything is kept in sep_feedback,
 * with a note for whoever works on the separation engine itself.
 */
export const maxDuration = 60;

type Body = {
  separation_id?: string; design_id?: string | null; message?: string;
  context?: Record<string, unknown>;
  images?: { label?: string; data?: string }[];
};
type Answer = {
  reply: string;
  changes?: { setting: string; value: unknown; why?: string }[];
  lesson?: { text: string; tags?: string[]; default?: { setting: string; value: unknown; when: string }; preset?: boolean } | null;
  engine_note?: string;
};

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  if (!(await viewerPerms(v.supabase, v.email, v.role)).coach) return NextResponse.json({ error: "The separation coach isn't on for you (Settings → User Access)." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const message = String(b.message || "").trim().slice(0, 3000);
  if (!message) return NextResponse.json({ error: "Say how it came out." }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ off: true, reason: st.reason });

  const now = new Date().toISOString();
  const [{ data: lessons }, { data: thread }] = await Promise.all([
    admin.from("sep_lessons").select("id, lesson, tags, default_setting, by, created_at").eq("active", true).gt("expires_at", now).order("created_at", { ascending: false }).limit(60),
    b.separation_id ? admin.from("sep_feedback").select("message, reply, changes, applied, created_at").eq("separation_id", b.separation_id).order("created_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
  ]);
  const ctx = JSON.stringify(b.context || {}, null, 1).slice(0, 9000);
  const prompt = [
    "THE SEPARATION ON SCREEN NOW (settings, inks, plates with their coverage, fades):",
    ctx,
    "",
    (lessons || []).length ? "WHAT THE SHOP HAS TAUGHT YOU (last 30 days, newest first; follow these unless this separation clearly differs):" : "Nothing learned yet: this is one of the first notes.",
    ...((lessons || []) as { lesson: string; tags: string[]; default_setting: LessonDefault | null; created_at: string }[]).map((l) => `- ${l.lesson}${l.tags?.length ? ` [${l.tags.join(", ")}]` : ""}${l.default_setting ? ` (starts new ${l.default_setting.when === "all" ? "" : l.default_setting.when + " "}separations at ${l.default_setting.setting} = ${l.default_setting.value})` : ""} · ${l.created_at.slice(0, 10)}`),
    "",
    ...((thread || []).length ? ["EARLIER ON THIS SEPARATION (oldest first):", ...((thread || []) as { message: string; reply: string; changes: unknown[]; applied: boolean }[]).reverse().map((t) => `Him: ${t.message}\nYou: ${t.reply}${t.changes?.length ? ` (changes ${t.applied ? "applied" : "not applied"})` : ""}`), ""] : []),
    `HE SAYS NOW: ${message}`,
  ].join("\n");

  const settingsDoc = (Object.keys(COACH_SETTINGS) as CoachSetting[]).map((k) => `- ${k}: ${COACH_SETTINGS[k].about}`).join("\n");
  const images = (b.images || []).filter((x) => typeof x.data === "string" && x.data.length > 100 && x.data.length < 4_000_000).slice(0, 2)
    .map((x) => ({ media_type: "image/jpeg" as const, data: x.data!.replace(/^data:image\/\w+;base64,/, ""), label: String(x.label || "").slice(0, 200) }));

  const r = await askClaude<Answer>({
    task: "sep_coach",
    model: st.settings.assistant.ai.model || "claude-sonnet-5",
    maxTokens: 1800,
    admin,
    ctx: { by: v.email, order_id: (b.context?.order_id as string) || undefined },
    images,
    system: [
      "You are the separation coach inside FBS Print's Separation Studio (screen printing: spot color and simulated process separations, films for a FilmMaker RIP on an Epson, manual and automatic presses).",
      "The production manager (Jose) tells you how a separation came out, on screen or on press. You see the soft proof and the original art (when sent), and every setting, ink and plate.",
      "Answer like an experienced separator talking to a printer: short, plain, specific. Say what you think caused it and what to change. If he says something came out good, say what to keep.",
      "Only suggest changes from this list (setting: what it does); he applies them with one click, so values must be exact:",
      settingsDoc,
      "Suggest 0–4 changes, only ones that address what he said. If the fix is on press or in the RIP (mesh, squeegee, flash, off-contact, the RIP's curve, the art itself), say so in the reply instead of inventing a setting.",
      "lesson: when his note teaches something that should carry over to other separations (a preference, how our presses / inks / films behave, what works for gradients, small type, dark shirts…), write it as one short rule in his terms, e.g. 'Gradients on dark shirts: 45 lpi and 20% dot gain hold better on our 156 mesh.' Give it a starting setting (default) only when it should apply to every new separation of that kind. Leave lesson out for one-off notes about this art. Don't repeat a lesson already listed; refine it instead (say so in the reply).",
      "Presets: when he says to change a preset or a default for good ('always…', 'never put crop marks on films', 'change the preset to 45 lpi'), make it a lesson with a default and preset: true (it stays until someone turns it off, not 30 days). 'Don't do crop marks on this' is just this separation: a change, no lesson.",
      "engine_note: one or two sentences for the developer who maintains the separation software, when his note points at something the software itself should do better (e.g. 'fade detection split the orange into two inks'). Leave it out otherwise.",
      "Never mention prices or money.",
    ].join("\n"),
    prompt,
    tool: {
      name: "coach",
      description: "Your answer to the production manager.",
      input_schema: {
        type: "object",
        properties: {
          reply: { type: "string", description: "What you tell him (2–5 short sentences)." },
          changes: { type: "array", items: { type: "object", properties: { setting: { type: "string", enum: Object.keys(COACH_SETTINGS) }, value: { description: "The new value (number, boolean or string as the setting says)." }, why: { type: "string" } }, required: ["setting", "value"] } },
          lesson: { type: "object", properties: {
            text: { type: "string" }, tags: { type: "array", items: { type: "string" }, description: "1–3 short topics: gradients, dark shirts, small type, sim process, halftones, underbase, black, trap…" },
            default: { type: "object", properties: { setting: { type: "string", enum: Object.keys(COACH_SETTINGS).filter((k) => k !== "addMiddle" && k !== "colors") }, value: {}, when: { type: "string", enum: ["all", "spot", "sim", "dark", "light"] } }, required: ["setting", "value", "when"] },
            preset: { type: "boolean", description: "true when he asked to change a preset / default for good: kept until turned off instead of 30 days" },
          }, required: ["text"] },
          engine_note: { type: "string" },
        },
        required: ["reply"],
      },
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error, off: r.off });

  const changes = (r.data.changes || []).map(cleanChange).filter(Boolean).slice(0, 4);
  const context = { ...(b.context || {}), engine_note: r.data.engine_note || undefined, model: r.model, images: images.length };
  const fb = await admin.from("sep_feedback").insert({ separation_id: b.separation_id || null, design_id: b.design_id || null, by: v.email, message, reply: r.data.reply || "", changes, context }).select("id").single();
  let lesson: { id: string; lesson: string; tags: string[]; default_setting: LessonDefault | null; expires_at: string } | null = null;
  const L = r.data.lesson;
  if (L?.text?.trim()) {
    const d = L.default ? cleanChange({ setting: L.default.setting, value: L.default.value }) : null;
    const when = ["all", "spot", "sim", "dark", "light"].includes(L.default?.when || "") ? L.default!.when : "all";
    const def = d && d.setting !== "addMiddle" && d.setting !== "colors" ? { setting: d.setting, value: d.value, when } : null;
    const tags = (L.tags || []).map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 3);
    // a preset stays until someone turns it off (ten years); everything else is learned for 30 days
    const ins = await admin.from("sep_lessons").insert({ lesson: L.text.trim().slice(0, 400), tags: L.preset ? ["preset", ...tags.slice(0, 2)] : tags, default_setting: def, by: v.email, feedback_id: fb.data?.id || null, ...(L.preset ? { expires_at: new Date(Date.now() + 3650 * 86400000).toISOString() } : {}) })
      .select("id, lesson, tags, default_setting, expires_at").single();
    if (ins.data) { lesson = ins.data as typeof lesson; if (fb.data?.id) await admin.from("sep_feedback").update({ lesson_id: ins.data.id }).eq("id", fb.data.id); }
  }
  return NextResponse.json({ id: fb.data?.id || null, reply: r.data.reply, changes, lesson, model: r.model });
}
