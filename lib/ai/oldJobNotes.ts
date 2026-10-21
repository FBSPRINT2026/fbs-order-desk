import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { LOCATIONS, METHODS, type Group, type Settings } from "@/lib/pricing";
import type { EODraft } from "@/lib/emailOrderShared";

/**
 * A reorder of an old Printavo job: what its notes say about the prints, put on the new prints as suggestions
 * (Oct 21, Nick, #33786 Mewjira: the customer note said "Front has 4 colors = Teal/Blue (7466 maybe), Yellow = 803c,
 * 806c, then Black. Back has 2 colors, Yellow & Black" — "you should be able to discern that and make a suggested
 * imprint… you should know to pre-choose these"). The inks go on each print (so the mockup is painted with them) and
 * stay marked for production to confirm; what the notes say goes in the production notes as "suggested, confirm".
 */
type Old = { visual_id: string | number | null; nickname?: string | null; data: unknown };
type Answer = { prints?: { imprint_id?: string; inks?: string[]; colors?: number; size?: string; why?: string }[]; production_note?: string };

const strip = (s: unknown) => String(s ?? "").replace(/<br\s*\/?>|<\/(div|p|li)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

/** what the old job says in words: its notes, line and print descriptions, and the customer's emails on it */
export function oldJobText(row: Old) {
  const d = (row.data || {}) as { customerNote?: string; productionNote?: string; groups?: { lines?: { description?: string }[]; imprints?: { details?: string; typeOfWork?: string }[] }[]; messages?: { incoming?: boolean; at?: string; text?: string }[] };
  const out: string[] = [];
  if (strip(d.customerNote)) out.push(`Customer note: ${strip(d.customerNote)}`);
  if (strip(d.productionNote)) out.push(`Production note: ${strip(d.productionNote)}`);
  for (const g of d.groups || []) {
    for (const l of g.lines || []) { const t = strip(l.description); if (t) out.push(`Line: ${t.replace(/\n/g, " / ")}`); }
    for (const im of g.imprints || []) { const t = strip(`${im.typeOfWork || ""} ${im.details || ""}`); if (t) out.push(`Imprint: ${t}`); }
  }
  for (const m of (d.messages || []).filter((x) => strip(x.text)).slice(-6)) out.push(`${m.incoming ? "Customer" : "Shop"} email ${String(m.at || "").slice(0, 10)}: ${strip(m.text).slice(0, 700)}`);
  return out.join("\n").slice(0, 6000);
}

/** anything about inks or colors to read at all (no AI call for a job that just says "1/0 Screen Print") */
const SAYS_INKS = /\bpms\b|\b\d{3,4}\s?c\b|\bink|\bcolou?rs?\b|\bc\s?=\s?\d|\b(teal|yellow|pink|black|white|red|navy|royal|gold|green|orange|purple|gray|grey|silver|neon)\b/i;

export async function fillFromOldNotes(admin: SupabaseClient, s: Settings, draft: EODraft, by: string, customerId?: string | null): Promise<void> {
  if (!draft.reorderOf?.startsWith("a:")) return;
  const { data: row } = await admin.from("archived_orders").select("visual_id, nickname, data").eq("id", draft.reorderOf.slice(2)).maybeSingle();
  if (!row) return;
  const text = oldJobText(row as Old);
  const ims = draft.groups.flatMap((g: Group) => g.imprints);
  if (!ims.length || !SAYS_INKS.test(text)) return;
  const label = `Printavo #${row.visual_id}`;
  const prints = draft.groups.map((g, gi) => [
    `Group ${gi + 1}: ${g.lines.map((l) => [l.brand, l.style, l.color].filter(Boolean).join(" ")).join("; ")}`,
    ...g.imprints.map((im) => `  Print id ${im.id}: ${METHODS[im.method] || im.method} on ${im.location}, ${im.colors} color(s)${im.inks ? `, inks ${im.inks}` : ", no inks yet"}${im.size ? `, size ${im.size}` : ""}`),
  ].join("\n")).join("\n");
  const r = await askClaude<Answer>({
    task: "reorder_old_notes", model: s.assistant.ai.model, maxTokens: 1500, timeoutMs: 40_000, admin,
    ctx: { customer_id: customerId || null, by },
    system: `You help a screen printing shop set up a reorder of an old job. Printavo didn't keep the inks on its prints, but the old job's notes often say them. Read the notes and work out, for each print on the new order, its ink colors as the shop names them:
- PMS colors as "PMS 803 C" (a bare number like 7466 or 803c is a Pantone Coated color); a "C=75 M=7 Y=29" mix is the same ink, use the PMS when given.
- Plain colors as their name: Black, White, Navy, Athletic Gold…
- A color named only by a word with its PMS elsewhere ("Yellow = 803c") is the PMS. "Teal/Blue (7466 maybe)" is PMS 7466 C.
- List the inks in the order they print when the notes say so, else as written.
Match the notes' sides to the prints: "front" is the Full Front (or chest) print, "back" the Full Back. Only fill a print the notes speak to; leave out what you can't tell. Use the print ids given.
Also write production_note: a short note for production with everything the notes say about how it printed (inks per side, PMS and CMYK values, print order, sizes, placement, anything else that still applies), so production can confirm it. Plain sentences, no markdown.
The shop's print locations: ${LOCATIONS.join(", ")}.`,
    prompt: `THE OLD JOB, ${label}${row.nickname ? ` "${row.nickname}"` : ""}:\n${text}\n\nTHE NEW REORDER'S PRINTS:\n${prints}`,
    tool: { name: "suggest_prints", description: "The inks for each print, from the old job's notes", input_schema: { type: "object", properties: {
      prints: { type: "array", items: { type: "object", properties: {
        imprint_id: { type: "string" }, inks: { type: "array", items: { type: "string" } }, colors: { type: "number", description: "screens / ink colors on this print" },
        size: { type: "string", description: 'only if the notes give it, like 11" wide' }, why: { type: "string", description: "the words in the notes this comes from" },
      }, required: ["imprint_id", "inks"] } },
      production_note: { type: "string" },
    }, required: ["prints", "production_note"] } },
  });
  if (!r.ok) { console.warn("fillFromOldNotes", r.error); return; }
  const at = new Date().toISOString(), who = `AI, from ${label}'s notes`;
  const filled: string[] = [];
  for (const p of Array.isArray(r.data.prints) ? r.data.prints : []) {
    const im = ims.find((x) => x.id === p.imprint_id);
    const inks = (Array.isArray(p.inks) ? p.inks : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
    if (!im || !inks.length || im.inks) continue;
    im.inks = inks.join(", ");
    if (im.method === "screen") im.colors = inks.length;
    if (!im.size && p.size && /^\d{1,2}(\.\d+)?"? ?(wide|w)?$/i.test(p.size.trim())) im.size = `${parseFloat(p.size)}" wide`;
    // a suggestion, not a fact: production still confirms the ink (and size)
    im.confirm = { size: im.confirm?.size ?? true, ink: true, why: im.confirm?.why || `Reorder of ${label}`, filled: { by: who, at } };
    im.notes = [im.notes, `Inks from ${label}'s notes${p.why ? `: "${String(p.why).slice(0, 160)}"` : ""}`].filter(Boolean).join(". ").slice(0, 300);
    filled.push(`${im.location}: ${im.inks}`);
  }
  const note = String(r.data.production_note || "").trim();
  if (note || filled.length) draft.prodSuggest = `Suggested from ${label}'s notes (production: please confirm before printing):\n${note}${filled.length ? `\nPre-filled on the prints: ${filled.join("; ")}.` : ""}`.slice(0, 1500);
}
