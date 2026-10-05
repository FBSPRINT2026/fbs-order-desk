import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, type Settings } from "@/lib/pricing";

// The one place the app talks to Claude. Every call:
//   - is off unless ANTHROPIC_API_KEY is set in Vercel AND "Use AI" is on in Pricing & shop
//   - asks Claude for one structured answer (a "tool" with a JSON schema), so results are data, not prose to parse
//   - is written to ai_runs (task, model, tokens, time, error) so cost and quality can be reviewed
// Nothing here changes an order by itself: callers turn results into suggestions staff accept or dismiss.

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

export type AiTool = { name: string; description: string; input_schema: Record<string, unknown> };
export type AiCtx = { order_id?: string | null; customer_id?: string | null; activity_id?: string | null; by?: string };
export type AiResult<T> = { ok: true; data: T; model: string; runId: string | null } | { ok: false; error: string; off?: boolean };

export function hasAiKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Settings plus whether AI can run right now, and why not. */
export async function aiState(admin: SupabaseClient = createAdminClient()): Promise<{ settings: Settings; ready: boolean; reason: string }> {
  const { data } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(data?.data);
  if (!hasAiKey()) return { settings, ready: false, reason: "Add ANTHROPIC_API_KEY in Vercel to turn on AI." };
  if (!settings.assistant.ai.enabled) return { settings, ready: false, reason: "AI is switched off in Pricing & shop → Assistant & AI." };
  return { settings, ready: true, reason: "" };
}

/**
 * Ask Claude for one structured answer.
 * `prompt` is the user turn (the email, the order summary…); `system` sets the job and the shop's voice.
 */
export async function askClaude<T>(opts: {
  task: string; model: string; system: string; prompt: string; tool: AiTool; maxTokens?: number; ctx?: AiCtx; admin?: SupabaseClient;
  /** pictures to look at with the prompt (JPEG or PNG, base64 without the data: prefix) */
  images?: { media_type: "image/jpeg" | "image/png"; data: string; label?: string }[];
}): Promise<AiResult<T>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "AI isn't set up yet.", off: true };
  const admin = opts.admin || createAdminClient();
  const started = Date.now();
  const log = async (row: { status: "ok" | "error"; input_tokens?: number; output_tokens?: number; error?: string }) => {
    const { data } = await admin.from("ai_runs").insert({
      task: opts.task, model: opts.model, ms: Date.now() - started, created_by: opts.ctx?.by || "system",
      order_id: opts.ctx?.order_id || null, customer_id: opts.ctx?.customer_id || null, activity_id: opts.ctx?.activity_id || null,
      input_tokens: row.input_tokens || 0, output_tokens: row.output_tokens || 0, status: row.status, error: row.error || null,
    }).select("id").maybeSingle();
    return (data?.id as string) || null;
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50_000);
  try {
    const res = await fetch(API, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens || 2000,
        system: opts.system,
        messages: [{ role: "user", content: opts.images?.length
          ? [...opts.images.flatMap((im) => [...(im.label ? [{ type: "text", text: im.label }] : []), { type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }]), { type: "text", text: opts.prompt }]
          : opts.prompt }],
        tools: [opts.tool],
        tool_choice: { type: "tool", name: opts.tool.name },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = j?.error?.message || `Claude API error ${res.status}`;
      await log({ status: "error", error });
      return { ok: false, error };
    }
    const use = (j.content || []).find((b: { type: string; name?: string }) => b.type === "tool_use" && b.name === opts.tool.name);
    const runId = await log({ status: use ? "ok" : "error", input_tokens: j.usage?.input_tokens, output_tokens: j.usage?.output_tokens, error: use ? undefined : "No structured answer" });
    if (!use) return { ok: false, error: "The AI didn't return an answer. Try again." };
    return { ok: true, data: use.input as T, model: j.model || opts.model, runId };
  } catch (e) {
    const error = e instanceof Error ? (e.name === "AbortError" ? "The AI took too long to answer." : e.message) : "AI request failed.";
    await log({ status: "error", error });
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
