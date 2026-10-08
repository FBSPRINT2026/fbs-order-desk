import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { normSize, proposalToGroups, type ProposedOrder } from "@/lib/ai/normalize";
import { refetchAttachments } from "@/lib/mail/imap";
import { officeText } from "@/lib/officeText";
import { mergeProduction, needsForPrintavo } from "@/lib/production";
import { LOCATIONS, newGLine, newImprint, orderGroups, SIZES, uid, type GLine, type Group, type Imprint, type Order, type Settings } from "@/lib/pricing";
import { bodyOf, smallestOrdered } from "@/lib/garmentBody";
import { maxWidthFor } from "@/lib/mockup";
import { correction, LESSON_KIND, type MockupLesson } from "@/lib/mockupLessons";
import { isPicture, looksLikeSignature, type EODraft, type EOFile, type PastJob } from "@/lib/emailOrderShared";

/**
 * "Create order" from a customer email. The AI reads the email AND its attachments (pictures and PDFs it looks at,
 * spreadsheets and Word files as text) with what we know about the customer (wholesale or not, their past jobs),
 * decides whether it's a new order or a reorder of a past job, and fills in the order for staff to check in the
 * Inbox. Nothing is created until staff press Create order (lib/emailOrderCreate.ts). Never sets prices.
 */

type Att = { name: string; path: string; type: string; size: number };
type AiFile = { file: number; role: "art" | "mockup" | "size_breakdown" | "signature" | "other"; what?: string };
type PGroup = NonNullable<ProposedOrder["groups"]>[number];
type AiGroup = Omit<PGroup, "garments" | "prints"> & {
  garments?: (NonNullable<PGroup["garments"]>[number] & { reorder_line?: number | null })[];
  prints?: (NonNullable<PGroup["prints"]>[number] & { art_file?: number | null; width_in?: number | null; drop_in?: number | null })[];
  mockup_files?: number[]; finishing?: string[];
};
type AiOrder = Omit<ProposedOrder, "groups"> & {
  kind: "new" | "reorder"; reorder_of?: number | null; summary?: string;
  garments_supplied_by?: "customer" | "shop" | "unknown";
  goods?: { supplier?: string; expected?: string; note?: string };
  files?: AiFile[];
  groups?: AiGroup[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const lineSizes = (l: GLine) => SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => `${z} ${l.sizes[z]}`).join(", ");
const qtyOf = (gs: Group[]) => gs.reduce((a, g) => a + g.lines.reduce((b, l) => b + Object.values(l.sizes || {}).reduce((c, v) => c + (+v || 0), 0), 0), 0);

// ---------- the customer's past jobs (what a reorder copies) ----------

type PvRow = { id: string; visual_id: string | number | null; nickname: string | null; qty: number | null; status_name: string; order_date: string | null; files: Record<string, string> | null;
  data: { groups?: { lines?: { itemNumber?: string; brand?: string; color?: string; description?: string; items?: number | null; category?: string | null; sizes?: Record<string, number>; mockups?: { full?: string; mime?: string }[] }[] | null; imprints?: { column?: string; details?: string; typeOfWork?: string }[] | null }[] } | null };

/** a Printavo invoice's groups in the portal's order format: garments, sizes, print locations and colors, mockups */
export function groupsFromPrintavo(row: PvRow, prodData: unknown): Group[] {
  const ps = mergeProduction(prodData);
  const out: Group[] = [];
  for (const g of row.data?.groups || []) {
    const lines: GLine[] = [];
    const mockups: { path: string; name: string }[] = [], pdfs: { path: string; name: string }[] = [];
    for (const pl of g.lines || []) {
      const l = newGLine();
      l.style = (pl.itemNumber || "").trim().slice(0, 40);
      l.brand = (pl.brand || "").trim().slice(0, 40);
      l.color = (pl.color || "").trim().slice(0, 60);
      l.garment = (pl.description || "").split(/\r?\n/)[0].replace(new RegExp(`^${(pl.brand || "").replace(/[^\w ]/g, ".")}\\s*-?\\s*`, "i"), "").trim().slice(0, 120);
      // older Printavo jobs often have the garment only in the description ("Next level 6210 - Forest Green")
      if (!l.style || !l.color) {
        for (const ln of (pl.description || "").split(/\r?\n/).slice(1, 6)) {
          const m = ln.trim().match(/^(.*?)\b([A-Za-z]{0,4}\d{3,5}[A-Za-z]{0,4})\s*[-–:]\s*(.+)$/);
          if (!m) continue;
          if (!l.style) l.style = m[2].slice(0, 40);
          if (!l.brand && m[1].trim()) l.brand = m[1].trim().slice(0, 40);
          if (!l.color) l.color = m[3].trim().slice(0, 60);
          break;
        }
      }
      for (const [k, q] of Object.entries(pl.sizes || {})) { const z = normSize(k); const n = Math.floor(+q || 0); if (z && n > 0) l.sizes[z] = (l.sizes[z] || 0) + n; }
      if (!Object.keys(l.sizes).length && !(pl.items || 0)) continue;
      if (!Object.keys(l.sizes).length && pl.items) { l.sizes.OS = Math.floor(+pl.items); l.oneSize = true; }
      lines.push(l);
      for (const m of pl.mockups || []) {
        const p = m.full ? row.files?.[m.full] : "";
        if (p && /\.(png|jpe?g|gif|webp)$/i.test(p)) mockups.push({ path: p, name: `Printavo #${row.visual_id} mockup` });
        // our old Illustrator mockup sheets: the art is pulled out of them when the reorder is made
        else if (p && /\.pdf$/i.test(p)) pdfs.push({ path: p, name: `Printavo #${row.visual_id} mockup.pdf` });
      }
    }
    if (!lines.length) continue;
    const steps = needsForPrintavo(ps, { qty: row.qty, status_name: row.status_name || "", nickname: row.nickname || "", data: { groups: [g as never] } }).flatMap((n) => n.steps);
    const imprints: Imprint[] = steps.map((st) => {
      // Printavo's sides ("Front", "Back") as our locations: the art pulled from the mockup refines them
      const loc = /^front$/i.test(st.location || "") ? "Full Front" : /^back$/i.test(st.location || "") ? "Full Back" : st.location || "Full Front";
      const im = newImprint(LOCATIONS.includes(loc) ? loc : "Full Front");
      im.method = st.method === "embroidery" ? "embroidery" : st.method === "heat" ? "dtf" : "screen";
      im.colors = Math.max(1, st.colors || 1);
      im.notes = `From Printavo #${row.visual_id}${st.note ? ` (${st.note})` : ""}`;
      // Printavo didn't keep the print size or ink: production confirms them before printing
      im.confirm = { size: true, ink: true, why: `Reorder of Printavo #${row.visual_id}, which has no size or ink on file` };
      return im;
    });
    out.push({ id: uid(), lines, imprints, customerMockups: mockups.slice(0, 6), ...(pdfs.length ? { pvArt: [...new Map(pdfs.map((x) => [x.path, x])).values()].slice(0, 3) } : {}) });
  }
  return out;
}

/** a portal order copied: new ids, same garments, prints (and their designs), finishing and mockups */
function groupsFromOrder(o: Order): Group[] {
  return orderGroups(o).map((g) => ({
    id: uid(), name: g.name, youth: g.youth, finishing: g.finishing || [],
    lines: g.lines.map((l) => ({ ...l, id: uid(), cost: "" as const, priceOverride: null })),
    imprints: g.imprints.map((d) => ({ ...d, id: uid() })),
    customerMockups: g.customerMockups || [], mockupThumbs: g.mockupThumbs, mockupAt: g.mockupAt,
  }));
}

export async function pastJobs(admin: SupabaseClient, customerId: string | null): Promise<PastJob[]> {
  if (!customerId) return [];
  const [{ data: os }, { data: as }, { data: st }] = await Promise.all([
    admin.from("orders").select("id, number, nickname, status, created_at, groups, lines").eq("customer_id", customerId).not("status", "in", "(request)").order("created_at", { ascending: false }).limit(12),
    admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, order_date, files, data").eq("customer_id", customerId).eq("kind", "invoice").order("order_date", { ascending: false, nullsFirst: false }).limit(15),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
  ]);
  const prod = (st?.data as { production?: unknown } | null)?.production;
  const jobs: PastJob[] = [];
  for (const o of (os || []) as (Order & { created_at: string })[]) {
    const groups = groupsFromOrder(o);
    if (!groups.some((g) => g.lines.some((l) => l.style || l.color))) continue;
    jobs.push({ ref: `o:${o.id}`, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, date: (o.created_at || "").slice(0, 10), qty: qtyOf(groups), groups });
  }
  for (const r of (as || []) as PvRow[]) {
    const groups = groupsFromPrintavo(r, prod);
    if (!groups.length) continue;
    jobs.push({ ref: `a:${r.id}`, label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "", qty: r.qty || qtyOf(groups), groups, note: "Printavo job: its art is in the job's files on the archive page." });
  }
  return jobs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
}

/** the past jobs as the AI reads them: J numbers, and L numbers for every garment line */
function jobsText(jobs: PastJob[]) {
  return jobs.map((j, ji) => {
    let n = 0;
    const lines = j.groups.flatMap((g) => [
      ...g.lines.map((l) => `   L${++n}: ${[l.brand, l.style, l.garment].filter(Boolean).join(" ") || "(no style)"}, ${l.color || "no color"}: ${lineSizes(l) || "no sizes"}`),
      `   prints: ${g.imprints.map((d) => `${d.location} ${d.method === "screen" ? `${d.colors} color${d.colors === 1 ? "" : "s"}` : d.method}${d.inks ? ` (${d.inks})` : ""}`).join("; ") || "none listed"}${g.finishing?.length ? `; finishing ${g.finishing.join(", ")}` : ""}`,
    ]);
    return `J${ji + 1}: ${j.label}, ${j.date}, ${j.qty} pcs\n${lines.join("\n")}`;
  }).join("\n");
}

// ---------- the attachments ----------

/**
 * The sender's email signature pictures: nameless small pictures, and pictures that came on their other emails too
 * (same name and size within 3%). They're listed for the AI as signatures and never shown to it or used as art.
 */
async function signaturePaths(admin: SupabaseClient, a: { id: string; from_email: string | null }, atts: Att[]): Promise<Set<string>> {
  const out = new Set(atts.filter((f) => looksLikeSignature(f)).map((f) => f.path));
  const pics = atts.filter((f) => isPicture(f) && !out.has(f.path));
  const dom = String(a.from_email || "").split("@")[1];
  if (!pics.length || !dom) return out;
  const { data } = await admin.from("activities").select("id, meta").ilike("from_email", `%@${dom}`).neq("id", a.id).order("occurred_at", { ascending: false }).limit(40);
  const seen = (data || []).flatMap((r) => ((r.meta as { attachments?: Att[] })?.attachments || []));
  for (const f of pics) if (seen.some((x) => x.name === f.name && Math.abs((x.size || 0) - f.size) <= f.size * 0.03)) out.add(f.path);
  return out;
}

async function readFiles(admin: SupabaseClient, atts: Att[], sigs: Set<string> = new Set()) {
  const images: { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string; label: string }[] = [];
  const documents: { data: string; label: string }[] = [];
  const listing: string[] = [];
  let budget = 18 * 1024 * 1024;
  for (const [i, a] of atts.slice(0, 12).entries()) {
    const n = i + 1, tag = `File ${n}: "${a.name}"`;
    if (sigs.has(a.path)) { listing.push(`${tag} (the sender's email signature picture: role signature, ignore it)`); continue; }
    const pic = isPicture(a), pdf = /pdf/i.test(a.type) || /\.pdf$/i.test(a.name);
    const text = /\.(xlsx|xlsm|docx|csv|tsv|txt)$/i.test(a.name) || /spreadsheetml|wordprocessingml|^text\//i.test(a.type);
    if (!pic && !pdf && !text) { listing.push(`${tag} (${a.type || "file"}, can't be opened here; judge it by its name)`); continue; }
    if ((pic && (a.size > 3.7 * 1024 * 1024 || images.length >= 8)) || (pdf && a.size > 15 * 1024 * 1024) || a.size > budget) { listing.push(`${tag} (too big to look at here)`); continue; }
    const { data } = await admin.storage.from("proofs").download(a.path);
    if (!data) { listing.push(`${tag} (couldn't be opened)`); continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    budget -= buf.length;
    if (pic) {
      const t = /png/i.test(a.type) || /\.png$/i.test(a.name) ? "image/png" : /gif/i.test(a.type) ? "image/gif" : /webp/i.test(a.type) ? "image/webp" : "image/jpeg";
      images.push({ media_type: t, data: buf.toString("base64"), label: `${tag} (picture):` });
      listing.push(`${tag} (picture, shown above)`);
    } else if (pdf) {
      documents.push({ data: buf.toString("base64"), label: `${tag} (PDF):` });
      listing.push(`${tag} (PDF, shown above)`);
    } else {
      const t = officeText(a.name, a.type, buf);
      listing.push(t ? `${tag} contents:\n"""\n${t}\n"""` : `${tag} (couldn't be read${/\.(xls|doc)$/i.test(a.name) ? "; old Excel/Word format" : ""})`);
    }
  }
  return { images, documents, listing };
}

// ---------- the AI ----------

const FILE_ROLE = { type: "string", enum: ["art", "mockup", "size_breakdown", "signature", "other"] };
function tool(finishingIds: string[]) {
  return {
    name: "propose_order",
    description: "The order found in the customer's email and attachments, in the shop's order format.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["new", "reorder"], description: "new = something we build from scratch (a new design or new garments); reorder = the same job as one we printed before, again" },
        reorder_of: { type: ["integer", "null"], description: "For a reorder: the J number of the past job it repeats" },
        summary: { type: "string", description: "One sentence for staff: what they want" },
        nickname: { type: "string", description: "Short job name, e.g. 'Terrible Toddler'" },
        due_date: { type: ["string", "null"], description: "In-hands date YYYY-MM-DD only if the customer gave one" },
        po_number: { type: "string" },
        delivery: { type: ["string", "null"], enum: ["pickup", "ship", "deliver", null] },
        ship_to: { type: "string" },
        notes: { type: "string", description: "Anything else the shop should know (one or two sentences)" },
        garments_supplied_by: { type: "string", enum: ["customer", "shop", "unknown"], description: "customer = they buy the blanks and send them to us" },
        goods: { type: "object", properties: {
          supplier: { type: "string", description: "Where their garments come from, e.g. SanMar, S&S Activewear" },
          expected: { type: "string", description: "When they should arrive, in plain words with a date if you can work it out, e.g. 'End of this week (Fri Oct 9)'" },
          note: { type: "string" },
        } },
        files: { type: "array", description: "Every attached file and what it is", items: { type: "object", properties: {
          file: { type: "integer" }, role: FILE_ROLE, what: { type: "string", description: "A few words, e.g. 'print art, 2 colors', 'sizes per style'" },
        }, required: ["file", "role"] } },
        groups: { type: "array", items: { type: "object", properties: {
          name: { type: "string" },
          garments: { type: "array", items: { type: "object", properties: {
            style: { type: "string" }, brand: { type: "string" }, description: { type: "string" }, color: { type: "string" },
            sizes: { type: "object", description: "Size code to quantity, e.g. {\"6M\":5,\"12M\":5,\"2T\":4}", additionalProperties: { type: "integer" } },
            reorder_line: { type: ["integer", "null"], description: "For a reorder: the L number of the past job's line this is" },
          } } },
          prints: { type: "array", items: { type: "object", properties: {
            method: { type: "string", enum: ["screen", "embroidery", "dtf"] }, location: { type: "string" },
            colors: { description: "Ink colors in the art (not the shirt color, not the underbase), or 'full'", anyOf: [{ type: "integer" }, { type: "string", enum: ["full"] }] },
            inks: { type: "string", description: "The ink colors by name, e.g. 'Gold, Black'" },
            size: { type: "string", description: "Print size only if the customer states it, e.g. '10\" wide' (it's then kept as theirs)" },
            notes: { type: "string" },
            art_file: { type: ["integer", "null"], description: "The File number of the art printed here" },
            width_in: { type: ["number", "null"], description: "Width of the print in inches, judged from the customer's mockup against the garment (see the sizing note). Null when there is no mockup showing it." },
            drop_in: { type: ["number", "null"], description: "Only when the customer states how far below the collar the print goes; otherwise null (we use our standard placement)." },
          } } },
          mockup_files: { type: "array", items: { type: "integer" }, description: "File numbers of mockups for these garments" },
          finishing: { type: "array", items: { type: "string", enum: finishingIds.length ? finishingIds : ["none"] } },
        } } },
        questions: { type: "array", items: { type: "string" }, description: "What we still need to ask the customer, in plain words" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["kind", "summary", "files", "groups", "questions", "confidence"],
    },
  };
}

const supplierKey = (s: string) => (/san\s*mar/i.test(s) ? "sanmar" : /s\s*&\s*s|ss\s*active/i.test(s) ? "ss" : s.trim().slice(0, 60));

/** run the AI for one email and save the suggestion; returns the draft and the past jobs */
export async function suggestEmailOrder(admin: SupabaseClient, activityId: string, by: string): Promise<{ ok: true; draft: EODraft; past: PastJob[] } | { ok: false; error: string }> {
  const { settings, ready, reason } = await aiState(admin);
  if (!ready) return { ok: false, error: reason };
  const { data: a } = await admin.from("activities").select("id, customer_id, subject, body, from_email, occurred_at, meta").eq("id", activityId).maybeSingle();
  if (!a) return { ok: false, error: "Email not found." };
  const atts = (await refetchAttachments(admin, activityId).catch(() => null)) || ((a.meta as { attachments?: Att[] })?.attachments || []);
  const [{ data: cust }, past] = await Promise.all([
    a.customer_id ? admin.from("customers").select("id, company, name, email, price_type, notes").eq("id", a.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    pastJobs(admin, a.customer_id as string | null),
  ]);
  const sigs = await signaturePaths(admin, { id: a.id as string, from_email: (a.from_email as string) || null }, atts).catch(() => new Set<string>());
  const { images, documents, listing } = await readFiles(admin, atts, sigs);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long" });
  const fin = (settings.finishing || []).map((f) => `${f.id} = ${f.name}`).join("; ");
  const system = `${SHOP_CONTEXT(settings as Settings)}
More sizes: infant NB, 6M, 12M, 18M, 24M and toddler 2T, 3T, 4T, 5T. Ranges like 3-6M or 6-12M are written as the top month (6M, 12M).

Your job: a customer emailed the shop. Read the email and every attached file (pictures, PDFs, spreadsheet contents) and fill in the order for staff to check. Today is ${weekday} ${today}.
1. Decide what it is. NEW = something built from scratch: a new design, new garments. REORDER = the same job as one we printed before, again ("reorder", "same as last time", "more of the ___ shirts", a past design or job named). For a reorder set reorder_of to the past job's J number and list its garment lines with reorder_line = the L number and the NEW quantities. If they want it exactly as before without numbers, copy the old quantities and ask to confirm.
2. Say what every attached file is: art (the print file), mockup (the design shown on a garment), size_breakdown (styles, colors, sizes and quantities), signature (the sender's email signature: their company logo, social icons, a banner; never art or a mockup), other (unrelated files).
3. Garments: style number, brand, color and every size quantity exactly as the email or the size sheet gives them. Read every number from a size sheet; don't round or total. One garment entry per style + color.
4. Prints: one per location. Count the ink colors in the art (spot colors; don't count the shirt color; a white underbase on dark garments isn't counted), name them, and set art_file. Take the location from the mockup when it shows it, using our names: ${LOCATIONS.join(", ")}. Give size only if it's stated in words.
4b. When a customer mockup shows the print on the garment, we remake their mockup in our own system so it must look the same: look closely and measure. Location: a small print on the wearer's left chest is Left Chest; a print centered across the chest is Full Front, or Center Chest only for a small logo (under about 5" wide on an adult, about a quarter of the chest width or less). On toddler, infant and youth garments judge by the share of the chest, not inches: a print across half or more of a toddler's chest is Full Front. Width: compare the print's width to the garment's chest width (armpit to armpit) in the picture, then scale to the real garment: adult Large tee 22", adult Medium 20", youth Large 18", youth Small 16", toddler 2T 12", 3T 12.75", 4T 13.5", infant 12M 9.5" (use the middle size of the order's run). Example: a print about 60% of a 3T's chest is about 7.5" wide. Measure the inked art only (from its leftmost to rightmost ink), not empty space around it, and judge the chest width at the armpits, not the sleeves. Give width_in to the nearest quarter inch, Leave drop_in null unless the customer states how far down it goes. Never invent these without a mockup.
5. Garments that share the same prints are one group, with the mockup files for them.
6. Wholesale customers usually buy their own blanks and send them to us: set garments_supplied_by and the goods (supplier, when they should arrive).
7. Finishing (only if asked, or this customer's past jobs always had it): ${fin || "none set up"}.
Never invent prices or dates. Anything unclear or missing goes in questions, written to the customer in plain words.`;
  const custText = cust ? `Customer: ${cust.company || cust.name} <${cust.email || a.from_email}>. ${cust.price_type === "wholesale" ? "WHOLESALE customer: they supply their own garments (we only print)." : "Retail customer: we normally supply the garments."}${cust.notes ? ` Notes on file: ${String(cust.notes).slice(0, 400)}` : ""}` : `Sender ${a.from_email} isn't a customer on file yet.`;
  const prompt = `${custText}

${past.length ? `This customer's past jobs (newest first):\n${jobsText(past)}` : "No past jobs on file for this customer."}

Attached files:
${listing.join("\n") || "(none)"}

The email (${String(a.occurred_at).slice(0, 10)}):
Subject: ${a.subject || ""}
"""
${String(a.body || "").slice(0, 12000)}
"""`;
  const r = await askClaude<AiOrder>({
    task: "order_from_email", model: settings.assistant.ai.model, maxTokens: 4000, timeoutMs: 55_000,
    ctx: { activity_id: a.id as string, customer_id: (a.customer_id as string) || null, by }, admin,
    tool: tool((settings.finishing || []).map((f) => f.id)), system, prompt, images, documents,
  });
  if (!r.ok) return { ok: false, error: r.error };
  // the model sometimes wraps its answer as { order: { ... } } (Peticolas, Oct 8: an empty draft): unwrap it
  const raw = r.data as AiOrder & { order?: AiOrder };
  const p: AiOrder = !raw.kind && raw.order && typeof raw.order === "object" ? raw.order : raw;
  const files: EOFile[] = atts.slice(0, 12).map((f, i) => {
    const t = (p.files || []).find((x) => x.file === i + 1);
    const role: EOFile["role"] = sigs.has(f.path) || t?.role === "signature" ? "signature" : t?.role === "size_breakdown" ? "sheet" : t?.role === "art" || t?.role === "mockup" ? t.role : "other";
    return { path: f.path, name: f.name, type: f.type, size: f.size, role, what: t?.what || "" };
  });
  const fileAt = (n?: number | null) => (n && files[n - 1] && files[n - 1].role !== "signature" ? files[n - 1].path : "");

  const art: Record<string, string> = {}, mockups: Record<string, string[]> = {};
  const finIds = new Set((settings.finishing || []).map((f) => f.id));
  let groups: Group[] = [];
  // the J number of the past job; the model sometimes gives the job's own number instead (#33729), so that's matched too
  const ro = Math.floor(+(p.reorder_of || 0));
  const job = p.kind === "reorder" && ro > 0 ? (ro <= past.length ? past[ro - 1] : past.find((j) => new RegExp(`^#${ro}\\b`).test(j.label))) : undefined;
  if (job) {
    // the past job, copied, with the new quantities on the lines they named
    groups = JSON.parse(JSON.stringify(job.groups)) as Group[];
    const flat = groups.flatMap((g) => g.lines.map((l) => ({ g, l })));
    const named = (p.groups || []).flatMap((g) => g.garments || []).filter((x) => x.reorder_line && flat[x.reorder_line - 1]);
    if (named.length) {
      const keep = new Set<GLine>();
      for (const x of named) {
        const at = flat[x.reorder_line! - 1];
        let t = at.l;
        // the same past line in more colors (Sit Down shirts: one old line, four new colors): a copy for each
        if (keep.has(t)) { t = { ...JSON.parse(JSON.stringify(t)), id: uid(), sizes: {} }; at.g.lines.push(t); }
        // an old Printavo line with the garment only in its description: take the style the AI read from it
        if (!t.style && x.style) t.style = x.style.trim().slice(0, 40);
        if (!t.brand && x.brand) t.brand = x.brand.trim().slice(0, 40);
        const sizes: GLine["sizes"] = {};
        for (const [raw, q] of Object.entries(x.sizes || {})) { const z = normSize(raw); const n = Math.max(0, Math.min(100000, Math.floor(+q || 0))); if (z && n) sizes[z] = (sizes[z] || 0) + n; }
        if (Object.keys(sizes).length) t.sizes = sizes;
        if (x.color && x.color.trim().toLowerCase() !== t.color.trim().toLowerCase()) t.color = x.color.trim().slice(0, 60);
        keep.add(t);
      }
      for (const g of groups) g.lines = g.lines.filter((l) => keep.has(l));
      groups = groups.filter((g) => g.lines.length);
    }
    // a new style or color they added that wasn't on the old job goes in the first group
    const extra = proposalToGroups({ groups: (p.groups || []).map((g) => ({ ...g, prints: [], garments: (g.garments || []).filter((x) => !x.reorder_line) })) }).flatMap((g) => g.lines).filter((l) => Object.keys(l.sizes).length);
    if (extra.length && groups[0]) groups[0].lines.push(...extra);
  } else {
    // what staff changed on earlier mockups the AI measured: scale this reading the same way
    const { data: ls } = await admin.from("ai_suggestions").select("payload").eq("kind", LESSON_KIND).order("updated_at", { ascending: false }).limit(80);
    const lessons = (ls || []).map((x) => x.payload as MockupLesson).filter(Boolean);
    for (const pg of p.groups || []) {
      const [g] = proposalToGroups({ groups: [pg] });
      if (!g) continue;
      const body = bodyOf({ sizes: [...new Set(g.lines.flatMap((l) => Object.keys(l.sizes || {})))] });
      (pg.prints || []).slice(0, 10).forEach((pr, k) => {
        const im = g.imprints[k]; if (!im) return;
        const f = fileAt(pr.art_file); if (f) art[im.id] = f;
        // a size the customer stated in words is theirs: the Mockup Creator asks before anyone changes it
        if (im.size && String(pr.size || "").trim()) im.sizeFrom = "customer";
        // where and how big the customer's mockup shows it, so our Mockup Creator rebuilds the same picture
        let w = +(pr.width_in || 0), dr = +(pr.drop_in ?? -1);
        if (!(w || dr >= 0) || im.size) return;
        const fix = w ? correction(lessons, im.location, body.kind, (a.customer_id as string) || null) : null;
        if (fix) { w *= fix.factor; if (dr >= 0) dr = Math.max(0, dr + fix.dropAdd); }
        // a centered print read wider than its location allows is the bigger location, not a shrunken small one
        // (an 8.5" toddler front called "Center Chest" was cut to that spot's 3.5" max)
        let moved = "";
        const grow: Record<string, string> = { "Center Chest": "Full Front", "Medium Front": "Full Front", "Upper Back (Yoke)": "Full Back", "Medium Back": "Full Back" };
        if (w > 0 && grow[im.location] && w > maxWidthFor(im.location, 0, body) + 0.25) { moved = `. ${grow[im.location]}, not ${im.location}: their print is about ${Math.round(w * 4) / 4}" wide`; im.location = grow[im.location]; }
        // one screen prints every size on the order: never bigger than fits the smallest size ordered (a 2T)
        const small = smallestOrdered(null, Object.keys(Object.assign({}, ...g.lines.map((l) => l.sizes || {}))), body);
        let capped = "";
        if (small && w > 0) { const cap = maxWidthFor(im.location, 0, small); if (w > cap) { capped = `. ${Math.round(cap * 4) / 4}" wide: the largest that fits the ${small.size}, the smallest size on this order (one screen prints every size); their mockup looked like ${Math.round(w * 4) / 4}"`; w = cap; } }
        if (w >= 1 && w <= 16) im.size = `${Math.round(w * 4) / 4}" wide`;
        // the drop isn't taken from their picture (it came out too close to the collar): our standard placement is used
        void dr;
        im.aiPlace = { size: im.size, drop: "", garment: body.size, kind: body.kind };
        im.notes = [im.notes, `Size and placement read from the customer's mockup${fix ? ` (adjusted from ${fix.n} earlier correction${fix.n === 1 ? "" : "s"})` : ""}${moved}${capped}`].filter(Boolean).join(". ").slice(0, 300);
      });
      const ms = (pg.mockup_files || []).map(fileAt).filter(Boolean);
      if (ms.length) mockups[g.id] = [...new Set(ms)];
      g.finishing = (pg.finishing || []).filter((x) => finIds.has(x));
      groups.push(g);
    }
    // a mockup the AI didn't tie to a group goes with the first one
    const loose = files.filter((f) => f.role === "mockup" && !Object.values(mockups).flat().includes(f.path)).map((f) => f.path);
    if (loose.length && groups[0]) mockups[groups[0].id] = [...(mockups[groups[0].id] || []), ...loose];
  }

  const wholesale = cust?.price_type === "wholesale";
  const supplied = p.garments_supplied_by === "customer" || (wholesale && p.garments_supplied_by !== "shop");
  const draft: EODraft = {
    v: 2, kind: job ? "reorder" : "new", summary: (p.summary || "").slice(0, 400), confidence: p.confidence || "medium",
    nickname: (p.nickname || job?.label.replace(/^#\d+\s*/, "").replace(/\s*\(Printavo\)$/, "") || "").slice(0, 120),
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(p.due_date || "") ? p.due_date! : null,
    delivery: p.delivery && ["pickup", "ship", "deliver"].includes(p.delivery) ? p.delivery : "pickup",
    ship_to: (p.ship_to || "").slice(0, 500), po_number: (p.po_number || "").slice(0, 60), notes: (p.notes || "").slice(0, 2000),
    goods: { supplied, supplier: supplierKey(p.goods?.supplier || ""), expected: (p.goods?.expected || "").slice(0, 120), note: (p.goods?.note || "").slice(0, 300) },
    groups, art, mockups, reorderOf: job?.ref || null,
    questions: (p.questions || []).map((q) => String(q).slice(0, 300)).slice(0, 10), files,
  };
  const row = {
    kind: "draft_order", dedupe_key: `email:${a.id}:order`, priority: 1, source: "ai", model: r.model, run_id: r.runId, status: "open",
    customer_id: a.customer_id, order_id: null, activity_id: a.id,
    title: `${draft.kind === "reorder" ? "Reorder" : "New order"} in ${cust?.company || cust?.name || a.from_email}'s email`,
    body: `${draft.summary}${draft.questions.length ? `\nStill need: ${draft.questions.join("; ")}` : ""}`,
    payload: { v: 2, draft, groups: draft.groups, proposal: p, qty: r2(qtyOf(groups)) },
  };
  const { error } = await admin.from("ai_suggestions").upsert(row, { onConflict: "dedupe_key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, draft, past };
}
