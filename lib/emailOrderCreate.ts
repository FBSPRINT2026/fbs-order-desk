import { resolvePending } from "@/lib/manifest";
import { mockupArtStamp } from "@/lib/mockupFresh";
import "server-only";
import { applyConfirmedSpecs } from "@/lib/designSpecs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposalToGroups } from "@/lib/ai/normalize";
import { METHODS, SIZES, STATUSES, sizeLabel, type Group } from "@/lib/pricing";
import { carryOf, isPicture, oldNoteText, type EODraft } from "@/lib/emailOrderShared";
import { trimPng } from "@/lib/pngTrim";
import { SITE_URL } from "@/lib/config";
import { namesForPaths } from "@/lib/printavoFileMeta";
import { oldJobLabel } from "@/lib/printavoNames";
import { tickInPrintavo } from "@/lib/clickup";

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
export type CreateInput = { activityId?: string; customerId?: string; draft: EODraft; status: "quote" | "approved"; /** where it came from, when not an email (the AI Workbench) */ via?: string;
  /** the next step on an order already made from it (Oct 27, Nick: "make that be the first step. Then I can go and say,
   *  okay, now bring in the art"): the garments and/or prints read now go onto that order instead of a new one */ addTo?: string };

export async function createOrderFromDraft(admin: SupabaseClient, by: string, input: CreateInput): Promise<{ ok: true; id: string; number: number } | { ok: false; error: string }> {
  const { data: a } = input.activityId ? await admin.from("activities").select("id, customer_id, subject, body, meta").eq("id", input.activityId).maybeSingle() : { data: null };
  if (input.activityId && !a) return { ok: false, error: "Email not found." };
  if (a && !a.customer_id) return { ok: false, error: "Make the sender a customer first (the yellow box above)." };
  const d = input.draft;
  const custId = (a?.customer_id as string) || input.customerId || "";
  if (!custId) return { ok: false, error: "No customer." };
  const { data: cust } = await admin.from("customers").select("price_type, tax_exempt, ship_on").eq("id", custId).maybeSingle();
  // staff may have edited the groups in the panel: run them through the same checks as the AI's
  const groups: Group[] = (d.groups || []).slice(0, 12).map((g) => {
    const clean = proposalToGroups({ groups: [{ name: g.name, garments: g.lines.map((l) => ({ style: l.style, brand: l.brand, description: l.garment, color: l.color, sizes: l.sizes as Record<string, number> })), prints: [] }] })[0];
    return {
      ...g,
      // what was settled on the line stays: their extras (printed or not, charged or not), its note, a price set on it
      // (Oct 23, #40122: the extras answer was dropped here and the line came out a plain one)
      lines: clean ? clean.lines.map((l, i) => {
        const o = g.lines[i];
        return { ...l, id: o?.id || l.id, sizeRun: o?.sizeRun, sizeUp: o?.sizeUp,
          ...(o?.extras ? { extras: true, ...(o.extrasPrint != null ? { extrasPrint: o.extrasPrint } : {}), ...(o.extrasFree != null ? { extrasFree: o.extrasFree } : {}) } : {}),
          ...(o?.note ? { note: o.note } : {}), ...(o?.priceOverride != null ? { priceOverride: o.priceOverride } : {}),
          // what it looks like in their photo: drawn in the Mockup Creator when it isn't in a catalog (Oct 27, Peter Millar vest)
          ...(o?.look ? { look: o.look } : {}) };
      }) : g.lines,
      imprints: (g.imprints || []).slice(0, 10).map((im) => ({ ...im, colors: Math.max(1, Math.min(15, Math.round(+im.colors || 1))) })),
    };
  }).filter((g) => g.lines.some((l) => Object.keys(l.sizes || {}).length) || g.imprints.length);
  if (!groups.length) return { ok: false, error: "Add at least one garment with sizes." };

  // the art files → designs in the customer's library (one design per file), attached to their prints
  const madeFor = new Map<string, string>();
  for (const g of groups) for (const im of g.imprints) {
    const path = d.art?.[im.id];
    if (!path || im.design_id) continue;
    // their own transfers (rule 4f): the file is the placement reference, not art for the customer's library. A picture
    // is used as it is; a PDF's first page is made into the picture when the order is opened (GroupEditor)
    if (im.supplied) {
      const f = d.files.find((x) => x.path === path);
      const name = f?.name || path.split("/").pop() || "placement reference";
      const to = `designs/placement-${crypto.randomUUID().slice(0, 8)}/${safe(name)}`;
      if (!(await admin.storage.from("proofs").copy(path, to)).error) im.supplied = { ...im.supplied, ...(f && isPicture(f) ? { picture: { path: to, name, file: to } } : { picture: { path: "", name, file: to } }) };
      continue;
    }
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
      // an .ai / EPS / PDF with a picture made of it (AI Workbench, Oct 13): the picture is the design's preview
      let pvPath = f && isPicture(f) ? to : "";
      if (!pvPath && f?.preview) {
        const { data: pb } = await admin.storage.from("proofs").download(f.preview).then((r) => r, () => ({ data: null }));
        const pbuf = pb ? Buffer.from(await pb.arrayBuffer()) : null;
        const pt = pbuf ? (() => { try { return trimPng(pbuf); } catch { return null; } })() : null;
        const pto = `${to.replace(/\.[^./]+$/, "")}-preview.png`;
        if (pbuf && !(await admin.storage.from("proofs").upload(pto, pt ? pt.buf : pbuf, { contentType: "image/png" })).error) { pvPath = pto; wh = pt ? { w: pt.w, h: pt.h } : dims(pbuf); }
      }
      const { data: des } = await admin.from("designs").insert({
        customer_id: custId, name: (d.nickname || name.replace(/\.[^.]+$/, "")).slice(0, 120), file_path: to, file_name: name, file_type: f?.type || "",
        preview_path: pvPath, width_px: wh?.w || null, height_px: wh?.h || null, method: im.method || "screen",
        draft: true, colors: im.colors || 1, inks: im.inks || "", notes: a ? `From ${a.subject ? `the email "${String(a.subject).slice(0, 80)}"` : "an email"}` : input.via ? `From ${input.via}` : "From an older job", created_by: by,
      }).select("id").single();
      if (des) madeFor.set(path, des.id as string);
    }
    const id = madeFor.get(path);
    if (id) im.design_id = id;
  }
  // files copied from Printavo keep their original names (Printavo's API didn't give mockups a name: looked up from Filestack)
  const pvNames = await namesForPaths(admin, groups.flatMap((g) => [...(d.mockups?.[g.id] || []), ...(g.pvRef || []), ...(g.pvArt || [])].map((x) => (typeof x === "string" ? x : x.path)))).catch(() => ({} as Record<string, { name: string; visualId: string }>));
  // the customer's mockups: copied where the portal keeps a customer's own mockups
  for (const g of groups) {
    const paths = d.mockups?.[g.id] || [];
    const have = new Set((g.customerMockups || []).map((m) => m.path));
    for (const p of paths) {
      if (have.has(p)) continue;
      const f = d.files.find((x) => x.path === p);
      if (p.startsWith("printavo/") || p.startsWith(`mockups/${custId}/`)) { g.customerMockups = [...(g.customerMockups || []), { path: p, name: pvNames[p]?.name || f?.name || "Mockup" }]; continue; }
      const to = `mockups/${custId}/${Date.now().toString(36)}-${safe(f?.name || "mockup.png")}`;
      const cp = await admin.storage.from("proofs").copy(p, to);
      if (!cp.error) g.customerMockups = [...(g.customerMockups || []), { path: to, name: f?.name || "Mockup" }];
    }
  }

  // the next step on an order already made (Create order → Other options): its garments and prints go onto that order,
  // each group onto the group of the same name (else by place, else the only one); a print where the order has the same
  // location with no art yet takes its place. Nothing else on the order changes.
  if (input.addTo) {
    const { data: ex } = await admin.from("orders").select("id, number, customer_id, groups").eq("id", input.addTo).maybeSingle();
    if (!ex || ex.customer_id !== custId) return { ok: false, error: "That order isn't this customer's any more." };
    const eg = JSON.parse(JSON.stringify(ex.groups || [])) as Group[];
    const norm = (x?: string) => (x || "").trim().toLowerCase();
    let lines = 0, prints = 0, newGroups = 0;
    groups.forEach((ng, i) => {
      const at = eg.findIndex((x) => norm(x.name) && norm(x.name) === norm(ng.name));
      const tgt = at >= 0 ? eg[at] : eg.length === groups.length ? eg[i] : eg.length === 1 ? eg[0] : null;
      if (!tgt) { eg.push(ng); newGroups++; lines += ng.lines.length; prints += ng.imprints.length; return; }
      const real = ng.lines.filter((l) => Object.keys(l.sizes || {}).length);
      tgt.lines = [...(tgt.lines || []).filter((l) => (l.style || "").trim() || Object.keys(l.sizes || {}).length), ...real];
      for (const im of ng.imprints) {
        const k = (tgt.imprints || []).findIndex((x) => !x.design_id && norm(x.location) === norm(im.location));
        tgt.imprints = k >= 0 ? (tgt.imprints || []).map((x, j) => (j === k ? im : x)) : [...(tgt.imprints || []), im];
      }
      if (ng.customerMockups?.length) tgt.customerMockups = [...(tgt.customerMockups || []), ...ng.customerMockups];
      if (!tgt.name && ng.name) tgt.name = ng.name;
      lines += real.length; prints += ng.imprints.length;
    });
    const { error: ue } = await admin.from("orders").update({ groups: eg }).eq("id", ex.id);
    if (ue) return { ok: false, error: ue.message };
    const what = [lines ? `${lines} garment line${lines === 1 ? "" : "s"}` : "", prints ? `${prints} print${prints === 1 ? "" : "s"} with ${prints === 1 ? "its" : "their"} art` : "", newGroups ? `${newGroups} new group${newGroups === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
    await admin.from("order_events").insert({ order_id: ex.id, kind: "details", detail: `Added from ${a ? (((a.meta || {}) as { source?: string }).source === "clickup" ? "the customer's ClickUp job" : "the customer's email") : "Create order"}: ${what || "nothing new"}.`, actor: by });
    if (a) await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: by, order_id: ex.id }).eq("dedupe_key", d.part ? `email:${d.part.anchor || a.id}:order:${d.part.key}` : `email:${a.id}:order`);
    return { ok: true, id: ex.id as string, number: ex.number as number };
  }

  const st = STATUSES.find((x) => x.k === input.status) || STATUSES.find((x) => x.k === "quote")!;
  const reorderOf = d.kind === "reorder" && d.reorderOf ? d.reorderOf : null;
  // one order reordering several past jobs (Oct 22, Hutchins T10A #33633 + T11A #33676): each one's label, notes and
  // confirmed specs, for its own groups
  const refs = reorderOf ? [...new Set([reorderOf, ...(d.reorderJobs || [])])] : [];
  const labels: string[] = [], carriedParts: string[] = [];
  let tookSpecs: string[] = [];
  for (const ref of refs) {
    let label = "";
    if (ref.startsWith("o:")) { const { data: o } = await admin.from("orders").select("number").eq("id", ref.slice(2)).maybeSingle(); if (o) label = `#${o.number}`; }
    // the old Printavo job's notes carried over to production (ticked, else the ones about the print)
    if (ref.startsWith("a:")) {
      const { data: o } = await admin.from("archived_orders").select("visual_id, data").eq("id", ref.slice(2)).maybeSingle();
      if (o) {
        label = `Printavo #${o.visual_id}`;
        const od = (o.data || {}) as { customerNote?: string; productionNote?: string };
        const n = { customer: oldNoteText(od.customerNote), production: oldNoteText(od.productionNote) };
        const c = carryOf(d, n).filter((k) => n[k]).map((k) => `${k === "customer" ? "Customer note" : "Production note"} on ${label}:\n${n[k].slice(0, 1500)}`).join("\n\n");
        if (c) carriedParts.push(c);
      }
    }
    if (!label) continue;
    labels.push(label);
    // a reorder of a job production already confirmed: its prints take the confirmed specs, not guesses (lib/designSpecs.ts)
    const mine = refs.length > 1 ? groups.filter((g) => g.reorderFrom === ref) : groups;
    if (mine.length) tookSpecs = [...tookSpecs, ...(await applyConfirmedSpecs(admin, custId, label, mine))];
  }
  const fromLabel = labels.join(" and ");
  const carried = carriedParts.join("\n\n");
  const priceType = d.goods?.supplied ? "wholesale" : cust?.price_type || "retail";
  // the AI's notes are for the shop (what it noticed reading the email), not the customer: they go in the internal
  // production notes, never the order's notes, which print on the quote and invoice (Oct 20, Nick: #40089's quote showed
  // "please confirm these map to the same garment colors…" to the customer)
  // the customer's own words for the job and who sends the garments do go there (Oct 23, Nick on #40113: "Customer
  // supplies their own PC330 Black tees… and the 'NOT A REPEAT ORDER - NEW LEFT CHEST LOGO…' should have gone under
  // customer notes")
  // just the fact (Oct 27, Nick: "way too much information in the customer notes… that's what they're going to see"): the
  // supplier, tracking and reference numbers are on the order's goods (order_goods) and in the production notes
  const goodsLine = d.goods?.supplied ? "Customer supplies the garments." : "";
  const goodsMore = d.goods?.supplied ? [d.goods.supplier ? `Garments from ${d.goods.supplier}` : "", d.goods.expected, d.goods.note].filter(Boolean).join(". ") : "";
  const notes = [(d.customerNotes || "").trim(), goodsLine].filter(Boolean).join("\n").slice(0, 2000);
  const shopNote = [d.notes, goodsMore ? `${goodsMore}.` : "", reorderOf && fromLabel ? `Reorder of ${fromLabel}.` : ""].filter(Boolean).join(" ").slice(0, 2000);
  // a program customer (Oct 14: Furry Feline's Mewjira reprint from Cheri's email): the order starts on Program, so the
  // order page prices it from their design prices / rate card, or recommends a price for a new quantity
  const useProgram = await customerUsesProgram(admin, custId);
  // a ClickUp job the customer flagged Urgent or High: 🚩 at the front of the job name (Oct 22, Nick: "put a little
  // priority flag emoji in the job name when we're converting it over")
  const cuSrc = ((a?.meta || {}) as { source?: string; clickup?: { id?: string } });
  let flag = "";
  if (cuSrc.source === "clickup" && cuSrc.clickup?.id) {
    const { data: ct } = await admin.from("clickup_tasks").select("priority").eq("id", cuSrc.clickup.id).maybeSingle();
    if (/^(urgent|high)$/.test(String(ct?.priority || ""))) flag = "🚩 ";
  }
  // a simple order from the portal (app/shop/actions.ts simpleOrderActivity): filled in where it is, keeping its number
  const intoId = String(((a?.meta || {}) as { into_order?: string }).into_order || "");
  // the brand's standard mockups (its "Standard mockups", Oct 30, Nick: "save the mockup number and reuse those… you don't
  // need to make it each time"): a group with exactly those logos gets that mockup, copied, nothing drawn
  const std = await standardMockups(admin, custId, groups).catch((e) => { console.warn("standard mockups", e); return new Map<string, StdMockup>(); });
  const orderRow = {
    customer_id: custId, status: st.k, type: st.type, source: a ? "email" : "shop", groups, lines: [], use_program: useProgram,
    nickname: (flag + (d.nickname || "").replace(/^🚩\s*/u, "")).slice(0, 120), due_date: /^\d{4}-\d{2}-\d{2}$/.test(d.due_date || "") ? d.due_date : null,
    ...(d.firm && d.due_date ? { firm: true } : {}),
    notes, po_number: (d.po_number || "").slice(0, 60),
    delivery_method: ["pickup", "ship", "deliver"].includes(d.delivery) ? d.delivery : "pickup", ship_to: (d.ship_to || "").slice(0, 500),
    // a customer who ships on their own carrier account (customers.ship_on): the order ships on it, $0 shipping, the same
    // as picking it on the order page (Oct 30, #40284: Nine18 on "Nine18 FEDEX")
    ...(d.delivery === "ship" && cust?.ship_on ? { ship_method: await ownAccountMethod(String(cust.ship_on)) } : {}),
    price_type: priceType, tax_exempt: !!cust?.tax_exempt, ...(st.k === "approved" ? { approved_at: new Date().toISOString(), approved_name: `${by}${a ? " (from the customer's email)" : ""}` } : {}),
  };
  const { data: o, error } = intoId
    ? await admin.from("orders").update({ ...orderRow, source: "portal" }).eq("id", intoId).eq("customer_id", custId).select("id, number").single()
    : await admin.from("orders").insert(orderRow).select("id, number").single();
  if (error || !o) return { ok: false, error: error?.message || "Couldn't create the order." };
  const oid = o.id as string;
  for (const [gid, m] of std) await admin.from("mockups").insert({ customer_id: custId, order_id: oid, group_id: gid, proof_id: null, title: m.title, file_path: m.file_path, design_ids: m.design_ids, created_by: by, snapshot: m.snapshot, number: m.number }).then(() => null, () => null);
  // a job from the customer's ClickUp board (ClickUp Jobs, lib/clickup.ts)
  const cuMeta = ((a?.meta || {}) as { source?: string; clickup?: { id?: string } });
  const cuJob = cuMeta.source === "clickup" && cuMeta.clickup?.id ? { id: String(cuMeta.clickup.id), name: String(a?.subject || "") } : null;
  // a ClickUp job flagged Urgent or High: 🚩 at the front of the order's name (Oct 22, Nick: "put a little priority flag
  // emoji in the name when we're converting it over")
  if (cuJob) {
    const { data: ct } = await admin.from("clickup_tasks").select("priority").eq("id", cuJob.id).maybeSingle();
    const nick = String(d.nickname || "").trim();
    if (/^(urgent|high)$/.test(String(ct?.priority || "")) && !nick.startsWith("🚩")) await admin.from("orders").update({ nickname: `🚩 ${nick}`.slice(0, 120) }).eq("id", oid);
  }
  // goods already bought for this email (Order goods, before the order existed): now they belong to it
  if (a) {
    const { data: got } = await admin.from("blank_orders").update({ order_id: oid }).eq("activity_id", a.id).is("order_id", null).select("supplier_order");
    if (got?.length) await admin.from("order_events").insert({ order_id: oid, kind: "blanks", detail: `Goods already ordered from S&S for this email: ${got.map((g) => g.supplier_order).join(", ")}`, actor: by });
  }
  await admin.from("order_events").insert({ order_id: oid, kind: reorderOf ? "reorder" : "created", detail: reorderOf && fromLabel ? `Reorder of ${fromLabel}${a ? (cuJob ? ", from the customer's ClickUp job" : ", from the customer's email") : " (Reorder on the archived job)"}` : input.via ? `Made in ${input.via}` : cuJob ? `From the customer's ClickUp job "${cuJob.name}" (ClickUp Jobs)` : "From the customer's email (Inbox → Create order)", actor: by });
  if (tookSpecs.length) await admin.from("order_events").insert({ order_id: oid, kind: "details", detail: `Specs taken from what production confirmed before: ${tookSpecs.join("; ")}`.slice(0, 2000), actor: by });
  const pn = [
    // short (Oct 27, Nick: "production notes and customer notes… it's all way too much"): the note itself, no preamble,
    // and not what staff told the AI (that's in the order's history of the reading)
    shopNote,
    d.questions?.length ? `Questions for the customer${a ? " (from the email)" : ""}:\n- ${d.questions.join("\n- ")}` : "",
    d.lookedUp ? `Looked up online: ${d.lookedUp.text}${d.lookedUp.sources.length ? ` (${d.lookedUp.sources.map((x) => x.url).join(", ")})` : ""}` : "",
    d.artNotes?.length ? `Reorder art:\n- ${d.artNotes.join("\n- ")}` : "",
    d.prodSuggest || "",
    carried,
  ].filter(Boolean).join("\n\n");
  if (pn) await admin.from("order_internal").upsert({ order_id: oid, production_notes: pn.slice(0, 8000) });
  if (priceType === "wholesale" && d.goods?.supplied) {
    await admin.from("order_goods").upsert({ order_id: oid, status: "waiting", supplier: (d.goods.supplier || "").slice(0, 60), expected: [d.goods.expected, d.goods.note].filter(Boolean).join(" · ").slice(0, 200), updated_by: by, updated_at: new Date().toISOString() });
  }
  // their goods may already be on a supplier's manifest (Oct 30, Nick on #40284: All My Sons' blanks came in days before
  // the order was entered): match the waiting manifest lines now, not at the next hourly run
  // (resolvePending stops 15s before its deadline: a deadline 15s out matched nothing, Oct 30 #40285–#40290)
  if (d.goods?.supplied) await resolvePending(admin, Date.now() + 40_000).catch((e) => console.warn("goods match", e));
  // a reorder of a portal order: our saved mockups come along (the latest of each group), so nothing is made again
  // (Oct 20, Nick: "when we've got a mock-up made in our new system, we don't need to recreate anything, just copy it")
  if (reorderOf?.startsWith("o:")) {
    const { data: olds } = await admin.from("mockups").select("group_id, title, file_path, design_ids, snapshot, created_at").eq("order_id", reorderOf.slice(2)).is("archived_at", null).order("created_at", { ascending: false });
    for (const g of groups) {
      if (!g.fromGroup || !g.mockupThumbs?.some(Boolean)) continue;
      const m = (olds || []).find((x) => x.group_id === g.fromGroup);
      if (m) await admin.from("mockups").insert({ customer_id: custId, order_id: oid, group_id: g.id, proof_id: null, title: m.title, file_path: m.file_path, design_ids: m.design_ids || [], created_by: by, snapshot: m.snapshot });
    }
  }
  // a reorder of an old Printavo job: its mockups (ours) go in Production files for reference
  for (const g of groups) for (const f of [...(g.pvRef || []), ...(g.pvArt || [])]) {
    const orig = pvNames[f.path];
    const label = orig ? oldJobLabel(orig.visualId || (f.name.match(/#(\d+)/)?.[1] || ""), orig.name) : `From the old Printavo job: ${f.name.replace(/ mockup(?=\.\w+$)/i, "")}`;
    const kind = (f as { kind?: string }).kind || null, fnote = (f as { note?: string }).note || null;
    await admin.from("art_files").insert({ order_id: oid, name: label, file_path: f.path, file_type: /\.pdf$/i.test(f.path) ? "application/pdf" : /\.png$/i.test(f.path) ? "image/png" : "image/jpeg", ...(kind ? { category: kind } : {}), ...(fnote ? { note: fnote.slice(0, 300) } : {}) });
  }
  // the customer's own documents (size sheet, spreadsheet, PDF order form) go in the order's Production notes & files
  // (art_files, the side panel), so the shop has them with the job; pictures are art / mockups, signatures left out
  for (const f of (d.files || []).filter((x) => (x.role === "sheet" || (x.role === "other" && !isPicture(x))) && !(intoId && x.path.startsWith("requests/")))) {
    const to = `art/${oid}/${Date.now().toString(36)}-${safe(f.name)}`;
    const cp = await admin.storage.from("proofs").copy(f.path, to);
    if (cp.error) continue;
    await admin.from("art_files").insert({ order_id: oid, name: f.name, file_path: to, file_type: f.type || "", ...(f.role === "sheet" ? { category: "order_sheet" } : f.kind ? { category: f.kind } : {}) });
  }
  if (!a) return { ok: true, id: oid, number: o.number as number };
  // the email's suggested answer becomes the order confirmation (Nick, Oct 7): thanks, the link, what we have, approve?
  const reply = confirmationReply({ number: o.number as number, id: oid, nickname: d.nickname, due: d.due_date, groups, subject: String(a.subject || ""), first: greetName(String(((a.meta as { from_name?: string } | null)?.from_name || "")), String((a as { body?: string | null }).body || "")) });
  const meta0 = (a.meta || {}) as { reply_options?: { options?: { label: string; subject: string; body: string }[] } };
  const others = (meta0.reply_options?.options || []).filter((x) => x.label !== reply.label).slice(0, 3);
  await admin.from("activities").update({ order_id: oid, meta: { ...meta0, reply_options: { at: new Date().toISOString(), options: [reply, ...others] } } }).eq("id", a.id);
  await admin.from("ai_suggestions").update({ status: "done", decided_at: new Date().toISOString(), decided_by: by, order_id: oid }).eq("dedupe_key", d.part ? `email:${d.part.anchor || a.id}:order:${d.part.key}` : `email:${a.id}:order`);
  // made from a ClickUp job: tick its "In Printavo" box in ClickUp (Oct 22, Nick: "at the end you would go back and
  // click the In Printavo button in ClickUp")
  if (cuJob) {
    const r = await tickInPrintavo(admin, cuJob.id, { id: oid, number: o.number as number }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    await admin.from("order_events").insert({ order_id: oid, kind: "clickup", detail: r.ok ? `Ticked "In Printavo" on the ClickUp job "${cuJob.name}".` : `Couldn't tick "In Printavo" on the ClickUp job "${cuJob.name}": ${r.error}`, actor: by });
  }
  return { ok: true, id: oid, number: o.number as number };
}

/**
 * Who to greet (Oct 20, Nick: the reply to Little Groupies started "Hi Little,"): the sender's first name, unless the
 * sender is a company or a shared box ("Little Groupies", info@): then the name they signed with ("Thank you, Brooke").
 */
export function greetName(fromName: string, body: string) {
  const first = fromName.trim().split(/\s+/)[0] || "";
  const person = /^[A-Z][a-z]+$/.test(first) && fromName.trim().split(/\s+/).length <= 3 && !/\b(inc|llc|co|company|shop|store|team|info|sales|orders?|groupies|designs?|print|apparel|brewing|club|church|school)\b/i.test(fromName);
  const lines = body.replace(/\r/g, "").split("\n").map((x) => x.trim());
  const k = lines.findIndex((x) => /^(thanks|thank you|best|regards|best regards|kind regards|cheers|sincerely|thx|warmly)[,!.]?$/i.test(x));
  const signed = k >= 0 ? lines.slice(k + 1).find((x) => x) || "" : "";
  const sig = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(signed) ? signed.split(/\s+/)[0] : "";
  if (sig && (!person || sig.toLowerCase() !== first.toLowerCase())) return person && first ? (sig.toLowerCase() === first.toLowerCase() ? first : sig) : sig;
  return person ? first : sig || "";
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
    // a reorder print production hasn't confirmed: no guessed specs in the customer's email (lib/designSpecs.ts)
    for (const im of g.imprints) lines.push(im.confirm && (im.confirm.size || im.confirm.ink) ? `- ${im.location}: ${METHODS[im.method] || im.method}, printed to match your previous order` : `- ${im.location}: ${METHODS[im.method] || im.method}${im.method !== "dtf" ? `, ${im.colors} color${im.colors === 1 ? "" : "s"}` : ""}${im.inks ? ` (${im.inks})` : ""}${im.size ? `, ${im.size}` : ""}`);
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

/** does this customer have program pricing (a rate card or design prices)? New orders for them start on Program. */
export async function customerUsesProgram(admin: SupabaseClient, customerId: string | null | undefined) {
  if (!customerId) return false;
  const { data: prog } = await admin.from("programs").select("id, rate_card").eq("customer_id", customerId).limit(1).maybeSingle();
  if (!prog) return false;
  if (prog.rate_card) return true;
  const { count } = await admin.from("program_items").select("id", { count: "exact", head: true }).eq("program_id", prog.id).eq("active", true).is("archived_at", null);
  return !!count;
}

/** "FedEx Ground · Nine18 FEDEX": the customer's own carrier account as a ship method (lib/thirdParty.ts onAccountMethod) */
async function ownAccountMethod(id: string): Promise<string> {
  const { carrierAccountsCached } = await import("@/lib/easypost");
  const { onAccountMethod } = await import("@/lib/thirdParty");
  const a = (await carrierAccountsCached().catch(() => [])).find((x) => x.id === id);
  return onAccountMethod(`${a && /ups/i.test(a.readable || a.type) ? "UPS" : "FedEx"} Ground`, a ? a.description || `${a.readable} account` : "their account");
}

type StdMockup = { number: number; title: string; file_path: string; design_ids: string[]; snapshot: unknown };
/**
 * The customer's brands' standard mockups (Brand.rules.mockups, by M-number) for these groups: a group whose prints are
 * all that brand's logos, with the same logos as a standard mockup, gets it (its newest version). The group is stamped
 * as drawn (mockupArt) so the order page doesn't draw it again. Returns group id → the mockup row to copy.
 */
async function standardMockups(admin: SupabaseClient, custId: string, groups: Group[]): Promise<Map<string, StdMockup>> {
  const out = new Map<string, StdMockup>();
  const { data: bs } = await admin.from("brands").select("name, rules").eq("customer_id", custId).is("archived_at", null);
  const byBrand = new Map(((bs || []) as { name: string; rules: { mockups?: number[] } | null }[]).filter((b) => b.rules?.mockups?.length).map((b) => [b.name, b.rules!.mockups!]));
  if (!byBrand.size) return out;
  const nums = [...new Set([...byBrand.values()].flat())];
  const { data: ms } = await admin.from("mockups").select("number, title, file_path, design_ids, snapshot, created_at").eq("customer_id", custId).in("number", nums).is("archived_at", null).order("created_at", { ascending: false });
  const rows = (ms || []) as (StdMockup & { created_at: string })[];
  const key = (ids: string[]) => [...new Set(ids)].sort().join("|");
  const allIds = [...new Set(groups.flatMap((g) => g.imprints.map((im) => im.design_id).filter(Boolean) as string[]))];
  const { data: ds } = allIds.length ? await admin.from("designs").select("id, preview_path, file_path").in("id", allIds) : { data: [] };
  for (const g of groups) {
    if ((g.mockupThumbs || []).some(Boolean) || !g.imprints.length || !g.imprints.every((im) => im.design_id && im.fromBrand && byBrand.has(im.fromBrand))) continue;
    const want = key(g.imprints.map((im) => im.design_id!));
    const own = byBrand.get(g.imprints[0].fromBrand!)!;
    const m = rows.find((r) => own.includes(r.number) && key(r.design_ids || []) === want);
    if (!m) continue;
    g.mockupThumbs = [m.file_path.replace(/\.png$/i, "-thumb.png")];
    g.mockupAt = new Date().toISOString();
    if (/ — Logo /.test(m.title || "")) g.mockupKind = "logo";
    g.mockupArt = mockupArtStamp(g, (ds || []) as { id: string; preview_path?: string | null; file_path?: string | null }[]);
    out.set(g.id, m);
  }
  return out;
}

