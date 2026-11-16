import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { orderFix } from "@/lib/ai/orderFix";
import { orderGroups, ST, type Order, type Settings } from "@/lib/pricing";
import { reasonOf } from "@/lib/messages";
import type { MsgChange, MsgRead } from "@/lib/messageRead";

/**
 * The AI reads a customer's message with its order and says what it means for us (Nick, Nov 16 2026: "would you like me
 * to update the shipping address to this?… customer says I added 2 garments… this can be smart"; "Peter… says firm ship
 * date… the AI helper should… click firm… and the date… change to the 28th"; "firm ship date, bag size… those are
 * changes… it's not no reply needed").
 *
 * Every customer message is read, whatever reason they picked (a "Just letting you know" can still change the order):
 *  - change: something on the order. The AI order helper (lib/ai/orderFix.ts, mode "propose": the one tool that changes
 *    orders) works out the exact changes; staff press the button and they're made (applyChanges).
 *  - answer / act: a question, or something to do that isn't an order field (order the transfers): To do, with a reply
 *    written for staff to check, or the tool to open.
 *  - nothing: filed (a goods notice, "approved: YES", something the order already says). No badge, no to-do.
 * A run of messages since our last one is read together; the read sits on the newest. What staff mark "Not this" is
 * kept and shown to the next reads, so it learns.
 */

const GOODS_NOTICE = /^📦 Goods for /;
type Msg = { id: string; order_id: string | null; customer_id: string | null; topic: string | null; author_type: string; author_name: string | null; body: string | null; created_at: string; reason: string | null; attachments: unknown[] | null; ai: MsgRead | null; handled_at: string | null };
const COLS = "id, order_id, customer_id, topic, author_type, author_name, body, created_at, reason, attachments, ai, handled_at";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const dateWords = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "not set");

/** the order in plain words, short: what a message about it could change */
function orderText(o: Order & Record<string, unknown>, customer: string): string {
  const groups = orderGroups(o);
  const g = groups.map((gr, gi) => {
    const lines = gr.lines.map((l) => {
      const sz = Object.entries(l.sizes || {}).filter(([, n]) => +n > 0).map(([z, n]) => `${z} ${n}`).join(" · ");
      return `  - line ${l.id}: ${[l.brand, l.style, l.garment].filter(Boolean).join(" ")} · color ${l.color || "?"} · ${sz || "no sizes"}`;
    }).join("\n");
    const prints = gr.imprints.map((i) => `  - print ${i.id}: ${i.location || "?"} · ${i.method || "screen"}${i.size ? ` · ${i.size}` : ""}${i.inks ? ` · inks ${i.inks}` : ""}`).join("\n");
    return `Group ${gi + 1}${gr.name ? ` "${gr.name}"` : ""}:\n${lines || "  (no garments)"}\n${prints || "  (no prints yet)"}`;
  }).join("\n");
  const fees = ((o.fees || []) as { label: string; amount: number | "" }[]).map((f) => `${f.label} $${f.amount}`).join(", ");
  return [
    `Order #${o.number} "${o.nickname || ""}" for ${customer}. Status: ${ST[o.status as string]?.label || o.status} (${o.type}).`,
    `In-hands (due / ship) date: ${dateWords(o.due_date as string)} (${o.due_date || "none"}), ${o.firm ? "FIRM" : "not firm"}. Production date: ${o.production_date || "none"}. Rush: ${o.rush ? "yes" : "no"}. High priority: ${o.priority ? "yes" : "no"}.`,
    `Delivery: ${o.delivery_method || "?"}. Ship to: ${String(o.ship_to || "").replace(/\n+/g, ", ") || "none"}. Ship method: ${o.ship_method || "none"}. PO: ${o.po_number || "none"}.`,
    `Proof: ${o.approved_at ? "approved" : o.sent_at ? "sent, not approved yet" : "not sent"}.`,
    g, fees ? `Fees: ${fees}` : "",
    o.notes ? `Notes: ${String(o.notes).slice(0, 600)}` : "",
  ].filter(Boolean).join("\n");
}

/** what an order field is called for staff, and its value in words */
const FIELD: Record<string, string> = { due_date: "In-hands date", firm: "Firm date", ship_to: "Ship to", delivery_method: "Delivery", rush: "Rush", priority: "High priority", nickname: "Job name", po_number: "PO", production_date: "Production date", ship_method: "Ship method" };
const words2 = (k: string, v: unknown) => {
  if (k === "firm" || k === "rush" || k === "priority") return /^(y|true|on|1)/i.test(String(v)) ? "Yes" : "No";
  if (k === "due_date" || k === "production_date") return v ? dateWords(String(v)) : "none";
  if (k === "delivery_method") return ({ pickup: "Pickup", ship: "Ship", deliver: "Deliver", tbd: "Not told yet" } as Record<string, string>)[String(v)] || String(v || "none");
  return String(v || "").replace(/\n+/g, ", ") || "none";
};

/** the conversation a message is in, since our last message: the run read together */
async function runOf(admin: SupabaseClient, m: Msg): Promise<{ run: Msg[]; before: Msg[] }> {
  let q = admin.from("messages").select(COLS).is("hidden_at", null);
  q = m.order_id ? q.eq("order_id", m.order_id).eq("topic", m.topic || "") : q.is("order_id", null).eq("customer_id", m.customer_id || "");
  const { data } = await q.lte("created_at", m.created_at).order("created_at", { ascending: false }).limit(30);
  const all = ((data || []) as Msg[]).reverse();
  let lastStaff = -1; all.forEach((r, i) => { if (r.author_type !== "customer") lastStaff = i; });
  const run = all.slice(lastStaff + 1).filter((r) => r.author_type === "customer" && !r.handled_at && !GOODS_NOTICE.test(r.body || ""));
  return { run: run.length ? run : [m], before: all.slice(Math.max(0, lastStaff - 5), lastStaff + 1) };
}

/** what staff said the AI read wrong before (newest first): shown to the next reads */
async function lessons(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from("messages").select("body, ai").not("ai->no", "is", null).order("created_at", { ascending: false }).limit(12);
  const ls = ((data || []) as { body: string | null; ai: MsgRead }[]).filter((x) => x.ai?.no);
  return ls.length ? `\nSTAFF CORRECTED THESE READS BEFORE (don't repeat them):\n${ls.map((x) => `- "${String(x.body || "").slice(0, 160)}": you said "${x.ai.head}"; staff: ${x.ai.no?.note || "not this"}`).join("\n")}` : "";
}

/** read one message (with the rest of its run since our last message) and keep what it means on it */
export async function readMessage(admin: SupabaseClient, s: Settings, msgId: string, force = false): Promise<{ ok: true; read: MsgRead } | { ok: false; error: string }> {
  const { data: m0 } = await admin.from("messages").select(COLS).eq("id", msgId).maybeSingle();
  const m = m0 as Msg | null;
  if (!m || m.author_type !== "customer") return { ok: false, error: "Not a customer's message." };
  if (m.ai && !force && !m.ai.err) return { ok: true, read: m.ai };
  const now = new Date().toISOString();
  // the portal's goods form writes these itself: on the order's Goods already, nothing to read
  if (GOODS_NOTICE.test(m.body || "")) {
    const read: MsgRead = { v: 1, at: now, kind: "filed", need: "nothing", head: "Goods notice: it's on the order's Goods", auto: true };
    await admin.from("messages").update({ ai: read, ai_kind: "filed", handled_at: now, handled_by: "AI" }).eq("id", m.id);
    return { ok: true, read };
  }
  const { run, before } = await runOf(admin, m);
  const last = run[run.length - 1];
  const { data: od } = m.order_id ? await admin.from("orders").select("*").eq("id", m.order_id).maybeSingle() : { data: null };
  const o = od as (Order & Record<string, unknown>) | null;
  const cid = o?.customer_id || m.customer_id;
  const { data: cu } = cid ? await admin.from("customers").select("company, name").eq("id", cid).maybeSingle() : { data: null };
  const customer = cu?.company || cu?.name || "the customer";
  const who = (last.author_name || customer).split(/\s+/)[0];
  const said = run.map((r) => `[${day(r.created_at)}${reasonOf(r.reason) ? `, they picked "${reasonOf(r.reason)!.label}"` : ""}${(r.attachments || []).length ? `, ${(r.attachments || []).length} file(s) attached` : ""}] ${String(r.body || "(a file)").slice(0, 2500)}`).join("\n");
  const earlier = before.map((r) => `${r.author_type === "customer" ? r.author_name || "Customer" : "Us"}: ${String(r.body || "").slice(0, 300)}`).join("\n");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const r = await askClaude<{ need: MsgRead["need"]; head: string; btn?: string; helper?: string; reply?: string; tool?: string }>({
    task: "message_read", model: s.assistant.ai.model, maxTokens: 1500, timeoutMs: 60_000, admin,
    ctx: { order_id: m.order_id, customer_id: cid, by: "AI (customer message)" },
    tool: { name: "message_read", description: "What this message means for the shop.", input_schema: { type: "object", properties: {
      need: { type: "string", enum: ["change", "answer", "act", "nothing"], description: "change: something on the order should change; answer: a question we need to answer; act: something for us to do that isn't a field on the order (order their heat transfers, order the goods, call them, send a proof); nothing: nothing for us to do." },
      head: { type: "string", description: "ONE short line for staff (under 70 characters), what to do, plain words: \"Make the ship date firm: Fri, Nov 28\", \"Add 2 CT106921 shirts (77 total)\", \"Hoodie color: Team Anthracite → Navy\", \"He asks if 4.75\\\" is the usual left chest\". For nothing: what it was (\"Approved the proof, no change\")." },
      btn: { type: "string", description: "change/act: the button, 2 to 4 words (\"Make it firm\", \"Update ship-to\", \"Add 2 shirts\", \"Order transfers\")." },
      helper: { type: "string", description: "change only: exactly what to change on the order, for the AI order helper, with exact values (\"Set firm to yes. Set the due date to 2026-11-28.\", \"Set delivery to ship and the ship-to to: Sanford Contractors, Attn: Blake Baur, 367 Freedom Parkway Suite 200, Pittsboro, NC 27312\", \"Add 2 more CT106921 to line …; sizes not given\")." },
      reply: { type: "string", description: `A short reply to ${who} in the shop's voice, 1 or 2 sentences, no sign-off: for change, saying it's done ("Done: Nov 28 is locked in as a firm ship date."); for answer, the answer when the order or the shop's rules give it, else empty; for act, what we'll do. Empty for nothing.` },
      tool: { type: "string", enum: ["none", "gang_sheet", "order_goods"], description: "act: gang_sheet when they ask us to order or make heat transfers / DTF; order_goods when they ask us to order the blanks. Else none." },
    }, required: ["need", "head"] } },
    system: `${SHOP_CONTEXT(s)}

You read a customer's portal message for the shop's account manager and say, in one line, what it means for us. Today is ${today}.

CHANGE (need "change") is anything that should be different on the order than it is now, even when they picked "Just letting you know" or wrote it as information: a date ("firm ship date Nov 28": firm yes and that date as the in-hands date when it differs), rush, "high profile" / "extra attention" / "make sure this one is perfect" (High priority yes), a ship-to address or delivery method, a garment's color, style, size or quantity (pieces added, a replacement for an out-of-stock color, "total qty is 7" when the order has another count), a print's size, spot or inks, a fee that's wrong. Check the order first: when it already says exactly that, it's nothing.
ANSWER: a question we have to answer. ACT: they ask us to do something that isn't a field on the order.
NOTHING: a proof approval whose note is only "yes", "ok", "approved", "looks good"; goods or tracking info that matches the order (vendor, PO, tracking number: it's on the order's Goods); thanks; something the order already says.
Never invent sizes, prices or dates they didn't give: say what's missing in the head ("sizes not given").
EVERY change: one message often asks for several ("high profile… firm ship date Nov 20… cap is adjustable"): the head names each one ("High priority; firm ship date Nov 20") and the helper lists each one. Nothing they didn't ask for: never High priority unless they said high profile / priority / extra attention, never a firm date unless they said firm.`,
    prompt: [o ? orderText(o, customer) : `Not about an order: a general message from ${customer}.`,
      earlier ? `\nEarlier in this conversation:\n${earlier}` : "",
      `\nTHEIR MESSAGE${run.length > 1 ? `S (since our last reply, read together)` : ""}, from ${last.author_name || customer}:\n${said}`,
      await lessons(admin)].filter(Boolean).join("\n"),
  });
  if (!r.ok) {
    const read: MsgRead = { v: 1, at: now, kind: "todo", need: "answer", head: "Couldn't read this one", err: r.error };
    await admin.from("messages").update({ ai: read }).eq("id", last.id);
    return { ok: false, error: r.error };
  }
  const d = r.data;
  let need = (["change", "answer", "act", "nothing"] as const).includes(d.need) ? d.need : "answer";
  const read: MsgRead = { v: 1, at: now, kind: need === "nothing" ? "filed" : "todo", need, head: String(d.head || "").slice(0, 140), btn: d.btn ? String(d.btn).slice(0, 40) : undefined,
    reply: d.reply ? String(d.reply).slice(0, 600) : undefined, covers: run.slice(0, -1).map((x) => x.id) };
  if (need === "act" && o) {
    if (d.tool === "gang_sheet") read.tool = { label: d.btn || "Create DTF gang sheet", href: `/shop/gang-sheet/builder?order=${o.id}` };
    else if (d.tool === "order_goods") read.tool = { label: d.btn || "Order goods", href: `/shop/order-goods?order=${o.id}` };
  }
  // a change: the AI order helper works out exactly what, made only when staff press the button
  if (need === "change" && o) {
    const f = await orderFix(admin, s, o.id as string, "AI (customer message)",
      `The customer wrote this portal message about the order:\n${said}\n\nMake exactly the changes the message asks for, nothing else: ${d.helper || d.head}`, "propose").catch((e) => ({ ok: false as const, error: String(e) }));
    const ch = (f.ok ? f.r.changes : []).filter((c) => c.what !== "art") as MsgChange[];
    if (ch.length) {
      read.changes = ch;
      read.ba = ch.filter((c) => c.what === "order" && FIELD[c.field]).map((c) => ({ k: FIELD[c.field], was: words2(c.field, o[c.field]), now: words2(c.field, c.value) }));
      read.says = ch.filter((c) => !(c.what === "order" && FIELD[c.field])).map((c) => c.say);
    } else {
      // the helper couldn't make it (sizes not given, a garment it can't find): still To do, opened in the order
      need = "answer"; read.need = "change"; read.err = f.ok ? (f.r.reply || "").slice(0, 300) : f.error;
    }
  } else if (need === "change") read.need = "answer";
  // what the words plainly say is never missed (Nov 16, #50072: "high profile… Firm ship date NOV. 20" came back as High
  // priority only): a firm date or high profile in their message the order doesn't have yet is added to the change
  if (o) {
    const words = run.map((r) => r.body || "").join("\n");
    const extra: MsgChange[] = [];
    const has = (f: string) => (read.changes || []).some((c) => c.what === "order" && c.field === f);
    if (/\bfirm\b[^.\n]{0,40}\b(date|ship|deliver|in[- ]?hands|due)/i.test(words) && !o.firm && !has("firm")) extra.push({ what: "order", id: "order", field: "firm", value: "yes", say: "Made the date firm" });
    if (/\bhigh[\s-]*(profile|priority)\b|\bextra (attention|care)\b/i.test(words) && !o.priority && !has("priority")) extra.push({ what: "order", id: "order", field: "priority", value: "yes", say: "Marked it High priority" });
    if (extra.length) {
      read.changes = [...(read.changes || []), ...extra];
      read.ba = [...(read.ba || []), ...extra.map((c) => ({ k: FIELD[c.field], was: words2(c.field, o[c.field]), now: words2(c.field, c.value) }))];
      if (read.kind === "filed" || read.need !== "change") { read.kind = "todo"; read.need = "change"; }
      if (!/firm|priority/i.test(read.head)) read.head = `${read.head}; ${extra.map((c) => c.field === "firm" ? "firm date" : "High priority").join(", ")}`.slice(0, 140);
      delete read.err;
    }
  }
  const kind = read.kind;
  await admin.from("messages").update({ ai: read, ai_kind: kind, ...(kind === "filed" ? { handled_at: now, handled_by: "AI" } : {}) }).eq("id", last.id);
  // the earlier ones in the run go with it
  const covers = read.covers || [];
  if (covers.length) await admin.from("messages").update({ ai: { v: 1, at: now, kind, need: read.need, head: read.head, coveredBy: last.id } satisfies MsgRead, ai_kind: kind, ...(kind === "filed" ? { handled_at: now, handled_by: "AI" } : {}) }).in("id", covers);
  return { ok: true, read };
}

/** customer messages not read yet (newest first, the last 10 days), read a few at a time */
export async function readPending(admin: SupabaseClient, s: Settings, max = 4): Promise<{ read: number; left: number }> {
  const since = new Date(Date.now() - 10 * 864e5).toISOString();
  const { data, count } = await admin.from("messages").select("id", { count: "exact" }).eq("author_type", "customer").is("ai", null).is("handled_at", null).is("hidden_at", null)
    .gte("created_at", since).order("created_at", { ascending: false }).limit(max);
  let n = 0;
  for (const x of (data || []) as { id: string }[]) {
    // read already as part of a later message's run
    const { data: cur } = await admin.from("messages").select("ai").eq("id", x.id).maybeSingle();
    if (cur?.ai) continue;
    const r = await readMessage(admin, s, x.id).catch(() => null);
    if (r?.ok) n++;
  }
  return { read: n, left: Math.max(0, (count || 0) - (data || []).length) };
}
