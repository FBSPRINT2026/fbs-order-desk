"use server";
import { createClient, getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canSeeTexts } from "@/lib/texts";

/**
 * My Day → Favorites (Oct 24, Nick: "a section there that… has your favorites, and then… a little recap of each one…
 * here's their jobs, here's their status, they sent you an email, there's a text message waiting"). The starred
 * customers, their recent email and texts (texts only for the people who can see texts), and this year's sales.
 * Jobs and the emails waiting on a reply come from the page, which already has them.
 */
export type FavCustomer = { id: string; name: string; contact: string };
export type FavEmail = { id: string; customer_id: string; direction: string; subject: string; summary: string; to_email: string | null; occurred_at: string; account_id: string | null; cc: string[]; from_name: string };
export type FavText = { customer_id: string; from_me: boolean; body: string; sent_at: string; pics: number };
export type FavSales = { customer_id: string; sales: number; orders: number; last_order: string | null };

/** `as`: an owner viewing the portal as someone sees that person's favorites */
export async function getFavoritesRecap(as?: string) {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) throw new Error("Only shop staff can see this.");
    const admin = createAdminClient();
    // each person's own stars (Oct 26, Nick: "Amanda should have her own favorites, not my favorites")
    const who = (as && v.role === "owner" ? as : v.email).toLowerCase();
    const { data: mine } = await admin.from("customer_favorites").select("customer_id").eq("staff_email", who).limit(60);
    const favIds = ((mine || []) as { customer_id: string }[]).map((r) => r.customer_id);
    const { data: cs } = favIds.length ? await admin.from("customers").select("id, company, name").in("id", favIds).or("is_test.is.null,is_test.eq.false").limit(24) : { data: [] };
    const favs: FavCustomer[] = ((cs || []) as { id: string; company: string | null; name: string | null }[])
      .map((c) => ({ id: c.id, name: c.company || c.name || "Customer", contact: c.company && c.name ? c.name : "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!favs.length) return { ok: true as const, favs, emails: [] as FavEmail[], texts: [] as FavText[], sales: [] as FavSales[], seesTexts: false };
    const ids = favs.map((f) => f.id);
    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const seesTexts = await canSeeTexts(v.email, v.role);
    const y = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 4);
    const [em, tx, sl] = await Promise.all([
      admin.from("activities").select("id, customer_id, direction, subject, to_email, occurred_at, meta").eq("kind", "email").in("customer_id", ids).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(300),
      seesTexts ? admin.from("text_messages").select("customer_id, from_me, body, sent_at, files").in("customer_id", ids).gte("sent_at", since).order("sent_at", { ascending: false }).limit(600) : Promise.resolve({ data: [] }),
      // the sales rule the charts use; asked as the person (it's staff-only)
      (await createClient()).rpc("shop_customer_sales", { p_ids: ids, p_from: `${y}-01-01` }),
    ]);
    type EmRow = { id: string; customer_id: string; direction: string; subject: string | null; to_email: string | null; occurred_at: string; meta: { from_name?: string; account_id?: string; cc?: string[]; ignored?: boolean; triage?: { summary?: string } } | null };
    const emails: FavEmail[] = ((em.data || []) as EmRow[]).filter((e) => !e.meta?.ignored).map((e) => ({
      id: e.id, customer_id: e.customer_id, direction: e.direction, subject: e.subject || "", summary: e.meta?.triage?.summary || "", to_email: e.to_email,
      occurred_at: e.occurred_at, account_id: e.meta?.account_id || null, cc: e.meta?.cc || [], from_name: e.meta?.from_name || "",
    }));
    const texts: FavText[] = ((tx.data || []) as { customer_id: string; from_me: boolean; body: string | null; sent_at: string; files: unknown[] | null }[])
      .map((t) => ({ customer_id: t.customer_id, from_me: !!t.from_me, body: (t.body || "").replace(/\s+/g, " ").trim().slice(0, 200), sent_at: t.sent_at, pics: Array.isArray(t.files) ? t.files.length : 0 }));
    const sales: FavSales[] = ((sl.data || []) as { customer_id: string; sales: number; orders: number; last_order: string | null }[])
      .map((s) => ({ customer_id: s.customer_id, sales: +s.sales || 0, orders: +s.orders || 0, last_order: s.last_order }));
    return { ok: true as const, favs, emails, texts, sales, seesTexts };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't load your favorites." };
  }
}
