import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { fileB64, imgType, orderBrief } from "@/lib/ai/reorderCheck";
import { loadMemories } from "@/lib/ai/orderMemory";
import { LOCATIONS, orderGroups, type Group, type Order, type Settings } from "@/lib/pricing";

/**
 * "Did I get everything right?" (Oct 23, Nick: "the right panel… never closes until I say, yes, we've got everything
 * right… or no, we got to make these changes… my team should be able to just talk to you… you should learn from it,
 * just like we did with the separation learning with Jose… I don't want my account manager to have to open up
 * Illustrator"). After Create order makes an order (or any time on an order): staff say what's wrong, in plain words,
 * and it's changed. Order changes are made here; art fixes (one black, solid colors, a hairline) are drawn in the
 * browser (lib/artFix.ts) and noted on the print for the proof. Every correction is kept (ai_suggestions, kind
 * order_correction) for the overnight review, and a lesson for the customer can be remembered.
 */
export type OrderChange = {
  /** print / line / art / order */ what: "print" | "line" | "art" | "order";
  /** the print's or line's id ("order" for the order) */ id: string;
  field: string; value: string;
  /** one plain sentence for staff (and, for art, the customer): "Moved the front up to 3" below the collar" */ say: string;
};
export type FixResult = { reply: string; changes: OrderChange[]; applied: string[]; art: OrderChange[]; lesson?: string; rule?: string };

const PRINT_FIELDS = ["size", "location", "inks", "colors", "drop", "underbase"];
const ART_ACTIONS = ["one_black", "flatten", "remove_hairline"];
const EXTRAS = ["printed_free", "not_printed_free", "printed_charged", "not_printed_charged", "not_extras"];

/** the order's garment lines with their ids, so a change can point at one */
const linesText = (groups: Group[]) => groups.map((g, gi) => g.lines.map((l) => `  Line id ${l.id} (group ${gi + 1}): ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color || ""}, ${Object.values(l.sizes || {}).reduce((a, v) => a + (+(v || 0)), 0)} pcs${l.extras ? `, their extras (${l.extrasPrint === false ? "not printed" : "printed"}, ${l.extrasFree === false ? "charged" : "no charge"})` : ""}`).join("\n")).join("\n");

export async function orderFix(admin: SupabaseClient, s: Settings, orderId: string, by: string, message: string, mode: "review" | "change"): Promise<{ ok: true; r: FixResult } | { ok: false; error: string }> {
  const msg = message.trim().slice(0, 2000);
  if (mode === "change" && !msg) return { ok: false, error: "Say what to change first." };
  const b = await orderBrief(admin, orderId, false);
  if (!b.ok) return b;
  const { o, images, documents } = b;
  const groups = orderGroups(o as Order);
  // what the customer sent: their mockup and art files on the order, to compare with
  const { data: theirs } = await admin.from("art_files").select("name, file_path, category").eq("order_id", orderId).in("category", ["customer_mockup", "order_sheet", "print_art"]).order("created_at").limit(6);
  for (const f of theirs || []) {
    const t = imgType(f.file_path);
    if (t && images.length < 10) { const x = await fileB64(admin, f.file_path); if (x) images.push({ media_type: t, data: x, label: `What the customer sent: ${f.name}` }); }
    else if (/\.(pdf|ai)$/i.test(f.file_path) && documents.length < 4) { const x = await fileB64(admin, f.file_path); if (x && Buffer.from(x.slice(0, 12), "base64").toString().startsWith("%PDF")) documents.push({ data: x, label: `What the customer sent: ${f.name}` }); }
  }
  const mem = await loadMemories(admin, (o.customer_id as string) || null).catch(() => []);
  const prompt = [
    b.text,
    "Garment lines:", linesText(groups),
    mem.length ? `\nWhat the shop has taught you about this customer:\n${mem.slice(0, 15).map((m) => `- ${m.text}`).join("\n")}` : "",
    mode === "review" ? "\nStaff ask: did I get everything right? Compare the order with what the customer sent (their mockup, their PO, their art) and say plainly what doesn't match." : `\nStaff say: ${msg}`,
  ].filter(Boolean).join("\n");
  const r = await askClaude<{ reply: string; changes?: OrderChange[]; lesson?: string; rule?: string }>({
    task: "order_fix", model: s.assistant.ai.model, maxTokens: 2000, timeoutMs: 60_000, admin, images, documents,
    ctx: { order_id: orderId, customer_id: o.customer_id, by },
    tool: { name: "order_fix", description: "What you'll change on the order and its art.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, short: what you found or what you changed. No headings." },
      changes: { type: "array", description: "Each change, one field each.", items: { type: "object", properties: {
        what: { type: "string", enum: ["print", "line", "art", "order"] },
        id: { type: "string", description: "The print id (print and art), the line id (line), or \"order\"" },
        field: { type: "string", description: `print: ${PRINT_FIELDS.join(", ")}. art: ${ART_ACTIONS.join(", ")}. line: extras. order: due_date, firm` },
        value: { type: "string", description: `size like 11" wide; location one of: ${LOCATIONS.join(", ")}; inks comma separated; colors a number; drop inches below the collar ("" = our standard spot); underbase yes/no; art: "yes"; line extras: ${EXTRAS.join(", ")}; due_date YYYY-MM-DD; firm yes/no` },
        say: { type: "string", description: "One plain sentence saying the change, past tense, for staff and (art) the customer: \"Made the two blacks in the art one solid black\"" },
      }, required: ["what", "id", "field", "value", "say"] } },
      lesson: { type: "string", description: "Only when staff corrected something that will come up again with THIS customer (how their art usually comes in, where they like a print): one sentence to remember for their next orders. Empty otherwise." },
      rule: { type: "string", description: "Only when the mistake was the shop's own way of doing things, not this customer's (a print placed far too low, a wrong default): one sentence of the rule that would have prevented it. Empty otherwise." },
    }, required: ["reply", "changes"] } },
    system: `${SHOP_CONTEXT(s)}

You're checking an order with the shop's account manager right after it was made, like a careful order-entry person. ${mode === "review" ? "Look at what the customer sent (their mockup, PO, art) next to the order and our mockup, and list only real differences: a print in the wrong spot or far too low, a wrong size, wrong inks, garments or quantities off, extras, the date. If it all matches, say so and change nothing. Changes you list here are SUGGESTIONS staff will approve." : "Staff are telling you what's wrong. Make exactly those changes, nothing else. If you can't tell which print or line they mean, ask in the reply and change nothing."}

Art fixes you can make (what "art", the print id, value "yes"), drawn on the art itself, no Illustrator:
- one_black: two or more blacks in the art (a gray-black next to pure black) become one solid black.
- flatten: shading, soft edges and in-between colors become the print's solid inks; no gradients (when the print is solid colors).
- remove_hairline: a very thin line that can't print (a hairline stroke or gap between shapes) is taken out.
Anything bigger (redrawing art, a new logo, vectorizing a picture) goes to the art department: say so in the reply.
Print drop: "" puts it at our standard spot for the location (a full front sits about 3" below the collar). Keep each "say" short and plain.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const printIds = new Set(groups.flatMap((g) => g.imprints.map((i) => i.id))), lineIds = new Set(groups.flatMap((g) => g.lines.map((l) => l.id)));
  const changes = (Array.isArray(r.data.changes) ? r.data.changes : []).filter((c) =>
    (c.what === "print" && printIds.has(c.id) && PRINT_FIELDS.includes(c.field)) ||
    (c.what === "art" && printIds.has(c.id) && ART_ACTIONS.includes(c.field)) ||
    (c.what === "line" && lineIds.has(c.id) && c.field === "extras" && EXTRAS.includes(c.value)) ||
    (c.what === "order" && ["due_date", "firm"].includes(c.field))).slice(0, 12);
  const res: FixResult = { reply: String(r.data.reply || "").slice(0, 2000), changes, applied: [], art: changes.filter((c) => c.what === "art"), lesson: String(r.data.lesson || "").trim().slice(0, 300) || undefined, rule: String(r.data.rule || "").trim().slice(0, 300) || undefined };
  if (mode === "change") {
    const a = await applyChanges(admin, orderId, by, changes.filter((c) => c.what !== "art"));
    if (!a.ok) return a;
    res.applied = a.applied;
    await keepCorrection(admin, o as Order, by, msg, changes, res);
  }
  return { ok: true, r: res };
}

/** the order changes (not art): print fields, their extras, the date */
export async function applyChanges(admin: SupabaseClient, orderId: string, by: string, changes: OrderChange[]): Promise<{ ok: true; applied: string[] } | { ok: false; error: string }> {
  if (!changes.length) return { ok: true, applied: [] };
  const { data: o } = await admin.from("orders").select("id, groups, due_date, firm").eq("id", orderId).maybeSingle();
  if (!o) return { ok: false, error: "Order not found." };
  const groups = (o.groups || []) as Group[];
  const patch: Record<string, unknown> = {}, applied: string[] = [];
  for (const c of changes) {
    const v = String(c.value || "").trim().slice(0, 120);
    if (c.what === "print") {
      const im = groups.flatMap((g) => g.imprints).find((x) => x.id === c.id);
      if (!im) continue;
      if (c.field === "size") { const n = parseFloat(v); if (!(n > 0 && n < 30)) continue; im.size = `${n}" wide`; }
      else if (c.field === "location") { if (!(LOCATIONS as readonly string[]).includes(v)) continue; im.location = v; }
      else if (c.field === "inks") { im.inks = v; }
      else if (c.field === "colors") { const n = parseInt(v, 10); if (!(n > 0 && n < 13)) continue; im.colors = n; }
      else if (c.field === "drop") { const n = parseFloat(v); im.drop = n > 0 && n < 20 ? String(n) : ""; }
      else if (c.field === "underbase") { im.underbase = /^y|true|on/i.test(v); }
      else continue;
      im.notes = [im.notes, `Changed after it was made: ${c.say}`].filter(Boolean).join(". ").slice(0, 300);
    } else if (c.what === "line") {
      const l = groups.flatMap((g) => g.lines).find((x) => x.id === c.id);
      if (!l) continue;
      if (v === "not_extras") { delete l.extras; delete l.extrasPrint; delete l.extrasFree; if (l.priceOverride === 0) l.priceOverride = null; }
      else { const free = /_free$/.test(v); l.extras = true; l.extrasPrint = !/^not_printed/.test(v); l.extrasFree = free; l.priceOverride = free ? 0 : l.priceOverride === 0 ? null : l.priceOverride; }
    } else if (c.what === "order") {
      if (c.field === "due_date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) patch.due_date = v;
      else if (c.field === "firm") patch.firm = /^y|true|on/i.test(v);
      else continue;
    }
    applied.push(c.say);
  }
  if (!applied.length) return { ok: true, applied };
  const { error } = await admin.from("orders").update({ groups, ...patch }).eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  await admin.from("order_events").insert({ order_id: orderId, kind: "edited", detail: `Changed when it was checked: ${applied.join("; ")}`.slice(0, 2000), actor: by });
  return { ok: true, applied };
}

/** one correction, kept for the overnight review (and the order's history) */
export async function keepCorrection(admin: SupabaseClient, o: Pick<Order, "id" | "number" | "customer_id" | "nickname">, by: string, said: string, changes: OrderChange[], res?: Pick<FixResult, "lesson" | "rule">) {
  if (!changes.length && !said) return;
  await admin.from("ai_suggestions").insert({
    kind: "order_correction", source: "staff", status: "open", priority: 3, order_id: o.id, customer_id: o.customer_id || null,
    title: `Corrected #${o.number}${o.nickname ? ` ${o.nickname}` : ""}`.slice(0, 200), body: (said || changes.map((c) => c.say).join("; ")).slice(0, 300),
    payload: { by, said, changes, lesson: res?.lesson || null, rule: res?.rule || null, at: new Date().toISOString() },
  });
}
