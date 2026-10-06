import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude } from "@/lib/ai/claude";
import { orderGroups, type Order } from "@/lib/pricing";
import { AI_TAG, PV, __ai, abbrevHit, applyGroup, customerForAccount, linkLines, sizeKey, unlinkedFrom, type Group, type ManifestRow, type Waiting } from "@/lib/manifest";

/**
 * The AI matcher. The rules in lib/manifest.ts link what they're sure of; whatever is still waiting comes here.
 * For each waiting shipment Claude reads:
 *   - the shipment (account, PO, every style / color / size),
 *   - the jobs it could be for (that customer's jobs, or for our own blanks / an unknown account the jobs around the
 *     ship date that share garments or a name with the PO), including jobs already printed,
 *   - the latest links staff made by hand or OK'd (with their notes): the worked examples it learns from.
 * It answers certain / likely / none. Certain links (only when the garments or the PO back it up), likely is saved as a
 * suggestion to OK, none says why it's still waiting. Each answer is remembered with a fingerprint of what it saw, so a
 * shipment is only asked about again when something changed (a new job, a new lesson).
 */

const { isUs, groupLines, styleEq, colorEq, words, numRuns, bySizeOf, sameSizes, pvSize, GENERIC, STOP } = __ai;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(d + "T12:00:00Z") + n * 86400000));

type Item = { style: string; color: string; size: string; qty: number; desc: string };
type Job = { id: string; number: number; customer: string; customerId: string | null; nickname: string; po: string; status: string; due: string | null; items: Item[] };
type Scored = Job & { score: number; fit: number; twin: boolean; named: boolean; numbered: boolean; linkedPcs: number };

type PvRow = { id: string; visual_id: string | number; nickname: string; po_number: string; customer_id: string | null; status_name: string; due_date: string | null; groups: { lines?: { itemNumber?: string; color?: string; description?: string; sizes?: Record<string, number> }[] }[] | null; customers: { company: string; name: string } | null };
const PV_COLS = "id, visual_id, nickname, po_number, customer_id, status_name, due_date, groups:data->groups, customers(company, name)";
const LIVE_COLS = "id, number, nickname, po_number, customer_id, status, due_date, groups, lines, customers(company, name)";

function fromPv(o: PvRow): Job {
  const items: Item[] = [];
  for (const gr of o.groups || []) for (const l of gr.lines || []) for (const [k, q] of Object.entries(l.sizes || {})) if (+q > 0) items.push({ style: l.itemNumber || "", color: l.color || "", size: pvSize(k), qty: +q, desc: (l.description || "").slice(0, 60) });
  return { id: PV + o.id, number: +o.visual_id || 0, customer: o.customers?.company || o.customers?.name || "", customerId: o.customer_id, nickname: o.nickname || "", po: o.po_number || "", status: o.status_name || "", due: o.due_date, items };
}
function fromLive(o: Order & { id: string; number: number; nickname: string; po_number: string; customer_id: string | null; status: string; due_date: string | null; customers: { company: string; name: string } | null }): Job {
  const items: Item[] = [];
  for (const g of orderGroups(o)) for (const l of g.lines) for (const [z, q] of Object.entries(l.sizes || {})) if (+(q || 0) > 0) items.push({ style: l.style || "", color: l.color || "", size: sizeKey(z), qty: +(q || 0), desc: [l.brand, l.garment].filter(Boolean).join(" ").slice(0, 60) });
  return { id: o.id, number: o.number, customer: o.customers?.company || o.customers?.name || "", customerId: o.customer_id, nickname: o.nickname || "", po: o.po_number || "", status: o.status, due: o.due_date, items };
}
/** quotes and cancelled jobs never get goods; completed ones can (goods often show up after the job ran) */
const usable = (status: string) => !/quote|cancel/i.test(status);

/** Jobs due in a window (our blanks, unknown accounts): fetched once per run. */
async function windowJobs(admin: SupabaseClient, from: string, to: string): Promise<Job[]> {
  const [{ data: ar }, { data: os }] = await Promise.all([
    admin.from("archived_orders").select(PV_COLS).gte("due_date", from).lte("due_date", to).limit(2500),
    admin.from("orders").select(LIVE_COLS).not("status", "in", "(quote,request)").gte("due_date", from).lte("due_date", to).limit(1000),
  ]);
  return [
    ...((ar || []) as unknown as PvRow[]).map(fromPv),
    ...((os || []) as unknown as Parameters<typeof fromLive>[0][]).map(fromLive),
  ].filter((j) => usable(j.status));
}

/** A customer's jobs: open and recently done (goods often show up after the job ran). */
async function customerJobs(admin: SupabaseClient, custIds: string[]): Promise<Job[]> {
  const since = iso(new Date(Date.now() - 90 * 86400000));
  const [{ data: ar }, { data: os }] = await Promise.all([
    admin.from("archived_orders").select(PV_COLS).in("customer_id", custIds).or(`due_date.gte.${since},due_date.is.null`).order("due_date", { ascending: false, nullsFirst: true }).limit(120),
    admin.from("orders").select(LIVE_COLS).in("customer_id", custIds).not("status", "in", "(quote,request)").order("number", { ascending: false }).limit(60),
  ]);
  return [...((ar || []) as unknown as PvRow[]).map(fromPv), ...((os || []) as unknown as Parameters<typeof fromLive>[0][]).map(fromLive)].filter((j) => usable(j.status));
}

/** How well a job fits the shipment, so only the plausible ones go to Claude. */
function score(g: Group<Waiting>, j: Job, shipDay: string): Omit<Scored, keyof Job | "linkedPcs"> {
  const lines = g.lines;
  const pcs = lines.reduce((a, l) => a + l.qty_shipped, 0) || 1;
  // share of the shipped pieces whose style + color (or color alone, when the job line has no style) is on the job
  let on = 0;
  for (const l of lines) if (j.items.some((it) => (it.style ? styleEq(it.style, l.style) : true) && colorEq(it.color, l.color))) on += l.qty_shipped;
  const fit = on / pcs;
  const twin = pcs >= 6 && sameSizes(bySizeOf(lines.map((l) => ({ size: l.size, qty: l.qty_shipped }))), bySizeOf(j.items.map((it) => ({ size: it.size, qty: it.qty }))));
  const po = g.customer_po || "";
  const theirs = new Set([...words(j.nickname), ...words(j.po), ...words(j.customer)]);
  const pw = words(po).filter((w) => w.length >= 3 && !GENERIC.test(w) && !STOP.has(w) && !/^(po|so)$/.test(w));
  const numbered = (j.number >= 1000 && words(po).includes(String(j.number))) || numRuns(po).some((r) => numRuns(`${j.nickname} ${j.po}`).includes(r));
  const named = numbered || (pw.length > 0 && pw.filter((w) => !/^\d+$/.test(w)).some((w) => theirs.has(w))) || (!!po && abbrevHit(po, [j.customer], j.nickname));
  const days = j.due ? Math.abs(Date.parse(j.due) - Date.parse(shipDay)) / 86400000 : 30;
  return { score: fit * 3 + (twin ? 3 : 0) + (named ? 4 : 0) + (numbered ? 4 : 0) - Math.min(2, days / 20), fit, twin, named, numbered };
}

const itemsText = (items: { style: string; color: string; size: string; qty: number; desc?: string }[]) => {
  const m = new Map<string, { label: string; sizes: Map<string, number>; n: number }>();
  for (const it of items) {
    const k = `${it.style}|${it.color}|${it.desc || ""}`;
    const x = m.get(k) || { label: [it.style || "(no style)", it.color || "(no color)", it.desc ? `"${it.desc}"` : ""].filter(Boolean).join(" "), sizes: new Map(), n: 0 };
    x.sizes.set(it.size, (x.sizes.get(it.size) || 0) + it.qty); x.n += it.qty; m.set(k, x);
  }
  return [...m.values()].map((x) => `${x.label}: ${x.n} pcs (${[...x.sizes].map(([z, q]) => `${z} ${q}`).join(", ")})`).join("; ") || "(no garments listed)";
};

type Lesson = { supplier: string; account: string; po: string; pcs: number; items: string; sizes: string; job: number; jobName: string; jobPo: string; jobCustomer: string; jobStatus: string; how: string; note: string };
async function lessons(admin: SupabaseClient): Promise<Lesson[]> {
  const { data } = await admin.from("ai_suggestions").select("payload").eq("kind", "goods_lesson").order("updated_at", { ascending: false }).limit(60);
  return ((data || []) as { payload: Lesson }[]).map((x) => x.payload).filter((x) => x && x.job);
}

const SYSTEM = [
  "You match supplier shipments to jobs at FBS Print, a screen printing, embroidery and heat press shop in Texas. Every day SanMar and S&S Activewear send manifests of the boxes shipping to the shop: the account the goods were bought on, the PO typed when ordering, and every style / color / size.",
  "Your job: say which ONE job a shipment is for, from the candidate jobs given. Answer with the job's number exactly as listed, or none.",
  "",
  "How this shop works (taught by the owner):",
  "- Account \"FBS\" is the shop itself buying blanks for a customer's job. Its PO is usually the job number and/or a short job or customer name: \"34110 LEHS FUNDRAISER\" is job 34110; \"LEHS\" is the initials of Little Elm High School; \"COR Softball\" is City of Richardson's softball job; \"HP Cent\" is short for a Centennial job. Customer initials and shortened words are normal.",
  "- Any other account is a customer (or their decorator / parent company) buying their own goods. Their PO usually appears in the job's name or PO, sometimes with a typo (one digit off), sometimes glued to letters (\"PeterMEI93298390\"). The account name can differ from the customer's name (a parent company, a legal name: UPSHOT HOLDINGS bought goods for Bullseye Ventures).",
  "- Some customers number every job with their own 5-digit PO (Nine18: \"43044 …\"). If the shipment's PO number is on no candidate, the job usually isn't entered yet: answer none unless the garments are an unmistakable twin of one job.",
  "- The same style, color and piece count as a job due within about two weeks is strong evidence. The same count in every size is very strong (\"757 to 757\").",
  "- Goods often arrive after a job already printed or is marked Job Completed. Completed jobs are still valid answers.",
  "- A job's goods can come in several shipments or from several vendors. \"Already linked\" shows pieces already tied to a job; a job already fully covered by other shipments is less likely, unless this shipment is a replacement or extras.",
  "- A job line's description often names INK colors (\"1/1 IMPRINT - NAVY\"); don't mistake the ink for the garment color. Job lines without a style still count by color and size.",
  "- Style numbers vary by vendor: 5000 = G500 = Gildan 5000; 64000 = G640; colors may be abbreviated (SportGrey = Sport Grey, AthlHthr = Athletic Heather).",
  "- The staff decisions listed are ground truth from the owner. Follow their patterns; a note explains why.",
  "",
  "Confidence:",
  "- certain: you would bet on it. The PO / name / number points at this job and the garments agree, or the garments are an exact twin of this job and no other candidate comes close.",
  "- likely: your best guess, but a person should OK it.",
  "- none: nothing fits well enough. Say what's missing (e.g. \"no job has PO 43044 yet\").",
  "Write the reason as one short plain sentence a shop worker understands, naming the evidence (\"PO LEHS = Little Elm High School; 56 Sport Grey 5000 in the same sizes as #34110\").",
].join("\n");

const TOOL = {
  name: "match",
  description: "The job this shipment is for.",
  input_schema: {
    type: "object",
    properties: {
      job: { type: ["integer", "null"], description: "The job number from the candidates, or null for none." },
      confidence: { type: "string", enum: ["certain", "likely", "none"] },
      reason: { type: "string", description: "One short sentence: the evidence." },
    },
    required: ["job", "confidence", "reason"],
  },
};

export type AiMatchResult = { asked: number; linked: number; suggested: number; none: number; skipped: number; errors: string[]; details: { po: string; account: string; job: number | null; confidence: string; reason: string }[]; off?: string };

/**
 * Ask Claude about the shipments still waiting. `max` caps the calls this run; `force` asks again even if nothing
 * changed since the last answer; `only` limits it to some shipments (by line id).
 */
export async function aiMatchPending(admin: SupabaseClient, deadline: number, opts: { max?: number; force?: boolean; only?: string[] } = {}): Promise<AiMatchResult> {
  const out: AiMatchResult = { asked: 0, linked: 0, suggested: 0, none: 0, skipped: 0, errors: [], details: [] };
  const st = await aiState(admin);
  if (!st.ready) return { ...out, off: st.reason };
  const model = st.settings.assistant.ai.model || "claude-sonnet-5";
  let q = admin.from("supplier_manifest_lines").select("*").eq("kind", "").order("created_at", { ascending: false }).limit(3000);
  if (opts.only?.length) q = q.in("id", opts.only);
  const { data } = await q;
  // arrived first (those are what people are waiting on), then the newest
  const groups = groupLines((data || []) as Waiting[]).sort((a, b) => Number(b.lines.some((l) => l.delivered_at || l.track_status === "delivered")) - Number(a.lines.some((l) => l.delivered_at || l.track_status === "delivered")));
  if (!groups.length) return out;
  const ls = await lessons(admin);
  const lessonText = ls.slice(0, 40).map((x) => `- ${x.account} PO "${x.po}" (${x.pcs} pcs: ${x.items}; sizes ${x.sizes}) → #${x.job} "${x.jobName}"${x.jobPo && x.jobPo !== x.jobName ? ` PO "${x.jobPo}"` : ""} for ${x.jobCustomer || "?"} [${x.jobStatus}] (${x.how})${x.note ? ` Note: ${x.note}` : ""}`).join("\n");
  const { data: prev } = await admin.from("ai_suggestions").select("dedupe_key, payload").eq("kind", "goods_ai").in("dedupe_key", groups.map((g) => `goods-ai:${g.key}`));
  const seen = new Map(((prev || []) as { dedupe_key: string; payload: { sig?: string; at?: string } }[]).map((x) => [x.dedupe_key, x.payload]));
  const notFor = await unlinkedFrom(admin).catch(() => new Map<string, { orderIds: string[]; numbers: number[]; note: string; wasHow: string }>());
  let pool: Job[] | null = null;
  const custCache = new Map<string, Job[]>();
  const max = opts.max ?? 10;

  type Work = { g: Group<Waiting>; cands: Scored[]; custIds: string[]; prompt: string; sig: string };
  const work: Work[] = [];
  for (const g of groups) {
    if (work.length >= max || Date.now() > deadline - 40000) break;
    const us = isUs(g.customer_name);
    const custIds = us ? [] : await customerForAccount(admin, g.supplier, g.customer_name, g.customer_account);
    const shipDay = g.lines[0].ship_date || iso(new Date(g.lines[0].created_at));
    let jobs: Job[];
    if (custIds.length) {
      const k = custIds.join(",");
      if (!custCache.has(k)) custCache.set(k, await customerJobs(admin, custIds));
      jobs = custCache.get(k)!;
    } else {
      if (!pool) pool = await windowJobs(admin, iso(new Date(Date.now() - 75 * 86400000)), iso(new Date(Date.now() + 60 * 86400000)));
      jobs = pool.filter((j) => !j.due || (j.due >= addDays(shipDay, -40) && j.due <= addDays(shipDay, 50)));
    }
    const no = notFor.get(g.key);
    let cands: Scored[] = jobs.filter((j) => !no?.orderIds.includes(j.id)).map((j) => ({ ...j, ...score(g, j, shipDay), linkedPcs: 0 }));
    cands = custIds.length ? cands.sort((a, b) => b.score - a.score).slice(0, 40) : cands.filter((c) => c.score > 1).sort((a, b) => b.score - a.score).slice(0, 25);
    const sig = createHash("sha1").update(JSON.stringify([g.lines.map((l) => `${l.id}:${l.qty_shipped}`).sort(), cands.map((c) => `${c.id}:${c.status}`).sort(), ls.length, no?.orderIds || []])).digest("hex");
    const before = seen.get(`goods-ai:${g.key}`);
    if (!opts.force && before?.sig === sig) { out.skipped++; continue; }
    if (!cands.length) {
      await remember(admin, g, sig, { job: null, confidence: "none", reason: "No job around the ship date shares these garments or the PO's name." }, model, null);
      continue;
    }
    // pieces already linked to each candidate (from other shipments)
    const pvIds = cands.filter((c) => c.id.startsWith(PV)).map((c) => c.id.slice(PV.length)), liveIds = cands.filter((c) => !c.id.startsWith(PV)).map((c) => c.id);
    const [{ data: a1 }, { data: a2 }] = await Promise.all([
      pvIds.length ? admin.from("supplier_manifest_lines").select("archived_order_id, qty_shipped").in("archived_order_id", pvIds).in("kind", ["goods", "blanks"]) : Promise.resolve({ data: [] }),
      liveIds.length ? admin.from("supplier_manifest_lines").select("order_id, qty_shipped").in("order_id", liveIds).in("kind", ["goods", "blanks"]) : Promise.resolve({ data: [] }),
    ]);
    for (const r of (a1 || []) as { archived_order_id: string; qty_shipped: number }[]) { const c = cands.find((x) => x.id === PV + r.archived_order_id); if (c) c.linkedPcs += r.qty_shipped; }
    for (const r of (a2 || []) as { order_id: string; qty_shipped: number }[]) { const c = cands.find((x) => x.id === r.order_id); if (c) c.linkedPcs += r.qty_shipped; }
    const pcs = g.lines.reduce((a, l) => a + l.qty_shipped, 0);
    const prompt = [
      `SHIPMENT`,
      `Vendor: ${g.supplier === "ss" ? "S&S Activewear" : g.supplier === "sanmar" ? "SanMar" : g.supplier} · order ${g.supplier_order}`,
      `Account: ${g.customer_name}${g.customer_account ? ` (account ${g.customer_account})` : ""}${us ? " (this is the shop itself: blanks for a customer's job)" : custIds.length ? "" : " (an account we don't know yet)"}`,
      `PO: ${g.customer_po || "(none)"}`,
      `Shipped: ${shipDay}${g.lines.some((l) => l.delivered_at || l.track_status === "delivered") ? " · already delivered to the shop" : ""}`,
      `Today: ${iso(new Date())}`,
      ...(no ? [`Staff UNLINKED this shipment from #${no.numbers.join(", #")}: it is NOT for ${no.numbers.length === 1 ? "that job" : "those jobs"}${no.wasHow ? ` (it had been linked because: ${no.wasHow})` : ""}.${no.note ? ` Their note: ${no.note}` : ""}`] : []),
      `Garments (${pcs} pcs): ${itemsText(g.lines.map((l) => ({ style: l.style, color: l.color, size: sizeKey(l.size), qty: l.qty_shipped })))}`,
      ``,
      `PAST DECISIONS BY STAFF (most recent first)`,
      lessonText || "(none yet)",
      ``,
      `CANDIDATE JOBS`,
      ...cands.map((c) => `#${c.number} · ${c.customer || "?"} · "${c.nickname}"${c.po && c.po !== c.nickname ? ` · PO "${c.po}"` : ""} · ${c.status || "?"} · due ${c.due || "?"} · ${c.items.reduce((a, it) => a + it.qty, 0)} pcs: ${itemsText(c.items)}${c.linkedPcs ? ` · already linked: ${c.linkedPcs} pcs from other shipments` : ""}`),
    ].join("\n");
    work.push({ g, cands, custIds, prompt, sig });
  }

  // a few at a time
  const run = async (w: Work) => {
    if (Date.now() > deadline - 25000) return;
    out.asked++;
    const r = await askClaude<{ job: number | null; confidence: "certain" | "likely" | "none"; reason: string }>({ task: "goods_match", model, system: SYSTEM, prompt: w.prompt, tool: TOOL, maxTokens: 600, ctx: { by: "goods matcher" }, admin });
    if (!r.ok) { out.errors.push(r.error); return; }
    const a = r.data;
    const c = a.job ? w.cands.find((x) => x.number === a.job) : undefined;
    out.details.push({ po: w.g.customer_po, account: w.g.customer_name, job: c ? c.number : null, confidence: c ? a.confidence : "none", reason: a.reason });
    await remember(admin, w.g, w.sig, { job: c ? c.number : null, confidence: c ? a.confidence : "none", reason: a.reason }, r.model, r.runId);
    const ids = w.g.lines.map((l) => l.id);
    if (!c || a.confidence === "none") {
      // say why it's waiting (unless the rules already have a guess up)
      if (!w.g.lines.some((l) => l.suggest_order_id || l.suggest_archived_id)) await admin.from("supplier_manifest_lines").update({ suggest_how: `${AI_TAG}: ${a.reason}`.slice(0, 500) }).in("id", ids);
      out.none++; return;
    }
    const how = `${AI_TAG}: ${a.reason}`.slice(0, 500);
    // certain links on its own, but only with evidence the code can see too (garments or the PO), and never for an
    // account we don't know (someone confirms who that is)
    const backed = c.fit >= 0.8 || c.twin || c.named;
    const known = isUs(w.g.customer_name) || w.custIds.length > 0;
    if (a.confidence === "certain" && backed && known) {
      if (isUs(w.g.customer_name)) {
        await applyGroup(admin, w.g.supplier, w.g, c.id, "blanks", how);
        await admin.from("supplier_manifest_lines").update({ linked_by: "ai" }).in("id", ids);
      } else {
        if (c.customerId) await admin.from("supplier_manifest_lines").update({ customer_id: c.customerId }).in("id", ids).is("customer_id", null);
        await linkLines(admin, w.g, (w.g.lines as ManifestRow[]).map((line) => ({ line, orderId: c.id })), how, "ai");
      }
      out.linked++; return;
    }
    const sugHow = `${AI_TAG} thinks #${c.number}: ${a.reason}`.slice(0, 500);
    await admin.from("supplier_manifest_lines").update(c.id.startsWith(PV) ? { suggest_order_id: null, suggest_archived_id: c.id.slice(PV.length), suggest_how: sugHow } : { suggest_order_id: c.id, suggest_archived_id: null, suggest_how: sugHow }).in("id", ids);
    out.suggested++;
  };
  for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map((w) => run(w).catch((e) => { out.errors.push(e instanceof Error ? e.message : String(e)); })));
  return out;
}

async function remember(admin: SupabaseClient, g: Group<Waiting>, sig: string, ans: { job: number | null; confidence: string; reason: string }, model: string, runId: string | null) {
  await admin.from("ai_suggestions").upsert({ dedupe_key: `goods-ai:${g.key}`, kind: "goods_ai", source: "ai", status: "done", title: `${g.customer_name} PO ${g.customer_po}`.slice(0, 300), body: ans.reason.slice(0, 2000), payload: { sig, ...ans, at: new Date().toISOString() }, model, run_id: runId, decided_at: new Date().toISOString(), decided_by: "ai" }, { onConflict: "dedupe_key" });
}

export const __aiTest = { score, itemsText, SYSTEM };
