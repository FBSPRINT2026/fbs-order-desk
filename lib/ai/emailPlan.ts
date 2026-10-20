import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { newPart } from "@/lib/linkArt";
import { emailConversation, signaturePaths } from "@/lib/ai/emailOrder";
import { buildCatalog } from "@/lib/designCatalog";
import type { EOPart } from "@/lib/emailOrderShared";
import { loadMemories, memoryText } from "@/lib/ai/orderMemory";
import type { Settings } from "@/lib/pricing";

/**
 * How many orders an email holds, before any is read in full (Oct 20, Nick, about Dear Heart's "Buc-ee's Reorders +
 * Warehouse Restock": "your AI should be able to read the email and determine everything… four different reorders.
 * Three of them are exact reprints, one is a reprint of a design with new specs… you should know which orders go to
 * which by the file names… put multiple PDFs together… Fisher's going to send over mockups and ink details, and he
 * sent that in another email… multiple emails is something we need to be able to handle").
 *
 * The AI reads the whole conversation (every email in it), the names of every file in it, and the customer's designs
 * with their past orders and garments, and splits the email into orders: one per design, each a reorder of a past
 * order (the one to copy) or new, with its files and what's different. Each order is then read on its own
 * (suggestEmailOrder with `part`). Saved per email (`email:<id>:plan`) and made again when the conversation grows.
 */
type Att = { name: string; path: string; type: string; size: number };
export type EmailPlan = { parts: EOPart[]; note: string; seen: string; at: string; /** the conversation's first email: the plan and its orders are kept under it, whichever email is opened */ anchor: string };
/** the conversation's first email (convo is newest first) */
export const anchorOf = (convo: { id: string }[]) => convo[convo.length - 1].id;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "order";
/** "DH-BC-EVERY-SZN-400PCS.pdf" → 400; "…-1,110PCS.pdf" → 1110 */
const pcsOf = (name: string) => { const m = /(\d[\d,]*)\s*pcs\b/i.exec(name.replace(/_/g, ",")); return m ? +m[1].replace(/,/g, "") || 0 : 0; };

export async function planEmail(admin: SupabaseClient, activityId: string, by: string, o: { fresh?: boolean } = {}): Promise<{ ok: true; plan: EmailPlan } | { ok: false; error: string }> {
  const cv = await emailConversation(admin, activityId);
  if (!cv) return { ok: false, error: "Email not found." };
  const { convo, clicked: C } = cv;
  const seen = convo[0].occurred_at;
  const anchor = anchorOf(convo);
  const key = `email:${anchor}:plan`;
  if (!o.fresh) {
    const { data: had } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", key).maybeSingle();
    const p = had?.payload as EmailPlan | undefined;
    if (p?.seen && p.seen >= seen) return { ok: true, plan: p };
  }
  const { settings, ready, reason } = await aiState(admin);
  if (!ready) return { ok: false, error: reason };
  const cid = (convo.find((e) => e.customer_id)?.customer_id || C.customer_id) as string | null;
  // every file in the conversation (the same file sent again counts once), signatures left out
  const files: (Att & { from: string; at: string })[] = [];
  for (const e of [...convo].reverse()) {
    if (e.direction !== "in") continue;
    for (const f of (e.meta?.attachments || []) as Att[]) if (!files.some((x) => x.path === f.path || (x.name === f.name && x.size === f.size))) files.push({ ...f, from: String(e.from_email || ""), at: String(e.occurred_at).slice(0, 10) });
  }
  const sigs = await signaturePaths(admin, { id: C.id, from_email: (C.from_email as string) || null }, files, convo.map((e) => e.id)).catch(() => new Set<string>());
  const real = files.filter((f) => !sigs.has(f.path)).slice(0, 40);
  const [cat, mems] = await Promise.all([cid ? buildCatalog(admin, cid).catch(() => null) : Promise.resolve(null), loadMemories(admin, cid).catch(() => [])]);
  // the customer's designs with their recent orders and what each was printed on
  const designs = (cat?.designs || []).slice(0, 60);
  const designText = designs.map((d, i) => {
    const jobs = d.jobs.slice(0, 5).map((j) => {
      const on = d.versions.filter((v) => v.jobs.some((x) => x.ref === j.ref)).map((v) => [v.style, v.color].filter(Boolean).join(" ")).filter(Boolean);
      return `#${j.number} ${j.date} ${j.qty} pcs${on.length ? ` on ${on.join(", ")}` : ""}${j.split?.length ? " (split order)" : ""}`;
    });
    return `D${i + 1}: ${d.name}${d.names.length > 1 ? ` (ordered as: ${d.names.slice(0, 4).join(" / ")})` : ""}\n   orders: ${jobs.join("; ") || "none"}`;
  }).join("\n");
  const convText = [...convo].reverse().slice(-12).map((e) => `- ${String(e.occurred_at).slice(0, 16).replace("T", " ")} ${e.direction === "out" ? "WE wrote" : `${e.from_email} wrote`}${e.subject ? ` ("${String(e.subject).slice(0, 90)}")` : ""}:\n${newPart(String(e.body || "")).replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000)}`).join("\n\n");
  const fileText = real.map((f, i) => `F${i + 1}: ${f.name} (${f.type || "file"}, sent by ${f.from} on ${f.at})`).join("\n");

  const r = await askClaude<{ orders?: { label?: string; design?: number; kind?: string; job_number?: number; files?: number[]; changes?: string }[]; note?: string }>({
    task: "email_plan", model: settings.assistant.ai.model, maxTokens: 2000, timeoutMs: 45_000, admin,
    ctx: { activity_id: C.id, customer_id: cid, by },
    system: `${SHOP_CONTEXT(settings as Settings)}

A customer's email conversation can hold several orders. Split it into the orders to make: usually one per design (a design printed on tees, pullovers and youth is ONE order for that design, with all its garments). Customers often send one size sheet (an S&S or SanMar order confirmation, a spreadsheet) per design and per destination (e.g. one for the store, one for their warehouse): every sheet for the same design goes in that design's order. File names usually say the design, shortened ("EVERY-SZN" = In Every Season, "SHEP" = The Lord Is My Shepherd, "JESUS-CHANGES" = Jesus Changes Everything, "MAKES-WAY" = He Makes a Way); BC, WS, DH and the like are the customer's own codes for where it goes, not designs.
For each order: the design (its D number), reorder or new, the past order to copy for a reorder (job_number: the order number from the design's list, usually the most recent one that has the same garments), its files (F numbers: size sheets, mockups and art for that design, including ones sent in later emails of the conversation, e.g. a mockup for a new garment), and what's different from that past order (a new garment or color, new ink colors, new placement), taken from every email in the conversation, the latest word winning. Leave changes empty for an exact reprint.
A file that belongs to no order (a signature, an unrelated picture) is left out. Never invent orders the emails don't ask for. If the conversation is one order, return one.`,
    prompt: `Customer: ${cat?.customer || "not on file"}.

THEIR DESIGNS (with their recent orders, newest first):
${designText || "(none on file)"}

FILES IN THE CONVERSATION:
${fileText || "(none)"}

THE CONVERSATION (oldest first):
${convText}${mems.length ? `

${memoryText(mems, cat?.customer || "this customer")}` : ""}`,
    tool: { name: "orders", description: "The orders this conversation asks for.", input_schema: { type: "object", properties: {
      orders: { type: "array", items: { type: "object", properties: {
        label: { type: "string", description: 'Short name, e.g. "In Every Season (tees + pullovers)"' },
        design: { type: "number", description: "D number of the design, 0 if it's not one of theirs" },
        kind: { type: "string", enum: ["reorder", "new"] },
        job_number: { type: "number", description: "reorder: the past order number to copy (from the design's list)" },
        files: { type: "array", items: { type: "number" }, description: "F numbers of this order's files" },
        changes: { type: "string", description: "what's different from the past order, one or two sentences; empty for an exact reprint" },
      }, required: ["label", "kind", "files"] } },
      note: { type: "string", description: "anything staff should know about the split, one sentence" },
    }, required: ["orders"] } },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const raw = (r.data.orders || []).slice(0, 12);
  const used = new Set<string>();
  const parts: EOPart[] = raw.map((x, i) => {
    const d = x.design && designs[x.design - 1] ? designs[x.design - 1] : null;
    const num = String(Math.floor(+(x.job_number || 0)) || "");
    // the past order: in the design's orders (else any of theirs) by its number; a Printavo job is "a:<id>" when read
    const job = num ? (d?.jobs.find((j) => j.number === num) || (cat?.designs || []).flatMap((z) => z.jobs).find((j) => j.number === num)) : undefined;
    const ref = job ? `${job.src === "printavo" ? "a" : "o"}:${job.id}` : null;
    const fs = (x.files || []).map((n) => real[n - 1]).filter(Boolean);
    let k = slug(d?.name || x.label || `order ${i + 1}`); while (used.has(k)) k += "-2"; used.add(k);
    const pieces = fs.reduce((n, f) => n + pcsOf(f.name), 0);
    return {
      key: k, anchor, label: String(x.label || d?.name || `Order ${i + 1}`).slice(0, 80), kind: x.kind === "new" ? "new" : "reorder", of: raw.length,
      job: ref, ...(job ? { jobLabel: `#${job.number}${job.title ? ` ${job.title}` : ""}` } : {}),
      changes: String(x.changes || "").trim().slice(0, 600), files: fs.map((f) => f.path), names: fs.map((f) => f.name), ...(pieces ? { pieces } : {}),
    } as EOPart;
  }).filter((p) => p.files.length || p.job);
  const plan: EmailPlan = { parts, note: String(r.data.note || "").slice(0, 300), seen, at: new Date().toISOString(), anchor };
  await admin.from("ai_suggestions").upsert({
    kind: "email_plan", dedupe_key: key, priority: 3, source: "ai", model: r.model, run_id: r.runId, status: "done",
    customer_id: cid, activity_id: anchor, title: `${parts.length} order${parts.length === 1 ? "" : "s"} in this email`, body: parts.map((p) => p.label).join("; ").slice(0, 500), payload: plan,
  }, { onConflict: "dedupe_key" });
  return { ok: true, plan };
}
