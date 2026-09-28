import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCustomer, getOrder, type PvCustomer } from "@/lib/printavo";
import { fileUrls, orderFiles, type PvAddress, type PvOrder } from "@/lib/archive";

/**
 * Bringing Printavo data into our database. Used by the Import page (one customer) and the background sync (everything).
 * Everything here READS from Printavo only (lib/printavo.ts refuses anything else).
 */

const addr = (a: PvAddress) => !a ? "" : [a.address1, a.address2, [[a.city, a.state].filter(Boolean).join(", "), a.zipCode].filter(Boolean).join(" ")].map((x) => (x || "").trim()).filter(Boolean).join("\n");
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
  if (!customerId && email) {
    const { data: same } = await sb.from("customers").select("id").ilike("email", email).limit(1);
    if (same?.[0]) { customerId = same[0].id; how = "matched by email"; }
  }
  if (customerId) {
    const { data: cur } = await sb.from("customers").select("*").eq("id", customerId).single();
    const fill: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (typeof v === "string" && v && !(cur as Record<string, unknown>)?.[k]) fill[k] = v;
    if (Object.keys(fill).length) await sb.from("customers").update(fill).eq("id", customerId);
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
  await sb.from("printavo_customers").upsert({ printavo_id: pc.id, customer_id: customerId, data: { ...pc, extraContacts: others }, imported_at: new Date().toISOString() });
  return { customerId: customerId!, how, company: fields.company || fields.name };
}

/** Our customer for a Printavo customer id, importing the customer first if we don't have them yet. */
export async function ensureCustomer(sb: SupabaseClient, printavoCustomerId: string): Promise<string> {
  const { data } = await sb.from("printavo_customers").select("customer_id").eq("printavo_id", printavoCustomerId).maybeSingle();
  if (data?.customer_id) return data.customer_id;
  return (await importCustomer(sb, printavoCustomerId)).customerId;
}

/** Brings over one Printavo invoice or quote, exactly as it is. Importing again refreshes it (files already copied are kept). */
export async function importOrder(sb: SupabaseClient, printavoId: string, customerId?: string | null): Promise<{ id: string; visualId: string; filesLeft: number; warnings: string[]; order: PvOrder }> {
  const o = await getOrder(printavoId);
  const cid = customerId || (o.customer.id ? await ensureCustomer(sb, o.customer.id) : null);
  if (!cid) throw new Error("This order has no customer in Printavo.");
  const { data: prev } = await sb.from("archived_orders").select("files").eq("printavo_id", o.id).maybeSingle();
  const urls = fileUrls(o);
  const kept = Object.fromEntries(Object.entries((prev?.files || {}) as Record<string, string>).filter(([u, path]) => urls.includes(u) && path !== "failed"));
  const row = {
    printavo_id: o.id, kind: o.kind, visual_id: o.visualId, customer_id: cid, nickname: o.nickname,
    status_name: o.status.name, status_color: o.status.color,
    order_date: (o.createdAt || "").slice(0, 10) || null, due_date: (o.customerDueAt || o.dueAt || "").slice(0, 10) || null,
    total: o.total, paid: o.amountPaid, balance: o.amountOutstanding, qty: o.totalQuantity, po_number: o.poNumber,
    data: o, files: kept, files_total: urls.length, files_copied: Object.keys(kept).length, imported_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from("archived_orders").upsert(row, { onConflict: "printavo_id" }).select("id").single();
  if (error || !data) throw new Error("Couldn't save: " + (error?.message || "unknown"));
  return { id: data.id, visualId: o.visualId, filesLeft: urls.length - Object.keys(kept).length, warnings: o.warnings || [], order: o };
}

const MAX = 45 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf", "application/postscript": "ai", "application/illustrator": "ai", "image/vnd.adobe.photoshop": "psd", "application/zip": "zip" };

/**
 * Copies an archived order's artwork (mockups, production files, message attachments) into our storage so it stays after
 * Printavo is gone. Stops at `deadline` (ms timestamp); call again until `left` is 0. Files are downloaded, never changed.
 */
export async function copyFiles(sb: SupabaseClient, archivedId: string, deadline: number): Promise<{ copied: number; total: number; left: number; failed: string[]; storageFull?: boolean }> {
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
  for (const [i, url] of todo.entries()) {
    if (Date.now() > deadline) break;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const len = +(r.headers.get("content-length") || 0);
      if (len > MAX) { files[url] = "too-big"; await r.body?.cancel().catch(() => {}); continue; }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > MAX) { files[url] = "too-big"; continue; }
      const type = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
      const base = (names.get(url) || url.split("?")[0].split("/").pop() || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
      const ext = /\.[a-z0-9]{2,5}$/i.test(base) ? "" : "." + (EXT[type] || "bin");
      const path = `printavo/${row.id}/${Date.now().toString(36)}${i}-${base}${ext}`;
      const up = await sb.storage.from("proofs").upload(path, buf, { contentType: type, upsert: true });
      if (up.error) {
        if (/quota|exceed|limit|space|full/i.test(up.error.message)) { storageFull = true; failed.push(up.error.message); break; }
        throw new Error(up.error.message);
      }
      files[url] = path;
    } catch (e) { failed.push(`${url.slice(0, 80)}: ${e instanceof Error ? e.message : e}`); files[url] = "failed"; }
  }
  const copied = Object.values(files).filter((p) => p && !["failed", "too-big"].includes(p)).length;
  await sb.from("archived_orders").update({ files, files_copied: copied }).eq("id", row.id);
  const left = fileUrls(o).filter((u) => !files[u]).length;
  return { copied, total: fileUrls(o).length, left, failed, ...(storageFull ? { storageFull } : {}) };
}
