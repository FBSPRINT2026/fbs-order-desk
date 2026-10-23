"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState } from "@/lib/ai/claude";
import { REVIEW_KIND, reviewCorrections, type ReviewItem } from "@/lib/ai/correctionReview";
import { RULE_KIND } from "@/lib/ai/orderMemory";

/** the overnight corrections review (lib/ai/correctionReview.ts): read, approve a rule or not, run it now */
async function owner() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Staff only.");
  return { admin: createAdminClient(), email: v.email, isOwner: v.role === "owner" || v.role === "admin" };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

export type Review = { id: string; at: string; summary: string; items: ReviewItem[]; status: string };
export async function loadReviews() {
  try {
    const { admin } = await owner();
    const [{ data: rv }, { data: rules }, { count }] = await Promise.all([
      admin.from("ai_suggestions").select("id, created_at, status, payload").eq("kind", REVIEW_KIND).order("created_at", { ascending: false }).limit(10),
      admin.from("ai_suggestions").select("id, created_at, payload").eq("kind", RULE_KIND).neq("status", "dismissed").order("created_at", { ascending: false }).limit(40),
      admin.from("ai_suggestions").select("id", { count: "exact", head: true }).eq("kind", "order_correction").eq("status", "open"),
    ]);
    return { ok: true as const, waiting: count || 0,
      reviews: (rv || []).map((r) => { const p = (r.payload || {}) as { summary?: string; items?: ReviewItem[] }; return { id: r.id as string, at: r.created_at as string, status: r.status as string, summary: p.summary || "", items: p.items || [] }; }) as Review[],
      rules: (rules || []).map((r) => ({ id: r.id as string, at: r.created_at as string, text: String(((r.payload || {}) as { text?: string }).text || "") })) };
  } catch (e) { return fail(e); }
}

/** a rule approved (it becomes a shop rule every order reading follows), not wanted, or a bug noted for the code */
export async function decideItem(reviewId: string, i: number, d: "approved" | "no" | "noted", text?: string) {
  try {
    const { admin, email, isOwner } = await owner();
    if (!isOwner) return { ok: false as const, error: "Only an owner or admin can decide the shop's rules." };
    const { data: r } = await admin.from("ai_suggestions").select("payload").eq("id", reviewId).maybeSingle();
    const p = (r?.payload || {}) as { items?: ReviewItem[] };
    const it = p.items?.[i];
    if (!it) return { ok: false as const, error: "That isn't on the review anymore." };
    it.state = d;
    if (text?.trim()) it.text = text.trim().slice(0, 300);
    if (d === "approved" && it.kind === "rule") await admin.from("ai_suggestions").insert({ kind: RULE_KIND, source: "staff", status: "done", priority: 3, title: it.text.slice(0, 200), body: it.text.slice(0, 300), payload: { text: it.text, by: email, from: reviewId, orders: it.orders, at: new Date().toISOString() } });
    const left = (p.items || []).some((x) => !x.state && x.kind !== "customer");
    await admin.from("ai_suggestions").update({ payload: p, ...(left ? {} : { status: "done", decided_at: new Date().toISOString() }) }).eq("id", reviewId);
    revalidatePath("/shop/ai/review");
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** a shop rule taken back */
export async function dropRule(id: string) {
  try {
    const { admin, isOwner } = await owner();
    if (!isOwner) return { ok: false as const, error: "Only an owner or admin can change the shop's rules." };
    await admin.from("ai_suggestions").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", id).eq("kind", RULE_KIND);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}

/** the review now, instead of waiting for tonight */
export async function runReviewNow() {
  try {
    const { admin } = await owner();
    const st = await aiState(admin);
    if (!st.ready) return { ok: false as const, error: st.reason };
    const r = await reviewCorrections(admin, st.settings);
    return r.ok ? { ok: true as const, n: r.n } : r;
  } catch (e) { return fail(e); }
}
