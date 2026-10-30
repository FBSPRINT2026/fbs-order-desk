"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { cardSetsAnything, cardsOf, tiersOf, type DesignPrice, type Program, type RateCard } from "@/lib/programs";

/**
 * Program pricing on the order page (Oct 14, Nick): the customer's rate card (with the base shirt's blank cost now),
 * and what they paid before for the same design ("Furry Feline has a reorder of Mewjira: what was the pricing and qtys
 * on the other orders of that design?").
 */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const perms = await viewerPerms(v.supabase, v.email, v.role);
  if (!perms.money) throw new Error("Prices aren't on for you.");
  return { admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

/** the customer's program: the rate card (with the base shirt's S–XL blank cost from the catalog) and the designs'
 *  own prices (program items); null when they have neither */
export type ProgramCardOpt = { id: string; name: string; match: string[]; card: RateCard; baseCost: number | null };
export async function programCard(customerId: string) {
  try {
    const { admin } = await me();
    const { data: p } = await admin.from("programs").select("id, name, rate_card, rate_cards, apply_mode").eq("customer_id", customerId).order("created_at").limit(1).maybeSingle();
    if (!p) return { ok: true as const, card: null, baseCost: null, items: [] as DesignPrice[], cards: [] as ProgramCardOpt[], applyMode: "auto" as const };
    const { data: its } = await admin.from("program_items").select("id, name, style, price, min_qty, design_id, active, tiers, price_mode, supplied, match, imprints").eq("program_id", p.id).eq("active", true).is("archived_at", null).order("position");
    const items = ((its || []) as DesignPrice[]).filter((x) => tiersOf(x).length);
    // every card (Oct 17: Nine18 has one per location or brand), each with its base shirt's cost now
    const cards: ProgramCardOpt[] = [];
    for (const c of cardsOf(p as Program)) {
      if (!cardSetsAnything(c)) continue;
      const { data: g } = await admin.from("garments").select("cost, brand").ilike("style", (c.base?.style || "").trim() || "-").limit(5);
      const hit = ((g || []) as { cost: number; brand: string }[]).find((x) => !c.base?.brand || x.brand.toLowerCase() === c.base.brand.toLowerCase()) || (g || [])[0];
      cards.push({ id: c.id, name: c.name || (p.name as string) || "Program", match: c.match || [], card: c, baseCost: hit?.cost ? +hit.cost : c.base?.cost ?? null });
    }
    const first = cards[0] || null;
    return { ok: true as const, card: first?.card || null, baseCost: first?.baseCost ?? null, items, cards, applyMode: ((p.apply_mode as string) === "ask" ? "ask" : "auto") as "auto" | "ask" };
  } catch (e) { return fail(e); }
}

export type PastPrice = { number: string; date: string; nickname: string; source: "printavo" | "portal"; orderId: string;
  lines: { style: string; color: string; qty: number; price: number; deco: string }[]; fees: string[]; total: number; setup: boolean };

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/^(shirt|shirts|tees?|hoodies?|order|reorder|print|screen|front|back|with)$/.test(w));

/**
 * Past orders of the same design for this customer, newest first: Printavo history and orders here. Matched by the
 * design names on the order's prints and the order's name ("Mewjira"), so Printavo-era orders (no design links) count.
 */
export async function pastPricesForDesign(input: { customerId: string; orderId: string; terms: string[] }) {
  try {
    const { admin } = await me();
    const keys = [...new Set(input.terms.flatMap(words))].slice(0, 4);
    if (!keys.length) return { ok: true as const, rows: [] as PastPrice[], keys };
    const like = keys.map((k) => `nickname.ilike.%${k}%`).join(",");
    const [{ data: arch }, { data: ours }] = await Promise.all([
      admin.from("archived_orders").select("id, visual_id, order_date, nickname, total, data").eq("customer_id", input.customerId).neq("kind", "quote").or(keys.map((k) => `search_text.ilike.%${k}%`).join(",")).order("order_date", { ascending: false }).limit(12),
      admin.from("orders").select("id, number, created_at, nickname, total, groups, waive_setup, type").eq("customer_id", input.customerId).eq("type", "invoice").neq("id", input.orderId).or(like).order("created_at", { ascending: false }).limit(8),
    ]);
    const rows: PastPrice[] = [];
    type PvLine = { itemNumber?: string; color?: string; items?: number; price?: number; description?: string };
    type PvData = { groups?: { lines?: PvLine[] }[]; fees?: { description?: string; quantity?: number; unitPrice?: number; amount?: number }[] };
    for (const a of (arch || []) as { id: string; visual_id: string; order_date: string; nickname: string; total: number; data: PvData }[]) {
      const lines = (a.data?.groups || []).flatMap((g) => g.lines || []).filter((l) => +(l.items || 0) > 0)
        .map((l) => ({ style: l.itemNumber || "", color: l.color || "", qty: +(l.items || 0), price: +(l.price || 0), deco: (l.description || "").split(/\r?\n/).slice(1).join(" · ").trim() }));
      const fees = (a.data?.fees || []).map((f) => `${f.description || "Fee"}: ${f.quantity && f.unitPrice ? `${f.quantity} × $${(+f.unitPrice).toFixed(2)}` : `$${(+(f.amount || 0)).toFixed(2)}`}`);
      rows.push({ number: a.visual_id, date: a.order_date, nickname: a.nickname || "", source: "printavo", orderId: a.id, lines, fees, total: +a.total || 0, setup: fees.some((f) => /setup|screen/i.test(f)) });
    }
    type OLine = { style?: string; color?: string; sizes?: Record<string, number>; priceOverride?: number | null; prog?: { each: number } };
    for (const o of (ours || []) as { id: string; number: number; created_at: string; nickname: string; total: number; groups: { lines?: OLine[]; imprints?: { location?: string; colors?: number }[] }[]; waive_setup: boolean }[]) {
      const lines = (o.groups || []).flatMap((g) => (g.lines || []).map((l) => ({ l, deco: (g.imprints || []).map((d) => `${d.colors || 1}c ${d.location || ""}`).join(" + ") })))
        .map(({ l, deco }) => ({ style: l.style || "", color: l.color || "", qty: Object.values(l.sizes || {}).reduce((s, n) => s + (+n || 0), 0), price: +(l.priceOverride ?? 0), deco }))
        .filter((l) => l.qty > 0);
      rows.push({ number: String(o.number), date: o.created_at.slice(0, 10), nickname: o.nickname || "", source: "portal", orderId: o.id, lines, fees: [], total: +o.total || 0, setup: !o.waive_setup });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true as const, rows: rows.slice(0, 10), keys };
  } catch (e) { return fail(e); }
}

/* ───────── the Program tab's AI box (Oct 14, Nick: "an AI chat box where the account managers can explain the special
   pricing they get, then you set it for their account" — e.g. Tiger Blue: always $15 a screen, they supply print-ready
   separations). The AI proposes; nothing changes until someone presses Apply. ───────── */
export type ProgramProposal = {
  summary: string;
  card?: { base_brand?: string; base_style?: string; garment_included?: boolean; markup?: number; min_qty?: number; waive_setup?: boolean; no_setup_any_job?: boolean;
    screen_fee?: number | null; size_up?: Partial<Record<"2XL" | "3XL" | "4XL" | "5XL", number>>; prices?: { front: number; back: number; price: number }[] };
  design_prices?: { name: string; price: number; min_qty?: number; style?: string; front_colors?: number; back_colors?: number; notes?: string }[];
  not_supported?: string[];
  questions?: string[];
};

const PROPOSAL_TOOL = {
  name: "set_program",
  description: "The program pricing settings to propose for this customer, from what the account manager said.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One to three plain sentences: what will be set, in the shop's words (e.g. 'Screens at $15 each on every job, because they supply print-ready separations.')." },
      card: {
        type: "object", description: "Only the rate card fields the account manager's words set or change. Leave out anything not mentioned.",
        properties: {
          base_brand: { type: "string" }, base_style: { type: "string", description: "the base shirt the per-piece prices are for, e.g. 6210" },
          garment_included: { type: "boolean", description: "true: prices include the shirt; false: print only (they supply shirts)" },
          markup: { type: "number", description: "multiplier on the blank-cost difference for other shirts, e.g. 1.2" },
          min_qty: { type: "integer", description: "minimum pieces per job for program per-piece prices" },
          waive_setup: { type: "boolean", description: "no setup charge on jobs priced by the grid" },
          no_setup_any_job: { type: "boolean", description: "no setup (screens, digitizing…) on ANY job for this customer, e.g. they supply everything and pay a flat price per piece" },
          screen_fee: { type: ["number", "null"], description: "price per screen on every job (null removes the rule)" },
          size_up: { type: "object", properties: { "2XL": { type: "number" }, "3XL": { type: "number" }, "4XL": { type: "number" }, "5XL": { type: "number" } } },
          prices: { type: "array", description: "per-piece price by front colors / back colors (back 0 = no back print)", items: { type: "object", properties: { front: { type: "integer" }, back: { type: "integer" }, price: { type: "number" } }, required: ["front", "back", "price"] } },
        },
      },
      design_prices: { type: "array", description: "a specific design's own flat price per piece at a minimum quantity (everything in). Tiers are one entry per break, e.g. Mewjira 100 at $6.25, 150 at $6.00, 200 at $5.50", items: { type: "object", properties: {
        name: { type: "string" }, price: { type: "number" }, min_qty: { type: "integer" }, style: { type: "string" }, front_colors: { type: "integer" }, back_colors: { type: "integer" }, notes: { type: "string" } }, required: ["name", "price"] } },
      not_supported: { type: "array", items: { type: "string" }, description: "parts of the deal these settings can't hold yet (they'll be kept as a note for whoever prices the order)" },
      questions: { type: "array", items: { type: "string" }, description: "what's unclear and needed to set it exactly (only if truly needed)" },
    },
    required: ["summary"],
  },
};

/** their last 18 months on Printavo, boiled down: per-piece prices by style and print, and the fees charged */
async function historyBrief(admin: ReturnType<typeof createAdminClient>, customerId: string) {
  const since = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10);
  const { data } = await admin.from("archived_orders").select("visual_id, order_date, nickname, data").eq("customer_id", customerId).eq("kind", "invoice").gte("order_date", since).order("order_date", { ascending: false }).limit(80);
  type PvLine = { itemNumber?: string; items?: number; price?: number; description?: string };
  type PvData = { groups?: { lines?: PvLine[] }[]; fees?: { description?: string; unitPrice?: number }[] };
  const lines = new Map<string, { n: number; min: number; max: number; qmin: number; qmax: number }>(), fees = new Map<string, number>();
  for (const o of (data || []) as { data: PvData }[]) {
    for (const l of (o.data?.groups || []).flatMap((g) => g.lines || [])) {
      if (!(+(l.items || 0) > 0)) continue;
      const deco = (l.description || "").split(/\r?\n/).slice(1).join(" ").trim().slice(0, 60);
      const k = `${(l.itemNumber || "?").trim()} | ${deco || "?"}`, p = +(l.price || 0), q = +(l.items || 0);
      const x = lines.get(k) || { n: 0, min: p, max: p, qmin: q, qmax: q };
      x.n++; x.min = Math.min(x.min, p); x.max = Math.max(x.max, p); x.qmin = Math.min(x.qmin, q); x.qmax = Math.max(x.qmax, q); lines.set(k, x);
    }
    for (const f of o.data?.fees || []) { const k = `${(f.description || "Fee").trim()} @ $${(+(f.unitPrice || 0)).toFixed(2)}`; fees.set(k, (fees.get(k) || 0) + 1); }
  }
  const top = [...lines.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([k, x]) => `- ${k}: ${x.n} orders, $${x.min.toFixed(2)}–$${x.max.toFixed(2)} each, ${x.qmin}–${x.qmax} pcs`);
  const fz = [...fees.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `- ${k}: ${n} orders`);
  return `${(data || []).length} invoices in the last 18 months.\nLines (style | print: orders, price range, qty range):\n${top.join("\n") || "- none"}\nFees:\n${fz.join("\n") || "- none"}`;
}

export async function programAssist(input: { customerId: string; text: string }) {
  try {
    const { admin } = await me();
    const v = await getViewer(", name");
    const text = input.text.trim().slice(0, 3000);
    if (!text) return { ok: false as const, error: "Say what their deal is first." };
    const { aiState, askClaude } = await import("@/lib/ai/claude");
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, error: st.reason || "AI isn't set up." };
    const [{ data: c }, { data: p }] = await Promise.all([
      admin.from("customers").select("company, name, price_type").eq("id", input.customerId).maybeSingle(),
      admin.from("programs").select("id, rate_card").eq("customer_id", input.customerId).order("created_at").limit(1).maybeSingle(),
    ]);
    if (!c) return { ok: false as const, error: "Customer not found." };
    const { data: its } = p ? await admin.from("program_items").select("name, price, min_qty, tiers, style, notes, active").eq("program_id", p.id).is("archived_at", null) : { data: [] };
    const s = st.settings;
    const system = [
      "You set up program (special) pricing for a customer of FBS Print, a screen printing and embroidery shop in Richardson, Texas.",
      "An account manager describes the customer's deal in their own words. Turn it into the settings below, exactly as said. Never invent a number they didn't give.",
      "If they say to use the customer's history, read the history given and say in the summary which numbers came from it.",
      "What the settings can hold:",
      "- Rules on every job while the order is set to Program: screen_fee (price per screen, replaces the normal screen charge), no_setup_any_job.",
      "- A rate card: per-piece prices by front colors / back colors on a base shirt (garment_included true) or print only (false, they supply shirts); markup on the blank-cost difference for other shirts; a minimum qty; 2XL+ per-piece charges.",
      "- Design prices: a design's own flat price per piece (garment, screens and setup all in), tiered by minimum qty (one entry per break).",
      "Anything else (PMS, ink changes, discounts on embroidery, rush, shipping…) goes in not_supported, in plain words.",
      `The shop's normal setup: retail charges $${(+s.screenFee || 0).toFixed(2)} a screen; wholesale (contract) $${(+(s.wholesale?.screenFee || 0)).toFixed(2)} a screen, remakes $${(+(s.wholesale?.remakeFee || 0)).toFixed(2)}.`,
      "Write the summary in plain, short sentences a shop owner would use.",
    ].join("\n");
    const prompt = [
      `Customer: ${c.company || c.name} (normally priced as ${c.price_type || "retail"}).`,
      `Their program now: ${p?.rate_card ? JSON.stringify(p.rate_card) : "none"}.`,
      `Design prices now: ${(its || []).length ? JSON.stringify(its) : "none"}.`,
      `\nTheir pricing history:\n${await historyBrief(admin, input.customerId)}`,
      `\nWhat the account manager (${v.email}) says:\n"""${text}"""`,
    ].join("\n");
    const r = await askClaude<ProgramProposal>({ task: "program_assist", model: s.assistant.ai.model, system, prompt, tool: PROPOSAL_TOOL, maxTokens: 2000, timeoutMs: 55_000, admin, ctx: { customer_id: input.customerId, by: v.email } });
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const, proposal: r.data };
  } catch (e) { return fail(e); }
}

/** Apply: the proposal goes on their program (made if they don't have one; their portal order form stays off) */
export async function applyProgramProposal(input: { customerId: string; proposal: ProgramProposal; text: string }) {
  try {
    const { admin } = await me();
    const v = await getViewer(", name");
    const { newRateCard } = await import("@/lib/programs");
    let { data: p } = await admin.from("programs").select("id, rate_card").eq("customer_id", input.customerId).order("created_at").limit(1).maybeSingle();
    if (!p) {
      const ins = await admin.from("programs").insert({ customer_id: input.customerId, name: "Program", notes: "", active: false, rate_card: null }).select("id, rate_card").single();
      if (ins.error) return { ok: false as const, error: ins.error.message };
      p = ins.data;
    }
    const pc = input.proposal.card || {};
    const had = (p!.rate_card || null) as RateCard | null;
    const card: RateCard = had ? { ...had, prices: { ...(had.prices || {}) }, sizeUp: { ...(had.sizeUp || {}) } } : { ...newRateCard(), waiveSetup: false };
    if (pc.base_brand != null) card.base = { ...card.base, brand: pc.base_brand };
    if (pc.base_style != null) card.base = { ...card.base, style: pc.base_style };
    if (pc.garment_included != null) card.garmentIncluded = pc.garment_included;
    if (pc.markup != null && pc.markup > 0) card.markup = pc.markup;
    if (pc.min_qty != null) card.minQty = Math.max(0, Math.round(pc.min_qty));
    if (pc.waive_setup != null) card.waiveSetup = pc.waive_setup;
    if (pc.no_setup_any_job != null) card.noSetupEver = pc.no_setup_any_job;
    if (pc.screen_fee !== undefined) { if (pc.screen_fee == null) delete card.screenFee; else { card.screenFee = Math.round(pc.screen_fee * 100) / 100; card.waiveSetup = false; } }
    for (const [z, n] of Object.entries(pc.size_up || {})) if (n != null) card.sizeUp[z as "2XL"] = Math.round(+n * 100) / 100;
    for (const x of pc.prices || []) if (x.front >= 0 && x.back >= 0 && x.front + x.back > 0 && x.price > 0) card.prices[`${Math.round(x.front)}/${Math.round(x.back)}`] = Math.round(x.price * 100) / 100;
    if ((pc.prices || []).length) card.gridOn = true;
    if (input.proposal.not_supported?.length) card.extras = [...new Set([...(card.extras || []), ...input.proposal.not_supported.map((x) => x.trim().slice(0, 200)).filter(Boolean)])].slice(0, 12);
    card.about = [{ text: input.text.trim().slice(0, 2000), by: v.email, at: new Date().toISOString() }, ...(card.about || [])].slice(0, 20);
    const up = await admin.from("programs").update({ rate_card: card }).eq("id", p!.id);
    if (up.error) return { ok: false as const, error: up.error.message };
    // design prices: one entry per design, its breaks as tiers (merged into the design's entry when it has one)
    const { data: have } = await admin.from("program_items").select("id, name, price, min_qty, tiers, position").eq("program_id", p!.id).is("archived_at", null);
    const byName = new Map<string, NonNullable<ProgramProposal["design_prices"]>>();
    for (const d of input.proposal.design_prices || []) {
      if (!d.name?.trim() || !(d.price > 0)) continue;
      const k = d.name.trim().toLowerCase();
      byName.set(k, [...(byName.get(k) || []), d]);
    }
    let pos = (have || []).length;
    for (const [k, ds] of byName) {
      const old = (have || []).find((x) => String(x.name).trim().toLowerCase() === k) as { id: string; price: number; min_qty: number; tiers: { min: number; price: number }[] | null } | undefined;
      const tiers = new Map<number, number>(old ? tiersOf(old).map((t) => [t.min, t.price]) : []);
      for (const d of ds) tiers.set(Math.max(0, Math.round(d.min_qty || 0)), Math.round(d.price * 100) / 100);
      const list = [...tiers.entries()].map(([min, price]) => ({ min, price })).sort((a, b) => a.min - b.min);
      const first = list[0], d0 = ds[0];
      const mode = list.length === 1 && !list[0].min ? "flat" : "breaks";
      if (old) { await admin.from("program_items").update({ tiers: list, price: first.price, min_qty: first.min, price_mode: mode, active: true }).eq("id", old.id); continue; }
      const imps = [{ location: "Full Front", method: "screen", colors: Math.max(1, d0.front_colors || 1), inks: "", size: "", notes: "" }, ...(d0.back_colors ? [{ location: "Full Back", method: "screen", colors: d0.back_colors, inks: "", size: "", notes: "" }] : [])];
      await admin.from("program_items").insert({ program_id: p!.id, name: d0.name.trim().slice(0, 120), style: (d0.style || "").slice(0, 40), brand: "", garment: "", colors: [], sizes: ["S", "M", "L", "XL", "2XL"],
        price: first.price, min_qty: first.min, tiers: list, price_mode: mode, supplied: !card.garmentIncluded, imprints: imps, design_id: null, image_path: "", notes: ds.map((x) => x.notes || "").filter(Boolean).join(" ").slice(0, 300), active: true, position: pos++ });
    }
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** a recommended price kept as one of the design's price breaks (from the order page's recommendation card) */
export async function addPriceBreak(input: { itemId: string; min: number; price: number }) {
  try {
    const { admin } = await me();
    const min = Math.max(0, Math.round(input.min)), price = Math.round(input.price * 100) / 100;
    if (!(price > 0)) return { ok: false as const, error: "Price first." };
    const { data: it } = await admin.from("program_items").select("id, price, min_qty, tiers, price_mode").eq("id", input.itemId).is("archived_at", null).maybeSingle();
    if (!it) return { ok: false as const, error: "That design price isn't on their program any more." };
    const t = new Map(tiersOf(it as never).map((x) => [x.min, x.price]));
    t.set(min, price);
    const list = [...t.entries()].map(([m, p]) => ({ min: m, price: p })).sort((a, b) => a.min - b.min);
    const { error } = await admin.from("program_items").update({ tiers: list, price_mode: "breaks", price: list[0].price, min_qty: list[0].min }).eq("id", input.itemId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/**
 * The rate card's numbers (Oct 30, Nick: "think up a new rate card design for this client"): for each end client (the
 * design prices' `match.who`), the jobs, pieces and dollars in the last 6 months, and for each style the design prices
 * name, how many jobs had it. From the customer's jobs (Printavo history and our own orders), by the words in them.
 */
export type CardStats = { since: string; who: Record<string, { jobs: number; pcs: number; total: number }>; styles: Record<string, Record<string, number>> };
export async function programCardStats(customerId: string): Promise<{ ok: true; stats: CardStats } | { ok: false; error: string }> {
  try {
    const { admin } = await me();
    const since = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
    const { data: p } = await admin.from("programs").select("id").eq("customer_id", customerId).order("created_at").limit(1).maybeSingle();
    if (!p) return { ok: true, stats: { since, who: {}, styles: {} } };
    const { data: its } = await admin.from("program_items").select("match").eq("program_id", p.id).eq("active", true).is("archived_at", null);
    const [{ data: ar }, { data: os }] = await Promise.all([
      admin.from("archived_orders").select("nickname, qty, total, search_text").eq("customer_id", customerId).gte("order_date", since).limit(5000),
      admin.from("orders").select("nickname, qty, total, groups, po_number").eq("customer_id", customerId).gte("created_at", since).neq("status", "request").limit(2000),
    ]);
    const jobs = [
      ...((ar || []) as { nickname: string; qty: number; total: number; search_text: string }[]).map((j) => ({ name: j.nickname || "", qty: +j.qty || 0, total: +j.total || 0, text: ` ${(j.search_text || "").toLowerCase()} ` })),
      ...((os || []) as { nickname: string; qty: number; total: number; groups: { lines?: { style?: string }[] }[] | null; po_number: string }[]).map((o) => ({ name: `${o.nickname || ""} ${o.po_number || ""}`, qty: +o.qty || 0, total: +o.total || 0, text: ` ${`${o.nickname || ""} ${(o.groups || []).flatMap((g) => (g.lines || []).map((l) => l.style || "")).join(" ")}`.toLowerCase()} ` })),
    ];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const has = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${norm(word).replace(/ /g, "[^a-z0-9]+")}([^a-z0-9]|$)`, "i").test(text);
    const whoSets = [...new Set(((its || []) as { match: { who?: string[] } | null }[]).map((x) => (x.match?.who || []).join("|")).filter(Boolean))];
    const stats: CardStats = { since, who: {}, styles: {} };
    for (const ws of whoSets) {
      const words = ws.split("|");
      const mine = jobs.filter((j) => words.some((w) => has(norm(j.name), w)));
      stats.who[ws] = { jobs: mine.length, pcs: mine.reduce((a, j) => a + j.qty, 0), total: Math.round(mine.reduce((a, j) => a + j.total, 0)) };
      const styles = new Set(((its || []) as { match: { who?: string[]; what?: string[] } | null }[]).filter((x) => (x.match?.who || []).join("|") === ws).flatMap((x) => (x.match?.what || []).filter((w) => /\d/.test(w))));
      stats.styles[ws] = Object.fromEntries([...styles].map((s) => [s, mine.filter((j) => has(j.text, s)).length]));
    }
    return { ok: true, stats };
  } catch (e) { return fail(e); }
}
