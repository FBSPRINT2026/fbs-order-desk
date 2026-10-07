import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposalToGroups } from "@/lib/ai/normalize";
import { STATUSES, type Group } from "@/lib/pricing";
import { isPicture, type EODraft } from "@/lib/emailOrderShared";
import { trimPng } from "@/lib/pngTrim";

/**
 * Make the order staff checked in the Inbox's "Create order" panel (lib/ai/emailOrder.ts suggested it):
 *  - the art files become designs in the customer's library, attached to their prints;
 *  - the customer's mockups go on the order (as customer supplied mockups, so the prints unlock);
 *  - customer supplied garments get their goods record (supplier, when they're expected);
 *  - the email is filed under the new order and the suggestion is marked done.
 * Prices are left to the order editor.
 */

const safe = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-100);

/** width and height of a PNG / JPEG / GIF / WebP from its first bytes */
function dims(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const t = b.toString("ascii", 12, 16);
    if (t === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

export type CreateInput = { activityId: string; draft: EODraft; status: "quote" | "approved" };

export async function createOrderFromDraft(admin: SupabaseClient, by: string, input: CreateInput): Promise<{ ok: true; id: string; number: number } | { ok: false; error: string }> {
  const { data: a } = await admin.from("activities").select("id, customer_id, subject, meta").eq("id", input.activityId).maybeSingle();
  if (!a) return { ok: false, error: "Email not found." };
  if (!a.customer_id) return { ok: false, error: "Make the sender a customer first (the yellow box above)." };
  const d = input.draft;
  const custId = a.customer_id as string;
  const { data: cust } = await admin.from("customers").select("price_type, tax_exempt").eq("id", custId).maybeSingle();
  // staff may have edited the groups in the panel: run them through the same checks as the AI's
  const groups: Group[] = (d.groups || []).slice(0, 12).map((g) => {
    const clean = proposalToGroups({ groups: [{ name: g.name, garments: g.lines.map((l) => ({ style: l.style, brand: l.brand, description: l.garment, color: l.color, sizes: l.sizes as Record<string, number> })), prints: [] }] })[0];
    return {
      ...g,
      lines: clean ? clean.lines.map((l, i) => ({ ...l, id: g.lines[i]?.id || l.id, sizeRun: g.lines[i]?.sizeRun, sizeUp: g.lines[i]?.sizeUp })) : g.lines,
      imprints: (g.imprints || []).slice(0, 10).map((im) => ({ ...im, colors: Math.max(1, Math.min(15, Math.round(+im.colors || 1))) })),
    };
  }).filter((g) => g.lines.some((l) => Object.keys(l.sizes || {}).length) || g.imprints.length);
  if (!groups.length) return { ok: false, error: "Add at least one garment with sizes." };

  // the art files → designs in the customer's library (one design per file), attached to their prints
  const madeFor = new Map<string, string>();
  for (const g of groups) for (const im of g.imprints) {
    const path = d.art?.[im.id];
    if (!path || im.design_id) continue;
    if (!madeFor.has(path)) {
      const f = d.files.find((x) => x.path === path);
      const name = f?.name || path.split("/").pop() || "art";
      const to = `designs/${crypto.randomUUID()}/${safe(name.replace(/^[a-z0-9]+-/, ""))}`;
      let wh: { w: number; h: number } | null = null;
      // pictures: a see-through PNG with empty space around the art is saved cropped to the art, so it scales right
      const { data: blob } = f && isPicture(f) ? await admin.storage.from("proofs").download(path) : { data: null };
      const buf = blob ? Buffer.from(await blob.arrayBuffer()) : null;
      const trimmed = buf ? (() => { try { return trimPng(buf); } catch { return null; } })() : null;
      if (trimmed) {
        const up = await admin.storage.from("proofs").upload(to, trimmed.buf, { contentType: "image/png" });
        if (up.error) continue;
        wh = { w: trimmed.w, h: trimmed.h };
      } else {
        const cp = await admin.storage.from("proofs").copy(path, to);
        if (cp.error) continue;
        if (buf) wh = dims(buf);
      }
      const { data: des } = await admin.from("designs").insert({
        customer_id: custId, name: (d.nickname || name.replace(/\.[^.]+$/, "")).slice(0, 120), file_path: to, file_name: name, file_type: f?.type || "",
        preview_path: f && isPicture(f) ? to : "", width_px: wh?.w || null, height_px: wh?.h || null, method: im.method || "screen",
        colors: im.colors || 1, inks: im.inks || "", notes: `From ${a.subject ? `the email "${String(a.subject).slice(0, 80)}"` : "an email"}`, created_by: by,
      }).select("id").single();
      if (des) madeFor.set(path, des.id as string);
    }
    const id = madeFor.get(path);
    if (id) im.design_id = id;
  }
  // the customer's mockups: copied where the portal keeps a customer's own mockups
  for (const g of groups) {
    const paths = d.mockups?.[g.id] || [];
    const have = new Set((g.customerMockups || []).map((m) => m.path));
    for (const p of paths) {
      if (have.has(p)) continue;
      const f = d.files.find((x) => x.path === p);
      if (p.startsWith("printavo/") || p.startsWith(`mockups/${custId}/`)) { g.customerMockups = [...(g.customerMockups || []), { path: p, name: f?.name || "Mockup" }]; continue; }
      const to = `mockups/${custId}/${Date.now().toString(36)}-${safe(f?.name || "mockup.png")}`;
      const cp = await admin.storage.from("proofs").copy(p, to);
      if (!cp.error) g.customerMockups = [...(g.customerMockups || []), { path: to, name: f?.name || "Mockup" }];
    }
  }

  const st = STATUSES.find((x) => x.k === input.status) || STATUSES.find((x) => x.k === "quote")!;
  const reorderOf = d.kind === "reorder" && d.reorderOf ? d.reorderOf : null;
  let fromLabel = "";
  if (reorderOf?.startsWith("o:")) { const { data: o } = await admin.from("orders").select("number").eq("id", reorderOf.slice(2)).maybeSingle(); if (o) fromLabel = `#${o.number}`; }
  else if (reorderOf?.startsWith("a:")) { const { data: o } = await admin.from("archived_orders").select("visual_id").eq("id", reorderOf.slice(2)).maybeSingle(); if (o) fromLabel = `Printavo #${o.visual_id}`; }
  const priceType = d.goods?.supplied ? "wholesale" : cust?.price_type || "retail";
  const notes = [d.notes, reorderOf && fromLabel ? `Reorder of ${fromLabel}.` : ""].filter(Boolean).join(" ").slice(0, 2000);
  const { data: o, error } = await admin.from("orders").insert({
    customer_id: custId, status: st.k, type: st.type, source: "email", groups, lines: [],
    nickname: (d.nickname || "").slice(0, 120), due_date: /^\d{4}-\d{2}-\d{2}$/.test(d.due_date || "") ? d.due_date : null,
    notes, po_number: (d.po_number || "").slice(0, 60),
    delivery_method: ["pickup", "ship", "deliver"].includes(d.delivery) ? d.delivery : "pickup", ship_to: (d.ship_to || "").slice(0, 500),
    price_type: priceType, tax_exempt: !!cust?.tax_exempt, ...(st.k === "approved" ? { approved_at: new Date().toISOString(), approved_name: `${by} (from the customer's email)` } : {}),
  }).select("id, number").single();
  if (error || !o) return { ok: false, error: error?.message || "Couldn't create the order." };
  const oid = o.id as string;
  await admin.from("order_events").insert({ order_id: oid, kind: reorderOf ? "reorder" : "created", detail: reorderOf && fromLabel ? `Reorder of ${fromLabel}, from the customer's email` : "From the customer's email (Inbox → Create order)", actor: by });
  if (d.questions?.length) await admin.from("order_internal").upsert({ order_id: oid, production_notes: `Questions for the customer (from the email):\n- ${d.questions.join("\n- ")}` });
  if (priceType === "wholesale" && d.goods?.supplied) {
    await admin.from("order_goods").upsert({ order_id: oid, status: "waiting", supplier: (d.goods.supplier || "").slice(0, 60), expected: [d.goods.expected, d.goods.note].filter(Boolean).join(" · ").slice(0, 200), updated_by: by, updated_at: new Date().toISOString() });
  }
  // the customer's own documents (size sheet, spreadsheet, PDF order form) go in the job's Production files, so the
  // shop has them with the job; pictures are art / mockups and the signature is left out
  for (const f of (d.files || []).filter((x) => x.role === "sheet" || (x.role === "other" && !isPicture(x)))) {
    const to = `production/jobs/o-${oid}/${Date.now()}-${safe(f.name)}`;
    const cp = await admin.storage.from("proofs").copy(f.path, to);
    if (cp.error) continue;
    await admin.from("job_files").insert({ order_id: oid, customer_id: custId, kind: "file", tag: "Customer files", body: `${f.role === "sheet" ? "Size sheet" : "File"} from the customer's email${a.subject ? ` "${String(a.subject).slice(0, 80)}"` : ""}`, file_path: to, file_name: safe(f.name), file_type: f.type || "", size: f.size || 0, by_name: "Inbox", by_email: by });
  }
  await admin.from("activities").update({ order_id: oid }).eq("id", a.id);
  await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: by, order_id: oid }).eq("dedupe_key", `email:${a.id}:order`);
  return { ok: true, id: oid, number: o.number as number };
}
