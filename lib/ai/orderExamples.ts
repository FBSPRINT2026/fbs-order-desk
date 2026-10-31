import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pdfTextServer } from "@/lib/pdfTextServer";
import { officeText } from "@/lib/officeText";
import { finishingList, lineQty, mergeSettings, orderGroups, persOf, priceList, SIZES, type GLine, type Group, type Order, type PriceType } from "@/lib/pricing";
import { hasSpotChange, spotLines } from "@/lib/spotChange";
import { isThirdParty, thirdPartyLabel } from "@/lib/thirdParty";

/**
 * Worked examples for Create order (Oct 30, Nick after #40284: "how do we train the create order… to make this exactly
 * right every time? You should be able to do all my son's orders almost immediately"). CLAUDE.md: systems that learn
 * over special cases; what the shop teaches is kept and used next time, for everyone, without anyone ticking
 * "remember".
 *
 * When staff say an order is right (Order chat → Yes, it's right) or send it to the customer, what came in (the email
 * and its files' words) is saved beside the order staff finished, and beside the first reading when there was one.
 * The next order read for the same customer gets the closest of these (its end client, its words) as a worked
 * example: "this came in → this is the order we made", so it groups, picks logos, prices and ships the same way.
 * Works for any customer; the more orders the shop finishes, the more it has to go by.
 */

export type OrderExample = { id: string; order_id: string; title: string; source_text: string; order_text: string; reading_text: string; confirmed_at: string };

const STOP = new Set("the and for with from this that your you our are was will order orders please thank thanks have has new need po purchase number qty size sizes total each item items color colors ship shipping".split(" "));
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || []).filter((w) => !STOP.has(w)));
const sizeText = (s: GLine["sizes"]) => SIZES.filter((z) => +(s?.[z] || 0) > 0).map((z) => `${z} ${s[z]}`).join(", ") || Object.entries(s || {}).filter(([, n]) => +(n || 0) > 0).map(([z, n]) => `${z} ${n}`).join(", ");

/** an order (or a reading's groups) the way the reader can learn from it: groups, garments, prints, extras, goods, shipping */
export function orderText(o: Partial<Order> & { groups: Group[] }, ctx: { designs: Record<string, { number: number; name: string }>; finNames: Record<string, string> }): string {
  const out: string[] = [];
  const head = [o.nickname && `Job name "${o.nickname}"`, o.po_number && `PO ${o.po_number}`, o.use_program && "priced by their program", o.delivery_method && `delivery: ${o.delivery_method}${o.ship_method ? ` (${o.ship_method})` : ""}`, isThirdParty(o) ? `bill ${thirdPartyLabel(o.third_party)}` : ""].filter(Boolean);
  if (head.length) out.push(head.join(" · "));
  o.groups.forEach((g, gi) => {
    out.push(`Group ${gi + 1} "${g.name || `Group ${gi + 1}`}"${g.description ? ` (${g.description})` : ""}:`);
    for (const l of g.lines || []) {
      if (!lineQty(l)) continue;
      const pers = persOf(l);
      out.push(`  - ${[l.brand, l.style, l.color].filter(Boolean).join(" ")}: ${sizeText(l.sizes)}${l.extras ? " (extras)" : ""}${l.note ? ` · note: ${l.note}` : ""}`);
      for (const e of pers) out.push(`      personalization "${e.text}" · size ${e.size || "—"} · qty ${e.qty} · ${e.loc || "Right Chest"}`);
    }
    for (const im of g.imprints || []) {
      const d = im.design_id ? ctx.designs[im.design_id] : null;
      out.push(`  print: ${im.location || "?"} · ${im.method}${d ? ` · logo D-${d.number} "${d.name}"` : ""}${im.size ? ` · ${im.size}` : ""}${im.inks ? ` · ${im.method === "embroidery" ? "threads" : "inks"}: ${im.inks}` : ""}${im.colors ? ` · ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}`);
      if (hasSpotChange(im, g.lines || [])) out.push(`    location change: ${spotLines(im, g.lines || []).map((x) => `${x.letter} ${x.spot}: ${x.what}`).join("; ")}`);
    }
    const fin = (g.finishing || []).map((f) => ctx.finNames[f] || f);
    if (fin.length) out.push(`  extras: ${fin.join(", ")}`);
  });
  return out.join("\n");
}

async function sourceOf(admin: SupabaseClient, activityId: string): Promise<{ text: string; subject: string }> {
  const { data: a } = await admin.from("activities").select("id, subject, body, from_email, thread_id, customer_id, occurred_at, meta").eq("id", activityId).maybeSingle();
  if (!a) return { text: "", subject: "" };
  const parts: string[] = [`Email from ${a.from_email || "the customer"}${a.subject ? ` "${a.subject}"` : ""}:\n${String(a.body || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500)}`];
  let left = 3500;
  for (const f of ((a.meta as { attachments?: { path: string; name: string; type?: string; size?: number }[] } | null)?.attachments || []).slice(0, 8)) {
    if (left <= 0) break;
    const pdf = /pdf/i.test(f.type || "") || /\.pdf$/i.test(f.name);
    const office = /\.(xlsx|xlsm|docx|csv|tsv|txt)$/i.test(f.name);
    if (!pdf && !office) { parts.push(`File "${f.name}" (a picture or art file)`); continue; }
    const { data } = await admin.storage.from("proofs").download(f.path).catch(() => ({ data: null }));
    if (!data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    const t = (pdf ? await pdfTextServer(buf).catch(() => "") : officeText(f.name, f.type || "", buf)) || "";
    const words = t.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, Math.min(1800, left));
    left -= words.length;
    parts.push(`File "${f.name}" words:\n${words || "(no words read)"}`);
  }
  return { text: parts.join("\n\n"), subject: String(a.subject || "") };
}

/** the order's source email: the reading it was made from, else an email filed on it */
async function sourceActivity(admin: SupabaseClient, orderId: string): Promise<{ activity: string | null; reading: { groups?: Group[] } | null }> {
  const { data: s } = await admin.from("ai_suggestions").select("activity_id, payload").in("kind", ["draft_order", "draft_order_part"]).eq("order_id", orderId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (s?.activity_id) return { activity: s.activity_id as string, reading: ((s.payload as { draft?: { groups?: Group[] } } | null)?.draft) || null };
  const { data: e } = await admin.from("activities").select("id").eq("order_id", orderId).eq("kind", "email").eq("direction", "in").order("occurred_at", { ascending: true }).limit(1).maybeSingle();
  return { activity: (e?.id as string) || null, reading: null };
}

/** save (or refresh) an order as a worked example: what came in, the reading, the order staff finished */
export async function saveExample(admin: SupabaseClient, orderId: string, by: string): Promise<{ ok: boolean; why?: string }> {
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o || !o.customer_id) return { ok: false, why: "no customer" };
  const order = { ...(o as Order), groups: orderGroups(o as Order) };
  if (!order.groups.some((g) => g.lines?.some((l) => lineQty(l) > 0))) return { ok: false, why: "no garments" };
  const src = await sourceActivity(admin, orderId);
  if (!src.activity) return { ok: false, why: "not made from an email" };
  const ids = [...new Set(order.groups.flatMap((g) => (g.imprints || []).map((im) => im.design_id)).filter(Boolean) as string[])];
  const { data: ds } = ids.length ? await admin.from("designs").select("id, number, name").in("id", ids) : { data: [] };
  const designs = Object.fromEntries(((ds || []) as { id: string; number: number; name: string }[]).map((d) => [d.id, { number: d.number, name: d.name }]));
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const settings = mergeSettings(st?.data);
  const finNames = Object.fromEntries(finishingList(settings, priceList(settings, (order.price_type || "retail") as PriceType)).map((f) => [f.id, f.name]));
  const { text: source_text, subject } = await sourceOf(admin, src.activity);
  const row = {
    customer_id: o.customer_id, order_id: orderId, activity_id: src.activity, title: `#${o.number} ${o.nickname || subject}`.slice(0, 200),
    source_text, order_text: orderText(order, { designs, finNames }).slice(0, 4000),
    reading_text: src.reading?.groups ? orderText({ groups: src.reading.groups }, { designs, finNames }).slice(0, 2500) : "",
    confirmed_by: by, confirmed_at: new Date().toISOString(), active: true,
  };
  const { error } = await admin.from("order_examples").upsert(row, { onConflict: "order_id" });
  return error ? { ok: false, why: error.message } : { ok: true };
}

/** one of the customer's orders the way the training chat reads it ("look at #40284: this is how it goes every time"):
 *  what it made, group by group, with each group's saved mockup number */
export async function orderTextFor(admin: SupabaseClient, customerId: string, number: number): Promise<{ id: string; title: string; text: string } | null> {
  const { data: o } = await admin.from("orders").select("*").eq("number", number).eq("customer_id", customerId).maybeSingle();
  if (!o) return null;
  const order = { ...(o as Order), groups: orderGroups(o as Order) };
  const ids = [...new Set(order.groups.flatMap((g) => (g.imprints || []).map((im) => im.design_id)).filter(Boolean) as string[])];
  const [{ data: ds }, { data: st }, { data: mk }] = await Promise.all([
    ids.length ? admin.from("designs").select("id, number, name").in("id", ids) : Promise.resolve({ data: [] }),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("mockups").select("number, group_id").eq("order_id", o.id).is("archived_at", null).not("number", "is", null),
  ]);
  const designs = Object.fromEntries(((ds || []) as { id: string; number: number; name: string }[]).map((d) => [d.id, { number: d.number, name: d.name }]));
  const settings = mergeSettings(st?.data);
  const finNames = Object.fromEntries(finishingList(settings, priceList(settings, (order.price_type || "retail") as PriceType)).map((f) => [f.id, f.name]));
  const mockOf = new Map(((mk || []) as { number: number; group_id: string | null }[]).filter((m) => m.group_id).map((m) => [m.group_id!, m.number]));
  const prices = order.groups.flatMap((g) => (g.lines || []).filter((l) => lineQty(l) > 0 && l.priceOverride != null).map((l) => `  ${[l.style, l.color].filter(Boolean).join(" ")} (${g.name || "group"}): $${(+l.priceOverride!).toFixed(2)} each`));
  const text = [orderText(order, { designs, finNames }), ...order.groups.map((g, i) => (mockOf.has(g.id) ? `Group ${i + 1} "${g.name || ""}" mockup: M-${mockOf.get(g.id)}` : "")).filter(Boolean), prices.length ? `Prices on the order:\n${prices.join("\n")}` : ""].filter(Boolean).join("\n");
  return { id: o.id as string, title: `#${o.number} ${o.nickname || ""}`.trim(), text: text.slice(0, 5000) };
}

/** the closest worked examples for a new email from this customer: the most words in common (the end client, the city,
 *  the products), newest first among equals */
export async function loadExamples(admin: SupabaseClient, customerId: string | null, about: string, n = 2): Promise<OrderExample[]> {
  if (!customerId) return [];
  const { data } = await admin.from("order_examples").select("id, order_id, title, source_text, order_text, reading_text, confirmed_at").eq("customer_id", customerId).eq("active", true).order("confirmed_at", { ascending: false }).limit(40);
  const want = words(about);
  const scored = ((data || []) as OrderExample[]).map((x, i) => { const w = words(`${x.title} ${x.source_text.slice(0, 2500)}`); let s = 0; for (const t of want) if (w.has(t)) s++; return { x, s, i }; });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((y) => y.x);
}

export function examplesText(xs: OrderExample[], who: string): string {
  if (!xs.length) return "";
  return `WORKED EXAMPLES: ORDERS STAFF MADE FROM ${who.toUpperCase()}'S PAST EMAILS (checked right by staff). When this email is the same kind of order (the same end client, the same kind of paperwork), make it the SAME WAY: the same groups (split the same way, named the same way), the same logos by D-number on the same spots at the same sizes and inks/threads, personalization the same way, the same extras, goods and shipping. Only the garments, sizes, names and dates are this email's own. Where your first reading of an example was wrong, don't repeat that mistake.
${xs.map((x, i) => `--- Example ${i + 1}: ${x.title} (made ${x.confirmed_at.slice(0, 10)})
WHAT CAME IN:
${x.source_text.slice(0, 3500)}
THE ORDER STAFF MADE FROM IT:
${x.order_text}${x.reading_text ? `
YOUR FIRST READING OF IT (corrected by staff into the order above):
${x.reading_text}` : ""}`).join("\n\n")}`;
}
