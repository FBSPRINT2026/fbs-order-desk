import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { LOCATIONS, SIZES, type Settings } from "@/lib/pricing";
import type { HelperAction, HelperMsg, HelperOrder } from "@/lib/orderHelperShared";

/**
 * The order helper (lib/orderHelperShared.ts): staff tell it what to do with the order on screen, in words or with a
 * snip of the customer's email or spreadsheet; it answers, asks what it can't tell, and sends back changes for the page
 * to make (sizes, lines, prints, prices, fees, the job's name and dates).
 */
export async function orderHelper(admin: SupabaseClient, s: Settings, a: {
  orderId: string; by: string; message: string; order: HelperOrder; thread: HelperMsg[];
  images: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string }[]; pairs: { adult: string; youth: string }[];
}): Promise<{ ok: true; reply: string; actions: HelperAction[] } | { ok: false; error: string }> {
  const o = a.order;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const orderText = [
    `Order #${o.number}${o.nickname ? ` "${o.nickname}"` : ""} for ${o.customer || "no customer yet"} (${o.price_type} pricing). Due ${o.due_date || "not set"}. PO ${o.po_number || "none"}. Total now $${o.total.toFixed(2)}.`,
    o.fees.length ? `Fees: ${o.fees.map((f) => `${f.label} $${f.amount}`).join(", ")}.` : "",
    o.discount ? `Discount: ${o.discount}.` : "",
    o.notes ? `Notes: ${o.notes.slice(0, 600)}` : "",
    ...o.groups.map((g, gi) => [
      `Group ${gi}${g.name ? ` "${g.name}"` : ""}:`,
      ...g.lines.map((l, li) => `  line ${li}: ${l.style || "(no style)"}${l.brand ? ` ${l.brand}` : ""} · ${l.color || "(no color)"}${l.description ? ` · ${l.description}` : ""} · sizes ${Object.keys(l.sizes).length ? Object.entries(l.sizes).map(([k, v]) => `${k} ${v}`).join(", ") : "none"}${l.each != null ? ` · $${l.each.toFixed(2)} each${l.priceSetByHand ? " (typed by hand)" : ""}` : ""}${l.sizeCharges && Object.keys(l.sizeCharges).length ? ` · extra each: ${Object.entries(l.sizeCharges).map(([k, v]) => `${k} +$${v}`).join(", ")}` : ""}${l.colors?.length ? ` · comes in: ${l.colors.slice(0, 80).join(", ")}` : ""}`),
      ...g.imprints.map((d) => `  print: ${d.method} ${d.location}, ${d.colors} color${d.colors === 1 ? "" : "s"}${d.inks ? ` (${d.inks})` : ""}${d.size ? `, ${d.size}` : ""}`),
    ].join("\n")),
  ].filter(Boolean).join("\n");
  const prompt = [
    orderText,
    a.pairs.length ? `\nYouth styles that go with adult styles (adult → youth): ${a.pairs.map((p) => `${p.adult} → ${p.youth}`).join(", ")}` : "",
    a.thread.length ? `\nThe conversation so far:\n${a.thread.slice(-14).map((m) => `${m.role === "staff" ? "Staff" : "You"}: ${m.text}${m.images ? ` [${m.images} picture${m.images === 1 ? "" : "s"}]` : ""}${m.done?.length ? ` [done: ${m.done.join("; ")}]` : ""}`).join("\n")}` : "",
    `\nStaff now says: ${a.message || "(see the picture)"}${a.images.length ? ` [${a.images.length} picture${a.images.length === 1 ? "" : "s"} attached]` : ""}`,
  ].filter(Boolean).join("\n");

  const num = { type: "number" };
  const r = await askClaude<{ reply: string; actions?: HelperAction[] }>({
    task: "order_helper", model: s.assistant.ai.model, maxTokens: 4000, timeoutMs: 58_000, admin,
    images: a.images, ctx: { order_id: a.orderId, by: a.by },
    tool: { name: "answer", description: "Your reply to staff and the changes to make to the order.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, short. Say what you changed (with the totals), or ask what you need to know." },
      actions: { type: "array", description: "Changes to make, in order. Leave empty when you're only asking or answering.", items: { type: "object", properties: {
        kind: { type: "string", enum: ["set_sizes", "add_line", "set_line", "remove_line", "set_imprint", "set_size_charge", "set_price", "add_fee", "set_discount", "set_order"] },
        group: { description: "A group's number on the order, or (add_line / set_imprint) the name of a new group to make" },
        line: num, style: { type: "string" }, brand: { type: "string" }, color: { type: "string" },
        sizes: { type: "object", description: "Size → quantity (set_sizes, add_line), or size → extra charge each, null for automatic (set_size_charge)", additionalProperties: { type: ["number", "null"] } },
        mode: { type: "string", enum: ["replace", "add"] },
        location: { type: "string" }, method: { type: "string", enum: ["screen", "embroidery", "dtf", "heat"] }, colors: num, inks: { type: "string" }, size: { type: "string" },
        each: { type: ["number", "null"] }, label: { type: "string" }, amount: num, type: { type: "string", enum: ["pct", "amt"] }, value: num,
        nickname: { type: "string" }, due_date: { type: "string" }, po_number: { type: "string" }, notes_append: { type: "string" },
        group_name: { type: "object", properties: { group: num, name: { type: "string" } } },
      }, required: ["kind"] } },
    }, required: ["reply"] } },
    system: `${SHOP_CONTEXT(s)}

You're the helper on the order page. Staff tell you what to do with this order, in words or with a snip (a screenshot of the customer's email, text or spreadsheet), and you do it: fill it in, build it, change sizes, styles, colors, prints, prices, fees, the job name and dates. Today is ${today}.

How the order works: garments are lines in groups; lines in the same group share the same prints and their pieces add up for the price break. Group and line numbers start at 0.

Doing it:
- Change things with actions; the page makes them right away (staff can Undo). Then reply in one or two short sentences with what you did and the totals. Only take quantities, sizes and prices from what staff or the snip say; never make numbers up.
- Filling in from a snip when the order already has the garments: put each row's sizes on the line it matches (same color, the closest color name: "Grey Soft" → a line in Soft Grey or Heather Grey) with set_sizes, mode replace. Don't add a line the order already has.
- Building it: add_line for each style and color, with its sizes; a new group by name (e.g. "Shirts") when the order has no garments yet, otherwise the group they belong to.
- When you can't tell something you need (which style a color is, which line a row goes on, whether "Extra Red" adds to Red or is its own line), ask in one short message listing exactly what you need ("What style is the Black, the Grey Soft and the Red? Same style for all three?"), and do the parts that are clear. When staff answer, do it.
- Sizes: ${SIZES.join(", ")}. Adult S → S, Adult XL → XL, XXL / 2X → 2XL, Youth M → YM, Youth XL → YXL, etc. Skip totals, subtotals and grand totals; check your numbers add up to the totals shown.
- Youth sizes go on a youth style, not the adult one: the youth line of the same color if the order has one; else add one with the youth style that goes with the adult style (the list above, or one you know for sure, like Gildan 5000 → 5000B); if you don't know it, ask.
- Prices: set_price "each" is the whole price per piece (garment and prints); null puts it back on the price list. set_size_charge is the extra each for a big size ("make the 2XLs $2 more" → {"2XL": 2}); leave group/line out to change every line. A fee is a line on the invoice (setup, rush, art, shipping). Discount: pct or amt.
- Prints: set_imprint with the group and location (${LOCATIONS.join(", ")}); method screen, embroidery, dtf or heat; colors a number; inks comma separated.
- Job name, due date (YYYY-MM-DD), PO and notes: set_order; group_name renames a group.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const actions = (r.data.actions || []).filter((x) => x && typeof x === "object" && typeof x.kind === "string").slice(0, 80);
  return { ok: true, reply: String(r.data.reply || "").trim() || (actions.length ? "Done." : "I'm not sure what to change."), actions };
}
