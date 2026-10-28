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

/** tasks that write words for people (drafts): a little variety; everything else reads and decides the same way each time */
const WRITING = new Set(["reply_options", "draft_message", "reply_followups", "text_job"]);

/**
 * Ask Claude for one structured answer.
 * `prompt` is the user turn (the email, the order summary…); `system` sets the job and the shop's voice.
 */
/** what a picture really is, from its first bytes (not its name): null when it isn't a JPEG, PNG, GIF or WebP (an SVG,
 *  a PDF, a damaged file), which the API can't take as a picture */
export function imageTypeOf(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export async function askClaude<T>(opts: {
  task: string; model: string; system: string; prompt: string; tool: AiTool; maxTokens?: number; ctx?: AiCtx; admin?: SupabaseClient;
  /** pictures to look at with the prompt (JPEG or PNG, base64 without the data: prefix) */
  images?: { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string; label?: string }[];
  /** PDFs to read with the prompt (base64) */
  documents?: { data: string; label?: string }[];
  /** how long to wait for the answer (ms, default 50 s) */
  timeoutMs?: number;
  /** 0 (the default) = the same answer every time; writing tasks get 0.7 */
  temperature?: number;
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
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 50_000);
  try {
    let pics = opts.images || [];
    const send = (temp: boolean) => fetch(API, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens || 2000,
        // the same answer for the same input (Oct 23, Nick: "I've tried to create this Logotology order 3 times, and each
        // time it gives me a different result… it's hard to get you to problem solve"): readers and checkers run at 0;
        // only the writing tasks (reply and message drafts) keep some variety
        ...(temp ? { temperature: opts.temperature ?? (WRITING.has(opts.task) ? 0.7 : 0) } : {}),
        // the long, unchanging instructions (and the answer format before them) are cached for 5 minutes, so a second read
        // starts faster (Oct 26, Nick: the order reader "is very slow"); short ones aren't worth it
        system: opts.system.length > 6000 ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }] : opts.system,
        messages: [{ role: "user", content: pics.length || opts.documents?.length
          ? [
            ...(opts.documents || []).flatMap((d) => [...(d.label ? [{ type: "text", text: d.label }] : []), { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } }]),
            ...pics.flatMap((im) => [...(im.label ? [{ type: "text", text: im.label }] : []), { type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } }]),
            { type: "text", text: opts.prompt },
          ]
          : opts.prompt }],
        tools: [opts.tool],
        tool_choice: { type: "tool", name: opts.tool.name },
      }),
    });
    let res = await send(true);
    let j = await res.json().catch(() => ({}));
    // a model that doesn't take a temperature: asked again without one
    if (res.status === 400 && /temperature/i.test(String(j?.error?.message || ""))) { res = await send(false); j = await res.json().catch(() => ({})); }
    // a picture the API can't open (Oct 28: an SVG logo sent as a picture made Claudia's ClickUp order fail with "Could not
    // process image"): only the pictures that open are sent again, or none, so the rest of the reading still happens
    if (res.status === 400 && pics.length && /image/i.test(String(j?.error?.message || ""))) {
      await log({ status: "error", error: `${j?.error?.message || "image error"} (asked again without the bad pictures)` });
      pics = pics.filter((im) => imageTypeOf(Buffer.from(im.data.slice(0, 64), "base64")) === im.media_type);
      if (pics.length === (opts.images || []).length) pics = [];
      res = await send(true); j = await res.json().catch(() => ({}));
    }
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

export type LookedUp = { text: string; sources: { title: string; url: string }[] };
/**
 * Look something up online for a note staff wrote ("we used the LA Lakers PMS colors"): Claude with web search
 * finds the facts the note points to and returns them short, with where they came from. Null when the note
 * needs nothing from outside (or search isn't available).
 */
export async function lookUpFacts(opts: { model: string; note: string; context?: string; ctx?: AiCtx; admin?: SupabaseClient }): Promise<LookedUp | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !opts.note.trim()) return null;
  const admin = opts.admin || createAdminClient();
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  let usage: { input_tokens?: number; output_tokens?: number } = {};
  try {
    const res = await fetch(API, {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model, max_tokens: 800,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        system: "You help a screen printing shop. Staff wrote a note about a customer's job. If the note points to facts that have to be looked up (a sports team's or brand's official colors and their PMS / Pantone numbers, a font, a garment's specs), search the web and give just those facts in 1-4 short lines, e.g. \"LA Lakers: Purple PMS 2685 C, Gold PMS 123 C\". Prefer official brand or league sources. If the note needs nothing looked up, answer exactly NONE.",
        messages: [{ role: "user", content: `${opts.context ? `${opts.context}\n\n` : ""}Staff note: ${opts.note.slice(0, 1500)}` }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    usage = j?.usage || {};
    if (!res.ok) throw new Error(j?.error?.message || `Claude API error ${res.status}`);
    type Block = { type: string; text?: string; citations?: { url?: string; title?: string }[]; content?: { type: string; url?: string; title?: string }[] };
    const blocks = (j.content || []) as Block[];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
    const seen = new Map<string, string>();
    for (const b of blocks) for (const c of b.citations || []) if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url);
    if (!seen.size) for (const b of blocks) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url && seen.size < 3) seen.set(r.url, r.title || r.url);
    await admin.from("ai_runs").insert({ task: "look_up", model: opts.model, ms: Date.now() - started, created_by: opts.ctx?.by || "system", order_id: opts.ctx?.order_id || null, customer_id: opts.ctx?.customer_id || null, activity_id: opts.ctx?.activity_id || null, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, status: "ok" });
    if (!text || /^NONE\.?$/i.test(text)) return null;
    return { text: text.slice(0, 600), sources: [...seen].slice(0, 3).map(([url, title]) => ({ url, title: title.slice(0, 120) })) };
  } catch (e) {
    const error = e instanceof Error ? (e.name === "AbortError" ? "The lookup took too long." : e.message) : "Lookup failed.";
    await admin.from("ai_runs").insert({ task: "look_up", model: opts.model, ms: Date.now() - started, created_by: opts.ctx?.by || "system", order_id: opts.ctx?.order_id || null, customer_id: opts.ctx?.customer_id || null, activity_id: opts.ctx?.activity_id || null, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, status: "error", error });
    return null;
  } finally { clearTimeout(timer); }
}
