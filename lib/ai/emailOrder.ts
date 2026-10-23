import "server-only";
import { PO_RULES } from "@/lib/ai/poRules";
import { newPart } from "@/lib/linkArt";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude, type LookedUp } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { normSize, proposalToGroups, type ProposedOrder } from "@/lib/ai/normalize";
import { applySheetSizes, sheetBreakdown } from "@/lib/sheetSizes";
import { refetchAttachments } from "@/lib/mail/imap";
import { convoKeys, groupConvos, senderKey } from "@/lib/mail/convo";
import { officeText } from "@/lib/officeText";
import { mergeProduction, needsForPrintavo } from "@/lib/production";
import { LOCATIONS, newGLine, newImprint, orderGroups, SIZES, uid, type GLine, type Group, type Imprint, type Order, type Settings } from "@/lib/pricing";
import { bodyOf, smallestOrdered } from "@/lib/garmentBody";
import { maxWidthFor } from "@/lib/mockup";
import { correction, LESSON_KIND, type MockupLesson } from "@/lib/mockupLessons";
import { loadMemories, memoryText } from "@/lib/ai/orderMemory";
import { fillFromOldNotes } from "@/lib/ai/oldJobNotes";
import { isPicture, looksLikeSignature, oldNoteText, type EODraft, type EOFile, type EOPart, type PastJob } from "@/lib/emailOrderShared";

/**
 * "Create order" from a customer email. The AI reads the email AND its attachments (pictures and PDFs it looks at,
 * spreadsheets and Word files as text) with what we know about the customer (wholesale or not, their past jobs),
 * decides whether it's a new order or a reorder of a past job, and fills in the order for staff to check in the
 * Inbox. Nothing is created until staff press Create order (lib/emailOrderCreate.ts). Never sets prices.
 */

type Att = { name: string; path: string; type: string; size: number };
type AiFile = { file: number; role: "art" | "mockup" | "setup_sheet" | "size_breakdown" | "signature" | "other"; what?: string; art_page?: number | null; mockup_page?: number | null };
type PGroup = NonNullable<ProposedOrder["groups"]>[number];
type AiGroup = Omit<PGroup, "garments" | "prints"> & {
  garments?: (NonNullable<PGroup["garments"]>[number] & { reorder_line?: number | null })[];
  prints?: (NonNullable<PGroup["prints"]>[number] & { art_file?: number | null; art_file_name?: string | null; width_in?: number | null; drop_in?: number | null })[];
  mockup_files?: number[]; finishing?: string[];
  /** an order that reorders several past jobs (one per design): the J number this group repeats */
  reorder_of?: number | null;
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
        // our own old mockups (not the customer's): kept for reference, never stamped "customer supplied"
        if (p && /\.(png|jpe?g|gif|webp)$/i.test(p)) mockups.push({ path: p, name: `Printavo #${row.visual_id} mockup${p.match(/\.[a-z]+$/i)?.[0] || ".png"}` });
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
    out.push({ id: uid(), lines, imprints, ...(mockups.length ? { pvRef: [...new Map(mockups.map((x) => [x.path, x])).values()].slice(0, 6) } : {}), ...(pdfs.length ? { pvArt: [...new Map(pdfs.map((x) => [x.path, x])).values()].slice(0, 3) } : {}) });
  }
  return out;
}

/** a portal order copied: new ids, same garments, prints (and their designs), finishing and mockups */
function groupsFromOrder(o: Order): Group[] {
  return orderGroups(o).map((g) => ({
    id: uid(), fromGroup: g.id, name: g.name, youth: g.youth, finishing: g.finishing || [],
    lines: g.lines.map((l) => ({ ...l, id: uid(), cost: "" as const, priceOverride: null })),
    imprints: g.imprints.map((d) => ({ ...d, id: uid() })),
    customerMockups: g.customerMockups || [], mockupThumbs: g.mockupThumbs, mockupAt: g.mockupAt,
  }));
}

/** a Printavo job's customer and production notes, as text */
const pvNotes = (r: { data?: unknown }) => { const d = (r.data || {}) as { customerNote?: string; productionNote?: string }; return { customer: oldNoteText(d.customerNote).slice(0, 1500), production: oldNoteText(d.productionNote).slice(0, 1500) }; };

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
    jobs.push({ ref: `a:${r.id}`, label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "", qty: r.qty || qtyOf(groups), groups, note: "Printavo job: its art is in the job's files on the archive page.", oldNotes: pvNotes(r) });
  }
  return jobs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
}

/**
 * Jobs staff named by number in what they told the AI ("it's a reorder of 31174"): looked up even when they're older
 * than the recent jobs listed (portal orders by number, Printavo jobs by their number), this customer's first.
 */
export async function jobsNamed(admin: SupabaseClient, told: string, customerId: string | null, have: PastJob[]): Promise<PastJob[]> {
  // not a PMS ("PMS 2178C", "534 C"), a year ("2026") or part of a longer number (a tracking number)
  const nums = [...new Set([...told.matchAll(/(?<![\d.$A-Za-z])#?(\d{4,6})(?![\d.]|\s?[CUcu]\b)/g)]
    .filter((m) => !/pms\s*#?$|pantone\s*$/i.test(told.slice(Math.max(0, (m.index || 0) - 8), m.index)))
    .map((m) => m[1]).filter((n) => !/^(19|20)\d\d$/.test(n)))].slice(0, 6);
  if (!nums.length) return [];
  const out: PastJob[] = [];
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const prod = (st?.data as { production?: unknown } | null)?.production;
  for (const n of nums) {
    if (have.some((j) => new RegExp(`^#${n}\\b`).test(j.label)) || out.some((j) => j.label.includes(n))) continue;
    // the customer's own PO number or a number in the job's name (Oct 22, Nick: Logotology's "Reorder from 86798" is
    // their PO; Printavo #32997 is "PO 86798 HALFF"): searched in this customer's whole history, portal and Printavo
    if (customerId) {
      const like = `%${n}%`;
      const [{ data: po }, { data: pa }] = await Promise.all([
        admin.from("orders").select("id, number, nickname, status, created_at, groups, lines, customer_id").eq("customer_id", customerId).or(`po_number.ilike.${like},nickname.ilike.${like}`).order("created_at", { ascending: false }).limit(2),
        admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, order_date, files, data, customer_id").eq("customer_id", customerId).eq("kind", "invoice").or(`po_number.ilike.${like},nickname.ilike.${like}`).order("order_date", { ascending: false, nullsFirst: false }).limit(2),
      ]);
      let hit = false;
      for (const o of (po || []) as (Order & { created_at: string })[]) {
        if (have.some((j) => j.ref === `o:${o.id}`) || out.some((j) => j.ref === `o:${o.id}`)) { hit = true; continue; }
        const groups = groupsFromOrder(o);
        out.push({ ref: `o:${o.id}`, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, date: (o.created_at || "").slice(0, 10), qty: qtyOf(groups), groups, note: `Matches ${n} (their PO or the job name).` }); hit = true;
      }
      for (const r of (pa || []) as PvRow[]) {
        if (have.some((j) => j.ref === `a:${r.id}`) || out.some((j) => j.ref === `a:${r.id}`)) { hit = true; continue; }
        const groups = groupsFromPrintavo(r, prod);
        if (!groups.length) continue;
        out.push({ ref: `a:${r.id}`, label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "", qty: r.qty || qtyOf(groups), groups, note: `Printavo job matching ${n} (their PO or the job name).`, oldNotes: pvNotes(r) }); hit = true;
      }
      if (hit) continue;
    }
    const { data: os } = await admin.from("orders").select("id, number, nickname, status, created_at, groups, lines, customer_id").eq("number", +n).limit(1);
    const o = os?.[0] as (Order & { created_at: string; customer_id: string | null }) | undefined;
    if (o && (!customerId || o.customer_id === customerId)) {
      const groups = groupsFromOrder(o);
      out.push({ ref: `o:${o.id}`, label: `#${o.number}${o.nickname ? ` ${o.nickname}` : ""}`, date: (o.created_at || "").slice(0, 10), qty: qtyOf(groups), groups });
      continue;
    }
    const { data: as } = await admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, order_date, files, data, customer_id").eq("visual_id", n).limit(2);
    // this customer's job (a stray number like part of a phone number shouldn't pull in someone else's job)
    const r = ((as || []) as (PvRow & { customer_id: string | null })[]).find((x) => !customerId || x.customer_id === customerId);
    if (r) {
      const groups = groupsFromPrintavo(r, prod);
      if (groups.length) out.push({ ref: `a:${r.id}`, label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "", qty: r.qty || qtyOf(groups), groups, note: "Printavo job named by staff.", oldNotes: pvNotes(r) });
    }
  }
  return out;
}

/** the past jobs as the AI reads them: J numbers, and L numbers for every garment line */
export function jobsText(jobs: PastJob[]) {
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
export async function signaturePaths(admin: SupabaseClient, a: { id: string; from_email: string | null }, atts: Att[], /** the same conversation's emails: a picture sent again in a reply is the order's, not a signature (Oct 20: Dear Heart's mauve pullover screenshot) */ skip: string[] = []): Promise<Set<string>> {
  const out = new Set(atts.filter((f) => looksLikeSignature(f)).map((f) => f.path));
  const pics = atts.filter((f) => isPicture(f) && !out.has(f.path));
  const dom = String(a.from_email || "").split("@")[1];
  if (!pics.length || !dom) return out;
  const { data } = await admin.from("activities").select("id, meta").ilike("from_email", `%@${dom}`).neq("id", a.id).order("occurred_at", { ascending: false }).limit(40);
  const seen = (data || []).filter((r) => !skip.includes(r.id as string)).flatMap((r) => ((r.meta as { attachments?: Att[] })?.attachments || []));
  for (const f of pics) if (seen.some((x) => x.name === f.name && Math.abs((x.size || 0) - f.size) <= f.size * 0.03)) out.add(f.path);
  return out;
}

/**
 * What a file is, by its name (Oct 22, Nick: "the file names are how I figure everything out… you can see Work Order
 * 91537, you know that's a work order"). The paperwork (a purchase order, work order, invoice, quote, packing slip) is
 * read for the order, never used as the print art; a name like a logo or art is the art. null: the name doesn't say.
 */
export function kindByName(name: string): { kind: "po" | "wo" | "invoice" | "quote" | "packing" | "art"; say: string } | null {
  const n = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/\bpurchase\s*order\b|^\s*p\.?o\.?\s*#?\s*\d|\bp\.?o\.?\s*#?\s*\d{3,}/i.test(n)) return { kind: "po", say: "the customer's purchase order (paperwork: read it for the garments, sizes, prints and notes; never the print art)" };
  if (/\bwork\s*order\b|\bw\.?o\.?\s*#?\s*\d{3,}|\bjob\s*(ticket|sheet)\b/i.test(n)) return { kind: "wo", say: "the customer's work order (paperwork: read it for the locations, sizes, inks and instructions; any mockup on it is only a picture of the job, never the print art)" };
  // a picture named "Bible quote tee.png" is art, not a quote: these words count only on documents
  const doc = !/\.(png|jpe?g|gif|webp|svg|ai|eps|psd|tiff?|heic)$/i.test(name);
  if (doc && /\binvoice\b|\binv\s*#?\s*\d/i.test(n)) return { kind: "invoice", say: "an invoice (paperwork, never the print art)" };
  if (doc && /\b(quote|estimate|quotation)\b/i.test(n)) return { kind: "quote", say: "a quote (paperwork, never the print art)" };
  if (doc && /\bpacking\s*(slip|list)\b|\bbill\s*of\s*lading\b/i.test(n)) return { kind: "packing", say: "a packing slip (paperwork, never the print art)" };
  if (/\b(logo|logos|art|artwork|vector|print\s*file|design|front|back|sleeve|chest)\b/i.test(n) || /\.(ai|eps|svg)$/i.test(name)) return { kind: "art", say: "art, by its name" };
  return null;
}
/** a phone's or scanner's own file name ("IMG_4521.jpg", "Screenshot 2026-10-22"): its numbers aren't a PO or job */
export const CAMERA_NAME = /^(img|dsc|dscn|pxl|photo|image|screenshot|screen shot|scan|mvimg|whatsapp)[\s_-]*\d/i;
const PAPERWORK = new Set(["po", "wo", "invoice", "quote", "packing"]);
export const isPaperwork = (name: string) => PAPERWORK.has(kindByName(name)?.kind || "");

export async function readFiles(admin: SupabaseClient, atts: Att[], sigs: Set<string> = new Set()) {
  const images: { media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string; label: string }[] = [];
  const documents: { data: string; label: string }[] = [];
  const listing: string[] = [];
  let budget = 18 * 1024 * 1024;
  for (const [i, a] of atts.slice(0, 12).entries()) {
    const fromLink = (a as { from_link?: string; source?: string }).from_link, prev = (a as { source?: string }).source === "canva-preview";
    const byName = kindByName(a.name);
    const n = i + 1, tag = `File ${n}: "${a.name}"${fromLink ? ` (from a link the customer sent${prev ? ": a preview picture of their Canva design, not a print file" : ""})` : ""}${byName ? ` [its name says: ${byName.say}]` : ""}`;
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

const FILE_ROLE = { type: "string", enum: ["art", "mockup", "setup_sheet", "size_breakdown", "signature", "other"] };
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
        notes: { type: "string", description: "Anything else the shop should know (one or two sentences). For a purchase order: the PO's own notes word for word, then its other useful facts (see rule 10)" },
        garments_supplied_by: { type: "string", enum: ["customer", "shop", "unknown"], description: "customer = they buy the blanks and send them to us" },
        goods: { type: "object", properties: {
          supplier: { type: "string", description: "Where their garments come from, e.g. SanMar, S&S Activewear" },
          expected: { type: "string", description: "When they should arrive, in plain words with a date if you can work it out, e.g. 'End of this week (Fri Oct 9)'" },
          note: { type: "string" },
        } },
        files: { type: "array", description: "Every attached file and what it is", items: { type: "object", properties: {
          file: { type: "integer" }, role: FILE_ROLE, what: { type: "string", description: "A few words, e.g. 'print art, 2 colors', 'sizes per style'" },
          art_page: { type: ["integer", "null"], description: "setup_sheet only: the page with the art shown big and the spec box (1 = first page)" },
          mockup_page: { type: ["integer", "null"], description: "setup_sheet only: the page with the design on the garment" },
        }, required: ["file", "role"] } },
        groups: { type: "array", items: { type: "object", properties: {
          name: { type: "string" },
          description: { type: "string", description: "What the customer says about everything in this group that the garments and prints don't hold: how it's packed, bagged, labeled or tagged, what it's for. Plain words, one or two sentences; empty if nothing" },
          garments: { type: "array", items: { type: "object", properties: {
            style: { type: "string" }, brand: { type: "string" }, description: { type: "string" }, color: { type: "string" },
            sizes: { type: "object", description: "Size code to quantity, e.g. {\"6M\":5,\"12M\":5,\"2T\":4}", additionalProperties: { type: "integer" } },
            reorder_line: { type: ["integer", "null"], description: "For a reorder: the L number of the past job's line this is" },
            note: { type: "string", description: "A note for this line only: \"Extras\" for an extras / overage line, a product or design name the PO lists apart from the style, a size breakdown that doesn't fit our sizes (waist sizes). Empty if nothing" },
          } } },
          prints: { type: "array", items: { type: "object", properties: {
            method: { type: "string", enum: ["screen", "embroidery", "dtf"] }, location: { type: "string" },
            colors: { description: "Ink colors in the art (not the shirt color, not the underbase), or 'full'", anyOf: [{ type: "integer" }, { type: "string", enum: ["full"] }] },
            inks: { type: "string", description: "The ink colors by name, e.g. 'Gold, Black'" },
            size: { type: "string", description: "Print size only if the customer states it, e.g. '10\" wide' (it's then kept as theirs)" },
            notes: { type: "string" },
            art_file: { type: ["integer", "null"], description: "The File number of the art printed here" },
            art_file_name: { type: ["string", "null"], description: "That file's exact name, written out (e.g. \"SS-logo--1-.png\"): the check that art_file points at the right file" },
            width_in: { type: ["number", "null"], description: "Width of the print in inches, judged from the customer's mockup against the garment (see the sizing note). Null when there is no mockup showing it." },
            drop_in: { type: ["number", "null"], description: "Only when the customer states how far below the collar the print goes; otherwise null (we use our standard placement)." },
          } } },
          mockup_files: { type: "array", items: { type: "integer" }, description: "File numbers of mockups for these garments" },
          reorder_of: { type: ["integer", "null"], description: "A reorder of several past jobs in one order (one per design): the J number of the past job THIS group repeats" },
          finishing: { type: "array", items: { type: "string", enum: finishingIds.length ? finishingIds : ["none"] } },
        } } },
        questions: { type: "array", items: { type: "string" }, description: "What we still need to ask the customer, in plain words" },
        check_with_staff: { type: "array", description: "What staff must answer BEFORE the order is made (rule 11): contradictions, things you couldn't find or place. Empty when it all adds up.", items: { type: "object", properties: {
          question: { type: "string", description: "Short, plain, to the shop's staff, quoting what you saw (e.g. 'The work order says \"best fit for onesie\" but there are no onesies on it. Ignore that note?')" },
          guess: { type: "string", description: "What you'll do if they don't say otherwise" } }, required: ["question", "guess"] } },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["kind", "summary", "files", "groups", "questions", "confidence"],
    },
  };
}

const supplierKey = (s: string) => (/san\s*mar/i.test(s) ? "sanmar" : /s\s*&\s*s|ss\s*active/i.test(s) ? "ss" : s.trim().slice(0, 60));

type ConvoRow = { id: string; customer_id: string | null; subject: string | null; body: string | null; from_email: string | null; to_email: string | null; occurred_at: string; thread_id: string | null; external_id: string | null; direction: string; meta: { attachments?: Att[]; references?: string[]; ignored?: boolean } | null };
type Row = ConvoRow;
/**
 * The conversation an email is in (lib/mail/convo): the emails in its thread, or with its subject from the same
 * customer / company, before and after it, both ways (our replies too), newest first. `near` is every email with the
 * customer looked at (for "other topics").
 */
export async function emailConversation(admin: SupabaseClient, activityId: string): Promise<{ clicked: ConvoRow; convo: ConvoRow[]; near: ConvoRow[] } | null> {
  const cols = "id, customer_id, subject, body, from_email, to_email, occurred_at, thread_id, external_id, direction, meta";
  const { data: clicked } = await admin.from("activities").select(cols).eq("id", activityId).maybeSingle();
  if (!clicked) return null;
  const C = clicked as ConvoRow;
  const since = new Date(new Date(C.occurred_at).getTime() - 120 * 864e5).toISOString();
  const firstTo = (e: ConvoRow) => (e.to_email || "").split(/[,;]/)[0].replace(/.*</, "").replace(/>.*/, "").trim();
  const dom = senderKey(C.direction === "out" ? firstTo(C) : C.from_email);
  const ors = [C.customer_id ? `customer_id.eq.${C.customer_id}` : "", C.thread_id ? `thread_id.eq.${C.thread_id}` : "", C.external_id ? `thread_id.eq.${C.external_id}` : "",
    dom && /^[\w.+@-]+$/.test(dom) ? (dom.includes("@") ? `from_email.eq.${dom}` : `from_email.ilike.*@${dom}`) : ""].filter(Boolean);
  const { data: near } = ors.length ? await admin.from("activities").select(cols)
    .eq("kind", "email").gte("occurred_at", since).or(ors.join(",")).order("occurred_at", { ascending: false }).limit(60) : { data: [] };
  const rows = ((near || []) as ConvoRow[]).filter((e) => e.id !== C.id && !e.meta?.ignored);
  // our replies are keyed by who they went to, so they join the customer's side of the conversation
  const keyOf = (e: ConvoRow) => convoKeys({ subject: e.subject, from_email: e.direction === "out" ? firstTo(e) : e.from_email, customer_id: e.customer_id, thread_id: e.thread_id, external_id: e.external_id, references: e.meta?.references || [] });
  const convo = groupConvos([C, ...rows], keyOf, (e) => e.occurred_at).find((g) => g.includes(C)) || [C];
  return { clicked: C, convo, near: rows };
}

/** run the AI for one email and save the suggestion; returns the draft and the past jobs */
export async function suggestEmailOrder(admin: SupabaseClient, activityId: string, by: string, o: { told?: string; jobRef?: string | null; /** several past jobs reordered together in one order (one group per design) */ jobRefs?: string[]; reorderOk?: boolean; lookedUp?: LookedUp | null; /** one of several orders in the email (lib/ai/emailPlan.ts): its files only, saved apart */ part?: EOPart | null } = {}): Promise<{ ok: true; draft: EODraft; past: PastJob[] } | { ok: false; error: string }> {
  const { settings, ready, reason } = await aiState(admin);
  if (!ready) return { ok: false, error: reason };
  const cv = await emailConversation(admin, activityId);
  if (!cv) return { ok: false, error: "Email not found." };
  // the whole conversation, whichever email it's started from (Oct 12, Nick: "if you do a task it starts from the
  // last email forward… he gave me the sizes, then updated sizes… I should create the order from my response or any
  // point in the conversation and it still gathers all the details"). The newest email from the customer is the one
  // read in full; what was decided along the way counts, and the latest decision wins. Other recent emails with the
  // customer (other subjects) come after, marked as other topics.
  const { clicked: C, convo, near } = cv;
  const inConvo = new Set(convo.map((e) => e.id));
  // the newest email from the customer is the one read in full (else the one clicked)
  const a0 = convo.find((e) => e.direction === "in") || C;
  const a: Row = a0.customer_id ? a0 : { ...a0, customer_id: C.customer_id };
  const lineOf = (e: Row) => {
    const t = newPart(String(e.body || "")).replace(/\n{3,}/g, "\n\n").trim().slice(0, 2400);
    return `- ${String(e.occurred_at).slice(0, 16).replace("T", " ")} ${e.direction === "out" ? "WE wrote" : `${e.from_email} wrote`}${e.subject ? ` ("${String(e.subject).slice(0, 90)}")` : ""}:\n${t}`;
  };
  let convLeft = 16000;
  const convText = [...convo].filter((e) => e.id !== a.id).reverse().slice(-16).map((e) => {
    const line = lineOf(e); if (convLeft <= 0) return ""; convLeft -= line.length; return line;
  }).filter(Boolean).join("\n\n");
  const after = convo.filter((e) => e.id !== a.id && e.occurred_at > a.occurred_at);
  let otherLeft = 5000;
  const otherText = near.filter((e) => !inConvo.has(e.id) && C.customer_id && e.customer_id === C.customer_id && e.occurred_at <= convo[0].occurred_at).slice(0, 6).reverse().map((e) => {
    const line = lineOf(e).slice(0, 900); if (otherLeft <= 0) return ""; otherLeft -= line.length; return line;
  }).filter(Boolean).join("\n\n");
  // the files from every email in the conversation, newest first (a size sheet sent later counts); the same file
  // sent twice is read once
  const attsOf = async (e: Row) => (e.id === a.id || e.id === C.id ? (await refetchAttachments(admin, e.id).catch(() => null)) : null) || e.meta?.attachments || [];
  const atts: Att[] = [];
  for (const e of convo) {
    if (e.direction !== "in" && e.id !== C.id) continue;
    for (const f of await attsOf(e)) if (!atts.some((x) => x.path === f.path || (x.name === f.name && x.size === f.size))) atts.push(f);
    if (atts.length >= 12 && !o.part) break;
  }
  // one order of several: only the files that are for it (the same file sent again counts too)
  if (o.part) { const want = new Set(o.part.files); const names = new Set(o.part.names || []); const keep = atts.filter((f) => want.has(f.path) || names.has(f.name)); atts.length = 0; atts.push(...keep.slice(0, 12)); }
  const told = (o.told || "").trim().slice(0, 1500);
  const [{ data: cust }, recent, mems] = await Promise.all([
    a.customer_id ? admin.from("customers").select("id, company, name, email, price_type, notes").eq("id", a.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    pastJobs(admin, a.customer_id as string | null),
    loadMemories(admin, (a.customer_id as string) || null).catch(() => []),
  ]);
  // a job staff picked or named goes first, so it's J1 (and jobs named in what staff taught about this customer)
  const memText = memoryText(mems, String(cust?.company || cust?.name || "this customer"));
  // numbers in the email (or the ClickUp job's notes) too: "Reorder from 86798" names the job by their PO
  const said = `${String(a.subject || "")} ${String(a.body || "").slice(0, 3000)} ${atts.filter((f) => !CAMERA_NAME.test(f.name)).map((f) => f.name.replace(/[_-]+/g, " ")).join(" ")}`;
  let past = [...await jobsNamed(admin, `${told} ${mems.map((m) => m.text).join(" ")} ${said}`, (a.customer_id as string) || null, recent).catch(() => []), ...recent];
  const picked = o.jobRef ? past.find((j) => j.ref === o.jobRef) : undefined;
  // several jobs picked together (Oct 22, Nick: Hutchins T10A is #33633 and T11A is #33676: "create an order out of a
  // reorder from two separate Printavos"): all of them first, J1, J2…
  const pickedAll = [...new Set([...(picked ? [picked.ref] : []), ...(o.jobRefs || [])])].map((ref) => past.find((j) => j.ref === ref)).filter((j): j is PastJob => !!j);
  if (pickedAll.length) past = [...pickedAll, ...past.filter((j) => !pickedAll.includes(j))];
  // facts the note points to that have to be looked up online ("we used the LA Lakers PMS colors")
  // (looked up first by the panel, so staff see it while the email is read)
  const lookedUp = told && o.lookedUp?.text ? { text: String(o.lookedUp.text).slice(0, 600), sources: (o.lookedUp.sources || []).slice(0, 3).map((x) => ({ title: String(x.title || "").slice(0, 120), url: String(x.url || "") })).filter((x) => /^https?:\/\//.test(x.url)) } : null;
  const staffSays = [
    o.part ? `This conversation holds ${o.part.of} separate orders, one per design. THIS order is only "${o.part.label}": use only its files (listed above) and only what the emails say about it.${o.part.pieces ? ` Its size sheets total ${o.part.pieces} pieces.` : ""} When several size sheets (e.g. one for the store and one for their warehouse) list the same style, color and size, add the quantities together into one garment line.${o.part.changes ? ` What's different from the past job: ${o.part.changes}` : " It's an exact reprint of the past job: same prints, inks and placement."}` : "",
    pickedAll.length > 1 ? `Staff confirmed: this is ONE order that reorders ${pickedAll.length} past jobs together: ${pickedAll.map((j, i) => `${j.label} (J${i + 1})`).join(", ")}. Each design is its own group; set each group's reorder_of to the J number of the job it repeats.` : picked ? `Staff confirmed: this is a reorder of ${picked.label} (J1).` : "",
    picked?.ref.startsWith("o:") ? "That order was made in our own system: its art, prints, inks, placement and mockups are on file and are reused exactly. Only the quantities (and any change the customer asks for) are new; don't ask about the art." : "",
    told,
    lookedUp ? `Looked up online for that note: ${lookedUp.text}` : "",
  ].filter(Boolean).join("\n");
  const sigs = await signaturePaths(admin, { id: a.id as string, from_email: (a.from_email as string) || null }, atts, convo.map((e) => e.id as string)).catch(() => new Set<string>());
  const { images, documents, listing } = await readFiles(admin, atts, sigs);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long" });
  const fin = (settings.finishing || []).map((f) => `${f.id} = ${f.name}`).join("; ");
  const system = `${SHOP_CONTEXT(settings as Settings)}
More sizes: infant NB, 6M, 12M, 18M, 24M and toddler 2T, 3T, 4T, 5T. Ranges like 3-6M or 6-12M are written as the top month (6M, 12M).

Your job: a customer emailed the shop. Read the email and every attached file (pictures, PDFs, spreadsheet contents) and fill in the order for staff to check. Today is ${weekday} ${today}.
0. Before taking any numbers, read the email like a person: how is it laid out, and why? Look at the headings and at what repeats. When the same designs come again under headings such as store or location names (e.g. ****Frisco**** then ****McKinney****, "see break out by location"), departments, people or ship-to places, that's ONE order broken out by those headings, not separate garments and never to be added together: make ONE group per design (name the group with the design, e.g. "T10A Autumn Tee"), and in it one garment line per heading, with the heading as that line's description (e.g. "Frisco"). The same style and color under two headings is two lines. When you can't tell what a heading or split means, keep the parts apart anyway and ask in questions what it is. Check your totals against any the customer gives ("T10A total tees 348").
1. Decide what it is. NEW = something built from scratch: a new design, new garments. REORDER = the same job as one we printed before, again ("reorder", "same as last time", "more of the ___ shirts", a past design or job named). For a reorder set reorder_of to the past job's J number and list its garment lines with reorder_line = the L number and the NEW quantities. If they want it exactly as before without numbers, copy the old quantities and ask to confirm. A design code or name in the email (T10A, "the Bottles") that matches a past job's name means that job. When one email reorders several designs that were separate past jobs, it's still one order: one group per design, each group's reorder_of = its own job's J number (top-level reorder_of = the first). If the customer attached the art on a reorder, still set art_file on each print: staff choose between their files and the old job's.
2. Say what every attached file is: art (the print file: just the design, nothing else on the page), mockup (the design shown on a garment), setup_sheet (the customer's own mockup sheet: the art shown big, usually on a flat background panel with a note like "BACKGROUND DOES NOT PRINT", a spec box with the location, the size and the inks (Pantone / PMS), and the design on the garment, often on a second page; give art_page and mockup_page), size_breakdown (styles, colors, sizes and quantities), signature (the sender's email signature: their company logo, social icons, a banner; never art or a mockup), other (unrelated files). A file's NAME says what it is, the way staff read it: "Purchase_Order_91537" is their purchase order, "Work_Order_91537" their work order, "SS-logo" the logo. The paperwork (purchase order, work order, invoice, quote, packing slip) is read for the garments, sizes, locations, inks and notes, and is never the art: a purchase order is size_breakdown, a work order other (even when it shows the design on a shirt); set art_file to the art files, and take a number in a paperwork name (91537) as their PO number.
3. Garments: style number, brand, color and every size quantity exactly as the email or the size sheet gives them. Read every number from a size sheet; don't round or total. One garment entry per style + color.
4. Prints: one per location. Set art_file to the file whose art prints there and write its name in art_file_name; when several art files are close (two colorways of one logo), match each to its print by what the files show (the work order's or mockup's picture of each variation: blue art on Variation 1, black on Variation 2), not by the order the files came in.  Count the ink colors in the art (spot colors; don't count the shirt color; a white underbase on dark garments isn't counted), name them, and set art_file. Take the location from the mockup when it shows it, using our names: ${LOCATIONS.join(", ")}. Give size only if it's stated in words.
4b. When a customer mockup shows the print on the garment, we remake their mockup in our own system so it must look the same: look closely and measure. Location: a small print on the wearer's left chest is Left Chest; a print centered across the chest is Full Front, or Center Chest only for a small logo (under about 5" wide on an adult, about a quarter of the chest width or less). On toddler, infant and youth garments judge by the share of the chest, not inches: a print across half or more of a toddler's chest is Full Front. Width: compare the print's width to the garment's chest width (armpit to armpit) in the picture, then scale to the real garment: adult Large tee 22", adult Medium 20", youth Large 18", youth Small 16", toddler 2T 12", 3T 12.75", 4T 13.5", infant 12M 9.5" (use the middle size of the order's run). Example: a print about 60% of a 3T's chest is about 7.5" wide. Measure the inked art only (from its leftmost to rightmost ink), not empty space around it, and judge the chest width at the armpits, not the sleeves. Give width_in to the nearest quarter inch, Leave drop_in null unless the customer states how far down it goes. Never invent these without a mockup.
4c. A setup_sheet (a customer's mockup sheet) often has two pages: the art page (the art shown big, often on a black or colored background with a note like "BLACK DOES NOT PRINT", and a spec box naming the location such as "Front screenprint", the size like 11.75"w x 6.25"t and the ink colors) and a mockup page (the design on the garment, with the style and color). Take the location, size and inks from the spec box (that size is the customer's own), use the PDF as the print's art_file AND as the group's mockup_files (staff cut the art off the art page). Give the size as written (11.5"w x 10.4"t → size "11.5\" wide", width_in 11.5) and each ink by its Pantone name (inks "Pantone 7499, Pantone 7597", colors 2). Take the garment's style and color from the mockup page when the email doesn't say. The background color isn't an ink. On a reorder, what the customer's own files show (the spec box, their mockup) wins over the old job's location, size and inks: use theirs, and say in notes what the old job had.
5. Garments that share the same prints are one group, with the mockup files for them. Instructions for a whole group (rolled and rubber-banded, tagged with UPCs, boxed by location) go in that group's description.
6. Wholesale customers usually buy their own blanks and send them to us: set garments_supplied_by and the goods (supplier, when they should arrive).
7. Finishing (only if asked, or this customer's past jobs always had it): ${fin || "none set up"}.
8. Read the WHOLE conversation, not just the newest email: customers decide over many emails (the garment and color picked from our options, the sizes, a price we agreed, the date they need it, then the art last). The latest decision wins (a size list sent later replaces an earlier one; the style they finally chose replaces the ones they considered). Prices and terms WE wrote are what was agreed: put them in the notes for staff, and don't ask the customer again for anything already settled in the conversation.
${PO_RULES}
9. Art sent as a link (a file marked "from a link", e.g. a Canva design preview): use it as the art for the mockup. A Canva preview is a picture, not a print file: say in questions that we'll need the print file (PDF or SVG) unless a real file came with it.
Never invent prices or dates. Anything unclear or missing goes in questions, written to the customer in plain words.
11. CHECK WITH STAFF FIRST (Oct 22, Nick: "take steps to get things right, but when there's a clear contradiction, or I can't find this product, or there's a clear anything, you need to just ask… I'm processing this for the first time, and then remember it moving forward"). Before the order is made, ask the shop in check_with_staff about anything that doesn't add up, with your best guess: a note or spec that contradicts the order ("best fit for onesie" with no onesies in it), two files that disagree (PO vs work order sizes, quantities, colors), a style or color written oddly or not one you know ("NeonBlue": Neon Blue?), a garment you can't identify, a file you can't place, a size grid that doesn't add up, a print with no location or art. Don't ask what the files settle, and don't ask what staff already told you or taught you about this customer. Never copy a contradicting note into the order as if it applied: ask instead.
When staff tell you something about this email (which past job it is, that it's a reorder, what the customer wants changed, colors used before), it's fact: follow it over your own reading.`;
  const custText = cust ? `Customer: ${cust.company || cust.name} <${cust.email || a.from_email}>. ${cust.price_type === "wholesale" ? "WHOLESALE customer: they supply their own garments (we only print)." : "Retail customer: we normally supply the garments."}${cust.notes ? ` Notes on file: ${String(cust.notes).slice(0, 400)}` : ""}` : `Sender ${a.from_email} isn't a customer on file yet.`;
  const prompt = `${custText}

${past.length ? `This customer's past jobs (newest first):\n${jobsText(past)}` : "No past jobs on file for this customer."}

Attached files:
${listing.join("\n") || "(none)"}

${otherText ? `OTHER RECENT EMAILS WITH THIS CUSTOMER (other subjects: use them only where they're clearly about this same order):
${otherText}

` : ""}${convText ? `THE CONVERSATION (every email in it but the one below, oldest first; what was decided along the way counts, the latest decision wins${after.length ? "; the emails dated after the one below are newer and override it" : ""}):
${convText}

` : ""}The newest email from the customer in this conversation (${String(a.occurred_at).slice(0, 10)}):
Subject: ${a.subject || ""}
"""
${String(a.body || "").slice(0, 12000)}
"""${memText ? `

${memText}` : ""}${staffSays ? `

WHAT STAFF TOLD YOU ABOUT THIS EMAIL (facts, follow them; put looked-up ink colors on the prints' inks):
${staffSays}` : ""}`;
  const r = await askClaude<AiOrder>({
    task: "order_from_email", model: settings.assistant.ai.model, maxTokens: 4000, timeoutMs: 55_000,
    ctx: { activity_id: C.id, customer_id: (a.customer_id as string) || null, by }, admin,
    tool: tool((settings.finishing || []).map((f) => f.id)), system, prompt, images, documents,
  });
  if (!r.ok) return { ok: false, error: r.error };
  // the model sometimes wraps its answer as { order: { ... } } (Peticolas, Oct 8: an empty draft): unwrap it
  const raw = r.data as AiOrder & { order?: AiOrder };
  const p: AiOrder = !raw.kind && raw.order && typeof raw.order === "object" ? raw.order : raw;
  // the quantities straight off a size-breakdown spreadsheet, not the AI's reading of it (lib/sheetSizes.ts)
  {
    const sheets = listing.map((x) => /contents:\n"""\n([\s\S]*)\n"""$/.exec(x)?.[1] || "").filter(Boolean);
    const sheet = sheets.flatMap((t) => sheetBreakdown(t));
    const all = (p.groups || []).flatMap((g) => g.garments || []);
    if (sheet.length && all.length) {
      const { unmatched, extra } = applySheetSizes(all, sheet);
      for (const g of p.groups || []) g.garments = (g.garments || []).filter((x) => !extra.has(x));
      // a color on the sheet the AI left out: added with the style most of the order has
      if (unmatched.length && p.groups?.[0]) {
        const sc = new Map<string, number>(); for (const x of all) { const k0 = String(x.style || "").trim(); if (k0) sc.set(k0, (sc.get(k0) || 0) + 1); }
        const style = [...sc.entries()].sort((a2, b2) => b2[1] - a2[1])[0]?.[0] || "";
        const like = all.find((x) => String(x.style || "").trim() === style);
        for (const u of unmatched) p.groups[0].garments = [...(p.groups[0].garments || []), { ...(like ? { brand: like.brand, description: like.description } : {}), style, color: u.color, sizes: { ...u.sizes } } as (typeof all)[number]];
      }
    }
  }
  const files: EOFile[] = atts.slice(0, 12).map((f, i) => {
    const t = (p.files || []).find((x) => x.file === i + 1);
    const paper = kindByName(f.name);
    let role: EOFile["role"] = sigs.has(f.path) || t?.role === "signature" ? "signature" : t?.role === "size_breakdown" ? "sheet" : t?.role === "art" || t?.role === "mockup" ? t.role : t?.role === "setup_sheet" ? "art" : "other";
    // the file's name wins: a purchase order or work order is paperwork, never the art (Work_Order_91537 was read as art)
    if (paper && PAPERWORK.has(paper.kind) && role !== "signature") role = paper.kind === "po" ? "sheet" : "other";
    // a customer's mockup sheet (art page + garment page): staff confirm, and the art is cut off its art page
    const sheet = t?.role === "setup_sheet" && !(paper && PAPERWORK.has(paper.kind)) ? { artPage: Math.max(1, Math.round(+(t.art_page || 1))), mockupPage: Math.max(1, Math.round(+(t.mockup_page || (t.art_page === 2 ? 1 : 2)))) } : undefined;
    return { path: f.path, name: f.name, type: f.type, size: f.size, role, what: t?.what || "", ...(sheet ? { sheet } : {}) };
  });
  // the art by its name when the number points elsewhere (Oct 22, Logotology #40106: the AI said Variation 1 is the blue
  // logo and Variation 2 the black one, but gave each the other's File number, so the arts came in switched)
  for (const pg of p.groups || []) for (const pr of pg.prints || []) {
    const nm = String(pr.art_file_name || "").trim().toLowerCase();
    if (!nm) continue;
    if (files[(pr.art_file || 0) - 1]?.name.toLowerCase() === nm) continue;
    const hits = files.map((f, i) => (f.name.toLowerCase() === nm ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 1 && files[hits[0]].role !== "signature") pr.art_file = hits[0] + 1;
  }
  // a print's art: never the signature, and never the paperwork when there's an art file to use instead
  const artFiles = files.filter((f) => f.role === "art");
  const fileAt = (n?: number | null) => {
    const f = n ? files[n - 1] : undefined;
    if (!f || f.role === "signature") return "";
    if (isPaperwork(f.name)) return artFiles.length === 1 ? artFiles[0].path : "";
    return f.path;
  };

  const art: Record<string, string> = {}, mockups: Record<string, string[]> = {};
  const finIds = new Set((settings.finishing || []).map((f) => f.id));
  let groups: Group[] = [];
  // the J number of the past job; the model sometimes gives the job's own number instead (#33729), so that's matched too
  const jobAt = (n0?: number | null) => { const n = Math.floor(+(n0 || 0)); return n > 0 ? (n <= past.length ? past[n - 1] : past.find((j) => new RegExp(`^#${n}\\b`).test(j.label))) : undefined; };
  const groupJobs = (p.groups || []).map((pg) => (p.kind === "reorder" ? jobAt(pg.reorder_of) : undefined));
  const job = p.kind === "reorder" ? jobAt(p.reorder_of) || groupJobs.find(Boolean) : undefined;
  // THE READING LEADS (Oct 22, Nick on Hutchins: T10A and T11A broken out by Frisco and McKinney, art attached; the
  // reorder copied one old job and squeezed every garment into its one print, dropping T10A and the art he sent):
  // when the email reorders several designs (several past jobs, or several groups with their own art), the order is
  // built the way the email reads, one group per design with its lines, and each group borrows from its own old job
  // (inks, its files for the Resolution Center, finishing) only what the email doesn't give
  const emailArt = (p.groups || []).some((pg) => (pg.prints || []).some((pr) => !!fileAt(pr.art_file)));
  const distinctJobs = new Set(groupJobs.filter(Boolean).map((j) => j!.ref));
  const readingLeads = p.kind === "reorder" && (p.groups || []).length >= 2 && (distinctJobs.size >= 2 || emailArt);
  const reorderJobs = [...new Set([job?.ref, ...groupJobs.map((j) => j?.ref)].filter((x): x is string => !!x))];
  if (readingLeads) {
    (p.groups || []).forEach((pg, i) => {
      const [g] = proposalToGroups({ groups: [pg] });
      if (!g) return;
      const j = groupJobs[i] || ((p.groups || []).length === 1 || distinctJobs.size <= 1 ? job : undefined);
      // the old job's group for these garments (same style), else its first
      const sk = (st: string) => (st || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const old = j ? j.groups.find((og) => og.lines.some((ol) => g.lines.some((l) => sk(l.style) && sk(l.style) === sk(ol.style)))) || j.groups[0] : undefined;
      if (old) {
        if (!g.imprints.length) g.imprints = old.imprints.map((im) => ({ ...JSON.parse(JSON.stringify(im)), id: uid() }));
        else g.imprints.forEach((im, k) => {
          const was = old.imprints.find((x) => x.location === im.location) || old.imprints[k];
          if (!was) return;
          if (!im.inks && was.inks) im.inks = was.inks;
          if (was.design_id && !fileAt(pg.prints?.[k]?.art_file)) im.design_id = was.design_id;
          im.notes = [im.notes, `Reorder of ${j!.label.replace(/\s*\(Printavo\)$/, "")}`].filter(Boolean).join(". ").slice(0, 300);
        });
        if (old.pvArt?.length) g.pvArt = JSON.parse(JSON.stringify(old.pvArt));
        if (old.pvRef?.length) g.pvRef = JSON.parse(JSON.stringify(old.pvRef));
        if (!(pg.finishing || []).length && old.finishing?.length) g.finishing = [...old.finishing];
        g.reorderFrom = j!.ref;
      }
      (pg.prints || []).slice(0, 10).forEach((pr, k) => { const f = fileAt(pr.art_file); const im = g.imprints[k]; if (f && im) { art[im.id] = f; if (im.size && String(pr.size || "").trim()) im.sizeFrom = "customer"; } });
      const ms = (pg.mockup_files || []).map(fileAt).filter(Boolean);
      if (ms.length) mockups[g.id] = [...new Set(ms)];
      if ((pg.finishing || []).length) g.finishing = (pg.finishing || []).filter((x) => finIds.has(x));
      groups.push(g);
    });
  } else if (job) {
    // the past job, copied, with the new quantities on the lines they named
    groups = JSON.parse(JSON.stringify(job.groups)) as Group[];
    // our mockup of each line goes with it (a portal order's mockups are copied, not made again: Oct 20, Nick)
    const thumbOf = new Map<GLine, string>();
    for (const g of groups) g.lines.forEach((l, i) => { const t = (g.mockupThumbs || [])[i]; if (t) thumbOf.set(l, t); });
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
        if (x.color && x.color.trim().toLowerCase() !== t.color.trim().toLowerCase()) { t.color = x.color.trim().slice(0, 60); thumbOf.delete(t); }
        keep.add(t);
      }
      for (const g of groups) g.lines = g.lines.filter((l) => keep.has(l));
      groups = groups.filter((g) => g.lines.length);
    }
    for (const g of groups) {
      if (!g.mockupThumbs) continue;
      const ts = g.lines.map((l) => thumbOf.get(l) || "");
      if (ts.some(Boolean)) g.mockupThumbs = ts; else { delete g.mockupThumbs; delete g.mockupAt; }
    }
    // garments the AI didn't tie to an old line but that ARE old lines (same style and color: Little Groupies' Bottles
    // sheet, Oct 20: none tied, so the old job's 500 stayed and the sheet's 500 went in as a second group = 1,000):
    // the sheet's quantities replace the old ones, and old lines the sheet doesn't list drop out
    const ck = (c: string) => (c || "").toLowerCase().replace(/[^a-z]/g, "");
    const sameColor = (a: string, b: string) => { const x = ck(a), y = ck(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };
    const sk = (st: string) => (st || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const claimed = new Set<GLine>();
    const claimFor = (l: GLine) => {
      for (const g of groups) for (const t of g.lines) {
        if (claimed.has(t)) continue;
        if (sameColor(t.color, l.color) && (!sk(t.style) || !sk(l.style) || sk(t.style) === sk(l.style))) return t;
      }
      return null;
    };
    // a sheet row without a style takes the style most of the sheet's rows have (Oct 20: Little Groupies' Black row had
    // none and matched the old job's 3001B tee instead of the 100B onesie)
    const styleCount = new Map<string, number>();
    for (const pg of p.groups || []) for (const x of pg.garments || []) { const k0 = String(x.style || "").trim(); if (k0) styleCount.set(k0, (styleCount.get(k0) || 0) + 1); }
    const usual = [...styleCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const pgs = (p.groups || []).map((pg) => ({ ...pg, garments: (pg.garments || []).map((x) => (!String(x.style || "").trim() && usual ? { ...x, style: usual } : x)).filter((x) => {
      if (x.reorder_line || named.length) return true;
      const [l] = proposalToGroups({ groups: [{ ...pg, prints: [], garments: [x] }] }).flatMap((g) => g.lines);
      if (!l || !Object.keys(l.sizes).length) return true;
      const t = claimFor(l);
      if (!t) return true;
      t.sizes = l.sizes; if (!t.style && l.style) t.style = l.style; claimed.add(t);
      return false;
    }) }));
    if (!named.length && claimed.size) {
      for (const g of groups) g.lines = g.lines.filter((l) => claimed.has(l));
      groups = groups.filter((g) => g.lines.length);
    }
    // a new style or color they added that wasn't on the old job goes in the first group; when its prints have their
    // own inks (Oct 20, Dear Heart: In Every Season on a new Mauve pullover in Burgundy ink, the tees in white), it's a
    // group of its own: the old job's prints, with those inks, and its mockup
    for (const pg of pgs) {
      const extra = proposalToGroups({ groups: [{ ...pg, prints: [], garments: (pg.garments || []).filter((x) => !x.reorder_line) }] }).flatMap((g) => g.lines).filter((l) => Object.keys(l.sizes).length);
      if (!extra.length || !groups[0]) continue;
      const inks = (pg.prints || []).map((pr) => String(pr.inks || "").trim());
      const base = groups[0];
      // only a real change of ink: an old job with no inks on file (Printavo) isn't "different" from what the AI read
      const differs = inks.some((x, k) => { const was = String(base.imprints[k]?.inks || "").trim().toLowerCase(); return !!x && !!was && x.toLowerCase() !== was; });
      if (!differs) { base.lines.push(...extra); continue; }
      const ng: Group = { ...JSON.parse(JSON.stringify(base)) as Group, id: uid(), name: [base.name, extra.map((l) => [l.style, l.color].filter(Boolean).join(" ")).join(", ")].filter(Boolean).join(" · ").slice(0, 80), lines: extra };
      ng.imprints = ng.imprints.map((im, k) => ({ ...im, id: uid(), ...(inks[k] ? { inks: inks[k], notes: [im.notes, `New ink for this garment: ${inks[k]} (was ${base.imprints[k]?.inks || "not on file"})`].filter(Boolean).join(". ").slice(0, 300) } : {}) }));
      delete (ng as { mockupThumbs?: unknown }).mockupThumbs; delete (ng as { pvArt?: unknown }).pvArt;
      const ms = (pg.mockup_files || []).map(fileAt).filter(Boolean);
      if (ms.length) mockups[ng.id] = [...new Set(ms)];
      groups.push(ng);
    }
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
    groups, art, mockups, reorderOf: job?.ref || null, ...(reorderJobs.length > 1 ? { reorderJobs } : {}), ...(readingLeads && emailArt ? { emailArt: true } : {}),
    questions: (p.questions || []).map((q) => String(q).slice(0, 300)).slice(0, 10), files,
    check: ((p as { check_with_staff?: { question?: string; guess?: string }[] }).check_with_staff || []).map((c) => ({ q: String(c.question || "").slice(0, 300), guess: String(c.guess || "").slice(0, 200) })).filter((c) => c.q).slice(0, 8),
    ...(told ? { told } : {}), ...(p.kind === "reorder" || picked ? { looksReorder: true } : {}),
    ...(lookedUp ? { lookedUp } : {}), ...(o.reorderOk && job ? { reorderOk: true } : {}), ...(o.part ? { part: o.part } : {}),
  };
  // a reorder of a Printavo job: the inks its notes name go on the prints, for production to confirm
  if (job?.ref.startsWith("a:")) await fillFromOldNotes(admin, settings, draft, by, a.customer_id).catch((e) => console.warn("fillFromOldNotes", e));
  const row = {
    kind: o.part ? "draft_order_part" : "draft_order", dedupe_key: o.part ? `email:${o.part.anchor || C.id}:order:${o.part.key}` : `email:${C.id}:order`, priority: 1, source: "ai", model: r.model, run_id: r.runId, status: "open",
    customer_id: a.customer_id, order_id: null, activity_id: C.id,
    title: `${draft.kind === "reorder" ? "Reorder" : "New order"} in ${cust?.company || cust?.name || a.from_email}'s email`,
    body: `${draft.summary}${draft.questions.length ? `\nStill need: ${draft.questions.join("; ")}` : ""}`,
    payload: { v: 2, draft, groups: draft.groups, proposal: p, qty: r2(qtyOf(groups)), seen: convo[0].occurred_at, emails: convo.length },
  };
  const { error } = await admin.from("ai_suggestions").upsert(row, { onConflict: "dedupe_key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, draft, past };
}
