import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { pdfTextServer } from "@/lib/pdfTextServer";
import { officeText } from "@/lib/officeText";
import { LOCATIONS, type Settings } from "@/lib/pricing";
import { trainingDiff, type TrainLine } from "@/lib/trainingDiff";
export type { TrainLine };

/**
 * Order training chat (Oct 30, Nick: "maybe we set those using Claude… a package that you save there and you can open,
 * and we can talk to back and forth and make little edits to"). Staff talk a customer's training through ("beanies go
 * on the cuff now", or attach a PO and say "this is how theirs read"), and Claude proposes the whole training rewritten
 * with each change marked. Nothing changes until Apply. The conversation is kept on the customer (ai_suggestions,
 * training_chat:<customer>), so anyone can open it later and keep going.
 *
 * The training is what Create order reads for every job of theirs ("HOW TO MAKE X'S ORDERS", lib/ai/emailOrder.ts), so
 * the chat sees what Create order has to go by: the training, their logos, their brands' rules and the worked examples
 * staff already checked right (lib/ai/orderExamples.ts), and can write a training from those for a customer with none.
 */
export const TRAINING_MAX = 8000;
export type TrainFile = { name: string; path: string; type: string };
export type TrainProposal = { training: string; name?: string; when?: string };
export type TrainMsg = {
  role: "staff" | "ai"; text: string; at: string; by?: string; files?: TrainFile[];
  question?: string; proposal?: TrainProposal; lines?: TrainLine[];
  status?: "open" | "applied" | "dismissed"; done_by?: string; done_at?: string;
};
export type TrainBase = { training: string; name: string; when: string };

const key = (customerId: string) => `training_chat:${customerId}`;
const MAX_IMG = 3_600_000, MAX_PDF = 24_000_000;
const imgType = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : /\.gif$/i.test(p) ? "image/gif" : null);

/** a proposed training is only the training: anything from the prompt's other parts that came along is cut off */
function cutLeaks(t: string) {
  // a line that's only a tag (</answer>, <training>) is never part of a training
  let s = t.split("\n").filter((l) => !/^\s*<\/?[a-z_]+>\s*$/i.test(l)).join("\n").replace(/<\/?training>/g, "").trim();
  const at = s.search(/\n\s*(<\/?(customer|brands|logos|worked_examples|files|training_name|used_when|conversation|staff_now_says)>|ORDERS STAFF CHECKED RIGHT|WHAT CAME IN:|THE ORDER MADE:)/);
  if (at > 0) s = s.slice(0, at).trim();
  return s;
}

async function download(admin: SupabaseClient, path: string, max: number) {
  const { data } = await admin.storage.from("proofs").download(path);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf.length > max ? null : buf;
}

export async function trainingThread(admin: SupabaseClient, customerId: string): Promise<TrainMsg[]> {
  const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", key(customerId)).limit(1).maybeSingle();
  return ((data?.payload as { messages?: TrainMsg[] } | null)?.messages || []);
}
async function saveThread(admin: SupabaseClient, customerId: string, title: string, messages: TrainMsg[], extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const last = [...messages].reverse().find((m) => m.role === "staff")?.text || "";
  const row = { kind: "training_chat", dedupe_key: key(customerId), source: "ai", status: "done", priority: 3, customer_id: customerId, title: `Order training: ${title}`.slice(0, 120), body: last.slice(0, 500), payload: { messages: messages.slice(-60), ...extra }, updated_at: now };
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", row.dedupe_key).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update(row).eq("id", had.id);
  else await admin.from("ai_suggestions").insert(row);
}

/** what Create order has to go by for this customer now */
async function current(admin: SupabaseClient, customerId: string) {
  const [{ data: c }, { data: p }, { data: bs }, { data: ds }, { data: ex }] = await Promise.all([
    admin.from("customers").select("id, company, name").eq("id", customerId).maybeSingle(),
    admin.from("customer_private").select("order_training, order_training_name, order_training_when").eq("customer_id", customerId).maybeSingle(),
    admin.from("brands").select("name, rules, notes").eq("customer_id", customerId).is("archived_at", null),
    admin.from("designs").select("number, name, inks").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("starred", { ascending: false }).order("number", { ascending: false }).limit(80),
    admin.from("order_examples").select("title, source_text, order_text, active").eq("customer_id", customerId).eq("active", true).order("confirmed_at", { ascending: false }).limit(3),
  ]);
  if (!c) return null;
  const pr = (p || {}) as { order_training?: string; order_training_name?: string; order_training_when?: string };
  return {
    name: String(c.company || c.name || "this customer"),
    saved: { training: pr.order_training || "", name: pr.order_training_name || "", when: pr.order_training_when || "" } as TrainBase,
    brands: ((bs || []) as { name: string; rules: unknown; notes: string | null }[]),
    logos: ((ds || []) as { number: number; name: string | null; inks: string | null }[]),
    examples: ((ex || []) as { title: string; source_text: string; order_text: string }[]),
  };
}

export async function trainingChat(admin: SupabaseClient, s: Settings, customerId: string, by: string, message: string, files: TrainFile[], base0?: Partial<TrainBase>): Promise<{ ok: true; messages: TrainMsg[] } | { ok: false; error: string }> {
  const msg = message.trim().slice(0, 6000);
  if (!msg && !files.length) return { ok: false, error: "Type something or attach a file." };
  const cur = await current(admin, customerId);
  if (!cur) return { ok: false, error: "Customer not found." };
  // what's on the screen (unsaved edits included) is what the change is made to
  const base: TrainBase = { training: base0?.training ?? cur.saved.training, name: base0?.name ?? cur.saved.name, when: base0?.when ?? cur.saved.when };
  const thread = await trainingThread(admin, customerId);

  // files: what's attached now, then earlier ones in this conversation (newest first)
  const documents: { data: string; label?: string }[] = [];
  const images: { media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string; label?: string }[] = [];
  const words: string[] = [], skipped: string[] = [];
  const all = [...files, ...thread.flatMap((m) => m.files || []).reverse()].filter((f, i, a) => a.findIndex((x) => x.path === f.path) === i).slice(0, 6);
  for (const f of all) {
    const pdf = /\.pdf$/i.test(f.path) || f.type === "application/pdf";
    if (pdf && documents.length < 2) {
      const b = await download(admin, f.path, MAX_PDF);
      if (b) documents.push({ data: b.toString("base64"), label: `Attached: ${f.name}` }); else skipped.push(f.name);
    } else if (pdf) {
      const b = await download(admin, f.path, MAX_PDF);
      const t = b ? await pdfTextServer(b).catch(() => "") : "";
      if (t) words.push(`File "${f.name}" words:\n${t.slice(0, 4000)}`); else skipped.push(f.name);
    } else if (imgType(f.path)) {
      const b = images.length < 6 ? await download(admin, f.path, MAX_IMG) : null;
      if (b) images.push({ media_type: imgType(f.path)!, data: b.toString("base64"), label: `Attached: ${f.name}` }); else skipped.push(f.name);
    } else if (/\.(xlsx|xlsm|docx|csv|tsv|txt)$/i.test(f.name)) {
      const b = await download(admin, f.path, MAX_PDF);
      const t = b ? officeText(f.name, f.type, b) : "";
      if (t) words.push(`File "${f.name}" words:\n${t.slice(0, 6000)}`); else skipped.push(f.name);
    } else skipped.push(f.name);
  }

  // each part in its own tags, the training last before the conversation, so the training's end is plain (Oct 30: without
  // them Claude copied the logos and examples that followed it into the training)
  const tag = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`;
  const prompt = [
    tag("customer", cur.name),
    cur.brands.length ? tag("brands", `Set on their Brand standards, not in the training:\n${cur.brands.map((b) => `${b.name} ${JSON.stringify(b.rules || {})}${b.notes ? ` · notes: ${String(b.notes).slice(0, 300)}` : ""}`).join("\n")}`) : "",
    tag("logos", cur.logos.length ? cur.logos.map((l) => `D-${l.number} "${l.name || ""}"${l.inks ? ` (${l.inks})` : ""}`).join("\n") : "none on file"),
    tag("worked_examples", cur.examples.length ? `Orders staff checked right (Create order also reads the closest of these):\n${cur.examples.map((x, i) => `--- ${i + 1}. ${x.title}\nWHAT CAME IN:\n${x.source_text.slice(0, 1500)}\nTHE ORDER MADE:\n${x.order_text.slice(0, 2500)}`).join("\n\n")}` : "none yet"),
    tag("files", `${[...documents.map((d) => d.label), ...images.map((x) => x.label)].join(" | ") || "none attached"}${skipped.length ? `\nCouldn't read: ${skipped.join(", ")}` : ""}${words.length ? `\n\n${words.join("\n\n")}` : ""}`),
    tag("training_name", base.name || "(none)"),
    tag("used_when", base.when || "(every job of theirs)"),
    tag("training", base.training || "(none yet)"),
    thread.length ? tag("conversation", thread.slice(-16).map((m) => `${m.role === "staff" ? `Staff${m.by ? ` (${m.by.split("@")[0]})` : ""}` : "You"}: ${m.text}${m.files?.length ? ` [attached ${m.files.map((f) => f.name).join(", ")}]` : ""}${m.proposal ? ` (you proposed a new training: ${m.status || "open"})` : ""}`).join("\n")) : "",
    tag("staff_now_says", msg || "(see the attached files)"),
  ].filter(Boolean).join("\n\n");

  const r = await askClaude<{ reply: string; question?: string; training?: string; name?: string; when?: string }>({
    task: "training_chat", model: s.assistant.ai.model, maxTokens: 6000, timeoutMs: 240_000, admin, images, documents,
    ctx: { customer_id: customerId, by },
    tool: { name: "answer", description: "Your reply, and the training rewritten when it should change.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, a few sentences: what you understood and what you changed (or the answer to their question). Don't paste the training; the changes are shown from it." },
      question: { type: "string", description: "One question, only when something that matters is unclear or two things disagree." },
      training: { type: "string", description: `The WHOLE training after the change: the text inside <training> with your changes made, nothing from the other tags (it replaces the saved one), at most ${TRAINING_MAX} characters. Leave it out when nothing should change.` },
      name: { type: "string", description: "A new training name, only when it should change (e.g. the end client: All My Sons)." },
      when: { type: "string", description: "New words that pick this training out of a job's subject or body, comma-separated, only when they should change (e.g. AMS, All My Sons). Empty = every job of theirs." },
    }, required: ["reply"] } },
    system: `${SHOP_CONTEXT(s)}

You're helping the shop keep a customer's ORDER TRAINING (the text in <training>): the playbook Create order (the AI that reads an email, a PO or a ClickUp job and makes the order) follows for this customer's jobs. Create order reads the training in full before every job of theirs, as "HOW TO MAKE <CUSTOMER>'S ORDERS", and it wins over its general rules. It also reads the closest worked examples (orders staff checked right). Staff talk the training through with you or attach paperwork (a PO, an order sheet, a confirmation) and you keep the training right.

Write it the way it's written now: plain sentences, short sections with a heading in capitals and a colon (JOB:, GROUPS, PRINTS, PERSONALIZATION:, PRICES:, SHIPPING, NOT STANDARD (ask):). Say exactly what to make: what to name the job, which PO number, how garments are split into groups and what each group is called, which logo by D-number on which spot (spots: ${LOCATIONS.join(", ")}) at what size, inks or threads, which garments sew or print somewhere else, personalization, pricing, goods (who supplies the blanks), shipping, and what's not standard so it asks. Use style numbers and D-numbers, not descriptions alone.
Change only what staff asked for or what the attached paperwork shows; keep everything else word for word, in the same order. When staff correct something, fix it everywhere it's said in the training. When a rule is new, put it in the section it belongs to. Don't invent rules nobody stated; when an attached PO or a worked example shows a pattern staff haven't said, you may propose it and say so in the reply.
For a customer with no training yet, write one from what staff say and from the worked examples above.
Keep it under ${TRAINING_MAX} characters. If staff only ask a question (what does it say about beanies?), answer it and leave the training out.
Brands' rules (mockups on new orders, standard mockups, dark-goods ink) are set on Brand standards, not here; when staff ask for one of those, say where it's set.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data;
  const nextT = typeof d.training === "string" ? cutLeaks(d.training).slice(0, TRAINING_MAX) : null;
  const proposal: TrainProposal | null = nextT !== null || d.name || d.when !== undefined ? {
    training: nextT ?? base.training,
    ...(d.name && d.name.trim() !== base.name ? { name: d.name.trim().slice(0, 120) } : {}),
    ...(typeof d.when === "string" && d.when.trim() !== base.when ? { when: d.when.trim().slice(0, 300) } : {}),
  } : null;
  const lines = proposal ? trainingDiff(base.training, proposal.training) : [];
  if (proposal?.name) lines.unshift({ op: "~", text: `Training name: ${proposal.name}`, old: `Training name: ${base.name || "(none)"}` });
  if (proposal?.when !== undefined) lines.unshift({ op: "~", text: `Used when the job says: ${proposal.when || "(every job of theirs)"}`, old: `Used when the job says: ${base.when || "(every job of theirs)"}` });
  const t = new Date().toISOString();
  const messages: TrainMsg[] = [...thread,
    { role: "staff", text: msg, at: t, by, ...(files.length ? { files } : {}) },
    { role: "ai", text: String(d.reply || "").slice(0, 4000), at: new Date().toISOString(),
      ...(d.question ? { question: String(d.question).slice(0, 600) } : {}),
      ...(proposal && lines.length ? { proposal, lines, status: "open" as const } : {}) },
  ];
  // a newer proposal replaces an older open one
  const lastAi = messages.length - 1;
  messages.forEach((m, i) => { if (i < lastAi && m.status === "open" && messages[lastAi].proposal) m.status = "dismissed"; });
  await saveThread(admin, customerId, cur.name, messages, { model: r.model, run_id: r.runId });
  return { ok: true, messages: messages.slice(-60) };
}

/** Apply a proposal (staff clicked Apply): saves the training on customer_private */
export async function applyTraining(admin: SupabaseClient, customerId: string, index: number, by: string): Promise<{ ok: true; messages: TrainMsg[]; saved: TrainBase } | { ok: false; error: string }> {
  const thread = (await trainingThread(admin, customerId)).slice(-60);
  const m = thread[index];
  if (!m?.proposal || m.status !== "open") return { ok: false, error: "That change isn't open any more." };
  const cur = await current(admin, customerId);
  if (!cur) return { ok: false, error: "Customer not found." };
  const saved: TrainBase = { training: m.proposal.training.slice(0, TRAINING_MAX), name: m.proposal.name ?? cur.saved.name, when: m.proposal.when ?? cur.saved.when };
  const { error } = await admin.from("customer_private").upsert({ customer_id: customerId, order_training: saved.training, order_training_name: saved.name, order_training_when: saved.when }, { onConflict: "customer_id" });
  if (error) return { ok: false, error: error.message };
  thread[index] = { ...m, status: "applied", done_by: by, done_at: new Date().toISOString() };
  await saveThread(admin, customerId, cur.name, thread);
  return { ok: true, messages: thread, saved };
}

export async function dismissTraining(admin: SupabaseClient, customerId: string, index: number, by: string) {
  const thread = (await trainingThread(admin, customerId)).slice(-60);
  if (thread[index]?.status === "open") {
    thread[index] = { ...thread[index], status: "dismissed", done_by: by, done_at: new Date().toISOString() };
    const cur = await current(admin, customerId);
    await saveThread(admin, customerId, cur?.name || "", thread);
  }
  return { ok: true as const, messages: thread };
}
