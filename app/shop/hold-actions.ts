"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readInboxEmail } from "@/app/shop/mail-actions";

/**
 * The press-and-hold menu's summary (Oct 15, Nick: "a more in depth AI summary"): the AI reads the whole email and
 * gives the details that matter (what they want, how many, which garments, dates, order numbers, money) and what they
 * need from us next. Kept, so holding the same email again is instant.
 */
export type HoldSummary = { points: string[]; next: string };

const toText = (html: string) => html.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&[lr]dquo;/g, '"');

export async function holdSummary(id: string): Promise<{ ok: true; summary: HoldSummary } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const admin = createAdminClient(), key = `hold:${id}`;
    const { data: had } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", key).limit(1).maybeSingle();
    if ((had?.payload as HoldSummary | undefined)?.points?.length) return { ok: true, summary: had!.payload as HoldSummary };
    const m = await readInboxEmail(id);
    if (!m.ok) return { ok: false, error: m.error };
    // this email, not the ones it quotes (a little of them, for what it's answering)
    const all = (m.text || toText(m.html || "")).replace(/\r/g, "");
    const cut = all.search(/\n\s*(?:On .{5,160} wrote:|-----\s*Original Message|From: .{3,200}\n\s*(?:Sent|Date): )/);
    const mine = (cut > 0 ? all.slice(0, cut) : all).replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
    const before = cut > 0 ? all.slice(cut).replace(/\s+/g, " ").slice(0, 1500) : "";
    const { aiState, askClaude } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: false, error: st.reason };
    const r = await askClaude<{ points: unknown; next: unknown }>({
      task: "hold_summary", model: st.settings.assistant.ai.fastModel || st.settings.assistant.ai.model, maxTokens: 600, admin, ctx: { by: v.email || "" }, timeoutMs: 25_000,
      tool: { name: "summary", description: "What's in the email and what to do about it.", input_schema: { type: "object", properties: {
        points: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" }, description: "2-5 short bullets (under 20 words each) with the concrete details: what they want or are telling us, quantities, garments, colors, sizes, print locations, dates and deadlines, order or job numbers, prices, attachments. No filler, no repeating the subject." },
        next: { type: "string", description: "One short line: what they need from us next (or \"Nothing, just FYI\")." },
      }, required: ["points", "next"] } },
      system: "You read email for the owner of a screen printing shop (FBS Print) who is deciding what to do with it on a phone. Be specific and brief. Use the email's own numbers and names. Don't invent anything that isn't in the email.",
      prompt: `From: ${m.from}\nTo: ${m.to}${m.cc ? `\nCc: ${m.cc}` : ""}\nDate: ${m.date}\nSubject: ${(m as { subject?: string }).subject || ""}${m.attachments?.length ? `\nAttachments: ${m.attachments.map((a) => a.name).join(", ")}` : ""}\n\nThe email:\n"""\n${mine}\n"""${before ? `\n\nWhat it's answering (earlier in the thread):\n"""\n${before}\n"""` : ""}`,
    });
    if (!r.ok) return { ok: false, error: r.error || "The AI didn't answer." };
    const raw = Array.isArray(r.data.points) ? r.data.points : typeof r.data.points === "string" ? (() => { try { return JSON.parse(r.data.points as string); } catch { return [r.data.points]; } })() : [];
    const summary: HoldSummary = { points: (raw as unknown[]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5).map((x) => x.slice(0, 200)), next: String(r.data.next || "").trim().slice(0, 200) };
    if (!summary.points.length) return { ok: false, error: "The AI didn't find anything to say." };
    const row = { kind: "hold_summary", dedupe_key: key, source: "ai", status: "done", priority: 3, title: "Email summary", body: summary.points.join("\n"), payload: summary, model: r.model };
    await admin.from("ai_suggestions").upsert(row, { onConflict: "dedupe_key" });
    return { ok: true, summary };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
