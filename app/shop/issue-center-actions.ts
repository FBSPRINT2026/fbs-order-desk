"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings } from "@/lib/pricing";
import { closeIssue, listIssues, repsFor } from "@/lib/goodsIssues";
import type { GoodsIssue } from "@/lib/goodsIssueShared";

/**
 * The Issue Center on Goods & Receiving (Nick, Nov 16 2026: "one of them needs to say issues… issue center… we need to be
 * able to work the issues… SMS or email the customer, tell him what's up"). Every goods issue with what working it
 * needs: who it's for (the account's contact, phone, email), when the job runs, who at the shop is on it, and a log of
 * what was said and done. Telling the customer is done by a person: the portal message (and their email, by their
 * settings) through staffMessage, or a text from the shop's phone that's then marked as sent. Nothing goes by itself.
 */
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type LogEv = { at: string; by: string; what: string };
export type CenterIssue = GoodsIssue & {
  assignee: string; told_at: string | null; log: LogEv[];
  customer: string; contact: string; phone: string; email: string; runs: string | null; press: string;
};
export type CenterCtx = { issues: CenterIssue[]; staff: { email: string; name: string }[]; me: string; shop: string; shopPhone: string; shipTo: string; reps: { customer_id: string | null; supplier: string; email: string }[] };

async function staff() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Shop staff only.");
  return { email: v.email, admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });

export async function issueCenter(): Promise<R<CenterCtx>> {
  try {
    const { email, admin } = await staff();
    const [base, { data: st }, { data: s }] = await Promise.all([
      listIssues(admin, null),
      admin.from("staff").select("email, name, role"),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    ]);
    const ids = base.map((i) => i.id);
    const { data: extra } = ids.length ? await admin.from("goods_issues").select("id, assignee, told_at, log").in("id", ids) : { data: [] };
    const ex = new Map(((extra || []) as { id: string; assignee: string; told_at: string | null; log: LogEv[] }[]).map((x) => [x.id, x]));
    const custIds = [...new Set(base.map((i) => i.customer_id).filter(Boolean))] as string[];
    const { data: cs } = custIds.length ? await admin.from("customers").select("id, company, name, phone, email").in("id", custIds) : { data: [] };
    const cust = new Map(((cs || []) as { id: string; company: string; name: string; phone: string | null; email: string | null }[]).map((c) => [c.id, c]));
    const oIds = [...new Set(base.map((i) => i.order_id).filter(Boolean))] as string[];
    const { data: slots } = oIds.length ? await admin.from("production_slots").select("order_id, day, status, machine_id").in("order_id", oIds).neq("status", "done").order("day") : { data: [] };
    const run = new Map<string, { day: string; machine: string }>();
    for (const x of (slots || []) as { order_id: string; day: string; machine_id: string | null }[]) if (!run.has(x.order_id)) run.set(x.order_id, { day: x.day, machine: x.machine_id || "" });
    const mIds = [...new Set([...run.values()].map((r) => r.machine).filter(Boolean))];
    const { data: ms } = mIds.length ? await admin.from("machines").select("id, name").in("id", mIds) : { data: [] };
    const mName = new Map(((ms || []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
    const settings = mergeSettings(s?.data);
    const issues: CenterIssue[] = base.map((i) => {
      const c = i.customer_id ? cust.get(i.customer_id) : undefined, x = ex.get(i.id), r = i.order_id ? run.get(i.order_id) : undefined;
      return { ...i, assignee: x?.assignee || "", told_at: x?.told_at || null, log: x?.log || [],
        customer: c?.company || c?.name || "", contact: c?.name || "", phone: c?.phone || "", email: c?.email || "",
        runs: r?.day || null, press: r ? mName.get(r.machine) || "" : "" };
    });
    const reps = await repsFor(admin, null);
    return { ok: true, issues, me: email, shop: settings.shop.name, shopPhone: settings.shop.phone || "", shipTo: [settings.shop.name, settings.shop.address].filter(Boolean).join("\n"), reps,
      staff: ((st || []) as { email: string; name: string; role: string }[]).filter((p) => !/@station\./.test(p.email)).map((p) => ({ email: p.email, name: p.name || p.email.split("@")[0] })).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (e) { return fail(e); }
}

async function note(admin: ReturnType<typeof createAdminClient>, id: string, by: string, what: string, more: Record<string, unknown> = {}) {
  const { data } = await admin.from("goods_issues").select("log").eq("id", id).maybeSingle();
  const log = [...(((data?.log as LogEv[]) || [])), { at: new Date().toISOString(), by, what: what.slice(0, 500) }].slice(-60);
  await admin.from("goods_issues").update({ ...more, log, updated_at: new Date().toISOString() }).eq("id", id);
}

/** who at the shop is working it */
export async function issueAssign(id: string, who: string): Promise<R> {
  try {
    const { email, admin } = await staff();
    await note(admin, id, email, who ? `Given to ${who.split("@")[0]}` : "Taken off everyone", { assignee: who });
    revalidatePath("/shop/receiving");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/**
 * Tell the customer: "portal" posts it on the order's goods conversation and emails them by their settings
 * (staffMessage); "text" records a text sent from the shop's phone (the page opens Messages with it written). Either way
 * the issue moves to Told them.
 */
export async function issueTell(id: string, how: "portal" | "text", body: string): Promise<R<{ emailed?: boolean }>> {
  try {
    const { email, admin } = await staff();
    const text = body.trim().slice(0, 3000);
    if (!text) return { ok: false, error: "Write the message first." };
    const { data: i } = await admin.from("goods_issues").select("order_id, status").eq("id", id).maybeSingle();
    if (!i) return { ok: false, error: "That issue isn't here." };
    let emailed = false;
    if (how === "portal") {
      if (!i.order_id) return { ok: false, error: "An old Printavo job has no portal conversation: text them instead." };
      const { staffMessage } = await import("@/app/shop/actions");
      const r = await staffMessage(i.order_id, text, [], "goods");
      if (!r.ok) return { ok: false, error: r.error || "Couldn't send it." };
      emailed = !!(r as { emailed?: boolean }).emailed;
    }
    const now = new Date().toISOString();
    await note(admin, id, email, how === "portal" ? `Told them in the portal${emailed ? " and by email" : ""}: "${text}"` : `Texted them: "${text}"`,
      { told_at: now, ...(i.status === "open" ? { status: "reported", reported_at: now, reported_by: email } : {}) });
    revalidatePath("/shop/receiving");
    return { ok: true, emailed };
  } catch (e) { return fail(e); }
}

export type FixHow = "sending" | "short" | "ordering" | "extras" | "recount" | "other" | "note";
const FIX: Record<FixHow, { say: string; close: boolean }> = {
  sending: { say: "They're sending more", close: false },
  ordering: { say: "We're ordering the replacements", close: false },
  short: { say: "Printing it short: they OK'd it", close: true },
  extras: { say: "Used our extras", close: true },
  recount: { say: "Counted again: it's all here", close: true },
  other: { say: "Closed", close: true },
  note: { say: "Note", close: false },
};
/** how it gets fixed: on its way (Fix on the way) or done (closed, the order's goods hold lifted) */
export async function issueFix(id: string, how: FixHow, words = ""): Promise<R> {
  try {
    const { email, admin } = await staff();
    const f = FIX[how];
    if (!f) return { ok: false, error: "How?" };
    const say = `${f.say}${words.trim() ? `: ${words.trim()}` : ""}`;
    if (how === "note") { if (!words.trim()) return { ok: false, error: "Write the note." }; await note(admin, id, email, words.trim()); }
    else if (f.close) { await note(admin, id, email, say); await closeIssue(admin, id, email, say); }
    else await note(admin, id, email, say, { status: "replacing" });
    revalidatePath("/shop/receiving");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** open a closed one again */
export async function issueReopen(id: string): Promise<R> {
  try {
    const { email, admin } = await staff();
    const { staffIssue } = await import("@/app/goods-issue-actions");
    const r = await staffIssue(id, "reopen");
    if (!r.ok) return r;
    await note(admin, id, email, "Opened again");
    return { ok: true };
  } catch (e) { return fail(e); }
}
