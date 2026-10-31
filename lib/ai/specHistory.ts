import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { asList, orderBrief } from "@/lib/ai/reorderCheck";
import { LOCATIONS, type Settings } from "@/lib/pricing";
import { latestSpecs, type DesignSpecs } from "@/lib/designSpecs";
import { designEmails } from "@/lib/designMail";
import type { MailAccount } from "@/lib/mail/config";
import { allRows } from "@/lib/readAll";

/**
 * Spec history (Oct 14, Nick: "any time we place a reorder, scan everything: every email about this design, the text
 * messages, the pictures… if I texted her a photo of the placement and she said 'looks great', that trumps the
 * original email because it's later; logically conclude what the specs should be"). For a reorder, the AI reads
 * everything we have about the design, oldest first:
 *  - every old Printavo job of this customer that mentions it: the print details, notes and the job's emails, and
 *    its mockups (pictures, dated);
 *  - every email with the customer that mentions it: the whole mailbox through Exchange's search (every year), the
 *    portal's copy and emails kept in the portal (lib/designMail.ts), and the pictures on kept emails;
 *  - the customer's other portal orders of it, and what production confirmed (designs.specs);
 *  - text messages, once the Mac is linked (not yet).
 * It returns, for each print on the new order, a dated timeline with the exact words, and what the latest decision
 * says (later beats earlier; what was printed or confirmed beats what was discussed). It's a GUESS with evidence:
 * nothing goes on the order until staff use it, and production still confirms.
 */
export type SpecEvidence = { date: string; source: "email" | "text" | "printavo" | "photo" | "order" | "production" | "film"; who: string; quote: string; says: string };
export type PrintSpecs = {
  imprint_id: string; location: string; size: string; drop: string; inks: string; colors: number; underbase: "yes" | "no" | "";
  confidence: "high" | "medium" | "low"; reasoning: string; evidence: SpecEvidence[]; conflicts: string[];
};
export type SpecHistory = { summary: string; prints: PrintSpecs[]; searched: string; keywords: string[]; at: string; model?: string };

const STOP = new Set("shirt shirts tees tee tshirt tshirts hoodie hoodies reprint reprints reorder order orders print prints printing front back left right chest sleeve full color colors youth adult with from the and for new old again same more please thanks thank your shirt's design designs logo".split(" "));
const MAX_IMG = 3_600_000;
const imgType = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : null);

/** the words that name the design ("Mewjira shirts REPRINTS" → mewjira) */
export function designWords(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const w of String(t || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/)) {
    const x = w.replace(/'s$/, "").replace(/'/g, "");
    if (x.length >= 4 && !STOP.has(x) && !/^\d+$/.test(x)) out.add(x);
  }
  return [...out].slice(0, 6);
}

async function pic(admin: SupabaseClient, path: string) {
  const t = imgType(path);
  if (!t) return null;
  let { data } = await admin.storage.from("proofs").download(path, { transform: { width: 1100, height: 1100, resize: "contain", quality: 75 } });
  if (!data) ({ data } = await admin.storage.from("proofs").download(path));
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > MAX_IMG) return null;
  // the transform answers JPEG/WebP whatever the file's name
  const head = buf.subarray(0, 4).toString("hex");
  const media_type = head.startsWith("89504e47") ? "image/png" : head.startsWith("ffd8") ? "image/jpeg" : head.startsWith("52494646") ? "image/webp" : t;
  return { media_type: media_type as "image/png" | "image/jpeg" | "image/webp", data: buf.toString("base64") };
}

export async function specHistory(admin: SupabaseClient, s: Settings, orderId: string, by: string, acct: MailAccount | null = null): Promise<{ ok: true; history: SpecHistory } | { ok: false; error: string }> {
  const b = await orderBrief(admin, orderId);
  if (!b.ok) return b;
  const { o, ims } = b;
  if (!o.customer_id) return { ok: false, error: "The order has no customer yet." };
  const ref = String(o.notes || "").match(/Reorder of (Printavo )?#(\d+)/);
  const dIds = [...new Set(ims.map((i) => i.design_id).filter(Boolean))] as string[];
  const { data: dsgs } = dIds.length ? await admin.from("designs").select("name").in("id", dIds) : { data: [] as { name: string }[] };
  let oldNick = "";
  if (ref?.[1]) { const { data: a } = await admin.from("archived_orders").select("nickname").eq("visual_id", ref[2]).maybeSingle(); oldNick = a?.nickname || ""; }
  const words = designWords(o.nickname, oldNick, ...(dsgs || []).map((d) => d.name));
  if (!words.length) return { ok: false, error: "Couldn't tell the design's name from the order. Give the order a nickname with the design's name." };
  const hit = (t: string | null | undefined) => { const x = String(t || "").toLowerCase(); return words.some((w) => x.includes(w)); };

  const lines: string[] = [];
  const images: { media_type: "image/png" | "image/jpeg" | "image/webp"; data: string; label: string }[] = [];
  const counts = { jobs: 0, emails: 0, kept: 0, orders: 0, pics: 0, confirmed: 0, texts: 0 };

  // 1. old Printavo jobs that mention the design (their details, notes, emails and mockups)
  const { data: arch } = await admin.from("archived_orders").select("id, visual_id, nickname, order_date, search_text").eq("customer_id", o.customer_id).order("order_date", { ascending: true }).limit(1000);
  const jobs = (arch || []).filter((a) => hit(a.nickname) || hit(a.search_text)).slice(-14);
  for (const j of jobs) {
    const { data: a } = await admin.from("archived_orders").select("data, files").eq("id", j.id).maybeSingle();
    const d = (a?.data || {}) as { groups?: { lines?: { description?: string; color?: string; items?: number }[]; imprints?: { details?: string; typeOfWork?: string }[] }[]; productionNote?: string; customerNote?: string; messages?: { at?: string; incoming?: boolean; subject?: string; text?: string; from?: string }[] };
    counts.jobs++;
    lines.push(`PRINTAVO JOB #${j.visual_id} "${j.nickname || ""}" (ordered ${j.order_date || "?"})`);
    for (const g of d.groups || []) {
      for (const l of g.lines || []) lines.push(`  Garment: ${l.description || "?"}, ${l.color || ""}, ${l.items ?? "?"} pcs`);
      for (const im of g.imprints || []) lines.push(`  Print: ${im.typeOfWork || ""} ${im.details || ""}`.replace(/\s+/g, " ").trim());
    }
    if (d.productionNote) lines.push(`  Production note: ${d.productionNote.replace(/\s+/g, " ").slice(0, 600)}`);
    if (d.customerNote) lines.push(`  Customer note: ${d.customerNote.replace(/\s+/g, " ").slice(0, 400)}`);
    for (const m of (d.messages || []).filter((x) => (x.text || "").trim()).sort((x, y) => String(x.at || "").localeCompare(String(y.at || "")))) {
      lines.push(`  Email ${String(m.at || "").slice(0, 10)} ${m.incoming ? `from the customer${m.from ? ` (${m.from})` : ""}` : "from the shop"}: ${m.subject ? `"${m.subject}" ` : ""}${(m.text || "").replace(/\s+/g, " ").slice(0, 700)}`);
    }
    // its mockups / photos (newest jobs first get the picture budget)
    const files = Object.values((a?.files || {}) as Record<string, string>).filter((p) => imgType(p));
    (j as { _files?: string[] })._files = files;
  }
  for (const j of [...jobs].reverse()) {
    for (const p of ((j as { _files?: string[] })._files || []).slice(0, 2)) {
      if (images.length >= 8) break;
      const im = await pic(admin, p);
      if (im) { images.push({ ...im, label: `Mockup/picture on Printavo job #${j.visual_id} (${j.order_date || "?"})` }); counts.pics++; }
    }
  }

  // 2. every email with the customer about it: the whole mailbox (every year), the portal's copy, emails kept here
  const { data: cust } = await admin.from("customers").select("email, company, name").eq("id", o.customer_id).maybeSingle();
  const found = await designEmails(admin, acct, o.customer_id, words);
  for (const m of found.emails.slice(-40)) {
    counts.emails++;
    lines.push(`EMAIL ${m.date.slice(0, 10)} ${m.incoming ? `from ${m.from} (the customer)` : `from ${m.from} (the shop)`}: "${m.subject}" ${m.text.replace(/\s+/g, " ").slice(0, 1200)}`);
  }

  // 3. emails kept in the portal (with their pictures)
  const { data: acts } = await admin.from("activities").select("occurred_at, direction, subject, body, from_email, meta").eq("customer_id", o.customer_id).order("occurred_at", { ascending: true }).limit(400);
  for (const a of (acts || []).filter((x) => hit(x.subject) || hit(x.body)).slice(-15)) {
    const att = (((a.meta || {}) as { attachments?: { path?: string; name?: string; signature?: boolean }[] }).attachments || []).filter((f) => f.path && imgType(f.path) && !f.signature);
    for (const f of att.slice(0, 2)) {
      if (images.length >= 12) break;
      const im = await pic(admin, f.path!);
      if (im) { images.push({ ...im, label: `Picture on the email of ${String(a.occurred_at).slice(0, 10)} ${a.direction === "in" ? "from the customer" : "from the shop"} ("${a.subject || ""}"): ${f.name || ""}` }); counts.pics++; }
    }
  }

  // 3b. texts with them (the Mac, Oct 15: "Gateway approved the placement photo by text"): the ones that name the
  // design, and pictures sent within two days of those
  const { data: tx } = await allRows((r0, r1) => admin.from("text_messages").select("from_me, body, sent_at, files").eq("customer_id", o.customer_id).order("sent_at").order("id").range(r0, r1), 3000);
  const texts = (tx || []) as { from_me: boolean; body: string; sent_at: string; files: { path: string; name: string }[] }[];
  const named = texts.filter((t) => hit(t.body)).map((t) => Date.parse(t.sent_at));
  for (const t of texts) {
    const at = Date.parse(t.sent_at), nearby = named.some((n) => Math.abs(n - at) < 2 * 864e5);
    if (!hit(t.body) && !nearby) continue;
    counts.texts++;
    lines.push(`TEXT ${t.sent_at.slice(0, 16).replace("T", " ")} ${t.from_me ? "from the shop" : "from the customer"}: ${t.body.replace(/\s+/g, " ").slice(0, 800) || "(picture only)"}`);
    for (const f of (t.files || []).filter((x) => imgType(x.path)).slice(0, 2)) {
      if (images.length >= 16) break;
      const im = await pic(admin, f.path);
      if (im) { images.push({ ...im, label: `Picture in a text of ${t.sent_at.slice(0, 10)} ${t.from_me ? "from the shop" : "from the customer"}` }); counts.pics++; }
    }
  }

  // 4. the customer's other portal orders of it, and what production confirmed
  const { data: prev } = await admin.from("orders").select("id, number, nickname, created_at, groups, notes").eq("customer_id", o.customer_id).neq("id", o.id).order("created_at", { ascending: true }).limit(200);
  for (const p of (prev || []).filter((x) => hit(x.nickname) || hit(x.notes)).slice(-6)) {
    counts.orders++;
    const ps = ((p.groups || []) as { imprints?: { location?: string; size?: string; drop?: string; inks?: string; colors?: number; confirmed?: { by: string; at: string } }[] }[]).flatMap((g) => g.imprints || []);
    lines.push(`PORTAL ORDER #${p.number} "${p.nickname || ""}" (${String(p.created_at).slice(0, 10)}): ${ps.map((im) => `${im.location}: ${[im.size, im.drop ? `${im.drop}" drop` : "", im.inks, `${im.colors} colors`].filter(Boolean).join(", ")}${im.confirmed ? ` (PRODUCTION CONFIRMED ${im.confirmed.at.slice(0, 10)} by ${im.confirmed.by})` : ""}`).join("; ")}`);
    const { data: ev } = await admin.from("order_events").select("detail, created_at").eq("order_id", p.id).in("kind", ["details", "edited"]).order("created_at").limit(10);
    for (const e of ev || []) if (/confirm|press|size|ink|placement|location/i.test(e.detail || "")) lines.push(`  ${String(e.created_at).slice(0, 10)}: ${String(e.detail).slice(0, 400)}`);
  }
  const { data: allD } = await admin.from("designs").select("name, specs").eq("customer_id", o.customer_id).not("specs->history", "is", null).limit(200);
  for (const d of (allD || []).filter((x) => hit(x.name)) as { name: string; specs: DesignSpecs }[]) for (const e of latestSpecs(d.specs)) {
    counts.confirmed++;
    lines.push(`PRODUCTION CONFIRMED ${e.at.slice(0, 10)} by ${e.by} on #${e.order_number} (design "${d.name}"): ${e.location}, ${e.size || "size blank"}, ${e.drop ? `${e.drop}" drop, ` : ""}${e.inks || "inks blank"}, ${e.colors} colors${e.underbase === true ? ", underbase" : e.underbase === false ? ", no underbase" : ""}`);
  }

  const searched = [`${counts.jobs} old Printavo job${counts.jobs === 1 ? "" : "s"}`, `${counts.emails} email${counts.emails === 1 ? "" : "s"}${found.wholeMailbox ? " (whole mailbox)" : ""}`, `${counts.pics} picture${counts.pics === 1 ? "" : "s"}`, ...(counts.texts ? [`${counts.texts} text${counts.texts === 1 ? "" : "s"}`] : []), counts.orders ? `${counts.orders} portal order${counts.orders === 1 ? "" : "s"}` : "", counts.confirmed ? `${counts.confirmed} production confirmation${counts.confirmed === 1 ? "" : "s"}` : "", "text messages: not linked yet"].filter(Boolean).join(", ");
  const prompt = [
    b.text, "",
    `EVERYTHING WE HAVE ABOUT THIS DESIGN (customer ${cust?.company || cust?.name || ""}; searched for: ${words.join(", ")}), oldest first:`,
    ...(lines.length ? lines : ["(nothing found beyond the order itself)"]),
    "", `Pictures attached (in this order): ${images.map((i, n) => `[${n + 1}] ${i.label}`).join(" | ") || "none"}`,
  ].join("\n").slice(0, 120_000);

  const r = await askClaude<{ summary: string; prints: PrintSpecs[] }>({
    task: "spec_history", model: s.assistant.ai.model, maxTokens: 5000, timeoutMs: 240_000, admin,
    images: [...b.images.slice(0, 4), ...images].slice(0, 16), documents: b.documents.slice(0, 2),
    ctx: { order_id: orderId, customer_id: o.customer_id, by },
    tool: { name: "spec_history", description: "What the history says each print's specs are, with the evidence.", input_schema: { type: "object", properties: {
      summary: { type: "string", description: "Two or three sentences: what you found and the most important change over time, if any" },
      prints: { type: "array", items: { type: "object", properties: {
        imprint_id: { type: "string", description: "The print id on the NEW order" },
        location: { type: "string", description: `One of: ${LOCATIONS.join(", ")}; blank if unknown` },
        size: { type: "string", description: 'Print width like 11" wide; blank if the history doesn\'t say or show it' },
        drop: { type: "string", description: "Inches below the collar; blank if unknown" },
        inks: { type: "string", description: "Comma separated, PMS numbers when known (e.g. PMS 234 C, Black); blank if unknown" },
        colors: { type: "integer", description: "Number of ink colors; 0 if unknown" },
        underbase: { type: "string", enum: ["yes", "no", ""] },
        confidence: { type: "string", enum: ["high", "medium", "low"], description: "high = stated or confirmed and never changed later; medium = shown in a picture or implied; low = little to go on" },
        reasoning: { type: "string", description: "One to three sentences: how you concluded it, which later evidence overrode what" },
        evidence: { type: "array", description: "Every piece of evidence about this print, OLDEST FIRST", items: { type: "object", properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          source: { type: "string", enum: ["email", "text", "printavo", "photo", "order", "production", "film"] },
          who: { type: "string", description: "Who said or sent it (the customer's name, Nick, production, Printavo job #)" },
          quote: { type: "string", description: "Their exact words (25 words at most), or for a picture what it shows" },
          says: { type: "string", description: "What it means for the specs, e.g. 'ink PMS 231 → 234'" },
        }, required: ["date", "source", "who", "quote", "says"] } },
        conflicts: { type: "array", items: { type: "string" }, description: "Disagreements production should look at" },
      }, required: ["imprint_id", "location", "size", "drop", "inks", "colors", "underbase", "confidence", "reasoning", "evidence", "conflicts"] } },
    }, required: ["summary", "prints"] } },
    system: `${SHOP_CONTEXT(s)}

Your job: a customer is REORDERING a design. Read everything we have about this design, in date order, and work out how each print on the new order should be printed: location and placement, print width, drop, inks (PMS when known), number of colors, underbase.
Rules:
- Build a timeline. LATER beats EARLIER: if the first email said PMS 231 and a later email or text says "let's do 234", it's 234. A customer approving a photo or mockup ("looks great") makes what that picture shows the decision, as of that date.
- What was actually printed or confirmed by production beats what was only discussed. A production confirmation is the strongest evidence.
- Pictures: say what you see (where the print sits, roughly how wide relative to the garment, the ink colors) and date it by its label. An adult L shirt's chest is about 22" wide.
- Only use evidence that is about THIS design. Other designs of the same customer don't count.
- Never invent. If the history doesn't say something, leave that field blank (colors 0) and say so in the reasoning. Quote exact words; keep quotes short.
- One entry per print id on the new order. Flag conflicts (two later sources disagree, or the reorder's current guess disagrees with the history).`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const ids = new Set(ims.map((i) => i.id));
  const history: SpecHistory = { summary: r.data.summary || "", prints: asList<SpecHistory["prints"][number]>(r.data.prints).filter((p) => ids.has(p.imprint_id)), searched, keywords: words, at: new Date().toISOString(), model: r.model };
  const row = { kind: "spec_history", dedupe_key: `spec_history:${orderId}`, source: "ai", status: "done", priority: 2, order_id: orderId, customer_id: o.customer_id, title: `Spec history #${o.number}`, body: history.summary, payload: history, model: r.model, run_id: r.runId, updated_at: history.at };
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", row.dedupe_key).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update(row).eq("id", had.id);
  else await admin.from("ai_suggestions").insert(row);
  return { ok: true, history };
}
