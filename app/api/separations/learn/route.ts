import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { cleanChange, COACH_SETTINGS, type CoachSetting } from "@/lib/sepCoach";

/**
 * Learning from Separo (or any outside separation): when a job had to be separated elsewhere and the result comes back
 * into the Separated Elsewhere tab, Claude compares what the outside separator did (its inks, in print order, and its
 * composite when there is one) with what our Studio picked for the same art, plus what the shop says was wrong with
 * ours. What carries over becomes lessons (30 days, used by the coach and as starting settings); what the separation
 * engine itself should do differently is kept as engine notes for whoever improves it. Everything lands in sep_feedback.
 */
export const maxDuration = 60;

type Ink = { name: string; hex?: string };
type Body = {
  separation_id?: string; design_id?: string | null; source?: string; why?: string;
  theirs?: { inks: Ink[]; files: string[]; method?: string };
  ours?: { method?: string; inks?: (Ink & { fadeTo?: string[]; also?: string[] })[]; natural?: number; settings?: Record<string, unknown> };
  art?: Record<string, unknown>;
  images?: { label?: string; data?: string }[];
};
type Answer = {
  summary: string;
  lessons?: { text: string; tags?: string[]; default?: { setting: string; value: unknown; when: string } }[];
  engine_notes?: string[];
};

export async function POST(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const theirs = b.theirs?.inks?.filter((x) => x?.name).slice(0, 16) || [];
  if (!theirs.length && !b.why?.trim()) return NextResponse.json({ skip: true });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ off: true, reason: st.reason });

  const { data: lessons } = await admin.from("sep_lessons").select("lesson, tags").eq("active", true).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(60);
  const images = (b.images || []).filter((x) => typeof x.data === "string" && x.data.length > 100 && x.data.length < 4_000_000).slice(0, 2)
    .map((x) => ({ media_type: "image/jpeg" as const, data: x.data!.replace(/^data:image\/\w+;base64,/, ""), label: String(x.label || "").slice(0, 200) }));
  const prompt = [
    `THE ART: ${JSON.stringify(b.art || {}).slice(0, 1500)}`,
    "",
    `WHAT ${String(b.source || "Separo").toUpperCase()} DID (${b.theirs?.method || "method not given"}), inks in print order:`,
    ...theirs.map((k, i) => `${i + 1}. ${k.name}${k.hex ? ` (${k.hex})` : ""}`),
    b.theirs?.files?.length ? `Files: ${b.theirs.files.slice(0, 10).join(", ")}` : "",
    "",
    b.ours?.inks?.length ? `WHAT OUR STUDIO PICKED (${b.ours.method || "spot"}; the art itself has about ${b.ours.natural || b.ours.inks.length} colors):` : "Our Studio didn't separate this one.",
    ...(b.ours?.inks || []).map((k, i) => `${i + 1}. ${k.name} (${k.hex})${k.fadeTo?.length ? ` fades to ${k.fadeTo.join(", ")}` : ""}${k.also?.length ? ` combined with ${k.also.join(", ")}` : ""}`),
    b.ours?.settings ? `Our settings: ${JSON.stringify(b.ours.settings).slice(0, 1200)}` : "",
    "",
    b.why?.trim() ? `WHY THE SHOP WENT TO ${String(b.source || "Separo").toUpperCase()} / WHAT WAS WRONG WITH OURS: ${b.why.trim().slice(0, 2000)}` : "The shop didn't say why.",
    "",
    (lessons || []).length ? "ALREADY LEARNED (don't repeat; refine if this changes one):" : "",
    ...((lessons || []) as { lesson: string }[]).map((l) => `- ${l.lesson}`),
  ].join("\n");
  const settingsDoc = (Object.keys(COACH_SETTINGS) as CoachSetting[]).filter((k) => k !== "addMiddle" && k !== "colors").map((k) => `- ${k}: ${COACH_SETTINGS[k].about}`).join("\n");

  const r = await askClaude<Answer>({
    task: "sep_learn",
    model: st.settings.assistant.ai.model || "claude-sonnet-5",
    maxTokens: 1600,
    admin,
    images,
    ctx: { by: v.email },
    system: [
      "You help FBS Print's own separation software (the Separation Studio) get better. This job was separated outside, in Separo (or another program), because the shop wasn't happy with ours or didn't trust it yet.",
      "Compare what the outside separation did with what our Studio picked for the same art: how many inks, which inks (stock / PMS, how close to the art), spot vs simulated process, fades (two inks crossing, or a middle screen), underbase / highlight white, print order. Use the pictures when sent.",
      "summary: 2–3 sentences for the production manager: the main differences and which one is better for the press, plainly.",
      "lessons: 0–3 rules for our separations from now on, in shop terms (e.g. 'Gradient logos on light shirts: 3 inks like Separo, not 5: the ends of each fade plus one middle screen.'). Give a starting setting (default, one of the settings below) only when one setting is the fix; most ink-choice lessons have none.",
      "engine_notes: 0–4 short notes for the developer who maintains the separation engine: what our automatic ink finding / fade handling / underbase should do differently to match a good separator. Be specific and testable.",
      "Settings a lesson can start new separations at:",
      settingsDoc,
      "Don't invent differences you can't see in the data. Never mention money.",
    ].join("\n"),
    prompt,
    tool: {
      name: "learned",
      description: "What we learned from the outside separation.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          lessons: { type: "array", items: { type: "object", properties: {
            text: { type: "string" }, tags: { type: "array", items: { type: "string" } },
            default: { type: "object", properties: { setting: { type: "string", enum: Object.keys(COACH_SETTINGS).filter((k) => k !== "addMiddle" && k !== "colors") }, value: {}, when: { type: "string", enum: ["all", "spot", "sim", "dark", "light"] } }, required: ["setting", "value", "when"] },
          }, required: ["text"] } },
          engine_notes: { type: "array", items: { type: "string" } },
        },
        required: ["summary"],
      },
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error, off: r.off });

  const message = `[${b.source || "Separo"}] ${theirs.length} inks: ${theirs.map((k) => k.name).join(", ")}${b.why?.trim() ? ` · Why: ${b.why.trim()}` : ""}`;
  const fb = await admin.from("sep_feedback").insert({
    separation_id: b.separation_id || null, design_id: b.design_id || null, by: v.email, message: message.slice(0, 3000), reply: r.data.summary || "",
    context: { kind: "outside", source: b.source || "Separo", theirs: b.theirs, ours: b.ours, art: b.art, engine_notes: r.data.engine_notes || [], model: r.model, images: images.length },
  }).select("id").single();
  const saved: { id: string; lesson: string }[] = [];
  for (const L of (r.data.lessons || []).slice(0, 3)) {
    if (!L?.text?.trim()) continue;
    const d = L.default ? cleanChange({ setting: L.default.setting, value: L.default.value }) : null;
    const when = ["all", "spot", "sim", "dark", "light"].includes(L.default?.when || "") ? L.default!.when : "all";
    const ins = await admin.from("sep_lessons").insert({ lesson: L.text.trim().slice(0, 400), tags: ["separo", ...(L.tags || []).map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 2)], default_setting: d ? { setting: d.setting, value: d.value, when } : null, by: v.email, feedback_id: fb.data?.id || null }).select("id, lesson").single();
    if (ins.data) saved.push(ins.data as { id: string; lesson: string });
  }
  return NextResponse.json({ id: fb.data?.id || null, summary: r.data.summary, lessons: saved, engine_notes: r.data.engine_notes || [] });
}
