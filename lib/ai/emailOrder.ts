import "server-only";
import { PO_RULES } from "@/lib/ai/poRules";
import { newPart } from "@/lib/linkArt";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiState, askClaude, type LookedUp } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { normSize, proposalToGroups, type ProposedOrder } from "@/lib/ai/normalize";
import { applySheetSizes, sheetBreakdown } from "@/lib/sheetSizes";
import { supplierConfirms } from "@/lib/supplierConfirm";
import { pdfTextServer } from "@/lib/pdfTextServer";
import { refetchAttachments } from "@/lib/mail/imap";
import { convoKeys, groupConvos, senderKey } from "@/lib/mail/convo";
import { officeText } from "@/lib/officeText";
import { mergeProduction, needsForPrintavo } from "@/lib/production";
import { fitLocation, LOCATIONS, newGLine, newImprint, orderGroups, SIZES, uid, type GLine, type Group, type Imprint, type Order, type Settings } from "@/lib/pricing";
import { bodyOf, smallestOrdered } from "@/lib/garmentBody";
import { maxWidthFor } from "@/lib/mockup";
import { correction, LESSON_KIND, type MockupLesson } from "@/lib/mockupLessons";
import { loadMemories, memoryText, loadShopRules, shopRulesText } from "@/lib/ai/orderMemory";
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
  const listing: string[] = [], confirms: string[] = [];
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
      // a supplier's order confirmation (S&S, SanMar): its rows read by code, exactly (Oct 24, Dear Heart's In Every Season)
      const tx = await pdfTextServer(buf);
      const cf = tx ? supplierConfirms([tx]) : null;
      if (cf?.rows) {
        confirms.push(tx);
        listing.push(`${tag} (PDF, shown above). Read by code, exactly: a supplier order confirmation, ${cf.pieces} pieces: ${cf.lines.map((l) => `${l.product.split(" - ").pop()} ${l.color} ${Object.entries(l.sizes).map(([z, q]) => `${z} ${q}`).join(", ")}`).join("; ")}. Use these quantities as they are.`);
      } else listing.push(`${tag} (PDF, shown above)`);
    } else {
      const t = officeText(a.name, a.type, buf);
      listing.push(t ? `${tag} contents:\n"""\n${t}\n"""` : `${tag} (couldn't be read${/\.(xls|doc)$/i.test(a.name) ? "; old Excel/Word format" : ""})`);
    }
  }
  return { images, documents, listing, confirms };
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
        reference_job: { type: ["integer", "null"], description: "A NEW order that points to a past job for how to print it ('not a repeat… same process as order 85254'): that job's J number. Null otherwise." },
        summary: { type: "string", description: "One sentence for staff: what they want" },
        nickname: { type: "string", description: "Short job name, e.g. 'Terrible Toddler'" },
        due_date: { type: ["string", "null"], description: "In-hands date YYYY-MM-DD only if the customer gave one" },
        due_firm: { type: "boolean", description: "True when the paperwork or email says the in-hands date is firm (FIRM, hard date, must have by, event date, no later than)" },
        po_number: { type: "string" },
        delivery: { type: ["string", "null"], enum: ["pickup", "ship", "deliver", null] },
        ship_to: { type: "string" },
        customer_notes: { type: "string", description: "The customer's own notes and instructions for this job, word for word: the ClickUp job's notes (e.g. \"NOT A REPEAT ORDER - NEW LEFT CHEST LOGO. Screen print process same as order 85254 from 4/2026\"), the PO's special instructions, what their email says about how to do the job. Never your own words, guesses or questions. Empty if they wrote none. These go on the order's Customer notes." },
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
          description: { type: "string", description: "What the customer says about everything in this group that the garments and prints don't hold: how it's packed, bagged, labeled or tagged, what it's for. Plain words, one or two sentences; empty if nothing. Not who supplies the garments or their tracking (that's goods)" },
          garments: { type: "array", items: { type: "object", properties: {
            style: { type: "string" }, brand: { type: "string" }, description: { type: "string" }, color: { type: "string" },
            sizes: { type: "object", description: "Size code to quantity, e.g. {\"6M\":5,\"12M\":5,\"2T\":4}", additionalProperties: { type: "integer" } },
            reorder_line: { type: ["integer", "null"], description: "For a reorder: the L number of the past job's line this is" },
            note: { type: "string", description: "A note for this line only: \"Extras\" for an extras / overage line, a product or design name the PO lists apart from the style, a size breakdown that doesn't fit our sizes (waist sizes). Empty if nothing" },
            called: { type: "string", description: "Rule 3c: only when the email and its files don't name the garment's style: what they called it, word for word (\"tees\", \"hoodies\", \"the shirts\"). Then style stays empty. Empty when the style is named" },
            look: { type: ["object", "null"], description: "Rule 3d: when a photo or drawing in the files shows this garment, what it looks like, so it can be drawn when it isn't in our catalog. Null when nothing shows it.", properties: {
              kind: { type: "string", enum: ["tee", "long", "crew", "hoodie", "polo", "quarter", "vest", "puffer", "jacket", "tank", "hat", "beanie"] },
              hex: { type: "string", description: "#rrggbb: the body's color as it looks in the photo (not shadows or highlights)" },
              trim: { type: ["string", "null"], description: "#rrggbb of the zipper, binding, collar lining, snaps or drawstrings when they're a different color from the body; else null" },
              heather: { type: "boolean" }, stripes: { type: ["string", "null"], description: "#rrggbb of stripes across the body; else null" }, quilted: { type: "boolean" },
            } },
          } } },
          prints: { type: "array", items: { type: "object", properties: {
            method: { type: "string", enum: ["screen", "embroidery", "dtf"], description: "embroidery = sewn with thread: the customer says embroidered, embroidery, stitched or 'emb', a stitch count or a DST/EMB file is mentioned, or it's a logo on a cap or polo they want embroidered. Otherwise screen (printed)" }, location: { type: "string" },
            stitches: { type: ["integer", "null"], description: "Embroidery only: the stitch count when the email or the digitizer's sheet states it (e.g. 7,450). Null otherwise" },
            colors: { description: "Ink colors in the art (not the shirt color, not the underbase), or 'full'", anyOf: [{ type: "integer" }, { type: "string", enum: ["full"] }] },
            inks: { type: "string", description: "The ink colors by name ONLY when an email, a spec box or the paperwork names them (e.g. 'Gold, Black', 'PMS 286'). Never a guessed ink name: when nothing names the inks, leave this empty and the colors come from the art itself (Oct 23, Logotology #40110: 'Reflex Blue' was guessed for art that's Electric Blue and the mockup came out the wrong blue)" },
            size: { type: "string", description: "Print size only if the customer states it, e.g. '10\" wide' (it's then kept as theirs)" },
            notes: { type: "string" },
            art_file: { type: ["integer", "null"], description: "The File number of the art printed here" },
            art_file_name: { type: ["string", "null"], description: "That file's exact name, written out (e.g. \"SS-logo--1-.png\"): the check that art_file points at the right file" },
            width_in: { type: ["number", "null"], description: "Width of the print in inches, judged from the customer's mockup against the garment (see the sizing note). Null when there is no mockup showing it." },
            drop_in: { type: ["number", "null"], description: "Only when the customer states how far below the collar the print goes; otherwise null (we use our standard placement)." },
            same_as_job: { type: ["integer", "null"], description: "A NEW order that says this print is done like a past job ('same process as order 85254', 'back same as last time'): the J number of that past job. Its print at the same location gives the colors, inks and size; the art still comes from art_file. Null otherwise." },
          } } },
          mockup_files: { type: "array", items: { type: "integer" }, description: "File numbers of mockups for these garments" },
          cut_from: { type: ["object", "null"], description: "Rule 4d: a product sheet (one page, several products, each a product photo with its logo drawn beside it over a width line): where THIS group's product photo and logo are on the page, as fractions of the page (0,0 = top-left corner, 1,1 = bottom-right). Code cuts the logo (the print's art) and the photo (their mockup) out exactly; give generous boxes around each. Null for anything else.", properties: { file: { type: "integer" }, page: { type: "integer", description: "1 = first page" }, photo: { type: "array", items: { type: "number" }, description: "[left, top, right, bottom] of the product photo" }, logo: { type: "array", items: { type: "number" }, description: "[left, top, right, bottom] of the logo only (not its width line or the spec text under it)" } } },
          shown_in: { type: ["object", "null"], description: "The file and page that pictures THIS group's print the way it should look (a work order page showing this variation's logo, their mockup of these garments): shown to staff beside the art you picked. Null when nothing pictures it.", properties: { file: { type: "integer" }, page: { type: "integer", description: "1 = first page" } } },
          reorder_of: { type: ["integer", "null"], description: "A reorder of several past jobs in one order (one per design): the J number of the past job THIS group repeats" },
          finishing: { type: "array", items: { type: "string", enum: finishingIds.length ? finishingIds : ["none"] } },
        } } },
        sheet_counts: { type: "array", description: "Rule 3b: EVERY size sheet on its own, exactly what that one sheet lists (nothing added across sheets). Code adds the sheets together and checks each against its total.", items: { type: "object", properties: {
          file: { type: "integer", description: "The sheet's File number" },
          file_name: { type: "string", description: "The sheet's exact file name" },
          sheet_total: { type: ["integer", "null"], description: "The total the sheet itself states (a Total line, or the number in its name like 550PCS); null if none" },
          garments: { type: "array", items: { type: "object", properties: { style: { type: "string" }, color: { type: "string" }, sizes: { type: "object", additionalProperties: { type: "integer" } } }, required: ["style", "color", "sizes"] } },
        }, required: ["file", "garments"] } },
        questions: { type: "array", items: { type: "string" }, description: "What we still need to ask the customer, in plain words" },
        check_with_staff: { type: "array", description: "What staff must answer BEFORE the order is made (rule 11): contradictions, things you couldn't find or place. Empty when it all adds up. Never ask about a color count one more than the inks named on a shirt that isn't white: that extra color is the white underbase.", items: { type: "object", properties: {
          question: { type: "string", description: "ONE short question, 15 words at most, no explaining or background (Oct 23, Nick: the questions are \"very long-winded… it's not succinct\"). e.g. '\"Best fit for onesie\" on the work order: no onesies here. Ignore it?' or 'Neon Blue for \"NeonBlue\"?'" },
          guess: { type: "string", description: "What you'll do if they don't say otherwise: 8 words at most (e.g. 'Ignore the note', 'Gildan 64400 Neon Blue')" },
          about: { type: "string", description: "The name of the group it's about, exactly as you named it in groups (e.g. 'Variation 2'); empty when it's about the whole order" },
          choices: { type: "array", description: "2 to 4 answers to click, the first being your guess. When the answer is one of the files (which art goes on a group, which mockup), give each choice its file so staff pick by the picture; otherwise short words ('Ignore it', 'Onesies too').", items: { type: "object", properties: { label: { type: "string", description: "6 words at most" }, file: { type: ["integer", "null"] } }, required: ["label"] } } }, required: ["question", "guess"] } },
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
/** which rules a saved reading was made with: raise it when the reader's rules change, and a saved reading made
 *  before is read again when Create order opens it (Oct 24, Nick: the fix didn't show because the old reading was reused) */
export const READER_REV = "2026-10-27a";

export async function suggestEmailOrder(admin: SupabaseClient, activityId: string, by: string, o: { told?: string; jobRef?: string | null; /** several past jobs reordered together in one order (one group per design) */ jobRefs?: string[]; reorderOk?: boolean; lookedUp?: LookedUp | null; /** one of several orders in the email (lib/ai/emailPlan.ts): its files only, saved apart */ part?: EOPart | null;
  /** which emails make up the order, picked in Create order (Oct 24, Nick): other emails brought in, conversation emails left out */ include?: string[]; exclude?: string[] } = {}): Promise<{ ok: true; draft: EODraft; past: PastJob[] } | { ok: false; error: string }> {
  const { settings, ready, reason } = await aiState(admin);
  if (!ready) return { ok: false, error: reason };
  const cv = await emailConversation(admin, activityId);
  if (!cv) return { ok: false, error: "Email not found." };
  // the whole conversation, whichever email it's started from (Oct 12, Nick: "if you do a task it starts from the
  // last email forward… he gave me the sizes, then updated sizes… I should create the order from my response or any
  // point in the conversation and it still gathers all the details"). The newest email from the customer is the one
  // read in full; what was decided along the way counts, and the latest decision wins. Other recent emails with the
  // customer (other subjects) come after, marked as other topics.
  const { clicked: C, near } = cv;
  // the emails staff picked (Create order asks which make up the order): conversation emails unticked are left out,
  // other emails from the customer ticked are added, all in date order, newest first
  const drop = new Set((o.exclude || []).filter((id) => id !== C.id)), add = new Set(o.include || []);
  const convo = [...cv.convo.filter((e) => !drop.has(e.id)), ...near.filter((e) => add.has(e.id) && !cv.convo.some((x) => x.id === e.id))]
    .sort((x, y) => y.occurred_at.localeCompare(x.occurred_at));
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
  const memText = [memoryText(mems, String(cust?.company || cust?.name || "this customer")), shopRulesText(await loadShopRules(admin).catch(() => []))].filter(Boolean).join("\n\n");
  // numbers in the email (or the ClickUp job's notes) too: "Reorder from 86798" names the job by their PO
  const said = `${String(a.subject || "")} ${String(a.body || "").slice(0, 3000)} ${atts.filter((f) => !CAMERA_NAME.test(f.name)).map((f) => f.name.replace(/[_-]+/g, " ")).join(" ")}`;
  let past = [...await jobsNamed(admin, `${told} ${mems.map((m) => m.text).join(" ")} ${said}`, (a.customer_id as string) || null, recent).catch(() => []), ...recent];
  // the past job whose mockup is the picture in their email (app/api/inbox/order/look): first, and said so
  const lookRef = ((a as { meta?: { look?: { ref?: string; why?: string } } }).meta?.look?.ref) || "";
  if (lookRef) {
    const lj = past.find((j) => j.ref === lookRef);
    if (lj) past = [{ ...lj, note: [`The picture in the email is this job's mockup (${(a as { meta?: { look?: { why?: string } } }).meta?.look?.why || "the same design"}).`, lj.note].filter(Boolean).join(" ") }, ...past.filter((j) => j !== lj)];
  }
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
  const { images, documents, listing, confirms } = await readFiles(admin, atts, sigs);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long" });
  const fin = (settings.finishing || []).map((f) => `${f.id} = ${f.name}`).join("; ");
  const system = `${SHOP_CONTEXT(settings as Settings)}
More sizes: infant NB, 6M, 12M, 18M, 24M and toddler 2T, 3T, 4T, 5T. Ranges like 3-6M or 6-12M are written as the top month (6M, 12M).

Your job: a customer emailed the shop. Read the email and every attached file (pictures, PDFs, spreadsheet contents) and fill in the order for staff to check. Today is ${weekday} ${today}.
0. Before taking any numbers, read the email like a person: how is it laid out, and why? Look at the headings and at what repeats. When the same designs come again under headings such as store or location names (e.g. ****Frisco**** then ****McKinney****, "see break out by location"), departments, people or ship-to places, that's ONE order broken out by those headings, not separate garments and never to be added together: make ONE group per design (name the group with the design, e.g. "T10A Autumn Tee"), and in it one garment line per heading, with the heading as that line's description (e.g. "Frisco"). The same style and color under two headings is two lines. When you can't tell what a heading or split means, keep the parts apart anyway and ask in questions what it is. Check your totals against any the customer gives ("T10A total tees 348").
1. Decide what it is. NEW = something built from scratch: a new design, new garments. REORDER = the same job as one we printed before, again ("reorder", "same as last time", "more of the ___ shirts", a past design or job named). For a reorder set reorder_of to the past job's J number and list its garment lines with reorder_line = the L number and the NEW quantities. If they want it exactly as before without numbers, copy the old quantities and ask to confirm. A design code or name in the email (T10A, "the Bottles") that matches a past job's name means that job. When one email reorders several designs that were separate past jobs, it's still one order: one group per design, each group's reorder_of = its own job's J number (top-level reorder_of = the first). If the customer attached the art on a reorder, still set art_file on each print: staff choose between their files and the old job's. NEW WITH A REFERENCE (Oct 23, Logotology PO 92785: "NOT A REPEAT ORDER - NEW LEFT CHEST LOGO. Screen print process same as order 85254"): it's NEW (kind new), set reference_job to that past job's J number (a number they give can be their PO on it: "PO 85254" is Printavo #32303), and on every print that matches one of that job's prints (same location, or the same side), set same_as_job to it: those prints print the same way (colors, inks, size); the art still comes from the files they attached. A new print (the new left chest) is set up as usual.
2. Say what every attached file is: art (the print file: just the design, nothing else on the page), mockup (the design shown on a garment), setup_sheet (the customer's own mockup sheet: the art shown big, usually on a flat background panel with a note like "BACKGROUND DOES NOT PRINT", a spec box with the location, the size and the inks (Pantone / PMS), and the design on the garment, often on a second page; give art_page and mockup_page), size_breakdown (styles, colors, sizes and quantities), signature (the sender's email signature: their company logo, social icons, a banner; never art or a mockup), other (unrelated files). A file's NAME says what it is, the way staff read it: "Purchase_Order_91537" is their purchase order, "Work_Order_91537" their work order, "SS-logo" the logo. The paperwork (purchase order, work order, invoice, quote, packing slip) is read for the garments, sizes, locations, inks and notes, and is never the art: a purchase order is size_breakdown, a work order other (even when it shows the design on a shirt); set art_file to the art files, and take a number in a paperwork name (91537) as their PO number.
3. Garments: style number, brand, color and every size quantity exactly as the email or the size sheet gives them. Read every number from a size sheet; don't round or total. One garment entry per style + color. A size sheet lists only the sizes they want: a size it leaves out (no XL, no XS, no 3XL) just isn't ordered, so never ask about it; and when the sizes you read add up to the sheet's own total ("375PCS" in its name, a Total line), they're right: don't ask about them (Oct 24, Nick: Dear Heart's sheet had the L and it still asked "no L size listed… skips L?"). Several size sheets for one order (Oct 24, Nick: Dear Heart's In Every Season, 550 + 400 = 950 pcs, read as 1,025 every time): read each sheet on its own first and check it adds up to that sheet's own total (its "550PCS" name or Total line) before adding sheets together; add a style + color + size from two sheets only when both sheets really list it, and never count one sheet's column twice. The order's total must equal the sheets' totals added together. 3b. Whenever quantities come from size sheets (PDFs or spreadsheets), also fill sheet_counts with one entry per sheet: that sheet's garments and sizes exactly as printed on it, and its own stated total. Don't add sheets together there; code does that and checks each sheet.
3c. READ THE EMAIL COLD for the garment (Oct 26, Nick: "read the email like you knew nothing about the client… if you can't determine what it is… you should ask"): a style is only what the email or its files actually name (a style number like 6210 or 3001CVC, or an exact product like "Comfort Colors 1717"), or the past job it reorders. When they just say "tees", "hoodies", "shirts", "the usual" with no style, leave style AND brand empty and put what they called it in called. Never fill a style from what you know about the customer, their past orders or what's common: staff are asked, with the customer's preferred goods (Create order asks; don't put it in check_with_staff). Their colors and sizes still go on the line as they wrote them ("black", "the gray").
3d. A GARMENT YOU CAN SEE (Oct 27, Nick on Peter Millar's Ridge Vest: "I don't have Peter Millar in my system, I've got to draw that"): when a photo or drawing in the files shows the garment (a product sheet, their mockup, a setup sheet's garment page), fill its look: kind (the closest of tee, long, crew, hoodie, polo, quarter, vest, puffer, jacket, tank, hat, beanie: a sleeveless jacket is a vest, a quilted or insulated vest a puffer, a zip or snap jacket with sleeves a jacket, a pullover with a short zip a quarter), hex (the body's color as it looks in the photo, not its shadows), trim (zipper, binding, snaps, collar lining or drawstrings in another color), heather, stripes, quilted. Retail brands and products we don't stock (Peter Millar, Rhone, Vuori, Little Sleepies…) are drawn from this, so never skip it when the garment is pictured. Leave look null when nothing pictures the garment.
4. Prints: one per location. Set art_file to the file whose art prints there and write its name in art_file_name; when several art files are close (two colorways of one logo), match each to its print by what the files show (the work order's or mockup's picture of each variation: blue art on Variation 1, black on Variation 2), not by the order the files came in.  Count the ink colors in the art (spot colors; don't count the shirt color; a white underbase on dark garments isn't counted), name them, and set art_file. Take the location from the mockup when it shows it, using our names: ${LOCATIONS.join(", ")}. HEADWEAR has its own spots (Oct 26, Nick): caps, hats, truckers and snapbacks print only on Full Front, Left Side, Right Side or Back; a visor only on Front; a beanie only on Cuff. Give size only if it's stated in words.
4b. When a customer mockup shows the print on the garment, we remake their mockup in our own system so it must look the same: look closely and measure. Location: a small print on the wearer's left chest is Left Chest; a print centered across the chest is Full Front, or Center Chest only for a small logo (under about 5" wide on an adult, about a quarter of the chest width or less). On toddler, infant and youth garments judge by the share of the chest, not inches: a print across half or more of a toddler's chest is Full Front. Width: compare the print's width to the garment's chest width (armpit to armpit) in the picture, then scale to the real garment: adult Large tee 22", adult Medium 20", youth Large 18", youth Small 16", toddler 2T 12", 3T 12.75", 4T 13.5", infant 12M 9.5" (use the middle size of the order's run). Example: a print about 60% of a 3T's chest is about 7.5" wide. Measure the inked art only (from its leftmost to rightmost ink), not empty space around it, and judge the chest width at the armpits, not the sleeves. Give width_in to the nearest quarter inch, Leave drop_in null unless the customer states how far down it goes. Never invent these without a mockup.
4c. A setup_sheet (a customer's mockup sheet) often has two pages: the art page (the art shown big, often on a black or colored background with a note like "BLACK DOES NOT PRINT", and a spec box naming the location such as "Front screenprint", the size like 11.75"w x 6.25"t and the ink colors) and a mockup page (the design on the garment, with the style and color). Take the location, size and inks from the spec box (that size is the customer's own), use the PDF as the print's art_file AND as the group's mockup_files (staff cut the art off the art page). Give the size as written (11.5"w x 10.4"t → size "11.5\" wide", width_in 11.5) and each ink by its Pantone name (inks "Pantone 7499, Pantone 7597", colors 2). Take the garment's style and color from the mockup page when the email doesn't say. The background color isn't an ink. On a reorder, what the customer's own files show (the spec box, their mockup) wins over the old job's location, size and inks: use theirs, and say in notes what the old job had.
4e. A decoration order sheet (Oct 26, Nick on Effing Gear's hat spreadsheet: "it's not even getting close… I want you to ask and not just make assumptions… what are the columns?"): a spreadsheet with ONE ROW PER LINE and columns like Finished hat, Supplier, Supplier order, Blank style, Blank color, Size, Qty, Method, Artwork, Thread instruction, Placement. Read its header row first and use each column for what it says: the blank style + blank color are the garment (style = the brand and style number as written, "Richardson 115", "Flexfit 110M"; color = the blank color exactly, two-tone colors like "Black/Neon Pink" kept whole), Qty is the quantity, Size is the size (hats: "M/L", "S/M", "Adjustable", "One Size", "OSFA" are one-size: sizes {"OS": qty}, and a fitted size like M/L goes in the line's note as "Size M/L"). Every row is its own garment line: never merge two rows, never drop one; the lines must add up to the sheet's own total ("154 hats"). Group by what's printed: rows with the same artwork, method and placement are one group; a different artwork or placement is another group. A thread or ink instruction that changes per row ("Match Neon Pink", "White", "Match Teal") is that row's thread: when the rows of one group need different threads, split the group by thread (name the group by the artwork and thread, e.g. "Effing Bird · Neon Pink") and put the thread in the print's inks. Supplier and supplier order columns (S&S #77242977, OpenTip #6479673) are where the blanks come from: put them in goods (supplier, note with the order numbers), not in the garments. When a column's meaning isn't clear, or a value doesn't fit (a size you don't know, a quantity that doesn't add up, a placement you can't place, a thread that's ambiguous), ask in check_with_staff with your best guess: don't assume.
4d. A product sheet (Oct 26, Nick on Cedar Promo's Embark sheets: "he is expecting us to pull sizing, make a mock-up, and then use that to create the art also… that is your production file"): ONE page (or a few) with several products, each a title in caps (the product: brand, product name and color, e.g. "RHONE LONG GAME JACKET PURE BLACK"), a photo of the product (their mockup), the logo drawn beside it over a width line ("3” W" = 3" wide), the method and location ("SCREEN PRINT ON LEFT ARM", "EMBROIDERY ON LEFT ARM"), the ink or thread ("PMS COOL GRAY 4C", "TO MATCH THE BUTTON SNAPS OF THE JACKET": the thread matches that part, so name the color that part is in the photo with the instruction, e.g. inks "Gold (match the snaps)", never a guess like "Tan"), the color, and the sizes with a TOTAL. Each product is its own group: the product title is the garment (brand = the brand in it, style = the product name as written, color = the color line), the sizes from its own list (SM = S, MD = M, LG = L; check them against its TOTAL), one print with the method, location, width ("3\" wide") and inks as written. The logo on these sheets is often drawn in black or on a panel just to show it: the inks are only what the spec names ("PMS COOL GRAY 4C" alone is 1 color: colors 1, inks "PMS Cool Gray 4 C"); never add the color the logo happens to be drawn in. The sheet is the art: art_file = the sheet's File number, mockup_files = [the sheet], file role setup_sheet, and cut_from = where that product's photo and logo are on the page. These are retail brand garments (Rhone, Peter Millar, Little Sleepies…), not in our catalog: the customer supplies them unless the email says we buy them; ask if unsure.
5. Garments that share the same prints are one group, with the mockup files for them. Instructions for a whole group (rolled and rubber-banded, tagged with UPCs, boxed by location) go in that group's description.
6. Wholesale customers usually buy their own blanks and send them to us: set garments_supplied_by and the goods (supplier, when they should arrive).
7. Finishing (only if asked, or this customer's past jobs always had it): ${fin || "none set up"}.
8. Read the WHOLE conversation, not just the newest email: customers decide over many emails (the garment and color picked from our options, the sizes, a price we agreed, the date they need it, then the art last). The latest decision wins (a size list sent later replaces an earlier one; the style they finally chose replaces the ones they considered). Prices and terms WE wrote are what was agreed: put them in the notes for staff, and don't ask the customer again for anything already settled in the conversation.
${PO_RULES}
9. Art sent as a link (a file marked "from a link", e.g. a Canva design preview): use it as the art for the mockup. A Canva preview is a picture, not a print file: say in questions that we'll need the print file (PDF or SVG) unless a real file came with it.
Never invent prices or dates. Anything unclear or missing goes in questions, written to the customer in plain words.
10b. A REORDER REUSES THE PAST JOB'S ART: when this is a reorder of a past job and the email brings no new art for a design, the past job's art is the art: use it and never ask (Oct 24, Nick on Dear Heart's Jesus Changes Everything: "what is this asking?"). Ask about art only when the email says the art changes or sends a different file. In any question or note, name a past job by its number (#34298) and name, never by its J1/J2 label.
11. CHECK WITH STAFF FIRST (Oct 22, Nick: "take steps to get things right, but when there's a clear contradiction, or I can't find this product, or there's a clear anything, you need to just ask… I'm processing this for the first time, and then remember it moving forward"). Before the order is made, ask the shop in check_with_staff about anything that doesn't add up, with your best guess: a note or spec that contradicts the order ("best fit for onesie" with no onesies in it), two files that disagree (PO vs work order sizes, quantities, colors), a style or color written oddly or not one you know ("NeonBlue": Neon Blue?), a garment you can't identify, a file you can't place, a size grid that doesn't add up, a print with no location or art. Don't ask what the files settle (a color count one more than the inks named, on a shirt that isn't white, is the white underbase: not a question, set colors to the named inks), and don't ask what staff already told you or taught you about this customer. Never copy a contradicting note into the order as if it applied: ask instead. Keep each question to one short line (15 words at most) and the guess to a few words; one question per thing; no explanations. Say which group it's about (about), and give choices to click, with their files when the answer is a file (which art goes on Variation 2: both logos). Give every group its shown_in when a file pictures it. Don't repeat the question in the print notes either.
12. READ THE PAPERWORK'S PICTURES LIKE A PERSON (Oct 23, Nick on Logotology's Work_Order_91537: "page two shows the blue gray logo across the front of a shirt… that's the same as listing the imprint color… page four shows me it's all black"). A work order, PO or proof often has no ink names, only a picture of each variation's print (the logo as it prints, often on a shirt). That picture IS the spec: which art goes on which variation, where, and in what colors. Match each variation to the art file that looks like its picture (the blue/gray logo → SS-logo.png; the all-black logo → SS-logo-black.pdf) and don't ask about it. When the picture's colors are the art file's own colors, leave inks empty (the art's colors are used); when the picture shows the art in different colors than the file (the blue logo printed all black), say so in inks by plain color name ("Black"). Never ask staff to confirm colors a picture already shows. Art sitting on a solid box (a black square behind the logo): the box isn't an ink when it's the shirt's color; count only the other colors, and don't ask about the box (Create order asks that itself, with the picture). The same for any color in the art that's the shirt's own color (black lines in the art on a black shirt, yellow on a yellow shirt; not a heathered shirt): it doesn't print, the shirt shows through, so never count it as an ink and never ask about it (Oct 23, Nick: "black on a black shirt, you should always think I'm removing it").
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
    task: "order_from_email", model: settings.assistant.ai.model, maxTokens: 8000, timeoutMs: 58_000,
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
        // a sheet that names its products (Effing Gear's hats: Richardson 115, Flexfit 110M…) keeps the line's own product
        for (const u of unmatched) p.groups[0].garments = [...(p.groups[0].garments || []), { ...(like && !u.product ? { brand: like.brand, description: like.description } : {}), style: u.product || style, color: u.color, sizes: { ...u.sizes }, ...(u.note ? { note: `Size ${u.note}` } : {}) } as (typeof all)[number]];
        // more than one design: which design these go on is staff's call, not a guess (Oct 26, Nick: "ask and not just make assumptions")
        if ((p.groups || []).length > 1) {
          const ck = ((p as { check_with_staff?: unknown[] }).check_with_staff ||= []) as { question: string; guess: string; about?: string; choices?: { label: string }[] }[];
          const names = unmatched.map((u) => `${u.product ? `${u.product} ` : ""}${u.color} (${u.total})`).slice(0, 4).join(", ");
          ck.push({ question: `Sheet lines not placed on a design: ${names}${unmatched.length > 4 ? "…" : ""}. Which design?`.slice(0, 160), guess: `Put on ${p.groups[0].name || "the first design"}`, about: "", choices: (p.groups || []).slice(0, 4).map((g) => ({ label: String(g.name || "").slice(0, 40) || "Design" })) });
        }
      }
    }
  }
  // the size sheets read one by one and added up HERE, not by the AI (Oct 24, Nick: Dear Heart's In Every Season,
  // 550 + 400 = 950 pcs, read as 1,025 every time). Each sheet is checked against its own total (its "550PCS" name or
  // Total line); when every sheet adds up, the garments get the sheets' sums; when one doesn't, it's said exactly
  let countNote = "";
  {
    type SC = { file?: number; file_name?: string; sheet_total?: number | null; garments?: { style?: string; color?: string; sizes?: Record<string, number> }[] };
    const sc = (((p as { sheet_counts?: SC[] }).sheet_counts) || []).filter((x) => x && Array.isArray(x.garments) && x.garments.length);
    const all = (p.groups || []).flatMap((g) => g.garments || []);
    if (sc.length && all.length) {
      const qty = (v: unknown) => Math.max(0, Math.min(100000, Math.floor(+(v as number) || 0)));
      const sumOf = (sz?: Record<string, number>) => Object.values(sz || {}).reduce((a, v) => a + qty(v), 0);
      const off: string[] = [];
      for (const x of sc) {
        const nm = String(x.file_name || atts[(x.file || 0) - 1]?.name || "a sheet");
        const named = +((nm.match(/(\d[\d,]*)\s*PCS/i)?.[1] || "").replace(/,/g, "")) || 0;
        const want = named || qty(x.sheet_total), got = (x.garments || []).reduce((a, gm) => a + sumOf(gm.sizes), 0);
        if (want && got !== want) off.push(`${nm} adds to ${got.toLocaleString("en-US")}, it says ${want.toLocaleString("en-US")}`);
      }
      const ns = (t?: string) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const same = (a?: string, b?: string) => { const x = ns(a), y = ns(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
      if (!off.length) {
        const tot: { style: string; color: string; sizes: Record<string, number> }[] = [];
        for (const x of sc) for (const gm of x.garments || []) {
          let t = tot.find((q) => same(q.style, gm.style) && ns(q.color) === ns(gm.color));
          if (!t) { t = { style: String(gm.style || ""), color: String(gm.color || ""), sizes: {} }; tot.push(t); }
          for (const [z, q] of Object.entries(gm.sizes || {})) { const n = qty(q); if (n) t.sizes[z] = (t.sizes[z] || 0) + n; }
        }
        const drop = new Set<object>(), used = new Set<object>(), miss: string[] = [];
        for (const t of tot) {
          const hits = all.filter((gm) => same(gm.style, t.style) && ns(gm.color) === ns(t.color));
          if (!hits.length) { miss.push(`${t.style} ${t.color}`); continue; }
          hits[0].sizes = { ...t.sizes }; used.add(hits[0]);
          for (const h of hits.slice(1)) if (!used.has(h)) drop.add(h);
        }
        if (drop.size) for (const g of p.groups || []) g.garments = (g.garments || []).filter((gm) => !drop.has(gm));
        if (miss.length) countNote = `On the size sheets but not matched to a garment line: ${miss.join(", ")}.`;
      } else countNote = `The size sheets don't add up as read: ${off.join("; ")}.`;
    }
  }
  // supplier order confirmations read by code (lib/supplierConfirm.ts): their quantities, added up across every
  // confirmation in the order, go on the garments exactly; this wins over the AI's reading of them
  if (confirms.length) {
    const cf = supplierConfirms(confirms), all = (p.groups || []).flatMap((g) => g.garments || []);
    if (cf.lines.length && all.length) {
      const { unmatched, extra } = applySheetSizes(all, cf.lines);
      for (const g of p.groups || []) g.garments = (g.garments || []).filter((x) => !extra.has(x));
      if (unmatched.length && p.groups?.[0]) for (const u of unmatched) p.groups[0].garments = [...(p.groups[0].garments || []), { style: u.product.split(" - ").pop() || "", description: u.product, color: u.color, sizes: { ...u.sizes } } as (typeof all)[number]];
      countNote = "";
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
  const refNotes: string[] = [];
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
    const pgs = (p.groups || []).map((pg) => ({ ...pg, garments: (pg.garments || []).map((x) => (!String(x.style || "").trim() && usual && !String((x as { called?: string }).called || "").trim() ? { ...x, style: usual } : x)).filter((x) => {
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
    // the past jobs prints copy their process from: their mockups go in this order's Production files to look at
    const refUsed = new Map<PastJob, Group>();
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
        // embroidery: a stitch count they gave (a digitizer's sheet, the email) is kept as stated
        const stc = Math.round(+((pr as { stitches?: number | null }).stitches || 0));
        if (im.method === "embroidery" && stc >= 300 && stc < 200000) { im.stitches = stc; im.emb = { ...(im.emb || {}), stitchesFrom: "staff" }; }
        // done like a past job's print ("same process as order 85254"): its colors, inks and size, and its mockup to look at
        const sj = jobAt((pr as { same_as_job?: number | null }).same_as_job);
        if (sj) {
          const side = (l: string) => (/back|yoke|shoulder|nape/i.test(l) ? "b" : "f");
          const olds = sj.groups.flatMap((x) => x.imprints.map((o2) => ({ o2, x })));
          const hit = olds.find((z) => z.o2.location === im.location) || olds.find((z) => side(z.o2.location) === side(im.location));
          if (hit) {
            const o2 = hit.o2, lab = sj.label.replace(/\s*\(Printavo\)$/, "");
            if (o2.colors) im.colors = o2.colors;
            if (!im.inks && o2.inks) im.inks = o2.inks;
            if (!String(pr.size || "").trim() && o2.size) im.size = o2.size;
            if (o2.method) im.method = o2.method;
            // its mockup: our picture of it, else its mockup PDF (Printavo #32303 had only the PDF)
            const pic = ((hit.x.pvRef || [])[0]?.path) || ((hit.x.pvArt || [])[0]?.path) || (sj.groups.flatMap((x) => [...(x.pvRef || []), ...(x.pvArt || [])])[0]?.path) || "";
            // its mockup PDF (ours, art over the shirt photos): the print's size is measured off it when the job didn't keep one
            const pdf = ((hit.x.pvArt || [])[0]?.path) || (sj.groups.flatMap((x) => x.pvArt || [])[0]?.path) || "";
            const pdfs = [...new Set([pdf, ...sj.groups.flatMap((x) => (x.pvArt || []).map((f) => f.path))].filter(Boolean))].slice(0, 4);
            im.sameAs = { ref: sj.ref, label: lab, ...(pic ? { pic } : {}), ...(pdf ? { pdf, pdfs } : {}) };
            im.notes = [im.notes, `Same process as ${lab}: ${o2.colors} color${o2.colors === 1 ? "" : "s"}${o2.inks ? ` (${o2.inks})` : ""}${o2.size ? `, ${o2.size}` : ""}`].filter(Boolean).join(". ").slice(0, 300);
            if (!refUsed.has(sj)) refUsed.set(sj, g);
          }
        }
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
    // the reference job (named, even with no print tied to it): its mockups in Production files, and said in the notes
    const rj = jobAt((p as { reference_job?: number | null }).reference_job);
    // every print that matches one of the reference job's prints takes how it printed, not only the ones the reader tied
    // (Oct 23, #40116: the reader tied only the Left Chest, so the Full Back missed #32303's size and inks)
    const refJobs = [...new Set([...(rj ? [rj] : []), ...refUsed.keys()])];
    for (const g of groups) for (const im of g.imprints) {
      if (im.sameAs || !refJobs.length) continue;
      const side = (l: string) => (/back|yoke|shoulder|nape/i.test(l) ? "b" : /sleeve/i.test(l) ? "s" : "f");
      for (const sj of refJobs) {
        const olds = sj.groups.flatMap((x) => x.imprints.map((o2) => ({ o2, x })));
        const hit = olds.find((z) => z.o2.location === im.location) || olds.find((z) => side(z.o2.location) === side(im.location));
        if (!hit) continue;
        const o2 = hit.o2, lab = sj.label.replace(/\s*\(Printavo\)$/, "");
        if (o2.colors) im.colors = o2.colors;
        if (!im.inks && o2.inks) im.inks = o2.inks;
        if (o2.method) im.method = o2.method;
        const pic = ((hit.x.pvRef || [])[0]?.path) || ((hit.x.pvArt || [])[0]?.path) || (sj.groups.flatMap((x) => [...(x.pvRef || []), ...(x.pvArt || [])])[0]?.path) || "";
        const pdfs = [...new Set(sj.groups.flatMap((x) => (x.pvArt || []).map((f) => f.path)))].slice(0, 4);
        im.sameAs = { ref: sj.ref, label: lab, ...(pic ? { pic } : {}), ...(pdfs[0] ? { pdf: pdfs[0], pdfs } : {}) };
        im.notes = [im.notes, `Same process as ${lab}`].filter(Boolean).join(". ").slice(0, 300);
        if (!refUsed.has(sj)) refUsed.set(sj, g);
        break;
      }
    }
    if (rj && !refUsed.has(rj) && groups[0]) refUsed.set(rj, groups[0]);
    for (const [j, g] of refUsed) {
      const lab = j.label.replace(/\s*\(Printavo\)$/, "");
      const add = j.groups.flatMap((x) => [...(x.pvRef || []), ...(x.pvArt || [])]).slice(0, 4).map((f) => ({ ...f, kind: "old_mockup", note: `The job this order is printed like: ${lab}` }));
      if (add.length) g.pvRef = [...(g.pvRef || []), ...add];
      refNotes.push(`Printed the same way as ${lab}${j.date ? ` (${j.date})` : ""}: its mockup is in Production files`);
    }
  }

  // hats, visors and beanies print on their own spots (Oct 26, Nick): a shirt location read for one moves to the spot it means
  for (const g of groups) for (const im of g.imprints || []) im.location = fitLocation(im.location, g.lines);
  const wholesale = cust?.price_type === "wholesale";
  const supplied = p.garments_supplied_by === "customer" || (wholesale && p.garments_supplied_by !== "shop");
  const draft: EODraft = {
    v: 2, kind: job ? "reorder" : "new", summary: (p.summary || "").slice(0, 400), confidence: p.confidence || "medium",
    nickname: (p.nickname || job?.label.replace(/^#\d+\s*/, "").replace(/\s*\(Printavo\)$/, "") || "").slice(0, 120),
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(p.due_date || "") ? p.due_date! : null,
    // a firm in-hands date (Oct 23, Nick on HALFF: "you should have checked firm date"): the order's Firm box
    firm: !!(p as { due_firm?: boolean }).due_firm || /\bfirm\b/i.test(`${(p as { customer_notes?: string }).customer_notes || ""} ${p.notes || ""}`),
    delivery: p.delivery && ["pickup", "ship", "deliver"].includes(p.delivery) ? p.delivery : "pickup",
    ship_to: (p.ship_to || "").slice(0, 500), po_number: (p.po_number || "").slice(0, 60),
    customerNotes: String((p as { customer_notes?: string }).customer_notes || "").trim().slice(0, 2000),
    notes: [...refNotes, p.notes || ""].filter(Boolean).join("\n").slice(0, 2000),
    goods: { supplied, supplier: supplierKey(p.goods?.supplier || ""), expected: (p.goods?.expected || "").slice(0, 120), note: (p.goods?.note || "").slice(0, 300) },
    groups, art, mockups, reorderOf: job?.ref || null, ...(reorderJobs.length > 1 ? { reorderJobs } : {}), ...(readingLeads && emailArt ? { emailArt: true } : {}),
    questions: (p.questions || []).map((q) => String(q).slice(0, 300)).slice(0, 10), files, ...(countNote ? { countNote } : {}),
    check: ((p as { check_with_staff?: { question?: string; guess?: string; about?: string; choices?: { label?: string; file?: number | null }[] }[] }).check_with_staff || []).map((c) => {
      const choices = (c.choices || []).map((x) => { const f = x.file ? files[x.file - 1] : undefined; return { label: String(x.label || f?.name || "").slice(0, 60), ...(f && f.role !== "signature" ? { path: f.path, name: f.name } : {}) }; }).filter((x) => x.label).slice(0, 4);
      return { q: String(c.question || "").slice(0, 300), guess: String(c.guess || "").slice(0, 200), ...(c.about ? { about: String(c.about).slice(0, 80) } : {}), ...(choices.length >= 2 ? { choices } : {}) };
    }).filter((c) => c.q).slice(0, 8),
    // the page that pictures each group's print (a work order's page per variation), shown beside the art at the check
    // a product sheet: where each group's photo and logo are, cut out at Create order (rule 4d)
    cuts: (p.groups || []).map((pg, gi) => { const cf = (pg as { cut_from?: { file?: number; page?: number; photo?: number[]; logo?: number[] } | null }).cut_from; const f = cf?.file ? files[cf.file - 1] : undefined; const bx = (b?: number[]) => (Array.isArray(b) && b.length === 4 && b.every((n) => Number.isFinite(+n)) ? b.map((n) => Math.min(1, Math.max(0, +n))) : undefined); return f && /pdf/i.test(`${f.type} ${f.name}`) && (bx(cf!.logo) || bx(cf!.photo)) ? { about: String(pg.name || `#${gi + 1}`), gi, path: f.path, name: f.name, page: Math.max(1, Math.min(40, Math.round(+(cf!.page || 1)))), photo: bx(cf!.photo), logo: bx(cf!.logo) } : null; }).filter((x): x is NonNullable<typeof x> => !!x),
    shown: (p.groups || []).map((pg) => { const si = (pg as { shown_in?: { file?: number; page?: number } | null }).shown_in; const f = si?.file ? files[si.file - 1] : undefined; return f && f.role !== "signature" ? { about: String(pg.name || ""), path: f.path, name: f.name, page: Math.max(1, Math.min(40, Math.round(+(si!.page || 1)))) } : null; }).filter((x): x is NonNullable<typeof x> => !!x),
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
    payload: { v: 2, rev: READER_REV, draft, groups: draft.groups, proposal: p, qty: r2(qtyOf(groups)), seen: convo[0].occurred_at, emails: convo.length,
      // what it was read with (the past job picked), so Create order can use a background reading when the same job is picked (Oct 26, Nick: "very slow")
      with: { job: o.jobRef || null, jobs: o.jobRefs || [], told: (o.told || "").slice(0, 400), emails: !!(o.include?.length || o.exclude?.length) } },
  };
  const { error } = await admin.from("ai_suggestions").upsert(row, { onConflict: "dedupe_key" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, draft, past };
}
