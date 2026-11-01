import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pdfTextServer } from "@/lib/pdfTextServer";
import { officeText } from "@/lib/officeText";
import { finishingList, lineQty, mergeSettings, orderGroups, persOf, priceList, SIZES, type Design, type GLine, type Group, type Order, type PriceType } from "@/lib/pricing";
import { hasSpotChange, spotLines } from "@/lib/spotChange";
import { isThirdParty, thirdPartyLabel } from "@/lib/thirdParty";
import { colorwayOnColor, colorwaysOf, type BrandRules } from "@/lib/brands";
import { customerTrainings, DEFAULT_FIELDS, SHIP_SAID, trainingsForText, type DefaultField, type TrainingDefaults } from "@/lib/orderTrainings";

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
      // a patch and their own transfers are said, so the next order like it is made the same way (Oct 31, #40328)
      const how = im.patch ? "heat press patch (patch: Patch Application fee)" : im.supplied ? `dtf · customer supplied transfers${im.supplied.by ? ` by ${im.supplied.by}` : ""}${im.supplied.ref ? `, their order ${im.supplied.ref}` : ""}` : im.method;
      out.push(`  print: ${im.location || "?"} · ${how}${d ? ` · logo D-${d.number} "${d.name}"` : ""}${im.colorway ? ` · version ${im.colorway}` : ""}${im.size ? ` · ${im.size}` : ""}${im.inks && !im.patch ? ` · ${im.method === "embroidery" ? "threads" : "inks"}: ${im.inks}` : ""}${im.colors && !im.patch ? ` · ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}`);
      if (hasSpotChange(im, g.lines || [])) out.push(`    location change: ${spotLines(im, g.lines || []).map((x) => `${x.letter} ${x.spot}: ${x.what}`).join("; ")}`);
    }
    const fin = (g.finishing || []).map((f) => ctx.finNames[f] || f);
    if (fin.length) out.push(`  extras: ${fin.join(", ")}`);
  });
  return out.join("\n");
}

export async function sourceOf(admin: SupabaseClient, activityId: string): Promise<{ text: string; subject: string }> {
  const { data: a } = await admin.from("activities").select("id, subject, body, from_email, thread_id, customer_id, occurred_at, meta").eq("id", activityId).maybeSingle();
  if (!a) return { text: "", subject: "" };
  const parts: string[] = [`Email from ${a.from_email || "the customer"}${a.subject ? ` "${a.subject}"` : ""}:\n${String(a.body || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000)}`];
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

/**
 * Their own heat transfers, learned from what staff marked right (Oct 31, #40330: MEI's cart heat transfers are always
 * the customer's own, #40328 and #40329 were marked right that way, and the next reading made it ours). The latest two
 * orders of this customer staff said are right that have a heat transfer: when every heat transfer on both was customer
 * supplied, this reading's heat transfers are too (a patch isn't a transfer). Returns how many prints it marked.
 */
export async function suppliedLikeBefore(admin: SupabaseClient, customerId: string, groups: Group[]): Promise<number> {
  const todo = groups.flatMap((g) => g.imprints || []).filter((im) => im.method === "dtf" && !im.patch && !im.supplied);
  if (!todo.length) return 0;
  const { data } = await admin.from("order_examples").select("order_text").eq("customer_id", customerId).eq("active", true).order("confirmed_at", { ascending: false }).limit(12);
  const withDtf = ((data || []) as { order_text: string }[]).map((e) => (e.order_text.match(/^\s*print: [^\n]*· dtf\b[^\n]*$/gm) || [])).filter((xs) => xs.length).slice(0, 2);
  if (withDtf.length < 2 || !withDtf.every((xs) => xs.every((x) => /customer supplied transfers/.test(x)))) return 0;
  for (const im of todo) im.supplied = { by: "", ref: "" };
  return todo.length;
}

/** the order's source email: the reading it was made from, else an email filed on it */
export async function sourceActivity(admin: SupabaseClient, orderId: string): Promise<{ activity: string | null; reading: { groups?: Group[] } | null }> {
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
  if (!error) await learnDefaults(admin, o.customer_id as string, `${o.nickname || ""} ${subject} ${o.po_number || ""}`).catch((e) => console.warn("learnDefaults", e));
  if (!error) await learnBrandsFromAll(admin, o.customer_id as string).catch((e) => console.warn("learnBrandLooks", e));
  return error ? { ok: false, why: error.message } : { ok: true };
}

/** what an order's setting is for each training default (the order page's values) */
function settingsOf(o: Order): Record<DefaultField, string | boolean | undefined> {
  const prints = orderGroups(o).flatMap((g) => g.imprints || []);
  return {
    order_type: o.order_type || undefined,
    confirm: prints.length ? prints.some((im) => !im.confirmed && !!im.confirm && (!!im.confirm.size || !!im.confirm.ink)) : undefined,
    delivery_method: ["pickup", "ship", "deliver"].includes(o.delivery_method) ? o.delivery_method : undefined,
    ship_method: o.delivery_method === "ship" && (o.ship_method || "").trim() ? o.ship_method.trim() : undefined,
  };
}
/**
 * The trainings learn their order defaults from the orders staff mark right (Oct 31, Nick: "the order page is not
 * learning, really… for MEI… default shipping always FedEx Ground… always set to reorder… no production
 * confirmation"): for each training this job uses, its last three worked examples; a setting the last two or more all
 * agree on becomes its default (shipping only from jobs that didn't name a carrier themselves). A field staff set on the
 * training stays theirs.
 */
export async function learnDefaults(admin: SupabaseClient, customerId: string, jobText: string) {
  const all = await customerTrainings(admin, customerId);
  const ts = trainingsForText(all, jobText);
  if (!ts.length) return;
  const { data: ex } = await admin.from("order_examples").select("order_id, title, source_text").eq("customer_id", customerId).eq("active", true).order("confirmed_at", { ascending: false }).limit(40);
  for (const t of ts) {
    const mine = ((ex || []) as { order_id: string; title: string; source_text: string }[]).filter((e) => trainingsForText(all, `${e.title}`).some((x) => x.id === t.id)).slice(0, 3);
    if (mine.length < 2) continue;
    const { data: os } = await admin.from("orders").select("*").in("id", mine.map((e) => e.order_id));
    const byId = new Map(((os || []) as Order[]).map((o) => [o.id, o]));
    const d: TrainingDefaults = { ...(t.defaults || {}) }, learned = { ...(d.learned || {}) };
    let changed = false;
    for (const f of DEFAULT_FIELDS) {
      if ((d.set || []).includes(f)) continue;
      const use = mine.filter((e) => byId.has(e.order_id) && !((f === "delivery_method" || f === "ship_method") && SHIP_SAID.test(e.source_text || "")));
      if (use.length < 2) continue;
      const vals = use.map((e) => settingsOf(byId.get(e.order_id)!)[f]);
      if (vals.some((v) => v === undefined) || new Set(vals.map(String)).size !== 1) continue;
      if ((d as Record<string, unknown>)[f] === vals[0]) continue;
      (d as Record<string, unknown>)[f] = vals[0];
      learned[f] = use.map((e) => `#${(byId.get(e.order_id) as { number?: number }).number}`).join(", ");
      changed = true;
    }
    if (changed) await admin.from("order_trainings").update({ defaults: { ...d, learned } }).eq("id", t.id);
  }
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

/**
 * What a right order teaches its customer's brands (Oct 31, Nick on #40319: "you should have made a mock-up… made it just
 * like this in M-1144. And then those should be going in each time"):
 *  - each garment color's goods (BrandRules.goods): a print in the brand's light colorway on Dark Gray Heather makes Dark
 *    Gray Heather light goods for that brand's logos from now on, its dark colorway dark;
 *  - its logo mockups are the brand's standard mockups (BrandRules.mockups): a group whose prints are all one brand's logos
 *    with a saved logo mockup gives that mockup to the next group with the same logos, spots and colorway.
 */
/**
 * Every order of the customer's that staff said is right, oldest first, teaches its brands again (Oct 31, Nick after
 * eight MEI carts: "make it learn from those now"): orders marked right before a lesson existed are learned from too, and
 * the newest order wins where two disagree. Runs each time one of their orders is marked right.
 */
export async function learnBrandsFromAll(admin: SupabaseClient, customerId: string) {
  const { data: ex } = await admin.from("order_examples").select("order_id, source_text, confirmed_at").eq("customer_id", customerId).eq("active", true).order("confirmed_at", { ascending: true }).limit(60);
  const rows = (ex || []) as { order_id: string; source_text: string }[];
  if (!rows.length) return;
  const { data: os } = await admin.from("orders").select("*").in("id", rows.map((e) => e.order_id));
  const byId = new Map(((os || []) as Order[]).map((o) => [o.id, o]));
  for (const e of rows) { const o = byId.get(e.order_id); if (o) await learnBrandLooks(admin, { ...o, groups: orderGroups(o) }, e.source_text || ""); }
}

export async function learnBrandLooks(admin: SupabaseClient, order: Order, /** what the order was made from: a version it names outright ("All White") is the customer's pick, not what the garment color takes */ source = "") {
  const flat = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const said = flat(source);
  // the paperwork asked for the logo in full color: a one-color version on a garment color is that color's own
  const askedFull = /\bfull[\s-]*colou?r\b/i.test(source);
  const groups = orderGroups(order);
  const ids = [...new Set(groups.flatMap((g) => (g.imprints || []).map((im) => im.design_id)).filter(Boolean) as string[])];
  if (!ids.length) return;
  const { data: ds } = await admin.from("designs").select("id, specs, brand_id").in("id", ids);
  const des = new Map(((ds || []) as (Pick<Design, "id" | "specs"> & { brand_id?: string | null })[]).map((d) => [d.id, d]));
  const bIds = [...new Set([...des.values()].map((d) => d.brand_id).filter(Boolean) as string[])];
  if (!bIds.length) return;
  const { data: bs } = await admin.from("brands").select("id, rules").in("id", bIds);
  const rules = new Map(((bs || []) as { id: string; rules: BrandRules | null }[]).map((b) => [b.id, { ...(b.rules || {}) } as BrandRules]));
  const changed = new Set<string>();
  const cwKey = (s?: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const { data: mks } = await admin.from("mockups").select("number, title, group_id, created_at").eq("order_id", order.id).is("archived_at", null).order("created_at", { ascending: false });
  for (const g of groups) {
    const colors = [...new Set((g.lines || []).filter((l) => lineQty(l) > 0 && (l.color || "").trim()).map((l) => l.color.trim().toLowerCase()))];
    const bOfG = new Set<string>();
    for (const im of g.imprints || []) {
      const d = im.design_id ? des.get(im.design_id) : null, bid = d?.brand_id;
      if (!d || !bid) { bOfG.add(""); continue; }
      bOfG.add(bid);
      const r = rules.get(bid); if (!r) continue;
      for (const c of colors) {
        const cw0 = colorwayOnColor(im, d, c)?.name;
        // a version the paperwork asked for by name says nothing about the garment color's light or dark
        const cw = cw0 && flat(cw0).trim() && said.includes(flat(cw0)) ? undefined : cw0;
        // the brand's full-color pair says light or dark; any other version staff put on a color it wasn't asked for by name
        // is that color's own (Oct 31, #40328: All Black on the hi-vis Brite Lime when the cart said Full Color)
        // (only a logo that has the brand's light and dark versions: the MEI Icon's Full Color is just "Maroon", which says
        // nothing about the color it's on, Oct 31: it taught Blacktop "Maroon")
        const pair = [r.light, r.dark].every((x) => x && colorwaysOf(d).some((y) => cwKey(y.name) === cwKey(x)));
        const side = cw && cwKey(cw) === cwKey(r.light) ? "light" : cw && cwKey(cw) === cwKey(r.dark) ? "dark"
          : cw && askedFull && pair ? cw : cw && cwKey(cw) === cwKey(r.one_light) ? "light" : cw && cwKey(cw) === cwKey(r.one_dark) ? "dark" : null;
        if (side && r.goods?.[c] !== side) { r.goods = { ...(r.goods || {}), [c]: side }; changed.add(bid); }
      }
    }
    // the group's saved logo mockup, when all its prints are one brand's logos
    const only = bOfG.size === 1 ? [...bOfG][0] : "";
    const m = only ? ((mks || []) as { number: number; title: string; group_id: string | null }[]).find((x) => x.group_id === g.id && / — Logo /.test(x.title || "")) : null;
    if (only && m) { const r = rules.get(only)!; if (!(r.mockups || []).includes(m.number)) { r.mockups = [...(r.mockups || []), m.number]; changed.add(only); } }
  }
  for (const bid of changed) await admin.from("brands").update({ rules: rules.get(bid) }).eq("id", bid);
}
