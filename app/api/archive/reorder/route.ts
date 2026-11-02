import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupsFromPrintavo } from "@/lib/ai/emailOrder";
import { createOrderFromDraft } from "@/lib/emailOrderCreate";
import { aiState } from "@/lib/ai/claude";
import { fillFromOldNotes } from "@/lib/ai/oldJobNotes";
import { oldNoteText, type EODraft } from "@/lib/emailOrderShared";
import { isSupplierPaperwork, looksLikePaperwork } from "@/lib/paperwork";
import { pvFileName, pvHandle } from "@/lib/printavoNames";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reorder on an archived Printavo job (staff only), through the Create order tool (components/tools/ReorderPick.tsx):
 *   GET  ?id=                          the old job's goods and EVERY file on it, each with a guess of what it is
 *   POST { id }                        the job as a new order to check: same garments, sizes and prints
 *   PUT  { customer, draft, status }   create it (the art pulled from the old mockup by the browser first)
 */
async function staff() { const v = await getViewer(); return v.user && v.isStaff ? v : null; }

export type ReorderFile = { key: string; name: string; path: string; thumb: string; mime: string; where: string; group: number;
  /** what it most likely is (the picker starts here): an art spot, or what to keep it as */ guess: string; why: string };

/**
 * The old job, listed plainly (Nov 1, Nick: "just list the goods, list the attachments, everything that's attached…
 * and then a quick picker… what are all these things? what should I do with them? Just sort them to the new order"):
 * every file on the job (its own files, each line's mockups, each print's mockups), one row each, with a first guess:
 * paperwork by its words (lib/paperwork.ts), a picture is a mockup, a PDF / AI / EPS that isn't paperwork is art
 * (the first the front, the next the back).
 */
export async function GET(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id") || "";
  const admin = createAdminClient();
  const { data: r } = await admin.from("archived_orders").select("id, visual_id, nickname, qty, order_date, total, files, data, customer_id").is("removed_at", null).eq("id", id).maybeSingle();
  if (!r) return NextResponse.json({ error: "That job isn't in the archive." }, { status: 404 });
  type F = { full?: string; mime?: string; name?: string; thumb?: string };
  type D = { files?: F[]; groups?: { lines?: { itemNumber?: string; brand?: string; color?: string; description?: string; items?: number; price?: number; sizes?: Record<string, number>; mockups?: F[] }[]; imprints?: { mockups?: F[]; details?: string; typeOfWork?: string }[] }[] };
  const d = (r.data || {}) as D, map = (r.files || {}) as Record<string, string>;
  // the files' original names ("COUNTITALLJOYSCREEN-BACK.pdf"), looked up from Filestack like the job's page does
  const handles = [...new Set(Object.keys(map).map(pvHandle).filter((h): h is string => !!h))];
  const names: Record<string, string> = {};
  for (let i = 0; i < handles.length; i += 150) {
    const { data: nm } = await admin.from("printavo_file_names").select("handle, filename").in("handle", handles.slice(i, i + 150)).not("filename", "is", null);
    for (const n of (nm || []) as { handle: string; filename: string }[]) names[n.handle] = n.filename;
  }
  const out: ReorderFile[] = [], seen = new Set<string>();
  const add = (f: F, where: string, group: number) => {
    const path = f.full ? map[f.full] : "";
    if (!path || seen.has(path)) return;
    seen.add(path);
    const ext = (path.split(".").pop() || "").toLowerCase();
    const real = pvFileName({ url: f.full, name: f.name, path, names });
    const nm = real && real !== "File" && !/^[A-Za-z0-9]{16,}\.\w+$/.test(real) ? real : `${where.replace(/^On the /, "").replace(/ line$/, "")} file ${out.length + 1}.${ext}`;
    out.push({ key: path, name: nm, path, thumb: (f.thumb && map[f.thumb]) || (/^(png|jpe?g|gif|webp)$/.test(ext) ? path : ""), mime: f.mime || "", where, group, guess: "", why: "" });
  };
  for (const f of d.files || []) add(f, "On the job", 0);
  (d.groups || []).forEach((g, gi) => {
    for (const l of g.lines || []) for (const m of l.mockups || []) add(m, `On the ${[l.itemNumber, l.color].filter(Boolean).join(" ")} line`, gi);
    for (const im of g.imprints || []) for (const m of im.mockups || []) add(m, "On a print", gi);
  });
  // first guesses: paperwork by its words; pictures are mockups; other art files in order, front then back
  const { pdfTextServer } = await import("@/lib/pdfTextServer");
  let arts = 0;
  for (const f of out) {
    const ext = (f.path.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") {
      const { data: blob } = await admin.storage.from("proofs").download(f.path).catch(() => ({ data: null }));
      const text = blob && blob.size < 25_000_000 ? await pdfTextServer(new Uint8Array(await blob.arrayBuffer()), 2).catch(() => "") : "";
      if (looksLikePaperwork(text)) { f.guess = isSupplierPaperwork(text) ? "supplier_order" : "order_sheet"; f.why = isSupplierPaperwork(text) ? "Reads like a supplier's order for the blanks" : "Reads like paperwork (a PO or size sheet)"; continue; }
      const firstLine = text.replace(/\s+/g, " ").trim().slice(0, 60);
      if (firstLine && !f.name.includes(firstLine)) f.why = `Says "${firstLine}${text.trim().length > 60 ? "…" : ""}"`;
    }
    if (/^(png|jpe?g|gif|webp)$/.test(ext)) { f.guess = "mockup"; f.why = f.why || "A picture: most likely a mockup"; continue; }
    if (/^(dst|exp|pes|jef)$/.test(ext)) { f.guess = "left_chest"; f.why = "An embroidery file"; continue; }
    if (/^(pdf|ai|eps|svg|psd)$/.test(ext)) { f.guess = arts === 0 ? "front" : arts === 1 ? "back" : "other_art"; arts++; f.why = f.why || "Art or a film"; continue; }
    f.guess = "other";
  }
  const lines = (d.groups || []).flatMap((g) => (g.lines || []).map((l) => ({ style: l.itemNumber || "", brand: l.brand || "", color: l.color || "", garment: String(l.description || "").split(/\r?\n/)[0], qty: +(l.items || 0), price: +(l.price || 0),
    sizes: Object.entries(l.sizes || {}).filter(([, n]) => +n > 0).map(([k, n]) => `${k.replace(/^size_/, "").toUpperCase()} ${n}`).join(" · ") })));
  const { data: c } = await admin.from("customers").select("id, company, name, moved_at").eq("id", r.customer_id as string).maybeSingle();
  // last time's notes, for staff to bring in or leave (Nov 1, Nick: "I had these production notes from before. Do you
  // want me to keep these… these customer notes")
  const od = (r.data || {}) as { customerNote?: string; productionNote?: string };
  const notes = { production: oldNoteText(od.productionNote), customer: oldNoteText(od.customerNote) };
  return NextResponse.json({ job: { visual: r.visual_id, nickname: String(r.nickname || "").trim(), date: r.order_date || "", qty: r.qty, total: r.total }, customer: c, lines, files: out, notes });
}

export async function POST(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const { id } = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: r } = await admin.from("archived_orders").select("id, visual_id, nickname, qty, status_name, order_date, files, data, customer_id").is("removed_at", null).eq("id", String(id || "")).maybeSingle();
  if (!r) return NextResponse.json({ error: "That job isn't in the archive." }, { status: 404 });
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const groups = groupsFromPrintavo(r as never, (st?.data as { production?: unknown } | null)?.production);
  if (!groups.length) return NextResponse.json({ error: "That job has no garments with sizes to copy." }, { status: 400 });
  const { data: c } = await admin.from("customers").select("id, company, name, moved_at").eq("id", r.customer_id as string).maybeSingle();
  const draft: EODraft = {
    v: 2, kind: "reorder", summary: `Exact reorder of Printavo #${r.visual_id}`, confidence: "high",
    nickname: String(r.nickname || "").slice(0, 120), due_date: null, delivery: "pickup", ship_to: "", po_number: "", notes: "",
    goods: { supplied: false, supplier: "", expected: "", note: "" }, groups, art: {}, mockups: {}, reorderOf: `a:${r.id}`, questions: [], files: [],
  };
  // what the old job's notes say about the inks: on the prints, for production to confirm
  const ai = await aiState(admin).catch(() => null);
  if (ai?.ready) await fillFromOldNotes(admin, ai.settings, draft, v.email || "staff", r.customer_id as string).catch((e) => console.warn("fillFromOldNotes", e));
  return NextResponse.json({ draft, customer: c, job: { label: `#${r.visual_id}${r.nickname ? ` ${r.nickname}` : ""} (Printavo)`, date: r.order_date || "" } });
}

export async function PUT(req: Request) {
  const v = await staff(); if (!v) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!b.draft || typeof b.draft !== "object" || !b.customer) return NextResponse.json({ error: "Nothing to create." }, { status: 400 });
  const { data: c } = await v.supabase.from("customers").select("id, moved_at").eq("id", String(b.customer)).maybeSingle();
  if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  if (!c.moved_at) return NextResponse.json({ error: "Move this customer to the new system first (customer page → Move to the new system)." }, { status: 400 });
  // a customer's portal reorder (Nov 1): filled in where it is, keeping its number, their words kept in the notes
  let into = "";
  const draft = b.draft as EODraft;
  if (b.into) {
    const { data: rq } = await createAdminClient().from("orders").select("id, customer_id, status, simple_order").eq("id", String(b.into)).maybeSingle();
    if (!rq || rq.customer_id !== c.id || rq.status !== "request") return NextResponse.json({ error: "That request isn't waiting to be made any more." }, { status: 400 });
    into = rq.id as string;
    const about = String((rq.simple_order as { about?: string } | null)?.about || "").trim();
    if (about) draft.customerNotes = [about, draft.customerNotes || ""].filter(Boolean).join("\n");
  }
  const r = await createOrderFromDraft(createAdminClient(), v.user!.email || "staff", { customerId: c.id as string, draft, status: b.status === "approved" ? "approved" : "quote", ...(into ? { intoOrder: into } : {}) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
