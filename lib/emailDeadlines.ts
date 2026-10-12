import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { newPart } from "@/lib/linkArt";
import { convoKeys, groupConvos } from "@/lib/mail/convo";
import type { Settings } from "@/lib/pricing";
import { mergeSettings } from "@/lib/pricing";
import { bizAdd, ctToday, nice, type JobAction } from "@/lib/jobWatch";

/**
 * Orders still in email (Oct 12, Nick: "if I don't order the heart transplant shirts today we're gonna miss the
 * deadline"). A customer asking for an order has a date in mind long before there's an order in the system. Every
 * customer conversation that's an order (new or reorder, last 3 weeks) with no order made from it yet is read once by
 * the AI for its in-hands date (read again when a new email comes in). From that date back: goods here by in-hands −
 * the goods lead time; ordered by one business day before that (Fort Worth). On that day, or once it's passed, it's
 * "Needs you today": make the order and order the goods.
 */
type Act = { id: string; customer_id: string | null; order_id: string | null; subject: string | null; body: string | null; from_email: string | null; to_email: string | null; direction: string; occurred_at: string; thread_id: string | null; external_id: string | null; meta: { account_id?: string; ignored?: boolean; references?: string[]; from_name?: string; triage?: { intent?: string; summary?: string } } | null };
type Read = { need_by: string | null; firm: boolean; what: string; pieces: number | null };

export async function watchEmailOrders(admin: SupabaseClient, opts: { deadline?: number; cut?: boolean } = {}): Promise<JobAction[]> {
  const today = ctToday();
  const since = new Date(Date.now() - 21 * 864e5).toISOString();
  const [{ data: acts }, { data: s }, { data: accts }] = await Promise.all([
    admin.from("activities").select("id, customer_id, order_id, subject, body, from_email, to_email, direction, occurred_at, thread_id, external_id, meta").eq("kind", "email").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(800),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("mail_accounts").select("id, email"),
  ]);
  const settings = mergeSettings(s?.data);
  const lead = Math.max(1, settings.ship?.goodsLeadDays ?? 3);
  const box = new Map(((accts || []) as { id: string; email: string }[]).map((a) => [a.id, a.email.toLowerCase()]));
  const rows = ((acts || []) as Act[]).filter((a) => !a.meta?.ignored);
  const keyOf = (x: Act) => convoKeys({ subject: x.subject, from_email: x.direction === "out" ? (x.to_email || "").split(/[,;]/)[0].replace(/.*</, "").replace(/>.*/, "").trim() : x.from_email, customer_id: x.customer_id, thread_id: x.thread_id, external_id: x.external_id, references: x.meta?.references });
  const convos = groupConvos(rows, keyOf, (x) => x.occurred_at)
    .filter((g) => g.some((x) => x.direction === "in" && x.customer_id && ["new_order", "reorder"].includes(x.meta?.triage?.intent || "")) && !g.some((x) => x.order_id));
  if (!convos.length) return [];
  // an order already made from the conversation (Create order) counts as made
  const ids = convos.flatMap((g) => g.map((x) => x.id));
  const [{ data: made }, { data: kept }] = await Promise.all([
    admin.from("ai_suggestions").select("activity_id").eq("kind", "draft_order").eq("status", "done").in("activity_id", ids),
    admin.from("email_deadlines").select("activity_id, need_by, firm, what, pieces").in("activity_id", convos.map((g) => g[0].id)),
  ]);
  const done = new Set(((made || []) as { activity_id: string }[]).map((x) => x.activity_id));
  const have = new Map(((kept || []) as (Read & { activity_id: string })[]).map((x) => [x.activity_id, x]));
  const st = await aiState(admin);
  const out: JobAction[] = [];
  let asked = 0;
  // an order made for the customer since the conversation started (in Printavo or here) counts as made too (Oct 12:
  // Fossil's order was in Printavo, the email still showed "no order yet")
  const custIds = [...new Set(convos.flatMap((g) => g.map((x) => x.customer_id)).filter(Boolean))] as string[];
  const [{ data: pv }, { data: po }] = custIds.length ? await Promise.all([
    admin.from("archived_orders").select("customer_id, order_date, data->>createdAt").in("customer_id", custIds).gte("order_date", since.slice(0, 10)),
    admin.from("orders").select("customer_id, created_at").in("customer_id", custIds).gte("created_at", since),
  ]) : [{ data: [] }, { data: [] }];
  const ordersSince = (cid: string | null, from: string) => !!cid && ([...((pv || []) as { customer_id: string; order_date: string | null; createdAt?: string }[]).map((x) => ({ c: x.customer_id, at: x.createdAt || x.order_date || "" })), ...((po || []) as { customer_id: string; created_at: string }[]).map((x) => ({ c: x.customer_id, at: x.created_at }))])
    .some((x) => x.c === cid && x.at.slice(0, 10) >= bizAdd(from.slice(0, 10), 2));
  for (const g of convos) {
    if (g.some((x) => done.has(x.id))) continue;
    if (g.some((x) => x.customer_id && ordersSince(x.customer_id, g[g.length - 1].occurred_at))) continue;
    const newest = g[0], cust = g.find((x) => x.direction === "in" && x.customer_id) || newest;
    let r: Read | null = have.get(newest.id) || null;
    if (!r) {
      if (!st.ready || asked >= 4 || (opts.deadline && Date.now() > opts.deadline)) { opts.cut = true; continue; }
      asked++;
      r = await readDate(admin, st.settings as Settings, g, today).catch(() => null);
      if (!r) continue;
      await admin.from("email_deadlines").upsert({ activity_id: newest.id, need_by: r.need_by, firm: r.firm, what: r.what.slice(0, 200), pieces: r.pieces, read_at: new Date().toISOString() }, { onConflict: "activity_id" });
    }
    if (!r.need_by || !/^\d{4}-\d{2}-\d{2}$/.test(r.need_by) || r.need_by < today) continue;
    const goodsHere = bizAdd(r.need_by, lead), orderBy = bizAdd(goodsHere, 1);
    if (orderBy > today) continue;
    const { data: c } = cust.customer_id ? await admin.from("customers").select("company, name").eq("id", cust.customer_id).maybeSingle() : { data: null };
    const who = (c?.company as string) || (c?.name as string) || cust.meta?.from_name || cust.from_email || "a customer";
    const owner = cust.meta?.account_id ? box.get(cust.meta.account_id) : undefined;
    const late = orderBy < today;
    out.push({
      orderId: cust.id, number: 0, step: "goods", ref: `mail:${newest.id}:goods`, by: orderBy, today: true, owner, archived: true,
      title: `${who}: no order yet, goods ${late ? "should already be ordered" : "have to be ordered today"}`,
      notes: `${r.what || "Their order"}${r.pieces ? ` (${r.pieces} pcs)` : ""} is needed ${r.firm ? "by" : "around"} ${nice(r.need_by)}. Goods need to be here by ${nice(goodsHere)}${late ? `; they should have been ordered by ${nice(orderBy)}` : ""}. Create the order and order the goods.`,
      url: `/shop/email-order/${cust.id}`,
    });
  }
  return out;
}

async function readDate(admin: SupabaseClient, s: Settings, g: Act[], today: string): Promise<Read | null> {
  const text = [...g].slice(0, 8).reverse().map((x) => `- ${x.occurred_at.slice(0, 10)} ${x.direction === "out" ? "WE wrote" : `${x.from_email} wrote`}: ${newPart(String(x.body || "")).replace(/\s+/g, " ").trim().slice(0, 1500)}`).join("\n");
  const wd = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" });
  const r = await askClaude<Read>({
    task: "email_deadline", model: s.assistant.ai.fastModel || s.assistant.ai.model, maxTokens: 300, admin, timeoutMs: 20_000, ctx: { activity_id: g[0].id, customer_id: g.find((x) => x.customer_id)?.customer_id || null, by: "jobwatch" },
    tool: { name: "deadline", description: "When the customer needs this order.", input_schema: { type: "object", properties: {
      need_by: { type: ["string", "null"], description: "The in-hands date as YYYY-MM-DD: the date they need the items (an event, a day they said). The latest one if it changed. null if no date was given or agreed." },
      firm: { type: "boolean", description: "true for a hard date (an event, 'must have by'); false for 'around', 'no rush', 'hopefully'." },
      what: { type: "string", description: "What they're ordering, a few words (\"Transplant Institute shirts\")." },
      pieces: { type: ["integer", "null"], description: "About how many pieces, if said." },
    }, required: ["need_by", "firm", "what", "pieces"] } },
    system: `${SHOP_CONTEXT(s)}\nRead this customer conversation and say when they need the order. Today is ${wd} ${today}; resolve "Friday", "next week", "the 16th" against today.`,
    prompt: `Subject: ${g[0].subject || ""}\n${text}`,
  });
  return r.ok ? r.data : null;
}
