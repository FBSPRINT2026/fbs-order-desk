import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { mergeSettings } from "@/lib/pricing";

/**
 * Junk on the website's form (Nov 6, Nick: "we're gonna get a lot of junk on our website open form… a button… ignore and
 * block… I noticed this… looks like junk… if it comes in to us, we can just automatically ignore"). Two checks, for every
 * submission:
 *  - blocked: the sender's email, their company's email domain, their IP or their phone was blocked by staff (Ignore and
 *    block in the Job Center's Leads). Those are kept as spam and never made into a lead.
 *  - looks like junk: the AI reads it the way a person would (a sales pitch, an offer of services, SEO, a bot) with the
 *    submissions staff blocked before as its examples, so it learns what this shop calls junk. A junk one still shows,
 *    flagged, with Ignore and block one click away.
 */
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|live|aol|icloud|me|msn|comcast|att|sbcglobal|proton|protonmail|ymail|mail|gmx)\./i;
export const domainOf = (email: string) => { const d = (email.split("@")[1] || "").toLowerCase().trim(); return d && !FREE_MAIL.test(d) ? d : ""; };
export const phoneKey = (p: string) => p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export async function blockedBy(admin: SupabaseClient, x: { email: string; ip: string; phone: string }): Promise<string> {
  const pairs: [string, string][] = [["email", x.email.toLowerCase()], ["domain", domainOf(x.email)], ["ip", x.ip], ["phone", phoneKey(x.phone)]];
  const want = pairs.filter(([, v]) => v && v !== "unknown");
  if (!want.length) return "";
  const { data } = await admin.from("site_blocks").select("kind, value").is("removed_at", null).in("value", want.map(([, v]) => v));
  const hit = ((data || []) as { kind: string; value: string }[]).find((r) => want.some(([k, v]) => k === r.kind && v === r.value));
  return hit ? `blocked ${hit.kind} ${hit.value}` : "";
}

/** "" when it reads like a real customer; else a short reason ("A sales pitch for virtual assistants") */
export async function junkReason(admin: SupabaseClient, text: string): Promise<string> {
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const s = mergeSettings(st?.data);
  // what staff blocked before: the shop's own examples of junk
  const { data: ex } = await admin.from("site_blocks").select("sample, reason").is("removed_at", null).not("sample", "is", null).order("created_at", { ascending: false }).limit(6);
  const examples = ((ex || []) as { sample: string; reason: string | null }[]).map((e, i) => `Example ${i + 1} (junk${e.reason ? `: ${e.reason}` : ""}):\n${e.sample.slice(0, 600)}`).join("\n\n");
  const r = await askClaude<{ junk: boolean; why: string }>({
    task: "site_junk", model: s.assistant.ai.fastModel || s.assistant.ai.model, maxTokens: 200, timeoutMs: 12_000, admin,
    system: `You read submissions from the quote and account form on the website of ${s.shop.name}, a screen printing, embroidery and heat transfer shop. Say whether it is JUNK: someone selling something to the shop (virtual assistants, marketing, SEO, web design, leads, loans, software), a bot, gibberish, or anything that isn't a person or business wanting printed or embroidered goods or an account. A real customer can be short, vague or misspelled; that is not junk. When unsure, it is not junk.${examples ? `\n\nSubmissions this shop blocked before:\n\n${examples}` : ""}`,
    prompt: text.slice(0, 4000),
    tool: { name: "verdict", description: "Whether this submission is junk", input_schema: { type: "object", properties: { junk: { type: "boolean" }, why: { type: "string", description: "If junk, under 12 words: what it is (\"A sales pitch for virtual assistants\")" } }, required: ["junk", "why"] } },
  }).catch(() => null);
  return r && r.ok && r.data.junk ? (r.data.why || "Looks like junk").slice(0, 160) : "";
}
