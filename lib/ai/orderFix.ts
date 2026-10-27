import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { fileB64, imgType, orderBrief } from "@/lib/ai/reorderCheck";
import { loadMemories, loadShopRules, shopRulesText } from "@/lib/ai/orderMemory";
import { colorHex } from "@/lib/inkColors";
import { calcOrder, LOCATIONS, mergeSettings, orderGroups, SIZES, uid, type Group, type Order, type Settings } from "@/lib/pricing";

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

const PRINT_FIELDS = ["size", "location", "inks", "colors", "drop", "underbase", "confirm"];
const ART_ACTIONS = ["one_black", "flatten", "remove_hairline", "distress"];
/** the order's own fields (the order page's Job details and Totals, Oct 23, Nick: "change it to pickup"), each checked here */
const yes = (v: string) => /^(y|true|on|1)/i.test(v);
const ORDER_FIELDS: Record<string, { say: string; set: (v: string) => unknown | undefined }> = {
  due_date: { say: "YYYY-MM-DD", set: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined) },
  firm: { say: "yes/no", set: (v) => yes(v) },
  delivery_method: { say: "pickup, deliver or ship", set: (v) => { const k = v.toLowerCase(); return /pick/.test(k) ? "pickup" : /deliver/.test(k) ? "deliver" : /ship/.test(k) ? "ship" : undefined; } },
  ship_to: { say: "the address", set: (v) => v.slice(0, 500) },
  nickname: { say: "the job name", set: (v) => (v ? v.slice(0, 120) : undefined) },
  po_number: { say: "the customer's PO number", set: (v) => v.slice(0, 80) },
  production_date: { say: "YYYY-MM-DD or \"\"", set: (v) => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined) },
  rush: { say: "yes/no", set: (v) => yes(v) },
  tax_exempt: { say: "yes/no", set: (v) => yes(v) },
  price_type: { say: "retail or wholesale", set: (v) => (/whole/i.test(v) ? "wholesale" : /retail/i.test(v) ? "retail" : undefined) },
  discount_pct: { say: "percent off, a number", set: (v) => { const n = parseFloat(v); return n >= 0 && n <= 100 ? n : undefined; } },
  waive_setup: { say: "yes/no (no screen and setup charges)", set: (v) => yes(v) },
};
const EXTRAS = ["printed_free", "not_printed_free", "printed_charged", "not_printed_charged", "not_extras"];

/** the order's garment lines with their ids, so a change can point at one */
const sizeRun = (l: Group["lines"][number]) => SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => `${z} ${l.sizes?.[z]}`).join(", ");
const linesText = (groups: Group[]) => groups.map((g, gi) => `Group ${gi + 1}${g.name ? ` "${g.name}"` : ""}: prints ${g.imprints.length ? g.imprints.map((d) => `${d.location} (${d.method})`).join(", ") : "none"}\n` + g.lines.map((l) => `  Line id ${l.id} (group ${gi + 1}): ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color || ""}, ${Object.values(l.sizes || {}).reduce((a, v) => a + (+(v || 0)), 0)} pcs (${sizeRun(l) || "no sizes"})${l.priceOverride != null && (l.priceOverride as unknown) !== "" ? `, priced $${l.priceOverride} each` : ""}${l.extras ? `, their extras (${l.extrasPrint === false ? "not printed" : "printed"}, ${l.extrasFree === false ? "charged" : "no charge"})` : ""}`).join("\n")).join("\n");

export async function orderFix(admin: SupabaseClient, s: Settings, orderId: string, by: string, message: string, mode: "review" | "change", earlier = ""): Promise<{ ok: true; r: FixResult } | { ok: false; error: string }> {
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
  const { data: cuBp } = o.customer_id ? await admin.from("customers").select("brand_print").eq("id", o.customer_id as string).maybeSingle() : { data: null };
  const hasMask = !!((cuBp?.brand_print || {}) as { distress?: { path?: string } }).distress?.path;
  const mem = await loadMemories(admin, (o.customer_id as string) || null).catch(() => []);
  const prompt = [
    b.text,
    "Garment lines:", linesText(groups),
    mem.length ? `\nWhat the shop has taught you about this customer:\n${mem.slice(0, 15).map((m) => `- ${m.text}`).join("\n")}` : "",
    shopRulesText(await loadShopRules(admin).catch(() => [])),
    earlier.trim() ? `\nEarlier in this check (already done; the order above already has these changes):\n${earlier.trim().slice(0, 3000)}` : "",
    mode === "review" ? "\nStaff ask: did I get everything right? Compare the order with what the customer sent (their mockup, their PO, their art) and say plainly what doesn't match." : `\nStaff say: ${msg}`,
  ].filter(Boolean).join("\n");
  const r = await askClaude<{ reply: string; changes?: OrderChange[]; lesson?: string; rule?: string }>({
    task: "order_fix", model: s.assistant.ai.model, maxTokens: 2000, timeoutMs: 60_000, admin, images, documents,
    ctx: { order_id: orderId, customer_id: o.customer_id, by },
    tool: { name: "order_fix", description: "What you'll change on the order and its art.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, short: what you found or what you changed. No headings. Name prints by their spot (the Full Front print), never by an id." },
      changes: { type: "array", description: "Each change, one field each.", items: { type: "object", properties: {
        what: { type: "string", enum: ["print", "line", "art", "order"] },
        id: { type: "string", description: "The print id (print and art), the line id (line), or \"order\"" },
        field: { type: "string", description: `print: ${PRINT_FIELDS.join(", ")}. art: ${ART_ACTIONS.join(", ")}. line: extras, sizes, color, price, group, group_name. order: ${Object.keys(ORDER_FIELDS).join(", ")}` },
        value: { type: "string", description: `size like 11" wide; location one of: ${LOCATIONS.join(", ")}; inks comma separated; colors a number; drop inches below the collar ("" = our standard spot); underbase yes/no; confirm (production confirms the print's details on the run, the Reorder Details screen): "both", "size", "ink" or "none" (take it off); art: "yes"; line extras: ${EXTRAS.join(", ")}; line sizes: the line's WHOLE size run after the change, like "S:10, M:12, L:8" (sizes from ${SIZES.join(" ")}; one left out = 0); line color: the garment color name; line price: the price per piece in dollars like 1.50 ("" = back to the shop's price); line group: the id of another line whose group this line joins, or "new" for a group of its own; line group_name: the name of the group that line is in after the moves ("Left chest", "Sleeve"); order fields: ${Object.entries(ORDER_FIELDS).map(([k, f]) => `${k} ${f.say}`).join("; ")}` },
        say: { type: "string", description: "One plain sentence saying the change, past tense. An art change goes on the customer's proof, so say what we changed and why, in their words: \"Flattened the art to two colors, black and white (there was shading in the black)\", \"Removed the thin white outline around the hawk (too thin to print)\"" },
      }, required: ["what", "id", "field", "value", "say"] } },
      lesson: { type: "string", description: "Only when staff corrected something that will come up again with THIS customer (how their art usually comes in, where they like a print): one sentence to remember for their next orders. Empty otherwise." },
      rule: { type: "string", description: "Only when the mistake was the shop's own way of doing things, not this customer's (a print placed far too low, a wrong default): one sentence of the rule that would have prevented it. Empty otherwise." },
    }, required: ["reply", "changes"] } },
    system: `${SHOP_CONTEXT(s)}

You're checking an order with the shop's account manager right after it was made, like a careful order-entry person. ${mode === "review" ? "Look at what the customer sent (their mockup, PO, art) next to the order and our mockup, and list only real differences: a print in the wrong spot or far too low, a wrong size, wrong inks, garments or quantities off, extras, the date. If it all matches, say so and change nothing; never list something that stays the same as a change. A white underbase under the inks on a colored (not white) shirt is our standard, not a difference: a customer's 3 colors for 2 named inks on a colored shirt is those 2 plus the white underbase. Changes you list here are SUGGESTIONS staff will approve." : "Staff are telling you what's wrong. Make exactly those changes, nothing else. If you can't tell which print or line they mean, ask in the reply and change nothing."}

Order changes you can make: a garment line's sizes (move quantities to other sizes: give the whole run after the change), its color, its price per piece; which group a line is in (field group: the id of a line in the group it joins, or "new"): this is how groups are combined or split ("put all the left chest ones together, the sleeve ones together" → move every left-chest line into one left-chest line's group and every sleeve line into one sleeve line's group). A line that joins a group takes that group's prints; a group left with no lines goes away. Name each group you combine (group_name on one of its lines) by what it gets: "Left chest", "Left chest + sleeve"; a print's size, location, inks, number of colors, drop and white underbase; a print's details sent to production to confirm on the run (Reorder Details: "production needs to confirm the details" on a reorder → confirm "both", or just "size" / "ink"; "they confirmed it" / "take it off Reorder Details" → "none"; when staff ask for it without naming one print ("have production confirm these", "the mockups", "this order", "it's a reorder, please confirm"), send a confirm change for EVERY print on the order, not just one. It keeps the details already entered as our best guess and never changes the mockup); extras; the order's job name, PO, due date and firm date, production date, rush, pickup / delivery / ship and the address, retail or wholesale, tax exempt, a discount, no setup charge. When staff ask for one of these, make it; don't say you can't.

Art fixes you can make (what "art", the print id, value "yes"), drawn on the art itself, no Illustrator:
- one_black: two or more blacks in the art (a gray-black next to pure black) become one solid black.
- flatten: shading, soft edges and in-between colors become the print's solid inks; no gradients (when the print is solid colors).
- remove_hairline: a very thin line that can't print (a hairline stroke or gap between shapes) is taken out.
- distress: the customer's own saved distress texture (their "distress mask") is laid over the art, the shirt showing through. ${hasMask ? "This customer HAS a saved mask." : "This customer has NO saved mask: say so, and that one can be saved from a distressed logo in the Mockup Creator."}
Anything bigger (redrawing art, a new logo, vectorizing a picture) goes to the art department: say so in the reply.
Print drop: "" puts it at our standard spot for the location (a full front sits about 3" below the collar). Keep each "say" short and plain.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const printIds = new Set(groups.flatMap((g) => g.imprints.map((i) => i.id))), lineIds = new Set(groups.flatMap((g) => g.lines.map((l) => l.id)));
  const changes = (Array.isArray(r.data.changes) ? r.data.changes : []).filter((c) =>
    (c.what === "print" && printIds.has(c.id) && PRINT_FIELDS.includes(c.field)) ||
    (c.what === "art" && printIds.has(c.id) && ART_ACTIONS.includes(c.field)) ||
    (c.what === "line" && lineIds.has(c.id) && ((c.field === "group" && (c.value === "new" || (lineIds.has(c.value) && c.value !== c.id))) || (c.field === "group_name" && !!String(c.value || "").trim()) || (c.field === "extras" && EXTRAS.includes(c.value)) || (c.field === "sizes" && !!parseRun(c.value)) || (c.field === "color" && !!String(c.value || "").trim()) || c.field === "price")) ||
    (c.what === "order" && c.field in ORDER_FIELDS)).filter((c) => !sameAsNow(c, groups, o as Order, mode)).slice(0, 40);
  const res: FixResult = { reply: String(r.data.reply || "").slice(0, 2000), changes, applied: [], art: changes.filter((c) => c.what === "art"), lesson: clean(r.data.lesson), rule: clean(r.data.rule) };
  if (mode === "change") {
    const a = await applyChanges(admin, orderId, by, changes.filter((c) => c.what !== "art"));
    if (!a.ok) return a;
    res.applied = a.applied;
    await keepCorrection(admin, o as Order, by, msg, changes, res);
  }
  return { ok: true, r: res };
}

/** the AI's "nothing" ('""', "none", "N/A") is nothing (Oct 23: Remember for theMcKennagroup: "") */
const clean = (x: unknown) => { const t = String(x ?? "").trim().replace(/^["'“”\s]+|["'“”\s]+$/g, "").slice(0, 300); return t && !/^(none|n\/a|null|nothing|empty)\.?$/i.test(t) ? t : undefined; };

/** "S:10, M:12, L:8" → the size run (null when it isn't one) */
function parseRun(v: string): Partial<Record<(typeof SIZES)[number], number>> | null {
  const out: Partial<Record<(typeof SIZES)[number], number>> = {};
  let n = 0;
  for (const part of String(v || "").split(/[,;]/)) {
    const m = part.trim().match(/^([A-Za-z0-9-]+)\s*[:=x ]\s*(\d+)$/);
    if (!m) { if (part.trim()) return null; continue; }
    const z = SIZES.find((k) => k.toLowerCase() === m[1].toLowerCase());
    if (!z) return null;
    out[z] = +m[2]; n++;
  }
  return n ? out : null;
}

/** a "change" that leaves the order as it is (Oct 23: the check offered "print stays at 3 x 0.7" with a Make this change
 *  button) is dropped, matched on the numbers, not the wording. A check never takes the white underbase off a colored
 *  shirt on its own; only staff saying so does. */
function sameAsNow(c: OrderChange, groups: Group[], o: Order, mode: "review" | "change"): boolean {
  const v = String(c.value || "").trim();
  const num = (x: unknown) => { const n = parseFloat(String(x ?? "")); return Number.isFinite(n) ? n : null; };
  if (c.what === "print") {
    const im = groups.flatMap((g) => g.imprints).find((x) => x.id === c.id);
    if (!im) return true;
    if (c.field === "size") return num(v) !== null && num(v) === num(im.size);
    if (c.field === "location") return v.toLowerCase() === String(im.location || "").toLowerCase();
    if (c.field === "colors") return num(v) === num(im.colors);
    if (c.field === "drop") return (num(v) || 0) === (num(im.drop) || 0);
    if (c.field === "inks") { const k = (x: string) => x.toUpperCase().replace(/PANTONE|PMS|\s+/g, "").split(",").filter(Boolean).sort().join(","); return k(v) === k(String(im.inks || "")); }
    if (c.field === "confirm") { const k = v.toLowerCase(), off = /^(none|no|off|done)/.test(k); return off ? !im.confirm : !!im.confirm && !!im.confirm.size === /both|size|place|all/.test(k) && !!im.confirm.ink === /both|ink|color|all/.test(k); }
    if (c.field === "underbase") { const on = /^y|true|on/i.test(v); return on === !!im.underbase || (mode === "review" && !on); }
  }
  if (c.what === "line") {
    const l = groups.flatMap((g) => g.lines).find((x) => x.id === c.id);
    if (!l) return true;
    if (c.field === "sizes") { const run = parseRun(v); return !!run && SIZES.every((z) => +(run[z] || 0) === +(l.sizes?.[z] || 0)); }
    if (c.field === "color") return v.toLowerCase() === String(l.color || "").toLowerCase();
    if (c.field === "group_name") return v === String(groups.find((g) => g.lines.some((x) => x.id === c.id))?.name || "");
    if (c.field === "group") { const gOf = (id: string) => groups.findIndex((g) => g.lines.some((x) => x.id === id)); return v === "new" ? groups[gOf(c.id)]?.lines.length === 1 : gOf(v) === gOf(c.id); }
    if (c.field === "price") { const n = parseFloat(v.replace(/[$,]/g, "")); return l.priceOverride != null && (l.priceOverride as unknown) !== "" && Math.abs(+l.priceOverride - n) < 0.005; }
  }
  if (c.what === "order" && c.field === "firm") return /^y|true|on/i.test(v) === !!(o as { firm?: boolean }).firm;
  if (c.what === "order" && c.field === "due_date") return v === String((o as { due_date?: string }).due_date || "").slice(0, 10);
  return false;
}

/** the order changes (not art): print fields, their extras, the date */
export async function applyChanges(admin: SupabaseClient, orderId: string, by: string, changes: OrderChange[]): Promise<{ ok: true; applied: string[] } | { ok: false; error: string }> {
  if (!changes.length) return { ok: true, applied: [] };
  const { data: o } = await admin.from("orders").select("id, groups, due_date, firm").eq("id", orderId).maybeSingle();
  if (!o) return { ok: false, error: "Order not found." };
  const groups = (o.groups || []) as Group[];
  const patch: Record<string, unknown> = {}, applied: string[] = [];
  // group names after the moves (the line's group is where it ends up)
  for (const c of [...changes.filter((x) => x.field !== "group_name"), ...changes.filter((x) => x.field === "group_name")]) {
    const v = String(c.value || "").trim().slice(0, 120);
    if (c.what === "print") {
      const im = groups.flatMap((g) => g.imprints).find((x) => x.id === c.id);
      if (!im) continue;
      if (c.field === "size") { const n = parseFloat(v); if (!(n > 0 && n < 30)) continue; im.size = `${n}" wide`; }
      else if (c.field === "location") { if (!(LOCATIONS as readonly string[]).includes(v)) continue; im.location = v; }
      else if (c.field === "inks") {
        im.inks = v;
        // the logo is painted in its picked inks (inkMap, from the Mockup Creator): the new inks, in the same order, so
        // the order page and the mockup show them (Oct 23, Nick: "it did it, but it doesn't update… on the left")
        const names = v.split(",").map((t) => t.trim()).filter(Boolean);
        if (im.inkMap?.map) { const keys = Object.keys(im.inkMap.map); keys.forEach((k, i) => { const n = names[i]; if (!n) return; const hx = colorHex(n); im.inkMap!.map[k] = { ...im.inkMap!.map[k], name: n, ...(hx ? { hex: hx } : {}) }; }); }
      }
      else if (c.field === "colors") { const n = parseInt(v, 10); if (!(n > 0 && n < 13)) continue; im.colors = n; }
      else if (c.field === "drop") { const n = parseFloat(v); im.drop = n > 0 && n < 20 ? String(n) : ""; }
      else if (c.field === "underbase") { im.underbase = /^y|true|on/i.test(v); }
      // Reorder Details (Oct 23, Nick: "this is a reorder, but I need production to confirm the details… like the furry
      // feline, 40093"): the print waits for production to confirm its size and placement and/or inks on the run
      else if (c.field === "confirm") {
        const k = v.toLowerCase();
        if (/^(none|no|off|done)/.test(k)) { delete im.confirm; im.visualOnly = false; }
        else { const size = /both|size|place|all/.test(k), ink = /both|ink|color|all/.test(k); if (!size && !ink) continue; im.confirm = { size, ink, why: "Asked in the Order chat: production confirms on the run", filled: { by: `${by}, in the Order chat (what's on the order now)`, at: new Date().toISOString() } }; im.visualOnly = true; delete (im as { confirmed?: unknown }).confirmed; }
      }
      else continue;
      // not added to the print's notes (Oct 23: they showed on the customer's proof); the order's history keeps it
    } else if (c.what === "line") {
      const l = groups.flatMap((g) => g.lines).find((x) => x.id === c.id);
      if (!l) continue;
      if (c.field === "group") {
        // combine / split groups (Oct 27, Nick on #40191: "there just should be two groups, the ones that get the left chest
        // and the ones that get the sleeve"): the line leaves its group for the other line's (or a new one with its prints)
        const from = groups.find((g) => g.lines.some((x) => x.id === l.id));
        const to = v === "new" ? null : groups.find((g) => g.lines.some((x) => x.id === v));
        if (!from || from === to || (v !== "new" && !to)) continue;
        from.lines = from.lines.filter((x) => x.id !== l.id);
        if (to) to.lines.push(l);
        else { const ng = JSON.parse(JSON.stringify(from)) as Group; ng.id = uid(); ng.name = ""; ng.lines = [l]; ng.imprints = ng.imprints.map((d) => ({ ...d, id: uid() })); delete (ng as { mockupAt?: unknown }).mockupAt; delete (ng as { mockupThumbs?: unknown }).mockupThumbs; groups.splice(groups.indexOf(from) + 1, 0, ng); }
        if (!from.lines.length) groups.splice(groups.indexOf(from), 1);
      }
      else if (c.field === "group_name") { const g = groups.find((x) => x.lines.some((y) => y.id === l.id)); if (!g || !v) continue; g.name = v.slice(0, 80); }
      else if (c.field === "sizes") { const run = parseRun(v); if (!run) continue; l.sizes = run; }
      else if (c.field === "color") { if (!v) continue; l.color = v; }
      else if (c.field === "price") { const n = parseFloat(v.replace(/[$,]/g, "")); if (v && !(n >= 0 && n < 10000)) continue; l.priceOverride = v ? Math.round(n * 100) / 100 : null; }
      else if (v === "not_extras") { delete l.extras; delete l.extrasPrint; delete l.extrasFree; if (l.priceOverride === 0) l.priceOverride = null; }
      else { const free = /_free$/.test(v); l.extras = true; l.extrasPrint = !/^not_printed/.test(v); l.extrasFree = free; l.priceOverride = free ? 0 : l.priceOverride === 0 ? null : l.priceOverride; }
    } else if (c.what === "order") {
      const f = ORDER_FIELDS[c.field];
      const x = f ? f.set(v) : undefined;
      if (x === undefined) continue;
      patch[c.field] = x;
    }
    applied.push(c.say);
  }
  if (!applied.length) return { ok: true, applied };
  // the totals follow (sizes or extras change the price), like the order page's save
  const { data: full } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  let money: Record<string, number> = {};
  try { if (full) { const c = calcOrder({ ...(full as Order), groups, ...patch } as Order, mergeSettings(st?.data)); money = { total: c.total, qty: c.qty }; } } catch { /* the page's next save fixes it */ }
  const { error } = await admin.from("orders").update({ groups, ...patch, ...money }).eq("id", orderId);
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
