import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { SHIRT_COLORS } from "@/lib/mockup";
import { INK_COLORS, LOCATIONS, uid, type BrandColor, type BrandPrint, type Design, type Settings } from "@/lib/pricing";
import { changeLines, cleanProposal, type BrandFile, type BrandLogo, type BrandMsg, type BrandProposal } from "@/lib/brandStandards";

/**
 * Brand standards chat (Oct 16, Nick): an admin talks a customer's brand standards through ("their navy is 289 C,
 * distressed logos are a fashion hit…"), or attaches their brand guide, and the AI proposes the setup: colors, print
 * sizes, how prints are made, which ink each logo prints in on each shirt color, and other rules in plain words.
 * Nothing changes until an admin clicks Apply. The conversation is kept on the customer (ai_suggestions, brand_chat).
 */
const key = (customerId: string) => `brand_chat:${customerId}`;
const MAX_IMG = 3_600_000, MAX_PDF = 24_000_000;
const imgType = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : /\.gif$/i.test(p) ? "image/gif" : null);

async function b64(admin: SupabaseClient, path: string, max: number) {
  const { data } = await admin.storage.from("proofs").download(path);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf.length > max ? null : buf.toString("base64");
}

export async function brandThread(admin: SupabaseClient, customerId: string): Promise<BrandMsg[]> {
  const { data } = await admin.from("ai_suggestions").select("payload").eq("dedupe_key", key(customerId)).limit(1).maybeSingle();
  return ((data?.payload as { messages?: BrandMsg[] } | null)?.messages || []);
}
async function saveThread(admin: SupabaseClient, customerId: string, title: string, messages: BrandMsg[], extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const row = { kind: "brand_chat", dedupe_key: key(customerId), source: "ai", status: "done", priority: 3, customer_id: customerId, title: `Brand standards: ${title}`.slice(0, 120), body: (messages.filter((m) => m.role === "staff").slice(-1)[0]?.text || "").slice(0, 300), payload: { messages: messages.slice(-60) }, updated_at: now, ...extra };
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", row.dedupe_key).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update(row).eq("id", had.id);
  else await admin.from("ai_suggestions").insert(row);
}

/** what's saved now: the customer, their brand colors and print standards, their logos */
async function current(admin: SupabaseClient, customerId: string) {
  const [{ data: c }, { data: ds }] = await Promise.all([
    admin.from("customers").select("id, name, company, brand_colors, brand_print").eq("id", customerId).maybeSingle(),
    admin.from("designs").select("id, number, name, inks, colors, specs, width_px, height_px, preview_path, starred").eq("customer_id", customerId).is("archived_at", null).order("starred", { ascending: false }).order("number", { ascending: false }).limit(60),
  ]);
  if (!c) return null;
  const designs = (ds || []) as (Design & { starred?: boolean })[];
  const logos: BrandLogo[] = designs.map((d) => {
    const sp = (d.specs || {}) as { distressed?: boolean; onShirts?: { shirt: string; ink: string }[] };
    return { id: d.id, number: d.number, name: d.name || "", inks: d.inks || "", distressed: !!sp.distressed, onShirts: (sp.onShirts || []).filter((x) => x.shirt && x.ink), ratio: d.width_px && d.height_px ? d.width_px / d.height_px : null };
  });
  return { c, name: String(c.company || c.name || "this customer"), colors: ((c.brand_colors || []) as BrandColor[]).filter(Boolean), print: ((c.brand_print || {}) as BrandPrint), logos, designs };
}

export async function brandChat(admin: SupabaseClient, s: Settings, customerId: string, by: string, message: string, files: BrandFile[]): Promise<{ ok: true; messages: BrandMsg[] } | { ok: false; error: string }> {
  const msg = message.trim().slice(0, 6000);
  if (!msg && !files.length) return { ok: false, error: "Type something or attach their brand guide." };
  const cur = await current(admin, customerId);
  if (!cur) return { ok: false, error: "Customer not found." };
  const thread = await brandThread(admin, customerId);

  // what to look at: files from this conversation (newest first), then their logos
  const documents: { data: string; label?: string }[] = [];
  const images: { media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string; label?: string }[] = [];
  const allFiles = [...files, ...thread.flatMap((m) => m.files || []).reverse()].filter((f, i, a) => a.findIndex((x) => x.path === f.path) === i).slice(0, 4);
  const skipped: string[] = [];
  for (const f of allFiles) {
    if (/\.pdf$/i.test(f.path) || f.type === "application/pdf") {
      const d = documents.length < 2 ? await b64(admin, f.path, MAX_PDF) : null;
      if (d) documents.push({ data: d, label: `Attached: ${f.name}` }); else skipped.push(f.name);
    } else if (imgType(f.path)) {
      const d = await b64(admin, f.path, MAX_IMG);
      if (d) images.push({ media_type: imgType(f.path)!, data: d, label: `Attached: ${f.name}` }); else skipped.push(f.name);
    } else skipped.push(f.name);
  }
  for (const d of cur.designs) {
    if (images.length >= 10) break;
    const t = d.preview_path ? imgType(d.preview_path) : null;
    if (!t) continue;
    const b = await b64(admin, d.preview_path, MAX_IMG);
    if (b) images.push({ media_type: t, data: b, label: `Their logo D-${d.number} "${d.name}"` });
  }

  const byId = new Map(cur.logos.map((l) => [l.id, l.number]));
  const now = {
    colors: cur.colors,
    sizes: (cur.print.sizes || []).map((r) => ({ which: r.which, ...(r.design_id ? { logo: byId.get(r.design_id) } : {}), location: r.location, width: r.width, ...(r.note ? { note: r.note } : {}) })),
    hit: cur.print.hit || "standard", soft: !!cur.print.soft, distressedOnly: !!cur.print.distressedOnly, rules: cur.print.rules || [],
  };
  const prompt = [
    `Customer: ${cur.name}`,
    `Their brand standards saved now (JSON): ${JSON.stringify(now)}`,
    `Their logos:\n${cur.logos.map((l) => `- D-${l.number} "${l.name}"${l.inks ? `, inks ${l.inks}` : ""}${l.ratio ? `, ${l.ratio > 1.18 ? "wide" : l.ratio < 0.85 ? "tall" : "round/square"} (w/h ${l.ratio.toFixed(2)})` : ""}${l.distressed ? ", distressed" : ""}${l.onShirts.length ? `, on shirts: ${l.onShirts.map((x) => `${x.shirt} → ${x.ink}`).join(", ")}` : ""}`).join("\n") || "none yet"}`,
    `Files attached for you to look at: ${[...documents.map((d) => d.label), ...images.map((i) => i.label)].join(" | ") || "none"}${skipped.length ? `\nCouldn't attach (too big or not a PDF/picture): ${skipped.join(", ")}` : ""}`,
    thread.length ? `\nThe conversation so far:\n${thread.slice(-16).map((m) => `${m.role === "staff" ? `Staff${m.by ? ` (${m.by})` : ""}` : "You"}: ${m.text}${m.lines?.length ? `\n  (you proposed: ${m.lines.map((l) => `${l.op} ${l.what}: ${l.text}`).join("; ")}; ${m.status === "applied" ? "staff APPLIED it" : m.status === "dismissed" ? "staff said not yet" : "not applied yet"})` : ""}${m.question ? `\n  (you asked: ${m.question})` : ""}`).join("\n")}` : "",
    `\nStaff now says: ${msg || "(see the attached files)"}`,
  ].filter(Boolean).join("\n");

  const shirts = SHIRT_COLORS.flatMap((g) => g.colors.map(([n]) => n));
  const r = await askClaude<{ reply: string; question?: string; proposal?: BrandProposal }>({
    task: "brand_chat", model: s.assistant.ai.model, maxTokens: 4000, timeoutMs: 240_000, admin, images, documents,
    ctx: { customer_id: customerId, by },
    tool: { name: "answer", description: "Your reply, and the brand standards setup you propose.", input_schema: { type: "object", properties: {
      reply: { type: "string", description: "Plain words, short: what you understood and what you'd set up. Don't list the changes; they're shown from the proposal." },
      question: { type: "string", description: "One question, only when something important is unclear or the guide and staff disagree." },
      proposal: { type: "object", description: "Only the parts that should change. Each part included REPLACES that part whole, so lists are the full list after the change (keep what's already saved unless it should go).", properties: {
        colors: { type: "array", description: "All their brand colors after the change: what they call it and the exact ink.", items: { type: "object", properties: {
          name: { type: "string", description: "Their name for it: Navy, Brewery Gold…" }, ink: { type: "string", description: "PMS as \"PMS 289 C\" / \"PMS Cool Gray 5 C\", or a stock ink name (White, Black)." }, group: { type: "string", description: "Only for a second brand or a wholesaler's client; leave out for the account's own colors." } }, required: ["name", "ink"] } },
        sizes: { type: "array", description: "All their standard print sizes after the change.", items: { type: "object", properties: {
          which: { type: "string", enum: ["round", "wide", "tall", "any", "design"], description: "Which logos: by shape, any logo, or one logo (design + logo number)." },
          logo: { type: "number", description: "The logo's number (10065 for D-10065), when which = design." },
          location: { type: "string", enum: [...LOCATIONS] }, width: { type: "number", description: "Print width in inches." }, note: { type: "string" } }, required: ["which", "location", "width"] } },
        hit: { type: "string", enum: ["standard", "fashion", "ask"], description: "How prints are made on dark shirts: standard (white underbase), fashion (no underbase, print-flash-print through one screen), or ask each time." },
        distressedOnly: { type: "boolean", description: "With fashion: only for distressed logos." },
        soft: { type: "boolean", description: "Soft hand additive in the ink." },
        rules: { type: "array", items: { type: "string" }, description: "All their other rules after the change, one short sentence each, for things no field covers (clear space, minimum size, never on red shirts, always include ®, approved shirt colors, no gradients…). Cite the guide page when it helps." },
        logos: { type: "array", description: "Per logo changes: the ink it prints in on each shirt color (the full list for that logo), and whether it's distressed.", items: { type: "object", properties: {
          number: { type: "number" }, distressed: { type: "boolean" },
          onShirts: { type: "array", items: { type: "object", properties: { shirt: { type: "string", description: "A shirt color name." }, ink: { type: "string", description: "The ink, or \"Original colors\" to keep the logo's own colors." } }, required: ["shirt", "ink"] } } }, required: ["number"] } },
      } },
    }, required: ["reply"] } },
    system: `${SHOP_CONTEXT(s)}

You're helping the shop's admin set up a customer's brand standards: the exact inks for their colors, their standard print sizes, how their prints are made, which ink each logo prints in on each shirt color, and any other rules. Staff talk it through in their own words and may attach the customer's brand guide (read it closely: color pages, logo usage, sizes, clear space, don'ts).
Turn what they say into a proposal. Staff words win over the guide; when the guide adds something staff didn't mention, include it if it matters for printing (colors, sizes, which logo on which shirt colors, don'ts) and say so in the reply.
Inks: PMS as "PMS 289 C" (coated), "PMS Cool Gray 5 C"; stock inks: ${INK_COLORS.slice(0, 40).join(", ")}…
Shirt colors (use these names): ${shirts.join(", ")}. "Heather gray" / "gray" usually means Sport Grey; ask if it matters.
Locations: ${LOCATIONS.join(", ")} ("nape" = Upper Back (Yoke)).
Logo shapes: round = about as tall as wide; a size rule for one logo wins over its shape, its shape over "any".
When a rule applies to "the logos" in general, set it on each of their logos it fits. Don't invent standards nobody stated. If nothing should change yet, leave the proposal out and just answer.
Keep the reply to a few sentences, no headings.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const proposal = r.data.proposal ? cleanProposal(r.data.proposal, cur.logos) : null;
  const lines = proposal ? changeLines(cur, proposal) : [];
  const t = new Date().toISOString();
  const messages: BrandMsg[] = [...thread,
    { role: "staff", text: msg, at: t, by, ...(files.length ? { files } : {}) },
    { role: "ai", text: String(r.data.reply || "").slice(0, 4000), at: new Date().toISOString(),
      ...(r.data.question ? { question: String(r.data.question).slice(0, 600) } : {}),
      ...(proposal && lines.length ? { proposal, lines, status: "open" as const } : {}) },
  ];
  // a newer proposal replaces an older open one
  const lastAi = messages.length - 1;
  messages.forEach((m, i) => { if (i < lastAi && m.status === "open" && messages[lastAi].proposal) m.status = "dismissed"; });
  await saveThread(admin, customerId, cur.name, messages, { model: r.model, run_id: r.runId });
  return { ok: true, messages: messages.slice(-60) };
}

/** Apply a proposal (an admin clicked Apply): customers.brand_colors / brand_print and the logos' specs. */
export async function applyBrand(admin: SupabaseClient, customerId: string, index: number, by: string): Promise<{ ok: true; messages: BrandMsg[] } | { ok: false; error: string }> {
  const thread = (await brandThread(admin, customerId)).slice(-60);
  const m = thread[index];
  if (!m?.proposal || m.status !== "open") return { ok: false, error: "That proposal isn't open any more." };
  const cur = await current(admin, customerId);
  if (!cur) return { ok: false, error: "Customer not found." };
  const p = cleanProposal(m.proposal, cur.logos);
  const byNum = new Map(cur.logos.map((l) => [l.number, l]));
  const upd: Record<string, unknown> = {};
  if (p.colors) upd.brand_colors = p.colors;
  if (p.sizes || p.hit || p.soft !== undefined || p.distressedOnly !== undefined || p.rules) {
    upd.brand_print = {
      ...cur.print,
      ...(p.sizes ? { sizes: p.sizes.map((s) => ({ id: uid(), which: s.which, ...(s.which === "design" ? { design_id: byNum.get(s.logo!)?.id } : {}), location: s.location, width: s.width, ...(s.note ? { note: s.note } : {}) })) } : {}),
      ...(p.hit ? { hit: p.hit } : {}), ...(p.soft !== undefined ? { soft: p.soft } : {}), ...(p.distressedOnly !== undefined ? { distressedOnly: p.distressedOnly } : {}),
      ...(p.rules ? { rules: p.rules } : {}),
    } satisfies BrandPrint;
  }
  if (Object.keys(upd).length) {
    const { error } = await admin.from("customers").update(upd).eq("id", customerId);
    if (error) return { ok: false, error: error.message };
  }
  for (const l of p.logos || []) {
    const d = cur.designs.find((x) => x.number === l.number);
    if (!d) continue;
    const specs = { ...((d.specs || {}) as Record<string, unknown>), ...(l.onShirts ? { onShirts: l.onShirts } : {}), ...(l.distressed !== undefined ? { distressed: l.distressed || undefined } : {}) };
    const { error } = await admin.from("designs").update({ specs }).eq("id", d.id);
    if (error) return { ok: false, error: `D-${d.number}: ${error.message}` };
  }
  thread[index] = { ...m, status: "applied", done_by: by, done_at: new Date().toISOString() };
  await saveThread(admin, customerId, cur.name, thread);
  return { ok: true, messages: thread };
}

export async function dismissBrand(admin: SupabaseClient, customerId: string, index: number, by: string) {
  const thread = (await brandThread(admin, customerId)).slice(-60);
  if (!thread[index] || thread[index].status !== "open") return { ok: true as const, messages: thread };
  thread[index] = { ...thread[index], status: "dismissed", done_by: by, done_at: new Date().toISOString() };
  const cur = await current(admin, customerId);
  await saveThread(admin, customerId, cur?.name || "", thread);
  return { ok: true as const, messages: thread };
}
