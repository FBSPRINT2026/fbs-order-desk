import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Look a customer's business up online (Nov 3, Nick: "when I pull up creative apparel, I don't really know their billing
 * address, but I bet if you Google them… you can see their address… their main number… would you like to update it with
 * what's on their Google file?"). Claude with web search finds the company's own listing (their website, Google business
 * listing, BBB, the state's business records) from what we know about them: the name, the web domain of their email, the
 * city if we have one. Nothing is saved here: staff see what was found, with where it came from, and pick what to use.
 * The AI tool "Company lookup" (lib/aiTools.ts).
 */
export type CompanyFound = { address: string; phone: string; website: string; sure: "high" | "medium" | "low"; note: string; sources: { title: string; url: string }[] };

export async function lookUpCompany(opts: { model: string; admin: SupabaseClient; by: string; customerId: string; name: string; domains: string[]; known: string }): Promise<{ ok: true; found: CompanyFound | null } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "The AI key isn't set up." };
  if (!opts.name.trim() && !opts.domains.length) return { ok: false, error: "There's no name to look up." };
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50_000);
  let usage: { input_tokens?: number; output_tokens?: number } = {}, error = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model, max_tokens: 900,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
        system: [
          "You help a screen printing shop in Dallas keep its customers' details right. Find the business's main mailing address and main phone number online.",
          "Use the web domain of their email to be sure it's the right company (their own website first, then their Google business listing, BBB, LinkedIn, or state business records).",
          "Many customers are small: a school PTA, a church, a team, a one-person brand. If you can't be sure it's the same organization, say so with sure \"low\" and leave the fields empty rather than guess.",
          "Never give the print shop's own details (FBS Print, 811 Alpha Dr, Richardson TX, 972-487-7858).",
          "Answer with only one JSON object, no other words: {\"address\": \"street, city, state ZIP\" or \"\", \"phone\": \"(xxx) xxx-xxxx\" or \"\", \"website\": \"domain\" or \"\", \"sure\": \"high\"|\"medium\"|\"low\", \"note\": \"one short line: what you found it on, or why you're unsure\"}",
        ].join(" "),
        messages: [{ role: "user", content: `Business: ${opts.name}\n${opts.domains.length ? `Their email domain: ${opts.domains.join(", ")}\n` : ""}${opts.known ? `What we already have: ${opts.known}\n` : ""}Find their main address and phone.` }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    usage = j?.usage || {};
    if (!res.ok) throw new Error(j?.error?.message || `Claude API error ${res.status}`);
    type Block = { type: string; text?: string; citations?: { url?: string; title?: string }[]; content?: { url?: string; title?: string }[] };
    const blocks = (j.content || []) as Block[];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
    const m = text.match(/\{[\s\S]*\}/);
    const raw = m ? (JSON.parse(m[0]) as Partial<CompanyFound>) : null;
    const seen = new Map<string, string>();
    for (const b of blocks) for (const c of b.citations || []) if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url);
    if (!seen.size) for (const b of blocks) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url && seen.size < 3) seen.set(r.url, r.title || r.url);
    if (!raw) return { ok: true, found: null };
    // never our own number or address, whatever the page said
    const phone = String(raw.phone || "").trim(), address = String(raw.address || "").trim();
    const ours = /9724877858/.test(phone.replace(/\D/g, "")) || /811 alpha/i.test(address);
    const found: CompanyFound = { address: ours ? "" : address, phone: ours ? "" : phone, website: String(raw.website || "").trim(), sure: raw.sure === "high" || raw.sure === "medium" ? raw.sure : "low",
      note: String(raw.note || "").trim().slice(0, 240), sources: [...seen].slice(0, 3).map(([url, title]) => ({ url, title: title.slice(0, 120) })) };
    return { ok: true, found: found.address || found.phone ? found : { ...found, note: found.note || "Nothing reliable found online." } };
  } catch (e) {
    error = e instanceof Error ? (e.name === "AbortError" ? "The lookup took too long." : e.message) : "Lookup failed.";
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
    await opts.admin.from("ai_runs").insert({ task: "company_lookup", model: opts.model, ms: Date.now() - started, created_by: opts.by || "system", customer_id: opts.customerId, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0, status: error ? "error" : "ok", error: error || null });
  }
}
