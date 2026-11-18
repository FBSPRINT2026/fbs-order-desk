"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { pvAsOrder, type PvEditRow } from "@/lib/printavoEdit";
import { METHOD_NAMES } from "@/lib/archive";
import { oldNoteText } from "@/lib/emailOrderShared";

/**
 * Edit here (Nick, Nov 18 2026: "release the holds on the Printavo editing… we should be able to update all the
 * statuses… change pricing… edit them the way they are"). An old Printavo job becomes one of our orders, as Printavo had
 * it (lib/printavoEdit.ts), keeping its number and its little P. Everything that pointed at the old job (payments taken
 * here, the schedule, goods counts, shipments, job files, time…) now points at the order. The Printavo copy stays as it
 * was, hidden from every list (`removed_at`), and its page opens the order; its files and messages are still there under
 * "Printavo's copy".
 *
 * QuickBooks: Printavo's invoice for the job is found by its number and linked as it is (same total); the first time
 * the order changes here, it's replaced with ours (lib/qbo/push.ts, like the 40,000s). A job that comes out at another
 * total than Printavo's is held back from QuickBooks until someone looks.
 */

/** the tables that point at an old job (archived_order_id) and at an order (order_id): moved with it */
const POINTS_AT = ["payments", "production_slots", "goods_checkins", "goods_issues", "ink_batches", "job_assignments", "job_files", "job_time", "post_counts", "press_actuals", "print_jobs", "shipments", "supplier_manifest_lines", "supplier_manifest_lines_archive"] as const;

/** the order an old Printavo job was made into here, if it was */
export async function editedOrderOf(archivedId: string): Promise<{ id: string; number: number } | null> {
  const v = await getViewer();
  if (!v.user) return null;
  const admin = createAdminClient();
  const { data: a } = await admin.from("archived_orders").select("printavo_id, customer_id").eq("id", archivedId).maybeSingle();
  if (!a?.printavo_id) return null;
  if (!v.isStaff) {
    // a customer sees it only when it's theirs (their portal link to the old job opens the order)
    const { data: mine } = await v.supabase.from("archived_orders").select("id").eq("id", archivedId).maybeSingle();
    if (!mine) return null;
  }
  const { data: o } = await admin.from("orders").select("id, number").eq("printavo_id", String(a.printavo_id)).is("discarded_at", null).maybeSingle();
  return o ? { id: o.id as string, number: o.number as number } : null;
}

export async function editHere(archivedId: string): Promise<{ ok: true; id: string; number: number; note: string } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const by = String((v.staff as { name?: string } | null)?.name || v.email || "shop");
    const admin = createAdminClient();
    const { data: row, error } = await admin.from("archived_orders").select("id, printavo_id, kind, visual_id, customer_id, nickname, status_name, order_date, due_date, total, po_number, qty, files, data, locked, removed_at").eq("id", archivedId).maybeSingle();
    if (error || !row) return { ok: false, error: error?.message || "That job isn't in the archive." };
    // already made into an order: open it
    const done = await admin.from("orders").select("id, number").eq("printavo_id", String(row.printavo_id)).maybeSingle();
    if (done.data) return { ok: true, id: done.data.id as string, number: done.data.number as number, note: "" };
    if (row.removed_at) return { ok: false, error: "This job was deleted in Printavo before it closed." };
    if (!row.customer_id) return { ok: false, error: "This job has no customer here: link it to a customer first." };
    if (!/^\d+$/.test(String(row.visual_id || ""))) return { ok: false, error: `#${row.visual_id} isn't a plain number, so it can't keep its number as an order.` };
    const taken = await admin.from("orders").select("id").eq("number", +row.visual_id).maybeSingle();
    if (taken.data) return { ok: false, error: `An order #${row.visual_id} already exists here.` };

    const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
    const settings = mergeSettings(st?.data);
    const x = pvAsOrder(row as unknown as PvEditRow, settings, (st?.data as { production?: unknown } | null)?.production);
    const d = (row.data || {}) as PvEditRow["data"] & { createdAt?: string; productionNote?: string };
    const off = Math.abs(x.ours - x.theirs) >= 0.01;
    const made = d.createdAt || (row.order_date ? `${row.order_date}T12:00:00Z` : new Date().toISOString());
    const { data: o, error: e1 } = await admin.from("orders").insert({
      ...x.order, source: "printavo", printavo_id: String(row.printavo_id), printavo_visual_id: String(row.visual_id),
      created_at: made,
      ...(x.order.type === "invoice" ? { approved_at: made, approved_name: "Printavo" } : {}),
      ...(x.order.status === "completed" ? { completed_at: (d.status as { at?: string } | undefined)?.at || (row.due_date ? `${row.due_date}T17:00:00Z` : made) } : {}),
      ...(off ? { qbo_hold: `Came over from Printavo at ${x.ours.toFixed(2)}; Printavo's total was ${x.theirs.toFixed(2)}. Check it, then take the hold off.` } : {}),
    }).select("id, number").single();
    if (e1 || !o) return { ok: false, error: e1?.message || "Couldn't make the order." };
    const oid = o.id as string;

    const prodNote = oldNoteText(d.productionNote);
    if (prodNote) await admin.from("order_internal").upsert({ order_id: oid, production_notes: prodNote.slice(0, 4000) });

    // Printavo's payments (and refunds): kept as Printavo's, so QuickBooks matches them to its own copies
    const pays = (d.transactions || []).filter((t) => /^(payment|refund|return)$/i.test(String(t.kind)) && +t.amount);
    if (pays.length) {
      const ids = pays.map((t) => `printavo:${t.id}`);
      const { data: have } = await admin.from("payments").select("processor_id").in("processor_id", ids);
      const seen = new Set((have || []).map((p) => String(p.processor_id)));
      const rows = pays.filter((t) => !seen.has(`printavo:${t.id}`)).map((t) => ({
        order_id: oid, amount: /^payment$/i.test(String(t.kind)) ? +t.amount : -Math.abs(+t.amount),
        method: METHOD_NAMES[t.category] || t.category || "Other", paid_on: String(t.date || row.order_date || "").slice(0, 10) || null,
        processor_id: `printavo:${t.id}`, note: `${/^payment$/i.test(String(t.kind)) ? "Paid" : String(t.kind)} in Printavo (#${row.visual_id})`,
      }));
      if (rows.length) { const { error: e2 } = await admin.from("payments").insert(rows); if (e2) console.warn("editHere payments", e2.message); }
    }
    // everything that pointed at the old job now points at the order
    const moved: string[] = [];
    for (const t of POINTS_AT) {
      const { data: m, error: e3 } = await admin.from(t).update({ order_id: oid, archived_order_id: null }).eq("archived_order_id", row.id).select("id");
      if (e3) console.warn("editHere move", t, e3.message);
      else if (m?.length) moved.push(`${m.length} ${t.replace(/_/g, " ")}`);
    }
    // the Printavo copy: hidden from every list (the order is the job now); its page opens the order
    const { error: e4 } = await admin.from("archived_orders").update({ removed_at: new Date().toISOString() }).eq("id", row.id);
    if (e4) console.warn("editHere hide", e4.message);
    await admin.from("order_events").insert({ order_id: oid, kind: "note", detail: `Made editable here from Printavo #${row.visual_id} (${row.status_name || "no status"}, ${x.theirs.toFixed(2)})${moved.length ? `; moved over: ${moved.join(", ")}` : ""}${x.notes.length ? `. ${x.notes.join(". ")}` : ""}`, actor: by });
    return { ok: true, id: oid, number: o.number as number, note: off ? `It comes to ${x.ours.toFixed(2)} here but Printavo had ${x.theirs.toFixed(2)}: held back from QuickBooks until you check it.` : "" };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** the Printavo copy of an order made editable here (its files, messages and history as they were), for the order's page */
export async function printavoCopyOf(orderId: string): Promise<string | null> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return null;
  const admin = createAdminClient();
  const { data: o } = await admin.from("orders").select("printavo_id, number").eq("id", orderId).maybeSingle();
  if (!o?.printavo_id) return null;
  const { data: a } = await admin.from("archived_orders").select("id").eq("printavo_id", String(o.printavo_id)).maybeSingle();
  return (a?.id as string) || null;
}

/**
 * An order made from a Printavo job, deleted: the job goes back to being Printavo's copy, as it was (everything that
 * was moved to the order points at it again, and it's back in the lists). Printavo's own payments copied onto the order
 * go with the order; payments taken here go back to the old job, never deleted.
 */
export async function backToPrintavo(orderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
  const admin = createAdminClient();
  const { data: o } = await admin.from("orders").select("printavo_id").eq("id", orderId).maybeSingle();
  if (!o?.printavo_id) return { ok: true };
  const { data: a } = await admin.from("archived_orders").select("id").eq("printavo_id", String(o.printavo_id)).maybeSingle();
  if (!a) return { ok: true };
  await admin.from("payments").delete().eq("order_id", orderId).like("processor_id", "printavo:%");
  for (const t of POINTS_AT) {
    const { error } = await admin.from(t).update({ archived_order_id: a.id, order_id: null }).eq("order_id", orderId);
    if (error) return { ok: false, error: `Couldn't move the ${t.replace(/_/g, " ")} back to Printavo's copy: ${error.message}` };
  }
  const { error } = await admin.from("archived_orders").update({ removed_at: null }).eq("id", a.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
