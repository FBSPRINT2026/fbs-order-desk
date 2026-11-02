"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { getPortalCtx } from "@/lib/portal";
import { closeIssue, listIssues, repsFor } from "@/lib/goodsIssues";
import type { GoodsIssue, IssueOwner } from "@/lib/goodsIssueShared";

/**
 * Goods issues for the page (Nov 2): the shop sees every customer's (or one customer's); a customer sees their own.
 * Plus what the email to the rep needs: the reps on file, where replacements go (the shop), and who signs it.
 */
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type IssueCtx = { issues: GoodsIssue[]; reps: { customer_id: string | null; supplier: string; email: string }[]; shipTo: string; signer: string; staff: boolean };

async function who(as?: string) {
  const v = await getViewer();
  if (!v.user) throw new Error("Please sign in again.");
  if (v.isStaff && !as) return { staff: true as const, email: v.email, customerIds: null as string[] | null, signer: "" };
  const ctx = await getPortalCtx(as);
  return { staff: ctx.isStaff, email: ctx.email || "", customerIds: ctx.customerIds, signer: ctx.customers[0]?.name || ctx.customers[0]?.company || "" };
}

export async function issuesFor(opts: { as?: string; customerId?: string } = {}): Promise<R<IssueCtx>> {
  try {
    const w = await who(opts.as);
    const admin = createAdminClient();
    const ids = w.customerIds ?? (opts.customerId ? [opts.customerId] : null);
    const [issues, { data: s }] = await Promise.all([listIssues(admin, ids), admin.from("settings").select("data").eq("id", 1).maybeSingle()]);
    const shop = mergeSettings(s?.data).shop;
    const reps = await repsFor(admin, ids?.[0] || null);
    return { ok: true, issues, reps, shipTo: [shop.name, shop.address].filter(Boolean).join("\n"), signer: w.signer || shop.name, staff: w.staff && !w.customerIds };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** may this viewer act on this issue: staff always; a customer on their own issue that's theirs to work */
async function mayAct(id: string, as?: string) {
  const w = await who(as);
  const admin = createAdminClient();
  const { data: i } = await admin.from("goods_issues").select("id, customer_id, owner, supplier, status").eq("id", id).maybeSingle();
  if (!i) throw new Error("That issue isn't here.");
  if (!w.staff && !(w.customerIds || []).includes(i.customer_id)) throw new Error("That issue isn't yours.");
  return { w, admin, i: i as { id: string; customer_id: string | null; owner: IssueOwner; supplier: string; status: string } };
}

/** "I've reported it": the date kept, the rep's email remembered for next time */
export async function reportIssue(id: string, rep: { email?: string } = {}, as?: string): Promise<R> {
  try {
    const { w, admin, i } = await mayAct(id, as);
    const email = String(rep.email || "").trim().slice(0, 200);
    if (email) {
      const mine = i.owner === "shop" || !i.customer_id ? null : i.customer_id;
      const q = admin.from("goods_reps").select("id").eq("supplier", i.supplier || "other");
      const { data: ex } = await (mine ? q.eq("customer_id", mine) : q.is("customer_id", null)).maybeSingle();
      if (ex) await admin.from("goods_reps").update({ email, updated_at: new Date().toISOString() }).eq("id", ex.id);
      else await admin.from("goods_reps").insert({ customer_id: mine, supplier: i.supplier || "other", email });
    }
    if (i.status === "open") await admin.from("goods_issues").update({ status: "reported", reported_at: new Date().toISOString(), reported_by: w.email, updated_at: new Date().toISOString() }).eq("id", id);
    revalidatePath("/portal"); revalidatePath("/shop/receiving");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** staff: who works it, close it (replaced / credited / not needed), or open it again */
export async function staffIssue(id: string, action: "owner" | "close" | "reopen" | "replacing", value = ""): Promise<R> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Shop staff only." };
    const admin = createAdminClient();
    const now = new Date().toISOString();
    if (action === "owner") await admin.from("goods_issues").update({ owner: value === "shop" ? "shop" : "customer", updated_at: now }).eq("id", id);
    else if (action === "close") await closeIssue(admin, id, v.email, value || "Closed");
    else if (action === "replacing") await admin.from("goods_issues").update({ status: "replacing", updated_at: now }).eq("id", id).is("closed_at", null);
    else if (action === "reopen") {
      const { data: i } = await admin.from("goods_issues").update({ status: "open", closed_at: null, closed_by: "", closed_how: "", updated_at: now }).eq("id", id).select("order_id, title, detail").maybeSingle();
      if (i?.order_id) { const { holdForGoods } = await import("@/lib/goodsIssues"); await holdForGoods(admin, i.order_id, `${i.title}: ${i.detail}`.slice(0, 300)); }
    }
    revalidatePath("/portal"); revalidatePath("/shop/receiving");
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
