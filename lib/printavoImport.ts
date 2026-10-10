import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCustomer, getOrder, PrintavoError, type PvCustomer } from "@/lib/printavo";
import { fileUrls, orderFiles, type PvAddress, type PvOrder } from "@/lib/archive";
import { pvHandle } from "@/lib/printavoNames";
import { fetchFileMeta, saveFileMeta } from "@/lib/printavoFileMeta";

/**
 * Bringing Printavo data into our database. Used by the Import page (one customer) and the background sync (everything).
 * Everything here READS from Printavo only (lib/printavo.ts refuses anything else).
 */

const addr = (a: PvAddress) => !a ? "" : [a.address1, a.address2, [[a.city, a.state].filter(Boolean).join(", "), a.zipCode].filter(Boolean).join(" ")].map((x) => (x || "").trim()).filter(Boolean).join("\n");
/** "theMcKennagroup", "The McKenna Group, LLC" and "the  mckenna group" are the same company. */
export const companyKey = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
  .replace(/\b(inc|llc|ltd|co|corp|corporation|company|pllc|pc)\b/g, " ").replace(/^\s*the/, "").replace(/\bthe\s*$/, "").replace(/\s+/g, "");
const terms = (t: PvCustomer["defaultPaymentTerm"]) => !t ? "receipt" : /prepa|up ?front|in advance|before/i.test(t.name) ? "prepay" : t.days >= 15 || /net/i.test(t.name) ? "net30" : "receipt";

/**
 * A Printavo customer becomes (or is linked to) one of our customers. An existing customer's details are never overwritten;
 * blanks are filled in. Matching: already imported, else same email.
 */
export async function importCustomer(sb: SupabaseClient, printavoId: string): Promise<{ customerId: string; how: string; company: string }> {
  const pc = await getCustomer(printavoId);
  const p = pc.primaryContact;
  const email = (p?.email || "").trim().toLowerCase();
  const others = pc.contacts.filter((c) => c.id !== p?.id && (c.fullName || c.email));
  const second = others[0];
  const fields = {
    company: (pc.companyName || "").trim(), name: (p?.fullName || "").trim(), email, phone: (p?.phone || "").trim(),
    address: addr(pc.billingAddress), ship_address: addr(pc.shippingAddress) === addr(pc.billingAddress) ? "" : addr(pc.shippingAddress),
    contact2_name: (second?.fullName || "").trim(), contact2_email: (second?.email || "").trim().toLowerCase(), contact2_phone: (second?.phone || "").trim(),
    tax_exempt: !!pc.taxExempt, payment_terms: terms(pc.defaultPaymentTerm),
  };

  const { data: linked } = await sb.from("printavo_customers").select("customer_id").eq("printavo_id", pc.id).maybeSingle();
  let customerId: string | null = linked?.customer_id || null, how = "already imported";
  // one company = one customer: Printavo sometimes has the same company twice (different contacts, extra spaces);
  // they all land on one customer, matched by company name, then by any contact's email
  const key = companyKey(pc.companyName || "");
  if (!customerId && key) {
    const { data: same } = await sb.from("customers").select("id").eq("company_key", key).order("created_at").limit(1);
    if (same?.[0]) { customerId = same[0].id; how = "matched by company name"; }
  }
  const emails = [...new Set([email, ...pc.contacts.map((c) => (c.email || "").trim().toLowerCase())].filter(Boolean))];
  if (!customerId && emails.length) {
    const { data: same } = await sb.from("customers").select("id").in("email", emails).limit(1);
    if (same?.[0]) { customerId = same[0].id; how = "matched by email"; }
    else {
      const { data: viaContact } = await sb.from("customer_contacts").select("customer_id").in("email", emails).limit(1);
      if (viaContact?.[0]) { customerId = viaContact[0].customer_id; how = "matched by email"; }
    }
  }
  let moved = false;
  if (customerId) {
    const { data: cur } = await sb.from("customers").select("*").eq("id", customerId).single();
    // moved to the new system: their name, contacts and details are kept here now; Printavo only links to them
    moved = !!(cur as { moved_at?: string | null } | null)?.moved_at;
    const fill: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (typeof v === "string" && v && !(cur as Record<string, unknown>)?.[k]) fill[k] = v;
    if (Object.keys(fill).length && !moved) await sb.from("customers").update(fill).eq("id", customerId);
  } else {
    const { data: made, error } = await sb.from("customers").insert({ ...fields, price_type: "retail" }).select("id").single();
    if (error || !made) throw new Error("Couldn't create the customer: " + (error?.message || "unknown"));
    customerId = made.id; how = "new customer";
  }

  // Printavo's internal note goes to the staff-only notes; extra contacts are kept with the Printavo record
  if (pc.internalNote?.trim()) {
    const { data: priv } = await sb.from("customer_private").select("notes").eq("customer_id", customerId).maybeSingle();
    const note = `From Printavo: ${pc.internalNote.trim()}`;
    if (!(priv?.notes || "").includes(note)) await sb.from("customer_private").upsert({ customer_id: customerId, notes: [priv?.notes, note].filter(Boolean).join("\n\n") });
  }
  await sb.from("printavo_customers").upsert({ printavo_id: pc.id, customer_id: customerId, data: { ...pc, extraContacts: others, contactsSaved: true }, imported_at: new Date().toISOString() });

  // every Printavo contact is kept under the company (they can all sign in to its portal)
  const contacts = pc.contacts.filter((c) => c.fullName || c.email || c.phone).map((c) => ({
    customer_id: customerId, printavo_id: c.id, name: (c.fullName || "").trim(), email: (c.email || "").trim().toLowerCase(), phone: (c.phone || "").trim(), is_primary: c.id === p?.id,
  }));
  if (p && !contacts.some((c) => c.printavo_id === p.id) && (p.fullName || p.email)) contacts.push({ customer_id: customerId, printavo_id: p.id, name: (p.fullName || "").trim(), email, phone: (p.phone || "").trim(), is_primary: true });
  if (contacts.length && !moved) {
    const { error: ce } = await sb.from("customer_contacts").upsert(contacts, { onConflict: "printavo_id" });
    if (ce) console.warn("[printavo] contacts:", ce.message);
  }
  return { customerId: customerId!, how, company: fields.company || fields.name };
}

/** Our customer for a Printavo customer id, importing the customer first if we don't have them yet. */
export async function ensureCustomer(sb: SupabaseClient, printavoCustomerId: string): Promise<string> {
  const { data } = await sb.from("printavo_customers").select("customer_id, saved:data->contactsSaved").eq("printavo_id", printavoCustomerId).maybeSingle();
  if (data?.customer_id && data.saved) return data.customer_id; // (customers imported before contacts were kept are read once more)
  return (await importCustomer(sb, printavoCustomerId)).customerId;
}

/** Brings over one Printavo invoice or quote, exactly as it is. Importing again refreshes it (files already copied are kept). */
export async function importOrder(sb: SupabaseClient, printavoId: string, customerId?: string | null): Promise<{ id: string; visualId: string; filesLeft: number; warnings: string[]; order: PvOrder }> {
  // sent from the new system (40,000 series): that order is the real one, the Printavo copy is never imported
  const { data: ours } = await sb.from("orders").select("number").eq("printavo_id", printavoId).maybeSingle();
  if (ours) throw new PrintavoError(`Not imported: this is order #${ours.number}, sent to Printavo from the new system.`);
  // history before 2026 is locked (migration 082): kept exactly as imported, never read again or rewritten
  const { data: locked } = await sb.from("archived_orders").select("id, visual_id, data, files_total, files_copied, files").eq("printavo_id", printavoId).eq("locked", true).maybeSingle();
  if (locked) {
    const done = Object.keys((locked.files || {}) as Record<string, string>).length;
    return { id: locked.id as string, visualId: locked.visual_id as string, filesLeft: Math.max(0, (locked.files_total as number) - done), warnings: ["Locked history (before 2026): kept as imported."], order: locked.data as PvOrder };
  }
  const o = await getOrder(printavoId);
  if (+o.visualId >= 40000) throw new PrintavoError(`Not imported: Printavo #${o.visualId} is in the 40,000 series, which belongs to the new system.`);
  const cid = customerId || (o.customer.id ? await ensureCustomer(sb, o.customer.id) : null);
  if (!cid) throw new Error("This order has no customer in Printavo.");
  const { data: prev } = await sb.from("archived_orders").select("id, files, data_hash").eq("printavo_id", o.id).maybeSingle();
  const urls = fileUrls(o);
  const kept = Object.fromEntries(Object.entries((prev?.files || {}) as Record<string, string>).filter(([u, path]) => urls.includes(u) && path !== "failed"));
  // nothing changed since the last import: don't rewrite the whole order (the database's heaviest write)
  const hash = createHash("sha1").update(JSON.stringify(o)).digest("hex");
  if (prev?.id && prev.data_hash === hash && cid) return { id: prev.id as string, visualId: o.visualId, filesLeft: urls.length - Object.keys(kept).length, warnings: o.warnings || [], order: o };
  const row = {
    printavo_id: o.id, kind: o.kind, visual_id: o.visualId, customer_id: cid, nickname: o.nickname,
    status_name: o.status.name, status_color: o.status.color,
    order_date: (o.createdAt || "").slice(0, 10) || null, due_date: (o.customerDueAt || o.dueAt || "").slice(0, 10) || null,
    total: o.total, paid: o.amountPaid, balance: o.amountOutstanding, qty: o.totalQuantity, po_number: o.poNumber,
    data: o, data_hash: hash, files: kept, files_total: urls.length, files_copied: Object.keys(kept).length, imported_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from("archived_orders").upsert(row, { onConflict: "printavo_id" }).select("id").single();
  if (error || !data) throw new Error("Couldn't save: " + (error?.message || "unknown"));
  return { id: data.id, visualId: o.visualId, filesLeft: urls.length - Object.keys(kept).length, warnings: o.warnings || [], order: o };
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf", "application/postscript": "ai", "application/illustrator": "ai", "image/vnd.adobe.photoshop": "psd", "application/zip": "zip" };

/**
 * Copies an archived order's artwork (mockups, production files, message attachments) into our storage so it stays after
 * Printavo is gone. Stops at `deadline` (ms timestamp); call again until `left` is 0. Files are downloaded, never changed.
 */
export async function copyFiles(sb: SupabaseClient, archivedId: string, deadline: number, hardStop = deadline + 15000): Promise<{ copied: number; total: number; left: number; failed: string[]; storageFull?: boolean }> {
  const { data: row, error } = await sb.from("archived_orders").select("id, data, files").eq("id", archivedId).single();
  if (error || !row) throw new Error("Archived order not found.");
  const o = row.data as PvOrder;
  const files = { ...(row.files as Record<string, string>) };
  const failed: string[] = [];
  const names = new Map<string, string>();
  orderFiles(o).forEach((f) => { if (f.name) names.set(f.full, f.name); });
  o.messages.forEach((m) => (m.attachments || []).forEach((a) => { if (a.name) names.set(a.url, a.name); }));
  const todo = fileUrls(o).filter((u) => !files[u]);
  let storageFull = false;
  // the biggest file we take (Import page setting; Supabase's own upload limit has to allow it)
  const { data: cfg } = await sb.from("printavo_sync").select("max_file_mb").eq("id", 1).maybeSingle();
  const MAX = Math.max(1, Number((cfg as { max_file_mb?: number } | null)?.max_file_mb) || 45) * 1024 * 1024;
  for (const [i, url] of todo.entries()) {
    if (Date.now() > deadline) break;
    try {
      // a download that can't finish before the run has to end is dropped and simply tried again next run
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(Math.max(1000, hardStop - Date.now())) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const len = +(r.headers.get("content-length") || 0);
      if (len > MAX) { files[url] = "too-big"; await r.body?.cancel().catch(() => {}); continue; }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > MAX) { files[url] = "too-big"; continue; }
      const type = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
      // the original file (not a thumbnail made from it): its upload name from Filestack (Printavo's API doesn't give
      // mockups a name), kept in printavo_file_names and used for our copy's name
      let orig = names.get(url) || "";
      const h = pvHandle(url);
      if (h && new RegExp(`^https?://[^/]+/(?:api/file/)?${h}(?:[?+/]|$)`).test(url)) {
        try {
          const m = await fetchFileMeta(h, 6000);
          await saveFileMeta(sb, h, m);
          if (!orig && m !== "missing" && m.filename) orig = m.filename;
        } catch { /* the name is looked up later (/api/printavo/file-names) */ }
      }
      const base = (orig || url.split("?")[0].split("/").pop() || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
      const ext = /\.[a-z0-9]{2,5}$/i.test(base) ? "" : "." + (EXT[type] || "bin");
      const path = `printavo/${row.id}/${Date.now().toString(36)}${i}-${base}${ext}`;
      const up = await sb.storage.from("proofs").upload(path, buf, { contentType: type, upsert: true });
      if (up.error) {
        // one file over Supabase's upload limit (Storage → Settings): marked too big and skipped, so the rest keep
        // copying (Files that didn't copy → Copy big files takes it once the limit is raised). Only a full or over-quota
        // project stops the copying.
        if (/maximum allowed size|payload too large|entity too large|413/i.test(up.error.message)) { files[url] = "too-big"; continue; }
        if (/quota|space|storage.*full|full.*storage/i.test(up.error.message)) { storageFull = true; failed.push(up.error.message); break; }
        throw new Error(up.error.message);
      }
      files[url] = path;
      // saved after every file, so a run that gets cut off never copies the same file twice
      await sb.from("archived_orders").update({ files, files_copied: Object.values(files).filter((p) => p && !["failed", "too-big"].includes(p)).length }).eq("id", row.id);
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) break; // out of time, not a bad file
      failed.push(`${url.slice(0, 80)}: ${e instanceof Error ? e.message : e}`); files[url] = "failed";
    }
  }
  const copied = Object.values(files).filter((p) => p && !["failed", "too-big"].includes(p)).length;
  await sb.from("archived_orders").update({ files, files_copied: copied }).eq("id", row.id);
  const left = fileUrls(o).filter((u) => !files[u]).length;
  return { copied, total: fileUrls(o).length, left, failed, ...(storageFull ? { storageFull } : {}) };
}
