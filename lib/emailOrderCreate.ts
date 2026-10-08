import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposalToGroups } from "@/lib/ai/normalize";
import { METHODS, SIZES, STATUSES, sizeLabel, type Group } from "@/lib/pricing";
import { isPicture, type EODraft } from "@/lib/emailOrderShared";
import { trimPng } from "@/lib/pngTrim";
import { SITE_URL } from "@/lib/config";

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

/** activityId: the email it came from (Inbox), or customerId alone (a reorder from the Printavo archive) */
export type CreateInput = { activityId?: string; customerId?: string; draft: EODraft; status: "quote" | "approved" };

export async function createOrderFromDraft(admin: SupabaseClient, by: string, input: CreateInput): Promise<{ ok: true; id: string; number: number } | { ok: false; error: string }> {
  const { data: a } = input.activityId ? await admin.from("activities").select("id, customer_id, subject, meta").eq("id", input.activityId).maybeSingle() : { data: null };
  if (input.activityId && !a) return { ok: false, error: "Email not found." };
  if (a && !a.customer_id) return { ok: false, error: "Make the sender a customer first (the yellow box above)." };
  const d = input.draft;
  const custId = (a?.customer_id as string) || input.customerId || "";
  if (!custId) return { ok: false, error: "No customer." };
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
        colors: im.colors || 1, inks: im.inks || "", notes: a ? `From ${a.subject ? `the email "${String(a.subject).slice(0, 80)}"` : "an email"}` : "From an older job", created_by: by,
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
    customer_id: custId, status: st.k, type: st.type, source: a ? "email" : "shop", groups, lines: [],
    nickname: (d.nickname || "").slice(0, 120), due_date: /^\d{4}-\d{2}-\d{2}$/.test(d.due_date || "") ? d.due_date : null,
    notes, po_number: (d.po_number || "").slice(0, 60),
    delivery_method: ["pickup", "ship", "deliver"].includes(d.delivery) ? d.delivery : "pickup", ship_to: (d.ship_to || "").slice(0, 500),
    price_type: priceType, tax_exempt: !!cust?.tax_exempt, ...(st.k === "approved" ? { approved_at: new Date().toISOString(), approved_name: `${by}${a ? " (from the customer's email)" : ""}` } : {}),
  }).select("id, number").single();
  if (error || !o) return { ok: false, error: error?.message || "Couldn't create the order." };
  const oid = o.id as string;
  await admin.from("order_events").insert({ order_id: oid, kind: reorderOf ? "reorder" : "created", detail: reorderOf && fromLabel ? `Reorder of ${fromLabel}${a ? ", from the customer's email" : " (Reorder on the archived job)"}` : "From the customer's email (Inbox → Create order)", actor: by });
  const pn = [
    d.questions?.length ? `Questions for the customer${a ? " (from the email)" : ""}:\n- ${d.questions.join("\n- ")}` : "",
    d.artNotes?.length ? `Reorder art:\n- ${d.artNotes.join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");
  if (pn) await admin.from("order_internal").upsert({ order_id: oid, production_notes: pn.slice(0, 4000) });
  if (priceType === "wholesale" && d.goods?.supplied) {
    await admin.from("order_goods").upsert({ order_id: oid, status: "waiting", supplier: (d.goods.supplier || "").slice(0, 60), expected: [d.goods.expected, d.goods.note].filter(Boolean).join(" · ").slice(0, 200), updated_by: by, updated_at: new Date().toISOString() });
  }
  // a reorder of an old Printavo job: its mockups (ours) go in Production files for reference
  for (const g of groups) for (const f of [...(g.pvRef || []), ...(g.pvArt || [])]) {
    await admin.from("art_files").insert({ order_id: oid, name: `Old mockup: ${f.name}`, file_path: f.path, file_type: /\.pdf$/i.test(f.path) ? "application/pdf" : /\.png$/i.test(f.path) ? "image/png" : "image/jpeg" });
  }
  // the customer's own documents (size sheet, spreadsheet, PDF order form) go in the order's Production notes & files
  // (art_files, the side panel), so the shop has them with the job; pictures are art / mockups, signatures left out
  for (const f of (d.files || []).filter((x) => x.role === "sheet" || (x.role === "other" && !isPicture(x)))) {
    const to = `art/${oid}/${Date.now().toString(36)}-${safe(f.name)}`;
    const cp = await admin.storage.from("proofs").copy(f.path, to);
    if (cp.error) continue;
    await admin.from("art_files").insert({ order_id: oid, name: f.name, file_path: to, file_type: f.type || "" });
  }
  if (!a) return { ok: true, id: oid, number: o.number as number };
  // the email's suggested answer becomes the order confirmation (Nick, Oct 7): thanks, the link, what we have, approve?
  const reply = confirmationReply({ number: o.number as number, id: oid, nickname: d.nickname, due: d.due_date, groups, subject: String(a.subject || ""), first: String(((a.meta as { from_name?: string } | null)?.from_name || "")).trim().split(/\s+/)[0] || "" });
  const meta0 = (a.meta || {}) as { reply_options?: { options?: { label: string; subject: string; body: string }[] } };
  const others = (meta0.reply_options?.options || []).filter((x) => x.label !== reply.label).slice(0, 3);
  await admin.from("activities").update({ order_id: oid, meta: { ...meta0, reply_options: { at: new Date().toISOString(), options: [reply, ...others] } } }).eq("id", a.id);
  await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: by, order_id: oid }).eq("dedupe_key", `email:${a.id}:order`);
  return { ok: true, id: oid, number: o.number as number };
}

/** "Thanks for your order": the reply staff send once the order is made, with its link and a short summary */
export function confirmationReply(o: { number: number; id: string; nickname: string; due: string | null; groups: Group[]; subject: string; first: string }) {
  const lines: string[] = [];
  for (const g of o.groups) {
    for (const l of g.lines) {
      const sizes = SIZES.filter((z) => +(l.sizes?.[z] || 0) > 0).map((z) => `${sizeLabel(z)} ${l.sizes[z]}`).join(", ");
      const qty = SIZES.reduce((a, z) => a + (+(l.sizes?.[z] || 0) || 0), 0);
      if (qty) lines.push(`- ${[l.brand, l.style].filter(Boolean).join(" ")}${l.color ? `, ${l.color}` : ""}${l.garment ? ` (${l.garment})` : ""}: ${sizes} (${qty} pcs)`);
    }
    for (const im of g.imprints) lines.push(`- ${im.location}: ${METHODS[im.method] || im.method}${im.method !== "dtf" ? `, ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}${im.inks ? ` (${im.inks})` : ""}${im.size ? `, ${im.size}` : ""}`);
  }
  const due = o.due && /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? new Date(o.due + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
  const body = [
    `Hi${o.first ? ` ${o.first}` : ""},`,
    "",
    "Thanks for your order! Please see below.",
    "",
    // during the move (40,000 series) customers get Printavo's invoice page: the link is filled in by Send to Printavo
    `Here's a link to your order confirmation: ${o.number >= 40000 && o.number < 50000 ? "[Printavo link: press Send to Printavo on the order first]" : `${SITE_URL}/portal/orders/${o.id}`}`,
    "",
    `Order #${o.number}${o.nickname ? `: ${o.nickname}` : ""}`,
    ...lines,
    ...(due ? ["", `In hands: ${due}`] : []),
    "",
    "Please let us know if this is approved.",
    "",
    "Thanks,",
    "FBS Print",
  ].join("\n");
  return { label: "Order confirmation", subject: o.subject.toLowerCase().startsWith("re:") ? o.subject : `Re: ${o.subject}`, body };
}
