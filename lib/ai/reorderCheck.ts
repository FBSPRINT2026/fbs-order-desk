import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/claude";
import { SHOP_CONTEXT } from "@/lib/ai/tasks";
import { LOCATIONS, METHODS, orderGroups, type Imprint, type Order, type Settings } from "@/lib/pricing";

/**
 * Reorder check: before a reorder goes to the customer or the press, the AI looks over the new order next to the old
 * job it copies — the old job's lines, fees and files (its art / mockup), the film's measurements, the art now on
 * each print and our new mockup — and says what doesn't line up. Each fix it suggests is one field on one print
 * (size, location, inks, colors, drop) that staff can apply with a click.
 */
export type ReorderFix = { imprint_id: string; field: "size" | "location" | "inks" | "colors" | "drop"; value: string; why: string };
export type ReorderCheck = { verdict: "good" | "check" | "problems"; summary: string; issues: { severity: "high" | "medium" | "low"; text: string }[]; fixes: ReorderFix[]; at?: string; model?: string;
  /** what staff told it about the job ("we used the LA Lakers PMS colors"): kept and used on every check */ told?: string };

const MAX_IMG = 3_600_000; // the API's 5 MB limit, after base64

async function fileB64(admin: SupabaseClient, path: string) {
  const { data } = await admin.storage.from("proofs").download(path);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf.length > MAX_IMG ? null : buf.toString("base64");
}
const imgType = (p: string) => (/\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.webp$/i.test(p) ? "image/webp" : /\.gif$/i.test(p) ? "image/gif" : null);
const SIZE = (k: string) => k.replace(/^size_/, "").toUpperCase();

export async function reorderCheck(admin: SupabaseClient, s: Settings, orderId: string, by: string, told = ""): Promise<{ ok: true; check: ReorderCheck } | { ok: false; error: string }> {
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return { ok: false, error: "Order not found." };
  // the job it copies: "Reorder of Printavo #31174" / "Reorder of #40012"
  const { data: ev } = await admin.from("order_events").select("detail").eq("order_id", orderId).eq("kind", "reorder").order("created_at").limit(1).maybeSingle();
  const ref = String(ev?.detail || o.notes || "").match(/Reorder of (Printavo )?#(\d+)/);
  if (!ref) return { ok: false, error: "This order isn't a reorder of an earlier job." };

  const old: string[] = [];
  if (ref[1]) {
    const { data: a } = await admin.from("archived_orders").select("visual_id, nickname, order_date, data").eq("visual_id", ref[2]).maybeSingle();
    if (!a) return { ok: false, error: `Printavo #${ref[2]} isn't in the archive.` };
    const d = (a.data || {}) as { groups?: { lines?: { description?: string; itemNumber?: string; color?: string; sizes?: Record<string, number>; items?: number; price?: number }[]; imprints?: { details?: string; typeOfWork?: string }[] }[]; fees?: { description?: string; quantity?: number; amount?: number }[]; productionNote?: string; customerNote?: string };
    old.push(`Printavo #${a.visual_id} "${a.nickname || ""}", ${a.order_date || ""}`);
    for (const g of d.groups || []) {
      for (const l of g.lines || []) old.push(`  Line: ${l.description || l.itemNumber || "?"}, color ${l.color || "?"}: ${Object.entries(l.sizes || {}).filter(([, q]) => q).map(([z, q]) => `${SIZE(z)} ${q}`).join(", ")} @ $${l.price ?? "?"}`);
      for (const im of g.imprints || []) old.push(`  Imprint: ${im.typeOfWork || ""} ${im.details || ""}`.trim());
      if (!(g.imprints || []).length) old.push("  (no imprint details on file)");
    }
    for (const f of d.fees || []) old.push(`  Fee: ${(f.description || "").trim()} x${f.quantity ?? 1} = $${f.amount ?? "?"}`);
    if (d.productionNote) old.push(`  Production note: ${d.productionNote}`);
    if (d.customerNote) old.push(`  Customer note: ${d.customerNote}`);
  } else {
    const { data: p } = await admin.from("orders").select("*").eq("number", +ref[2]).maybeSingle();
    if (!p) return { ok: false, error: `#${ref[2]} wasn't found.` };
    old.push(`#${p.number} "${p.nickname || ""}"`, describe(orderGroups(p as Order)));
  }

  const groups = orderGroups(o as Order);
  const ims = groups.flatMap((g) => g.imprints);
  const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", orderId).maybeSingle();
  const { data: files } = await admin.from("art_files").select("name, file_path, file_type").eq("order_id", orderId).order("created_at");
  const { data: mks } = await admin.from("mockups").select("title, file_path, created_at").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1);
  const dIds = [...new Set(ims.map((i) => i.design_id).filter(Boolean))] as string[];
  const { data: dsgs } = dIds.length ? await admin.from("designs").select("id, name, file_path, preview_path, notes").in("id", dIds) : { data: [] as { id: string; name: string; file_path: string; preview_path: string | null; notes: string | null }[] };

  // what the AI looks at: the old job's files, the film, each print's art, our new mockup
  const images: { media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string; label: string }[] = [];
  const documents: { data: string; label: string }[] = [];
  for (const f of files || []) {
    const old = /^(From the old Printavo job|Old mockup)/i.test(f.name), film = /^Film:/i.test(f.name);
    if (!old && !film) continue;
    if (/\.(pdf|ai)$/i.test(f.file_path) && documents.length < 3) {
      const b = await fileB64(admin, f.file_path); // an .ai saved PDF-compatible is a PDF
      if (b && Buffer.from(b.slice(0, 12), "base64").toString().startsWith("%PDF")) documents.push({ data: b, label: `${film ? "The job's film (Illustrator, real print size)" : "From the old job"}: ${f.name}` });
    } else if (imgType(f.file_path) && images.length < 6) {
      const b = await fileB64(admin, f.file_path);
      if (b) images.push({ media_type: imgType(f.file_path)!, data: b, label: `From the old job: ${f.name}` });
    }
  }
  for (const d of dsgs || []) {
    const p = d.preview_path || d.file_path, t = imgType(p);
    if (!t || images.length >= 8) continue;
    const b = await fileB64(admin, p);
    if (b) images.push({ media_type: t, data: b, label: `The art now on print(s) ${ims.filter((i) => i.design_id === d.id).map((i) => i.id).join(", ")}: design "${d.name}"${d.notes ? ` (${d.notes})` : ""}` });
  }
  const mk = mks?.[0];
  if (mk && imgType(mk.file_path)) { const b = await fileB64(admin, mk.file_path); if (b) images.push({ media_type: imgType(mk.file_path)!, data: b, label: `Our new mockup: ${mk.title || ""}` }); }

  const prompt = [
    "THE OLD JOB (what the customer is reordering):", ...old, "",
    `THE NEW REORDER #${o.number} "${o.nickname || ""}":`, describe(groups),
    inn?.production_notes ? `Production notes: ${inn.production_notes}` : "",
    o.notes ? `Order notes: ${o.notes}` : "",
    "",
    mk ? "" : "No mockup has been made for the new order yet.",
    told.trim() ? `\nWHAT THE SHOP TOLD YOU ABOUT THIS JOB (facts, use them): ${told.trim()}` : "",
    `Files attached: ${[...documents.map((d) => d.label), ...images.map((i) => i.label)].join(" | ") || "none"}`,
  ].filter((x) => x !== "").join("\n");

  const r = await askClaude<ReorderCheck>({
    task: "reorder_check", model: s.assistant.ai.model, maxTokens: 2000, timeoutMs: 55_000, admin, images, documents,
    ctx: { order_id: orderId, customer_id: o.customer_id, by },
    tool: { name: "reorder_check", description: "How the new reorder lines up with the old job.", input_schema: { type: "object", properties: {
      verdict: { type: "string", enum: ["good", "check", "problems"], description: "good = matches the old job; check = small things to confirm; problems = something is wrong" },
      summary: { type: "string", description: "One or two sentences" },
      issues: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["high", "medium", "low"] }, text: { type: "string" } }, required: ["severity", "text"] } },
      fixes: { type: "array", description: "Changes to make, one field on one print each. Only when you're confident.", items: { type: "object", properties: {
        imprint_id: { type: "string" }, field: { type: "string", enum: ["size", "location", "inks", "colors", "drop"] },
        value: { type: "string", description: 'size like 6.25" wide; location one of the shop\'s locations; inks comma separated (PMS names when you can tell); colors a number; drop inches below the collar' },
        why: { type: "string" },
      }, required: ["imprint_id", "field", "value", "why"] } },
    }, required: ["verdict", "summary", "issues", "fixes"] } },
    system: `${SHOP_CONTEXT(s)}

Your job: check a REORDER before it goes to the customer and the press. The customer wants the same thing as the old job. Compare the new order with the old job and its files, like an experienced production manager:
- Garments: same style, color and size breakdown (Printavo size_6m = 6M etc.), same quantities unless the notes say otherwise.
- Art: the art on each print should be the old job's art (the customer's original file or what's on the old mockup), not something else or missing. Say which file it should come from if it's wrong.
- Print size: the film in the job's film folder is at real print size; the print size should match the film's art (within about 1/8"). A size off the film is the truth over a guess from a mockup.
- Location and placement: what the old mockup shows (front/back, chest/full), sensible for the garment (onesies and toddler pieces have small print areas).
- Inks: the ink colors should match the art's colors (name PMS colors when you can tell, e.g. Yellow / PMS 123 C, Violet / PMS 2685 C); the number of colors should match the art and the old job's screen fees (2 new screens = 2 colors).
- Our new mockup (if attached): the art looks like the old job's, sits where it should, and its size looks right on that garment.
- Anything in the old job's notes or nickname that still applies (e.g. "No neck labels").
When the shop tells you something about the job (e.g. "we used the LA Lakers PMS colors", "the back was 3 inches"), treat it as fact: work out what it means from what you know (a team's official PMS colors, matched to the art's colors) and turn it into fixes on the prints.
The shop's print locations: ${LOCATIONS.join(", ")}.
Only list real problems, most important first. Use the print ids given in the order for fixes. If everything lines up, say so and return no issues.`,
    prompt,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const ids = new Set(ims.map((i) => i.id));
  const check: ReorderCheck = { ...r.data, issues: r.data.issues || [], fixes: (r.data.fixes || []).filter((f) => ids.has(f.imprint_id)), at: new Date().toISOString(), model: r.model, ...(told.trim() ? { told: told.trim().slice(0, 1000) } : {}) };
  // the latest check is kept on the order (one row, updated each time)
  const row = { kind: "reorder_check", dedupe_key: `reorder_check:${orderId}`, source: "ai", status: "done", priority: 2, order_id: orderId, customer_id: o.customer_id, title: `Reorder check #${o.number}`, body: check.summary, payload: check, model: r.model, run_id: r.runId, updated_at: check.at };
  const { data: had } = await admin.from("ai_suggestions").select("id").eq("dedupe_key", row.dedupe_key).limit(1).maybeSingle();
  if (had) await admin.from("ai_suggestions").update(row).eq("id", had.id);
  else await admin.from("ai_suggestions").insert(row);
  return { ok: true, check };
}

/** the new order, with each print's id so a fix can point at it */
function describe(groups: ReturnType<typeof orderGroups>) {
  return groups.map((g, i) => [
    `Group ${i + 1}:`,
    ...g.lines.map((l) => `  Garment: ${[l.brand, l.style, l.garment].filter(Boolean).join(" ")}, color ${l.color || "?"}: ${Object.entries(l.sizes || {}).filter(([, q]) => q).map(([z, q]) => `${z} ${q}`).join(", ")}`),
    ...g.imprints.map((d: Imprint) => `  Print id ${d.id}: ${METHODS[d.method] || d.method} on ${d.location || "?"}, ${d.colors} color(s), inks ${d.inks || "none listed"}, size ${d.size || "not set"}${d.drop ? `, drop ${d.drop}"` : ""}${d.sizeFrom === "film" ? " (size off the film)" : ""}${d.design_id ? ", art attached" : ", NO art"}${d.confirm ? `, production to confirm: ${[d.confirm.size && "size", d.confirm.ink && "ink"].filter(Boolean).join(" + ")}` : ""}${d.notes ? `; notes: ${d.notes}` : ""}`),
  ].join("\n")).join("\n");
}
