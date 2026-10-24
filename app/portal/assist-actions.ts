"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";
import { ST, type Order } from "@/lib/pricing";
import { portalSend } from "@/app/portal/message-actions";
import { GOODS, trackingUrl, type GoodsStatus } from "@/lib/goods";

/** What the helper can offer to do. Nothing happens until the customer presses the button. */
export type AssistAction = {
  kind: "open_order" | "track" | "pay" | "reorder" | "new_order" | "new_order_from_text" | "open_mockup" | "message_shop" | "open_goods" | "open_payments" | "open_statement" | "open_orders" | "open_artwork";
  label: string;
  /** resolved by the server from the customer's own orders */
  orderId?: string; href?: string; archived?: boolean; number?: number;
  /** pay: what to select ("all of August"); message/new order: the text */
  text?: string;
};
export type AssistTurn = { role: "user" | "assistant"; text: string };

const TOOL = {
  name: "respond",
  description: "Answer the customer and offer the next steps as buttons.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "A short, friendly answer (1-3 sentences). Never use the customer's personal name. Use only facts from the account data." },
      actions: {
        type: "array", maxItems: 4,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["open_order", "track", "pay", "reorder", "new_order", "new_order_from_text", "open_mockup", "message_shop", "open_goods", "open_payments", "open_statement", "open_orders", "open_artwork"] },
            label: { type: "string", description: "Button text, e.g. 'Reorder #1005 Summer Camp Tees' or 'Pay all of August ($812.40)'." },
            number: { type: "integer", description: "The order number this is about (for open_order, track, reorder)." },
            text: { type: "string", description: "pay: the selection in plain words ('all orders in August', 'everything under $100'). message_shop: the message to send the shop. new_order_from_text: what they want made." },
          },
          required: ["kind", "label"],
        },
      },
    },
    required: ["reply"],
  },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The customer's helper on their dashboard: "Where's my order?", "Pay my bill", "Reorder the AMS helper tees from November".
 * Claude sees a summary of this customer's own account (orders, balances, goods) and answers, offering buttons;
 * anything that changes something (reorders, new orders, messages, payments) only happens when the customer presses it.
 */
export async function portalAssist(history: AssistTurn[]): Promise<{ ok: boolean; error?: string; reply?: string; actions?: AssistAction[] }> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user) return { ok: false, error: "Please sign in again." };
    if (isStaff) return { ok: false, error: "The helper works from the customer's own login." };
    const turns = history.filter((t) => t.text.trim()).slice(-10).map((t) => ({ ...t, text: t.text.slice(0, 800) }));
    const last = turns[turns.length - 1]?.text || "";
    if (!last) return { ok: false, error: "Type what you need." };
    const admin = createAdminClient();

    // this customer's own account (row security limits what comes back)
    const { data: cs } = await supabase.from("customers").select("id, company, price_type, payment_terms");
    const ids = (cs || []).map((c) => c.id);
    if (!ids.length) return { ok: false, error: "We couldn't find your account." };
    const { data: os } = await supabase.from("orders").select("id, number, nickname, status, type, total, due_date, created_at, qty, po_number, price_type, submitted_at, delivery_method, ship_method, tracking, groups, approved_at").neq("status", "quote").order("created_at", { ascending: false }).limit(150);
    const orders = ((os || []) as (Order & { submitted_at: string | null })[]).filter((o) => !(o.status === "request" && !o.submitted_at));
    const oids = orders.map((o) => o.id);
    const [{ data: pays }, { data: arch }, { data: goods }] = await Promise.all([
      oids.length ? admin.from("payments").select("order_id, amount").in("order_id", oids) : Promise.resolve({ data: [] }),
      admin.from("archived_orders").select("id, visual_id, nickname, status_name, order_date, total, qty").in("customer_id", ids).order("order_date", { ascending: false }).limit(150),
      oids.length ? admin.from("order_goods").select("order_id, status, issue_type").in("order_id", oids) : Promise.resolve({ data: [] }),
    ]);
    const paid: Record<string, number> = {};
    (pays || []).forEach((p) => { paid[p.order_id] = (paid[p.order_id] || 0) + (+p.amount || 0); });
    const gmap = new Map(((goods || []) as { order_id: string; status: GoodsStatus; issue_type: string }[]).map((g) => [g.order_id, g]));
    const wholesale = (cs || []).some((c) => c.price_type === "wholesale");
    // the full story of the orders that matter (Oct 24, Nick: asked about #40149 "it came back and said, it's a quote. We're
    // waiting for your goods… but we haven't even confirmed it yet"; "was the artwork okay?… it didn't even see the
    // artwork that we made in the mock-up creator"): where each one really is, its art (mockups, proofs, separations), the
    // goods coming in and checked in, and what shipped. The helper isn't trained: it only knows what's written here.
    const asked = new Set((turns.map((t) => t.text).join(" ").match(/\b\d{4,6}\b/g) || []).map(Number));
    const deep = orders.filter((o) => asked.has(o.number) || o.status !== "completed").slice(0, 30);
    const dids = deep.map((o) => o.id);
    const none = Promise.resolve({ data: [] as unknown[] });
    const [{ data: prf }, { data: seps }, { data: shp }, { data: gin }, { data: gck }] = await Promise.all([
      dids.length ? admin.from("proofs").select("order_id, title, status, version, sent_at, decided_at, customer_change, archived_at").in("order_id", dids).is("archived_at", null).order("created_at", { ascending: false }) : none,
      dids.length ? admin.from("separations").select("order_id, location, status").in("order_id", dids) : none,
      dids.length ? admin.from("shipments").select("order_id, status, carrier, service, boxes, shipped_at, created_at").in("order_id", dids).order("created_at", { ascending: false }) : none,
      dids.length ? admin.from("goods_shipments").select("order_id, carrier, tracking, boxes, est_delivery, delivered_at, track_status").in("order_id", dids) : none,
      dids.length ? admin.from("goods_checkins").select("order_id, expected, received, boxes, status, note, created_at, resolution").in("order_id", dids).order("created_at", { ascending: false }) : none,
    ]);
    type Row = Record<string, unknown> & { order_id: string };
    const by = (rows: unknown, id: string) => ((rows || []) as Row[]).filter((r) => r.order_id === id);
    const stage = (o: Order & { submitted_at: string | null }) =>
      o.status === "request" ? "sent to us; NOT confirmed by the shop yet (we're checking it; nothing is ordered, printed or waiting on goods until we confirm)"
      : o.status === "quote_sent" ? "quote sent; waiting on the customer's approval"
      : `${ST[o.status as keyof typeof ST]?.portal || o.status}${o.approved_at ? ` (confirmed ${String(o.approved_at).slice(0, 10)})` : ""}`;
    const story = (o: Order & { submitted_at: string | null; groups?: unknown; approved_at?: string | null }) => {
      const out: string[] = [`#${o.number} ${o.nickname || "(no name)"}: ${stage(o)}`];
      const gs = Array.isArray(o.groups) ? (o.groups as { name?: string; fromMockup?: { number: number | null }; customerMockups?: unknown[]; mockupThumbs?: unknown[]; mockupAt?: string; imprints?: { location?: string; design_id?: string; inks?: string }[]; lines?: { style?: string; color?: string; sizes?: Record<string, number> }[] }[]) : [];
      for (const g of gs) {
        const art = g.fromMockup ? `art: made by the customer in our Mockup Creator (mockup M-${g.fromMockup.number ?? "?"})` : (g.customerMockups || []).length ? "art: the customer's own mockup file was attached" : g.mockupAt || (g.mockupThumbs || []).length ? "art: we made the mockup" : "art: no mockup yet";
        const prints = (g.imprints || []).filter((d) => d.location).map((d) => `${d.location}${d.design_id ? "" : " (no logo picked)"}${d.inks ? ` in ${d.inks}` : ""}`).join("; ");
        const garments = (g.lines || []).filter((l) => l.style).map((l) => `${l.style} ${l.color || ""}`.trim()).join(", ");
        out.push(`  group ${g.name || ""}: ${garments || "garments not set"} | ${art}${prints ? ` | prints: ${prints}` : ""}`);
      }
      const pr = by(prf, o.id)[0];
      out.push(pr ? `  proof: ${String(pr.title || "proof")} v${pr.version ?? 1} is ${pr.status}${pr.decided_at ? ` (${String(pr.decided_at).slice(0, 10)})` : pr.sent_at ? ` (sent ${String(pr.sent_at).slice(0, 10)})` : ""}` : "  proof: none sent yet");
      const sp = by(seps, o.id);
      out.push(sp.length ? `  separations (print films): ${sp.map((x) => `${x.location}: ${x.status}`).join("; ")}` : "  separations (print films): not started yet");
      if (wholesale) {
        const g = gmap.get(o.id), inbound = by(gin, o.id), chk = by(gck, o.id);
        const parts: string[] = [];
        if (o.status === "request") parts.push("not needed until we confirm the order");
        else if (g) parts.push(GOODS[g.status]?.portal || g.status);
        inbound.forEach((x) => parts.push(`coming by ${x.carrier || "carrier"}${x.tracking ? ` ${x.tracking}` : ""}${x.boxes ? `, ${x.boxes} boxes` : ""}${x.delivered_at ? `, delivered ${String(x.delivered_at).slice(0, 10)}` : x.est_delivery ? `, due ${String(x.est_delivery).slice(0, 10)}` : ""}`));
        chk.slice(0, 2).forEach((x) => parts.push(`checked in ${String(x.created_at).slice(0, 10)}: ${x.boxes ?? "?"} boxes, ${x.received ?? "?"} of ${x.expected ?? "?"} pieces, ${x.status}${x.note ? ` (${x.note})` : ""}`));
        out.push(`  their goods: ${parts.join("; ") || "nothing on file"}`);
      }
      const sh = by(shp, o.id);
      if (o.delivery_method === "ship") out.push(`  shipping: ${sh.length ? sh.map((x) => `${x.carrier || ""} ${x.service || ""} ${x.status}${x.shipped_at ? ` ${String(x.shipped_at).slice(0, 10)}` : ""}`.replace(/\s+/g, " ").trim()).join("; ") : "not shipped yet"}${o.tracking ? ` | tracking ${o.ship_method || ""} ${o.tracking}` : ""}`);
      else out.push(`  ${o.delivery_method === "deliver" ? "we deliver it" : "pickup at the shop"}`);
      return out.join("\n");
    };
    const stories = deep.map(story);
    const lines = orders.map((o) => {
      const bal = o.type === "invoice" ? r2((+o.total || 0) - (paid[o.id] || 0)) : 0;
      const g = gmap.get(o.id);
      return `#${o.number} | ${(o.created_at || "").slice(0, 10)} | ${o.nickname || "(no name)"} | ${o.status === "request" ? "sent to us, not confirmed yet" : `${o.type === "quote" ? "quote: " : ""}${ST[o.status as keyof typeof ST]?.portal || o.status}`} | total $${(+o.total || 0).toFixed(2)}${bal > 0.004 ? ` | owes $${bal.toFixed(2)}` : ""}${o.due_date ? ` | in-hands ${o.due_date}` : ""}${o.qty ? ` | ${o.qty} pcs` : ""}${o.po_number ? ` | PO ${o.po_number}` : ""}${o.delivery_method === "ship" ? ` | shipping${o.ship_method ? ` ${o.ship_method}` : ""}${o.tracking ? ` tracking ${o.tracking}` : " (no tracking yet)"}` : o.delivery_method === "deliver" ? " | we deliver" : " | pickup"}${wholesale && g && o.status !== "request" ? ` | goods: ${GOODS[g.status]?.portal}${g.issue_type ? ` (${g.issue_type})` : ""}` : ""}`;
    });
    const old = ((arch || []) as { id: string; visual_id: string; nickname: string; status_name: string; order_date: string | null; total: number; qty: number }[])
      .map((a) => `#${a.visual_id} | ${a.order_date || ""} | ${a.nickname || "(no name)"} | past order (${a.status_name}) | total $${(+a.total || 0).toFixed(2)}${a.qty ? ` | ${a.qty} pcs` : ""}`);
    const due = orders.filter((o) => o.type === "invoice").reduce((a, o) => a + Math.max(0, (+o.total || 0) - (paid[o.id] || 0)), 0);

    const byNumber = new Map<number, AssistAction>();
    orders.forEach((o) => byNumber.set(o.number, { kind: "open_order", label: "", orderId: o.id, href: `/portal/orders/${o.id}`, number: o.number }));
    const trackOf = new Map(orders.filter((o) => o.tracking?.trim()).map((o) => [o.number, trackingUrl(o.ship_method || "", o.tracking.trim())]));
    (arch || []).forEach((a) => { const n = +a.visual_id; if (n && !byNumber.has(n)) byNumber.set(n, { kind: "open_order", label: "", orderId: a.id, href: `/portal/archive/${a.id}`, archived: true, number: n }); });

    const ai = await aiState(admin);
    let reply = "", raw: { kind: AssistAction["kind"]; label: string; number?: number; text?: string }[] = [];
    if (ai.ready) {
      const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
      const r = await askClaude<{ reply: string; actions?: typeof raw }>({
        task: "portal_assist", model: ai.settings.assistant.ai.fastModel || ai.settings.assistant.ai.model, maxTokens: 900, admin, tool: TOOL, ctx: { customer_id: ids[0], by: user.email || "customer" },
        system: `You are the helper in ${ai.settings.shop.name}'s customer portal (custom printed apparel: screen printing, embroidery, DTF). Today is ${today}.
Help this customer with their account: order status, paying, reordering, starting a new order, mockups, artwork, messages to the shop${wholesale ? ", and the garments (goods) they send us" : ""}.
Rules:
- Never use the customer's personal name.
- Only state facts found in the account data below. If something isn't there, say so and offer to message the shop.
- Keep replies short and plain. No markdown.
- Offer next steps as actions (buttons). Anything that changes something (reorder, new order, sending a message, paying) must be an action the customer presses, never done by you.
- Reorders: find the order they mean by name, date or number (past orders count too) and offer "reorder" with its number. If several match, list the best 2-3 as separate reorder buttons.
- Paying: offer "pay" with text describing the selection ("all orders in August", "everything", "#1002 and #1004", "everything under $100"). Include the amount in the label when you can work it out.
- New orders described in words ("48 navy tees with our logo on the front"): offer "new_order_from_text" with their description as text. Otherwise "new_order".
- Questions for a person, changes to an order in progress, rush requests, complaints: offer "message_shop" with a clear message written for them as text.
- Use open_order for status questions about one order.
- Order details below are the truth. An order "sent to us; NOT confirmed" is not a quote and isn't waiting on goods: say we got it and are checking it, and they'll get a message when we confirm.
- Art questions: say how the art came in (their mockup from our Mockup Creator with its M-number, their own file, or ours), whether a proof was sent or approved, and whether separations have started. If nothing's wrong on file, say so plainly and that we'll reach out if anything comes up.
- Goods questions: say what's coming, what's been checked in (boxes, pieces), and anything short or wrong. Shipping: carrier, date and tracking from the details.
- Tracking: if the order ships and has a tracking number, give the carrier and number and offer "track" with that order number. If it's a pickup order, say it's for pickup (and whether it's ready). If it ships but has no tracking yet, say it hasn't shipped yet and when it's due. If they didn't say which order, use their most recent shipped or shipping orders.`,
        prompt: `ACCOUNT\nCompany: ${(cs || [])[0]?.company || ""}\nBalance due: $${due.toFixed(2)}\n\nORDERS (newest first; number | date | name | status | money | details)\n${lines.join("\n") || "(none)"}\n\nORDER DETAILS (open and asked-about orders)\n${stories.join("\n") || "(none)"}\n\nPAST ORDERS FROM BEFORE THE PORTAL\n${old.join("\n") || "(none)"}\n\nCONVERSATION\n${turns.map((t) => `${t.role === "user" ? "Customer" : "Helper"}: ${t.text}`).join("\n")}`,
      });
      if (!r.ok) return { ok: false, error: r.off ? "The helper is resting right now. Use the buttons below or message us." : r.error };
      reply = r.data.reply; raw = r.data.actions || [];
    } else {
      // no AI: a simple guess from keywords, same buttons
      const t = last.toLowerCase();
      if (/\bpay|bill|balance|owe|invoice/.test(t)) { reply = due > 0.004 ? `Your balance is $${due.toFixed(2)}.` : "You're all paid up."; raw = [{ kind: "pay", label: "Choose what to pay", text: last }, { kind: "open_statement", label: "View statement" }]; }
      else if (/reorder|again|same as/.test(t)) { reply = "Pick the order to repeat from your orders, then press Reorder."; raw = [{ kind: "open_orders", label: "See my orders" }]; }
      else if (/new order|place an order|quote|need shirts|order some/.test(t)) { reply = "Let's start a new order."; raw = [{ kind: "new_order", label: "Start an order" }]; }
      else if (/mockup|design|idea/.test(t)) { reply = "Try the Mockup Creator."; raw = [{ kind: "open_mockup", label: "Open Mockup Creator" }]; }
      else if (/track|package|shipment|deliver/.test(t)) {
        const shipped = orders.filter((o) => o.tracking?.trim()).slice(0, 3);
        reply = shipped.length ? `Here's the latest tracking: ${shipped.map((o) => `#${o.number} ${o.ship_method || ""} ${o.tracking}`.replace(/\s+/g, " ")).join("; ")}.` : "Nothing has shipped with tracking yet.";
        raw = shipped.map((o) => ({ kind: "track" as const, label: `Track #${o.number}`, number: o.number }));
      }
      else if (/status|where|when|ready|done|ship/.test(t)) { reply = "Here are your orders with their status."; raw = [{ kind: "open_orders", label: "See my orders" }]; }
      else { reply = "I'll pass that to the shop."; raw = [{ kind: "message_shop", label: "Send this to the shop", text: last }]; }
    }

    const actions: AssistAction[] = [];
    for (const a of raw.slice(0, 4)) {
      if (a.kind === "track") {
        const href = a.number !== undefined ? trackOf.get(a.number) : undefined;
        if (href) actions.push({ kind: "track", label: a.label || `Track #${a.number}`, href, number: a.number });
        continue;
      }
      if (["open_order", "reorder"].includes(a.kind)) {
        const hit = a.number !== undefined ? byNumber.get(a.number) : undefined;
        if (!hit) continue; // never offer an order that isn't theirs
        actions.push({ ...hit, kind: a.kind, label: a.label || `#${a.number}` });
      } else actions.push({ kind: a.kind, label: a.label, text: a.text });
    }
    return { ok: true, reply, actions };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/**
 * "Reorder" a past order from before the portal. Those don't have garment details we can copy into a new order,
 * so the shop gets a clear request (in Messages, and by email) and sends back a quote.
 */
export async function reorderArchived(archivedId: string, note = ""): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user, isStaff } = await getViewer();
    if (!user || isStaff) return { ok: false, error: "Reorders start from the customer's own login." };
    const { data: cs } = await supabase.from("customers").select("id");
    const admin = createAdminClient();
    const { data: a } = await admin.from("archived_orders").select("id, visual_id, nickname, qty").eq("id", archivedId).in("customer_id", (cs || []).map((c) => c.id)).maybeSingle();
    if (!a) return { ok: false, error: "We couldn't find that order." };
    return portalSend(null, `I'd like to reorder past order #${a.visual_id}${a.nickname ? ` (${a.nickname})` : ""}: same garments and artwork as before${a.qty ? ` (last time ${a.qty} pcs)` : ""}.${note ? `\n\n${note.slice(0, 1000)}` : ""}\n\nPlease send me a quote.`);
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
