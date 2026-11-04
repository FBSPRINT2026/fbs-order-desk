"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SHOP_NOTIFY_EMAIL } from "@/lib/config";
import type { Group } from "@/lib/pricing";
import type { SimpleSpec } from "@/lib/simpleOrders";

/**
 * Proofs on a signage / promotional products / paper printing order (Nov 4, Nick: "upload a picture, and you would send it
 * to the customer just like a proof… a flat description… please see your visual proof… approved or needs changes… attach
 * it to each line item"). The shop sends every line's picture at once; in the portal the customer answers each line.
 */
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong. Try again." });

/** staff: mark every line with a picture (not approved yet) as sent, and email the customer a link to answer them */
export async function sendItemProofs(orderId: string) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can send proofs.");
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, nickname, status, customer_id, groups").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    if (o.status === "quote" || o.status === "request") throw new Error("Send the quote first, so the customer can see this order in their portal.");
    const at = new Date().toISOString();
    let n = 0;
    const groups = ((o.groups || []) as Group[]).map((g) => ({ ...g, lines: g.lines.map((l) => {
      const s = l.spec as SimpleSpec | undefined;
      if (!s?.image || s.proof?.status === "approved") return l;
      n++;
      return { ...l, spec: { ...s, proof: { status: "sent" as const, at, by: v.email || "" } } };
    }) }));
    if (!n) throw new Error("Add a picture to at least one item first (or they're all approved already).");
    const { error } = await admin.from("orders").update({ groups }).eq("id", orderId);
    if (error) throw new Error(error.message);
    await admin.from("order_events").insert({ order_id: orderId, kind: "proofs_requested", detail: `${n} item proof${n === 1 ? "" : "s"} sent`, actor: v.email || "" });
    let emailed = false;
    if (o.customer_id) {
      const m = await import("@/lib/customerEmailServer");
      const { siteUrl } = await import("@/lib/email");
      const { mergeSettings } = await import("@/lib/pricing");
      const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const shop = mergeSettings(st?.data as never).shop;
      const link = `${siteUrl()}/portal/orders/${orderId}#items`;
      const r = await m.sendCustomerEmail(admin, {
        customerId: o.customer_id, kind: "approvals", orderId, actor: v.email || "",
        subject: `Proof${n === 1 ? "" : "s"} ready: ${o.nickname || `order #${o.number}`}`,
        html: m.customerEmailHtml({ shop, chip: { text: "Proof", tone: "blue" }, head: `Please look over your proof${n === 1 ? "" : "s"}`,
          lines: [`Please see your visual proof${n === 1 ? "" : "s"} for ${o.nickname || `order #${o.number}`} and let us know if everything looks okay. Approve each item, or tell us what to change.`],
          button: { label: "Review and approve", url: link } }),
      });
      emailed = r.sent.length > 0;
    }
    return { ok: true as const, n, emailed, groups };
  } catch (e) { return fail(e); }
}

/** the customer: approve one item's proof, or say what to change. Row security checks the order is theirs. */
export async function answerItemProof(orderId: string, lineId: string, ok: boolean, note: string) {
  try {
    const { supabase, user, email, isStaff } = await getViewer();
    if (!user) throw new Error("Please sign in again.");
    if (isStaff) throw new Error("This is a preview. Customers answer from their own login.");
    const { data: mine } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
    if (!mine) throw new Error("We couldn't find that order.");
    if (!ok && !note.trim()) throw new Error("Tell us what to change.");
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("id, number, nickname, customer_id, groups").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("We couldn't find that order.");
    let name = "";
    const at = new Date().toISOString();
    const groups = ((o.groups || []) as Group[]).map((g) => ({ ...g, lines: g.lines.map((l) => {
      if (l.id !== lineId || !l.spec) return l;
      name = l.garment || "an item";
      return { ...l, spec: { ...(l.spec as SimpleSpec), proof: { status: ok ? ("approved" as const) : ("changes" as const), at, by: email || "", note: note.trim().slice(0, 2000) || undefined } } };
    }) }));
    if (!name) throw new Error("We couldn't find that item.");
    const { error } = await admin.from("orders").update({ groups }).eq("id", orderId);
    if (error) throw new Error(error.message);
    await admin.from("order_events").insert({ order_id: orderId, kind: "note", detail: `${email || "The customer"} ${ok ? "approved" : "asked for changes on"} the proof for ${name}${note.trim() ? `: ${note.trim().slice(0, 300)}` : ""}.`, actor: email || "" });
    // whoever's on the account hears about it in the shop
    const { data: c } = o.customer_id ? await admin.from("customers").select("owner_email, company, name").eq("id", o.customer_id).maybeSingle() : { data: null };
    const owner = String(c?.owner_email || SHOP_NOTIFY_EMAIL).toLowerCase();
    await admin.from("alerts").insert({ owner, kind: "job", title: `#${o.number}: ${name} ${ok ? "approved" : "needs changes"}`.slice(0, 120),
      body: `${c?.company || c?.name || ""}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, 400), url: `/shop/orders/${orderId}`, dedupe_key: `item-proof:${orderId}:${lineId}:${at}`, order_id: orderId });
    revalidatePath(`/portal/orders/${orderId}`);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}


/**
 * Staff: an item's picture becomes the order's mockup for it (Nov 4, Nick: the Send dialog's "Proof v1 · Quote" with the
 * picture in the email, like an apparel order). So the usual Send, proof versions, the review page and approvals all work
 * as they do for a shirt; the line keeps the mockup's id. A changed picture retires the old one.
 */
export async function itemMockup(orderId: string, lineId: string, title: string, path: string, oldId?: string) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
    const admin = createAdminClient();
    const { data: o } = await admin.from("orders").select("customer_id, groups").eq("id", orderId).maybeSingle();
    if (!o) throw new Error("Order not found.");
    const g = ((o.groups || []) as Group[]).find((x) => x.lines.some((l) => l.id === lineId));
    if (oldId) await admin.from("mockups").update({ archived_at: new Date().toISOString() }).eq("id", oldId).eq("order_id", orderId);
    if (!path) return { ok: true as const, id: "" };
    const { data, error } = await admin.from("mockups").insert({ order_id: orderId, customer_id: o.customer_id, title: (title || "Item").slice(0, 200), file_path: path, group_id: g?.id || null, created_by: v.email || "" }).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: String(data.id) };
  } catch (e) { return fail(e); }
}
