"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";
import { PAY_TERMS, type PayTerms } from "@/lib/pricing";

/**
 * Moving customers to the portal in bulk (Nov 3, Nick: "show me a list of all of our customers… quickly set their terms…
 * everybody in the top 30, if we haven't already transitioned them, we'll just automatically transition them… if they're
 * already in, you can gray them out"). Every customer, biggest first, with their terms, owner, email and whether they're
 * moved; terms set one at a time or for many at once, and the ticked ones moved together. Owner only.
 */
async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff || v.role !== "owner") throw new Error("Only the owner can do this.");
  return v;
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });
const okEmail = (e: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);

export type MoveRow = { id: string; name: string; contact: string; email: string; sales: number; orders: number; rank: number; terms: PayTerms; priceType: string; owner: string; movedAt: string | null; launchSent: string | null; /** moved without the launch email */ quiet: boolean;
  /** the personal note from Nick or Amanda: to whom, from which mailbox, not sent, sent */ personal: { to: string[]; from: string; skip: boolean; sentAt: string | null } };

export async function moveList() {
  try {
    const v = await me();
    const admin = createAdminClient();
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10), from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const [{ data: top, error }, { data: cs, error: ce }, { data: pr }, { data: sent }] = await Promise.all([
      v.supabase.rpc("shop_top_customers", { p_from: from, p_to: to, p_limit: 5000 }),
      allRows((a, b) => admin.from("customers").select("id, company, name, email, payment_terms, price_type, moved_at, is_test, launch_quiet, personal_note_to, personal_note_from, personal_note_skip, personal_note_sent_at").order("id").range(a, b)),
      allRows((a, b) => admin.from("customer_private").select("customer_id, account_owner").order("customer_id").range(a, b)),
      allRows((a, b) => admin.from("launch_email_sends").select("customer_id, sent_at").eq("ok", true).order("sent_at", { ascending: false }).order("id").range(a, b)),
    ]);
    if (error) throw new Error(error.message);
    if (ce) throw new Error(ce.message);
    const sales = new Map(((top || []) as { customer_id: string; sales: number; orders: number }[]).filter((r) => r.customer_id).map((r, i) => [r.customer_id, { sales: +r.sales || 0, orders: +r.orders || 0, rank: i + 1 }]));
    const own = new Map(((pr || []) as { customer_id: string; account_owner: string | null }[]).map((p) => [p.customer_id, p.account_owner || ""]));
    const last = new Map<string, string>();
    for (const r of (sent || []) as { customer_id: string | null; sent_at: string }[]) if (r.customer_id && !last.has(r.customer_id)) last.set(r.customer_id, r.sent_at);
    const rows = ((cs || []) as { id: string; company: string | null; name: string | null; email: string | null; payment_terms: PayTerms | null; price_type: string | null; moved_at: string | null; is_test: boolean | null; launch_quiet: boolean | null; personal_note_to: string[] | null; personal_note_from: string | null; personal_note_skip: boolean | null; personal_note_sent_at: string | null }[])
      .filter((c) => !c.is_test)
      .map((c): MoveRow => {
        const s = sales.get(c.id), email = String(c.email || "").trim().toLowerCase();
        return { id: c.id, name: String(c.company || "").trim() || String(c.name || "").trim() || "(no name)", contact: String(c.name || "").trim(), email: okEmail(email) ? email : "",
          sales: s?.sales || 0, orders: s?.orders || 0, rank: s?.rank || 0, terms: (c.payment_terms || "receipt") as PayTerms, priceType: c.price_type || "retail",
          owner: own.get(c.id) || "", movedAt: c.moved_at, launchSent: last.get(c.id) || null, quiet: !!c.launch_quiet,
          personal: { to: c.personal_note_to || [], from: c.personal_note_from || "", skip: !!c.personal_note_skip, sentAt: c.personal_note_sent_at } };
      })
      .sort((a, b) => (a.rank && b.rank ? a.rank - b.rank : a.rank ? -1 : b.rank ? 1 : a.name.localeCompare(b.name)));
    // their order: 1, 2, 3… for the ones with sales in the last 12 months
    let n = 0; for (const r of rows) r.rank = r.sales > 0 ? ++n : 0;
    return { ok: true as const, rows };
  } catch (e) { return fail(e); }
}

/** set the payment terms of one or more customers */
export async function setTerms(ids: string[], terms: PayTerms) {
  try {
    await me();
    if (!(terms in PAY_TERMS)) throw new Error("Pick terms first.");
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    for (let i = 0; i < ok.length; i += 200) {
      const { error } = await createAdminClient().from("customers").update({ payment_terms: terms }).in("id", ok.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
    return { ok: true as const, saved: ok.length };
  } catch (e) { return fail(e); }
}

/** move these customers to the portal (the same mark the move checklist's last step makes: moved_at / moved_by).
 *  `quiet`: they're left off the launch email (Nov 3, Nick: "move to portal, but don't notify… a once a year client") */
export async function moveCustomers(ids: string[], quiet = false) {
  try {
    const v = await me();
    const admin = createAdminClient();
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
    const at = new Date().toISOString();
    const { data, error } = await admin.from("customers").update({ moved_at: at, moved_by: v.user?.email || "", launch_quiet: quiet }).in("id", ok).is("moved_at", null).select("id");
    if (error) throw new Error(error.message);
    const moved = ((data || []) as { id: string }[]).map((x) => x.id);
    if (moved.length) await admin.from("activities").insert(moved.map((id) => ({ customer_id: id, kind: "note", direction: "none", subject: "Moved to the new system",
      body: `Moved from the customer list (Customers → Move to the portal)${quiet ? ", without the launch email" : ""}. New orders are 40,000-series; their portal is open.`, occurred_at: at })));
    return { ok: true as const, moved: moved.length, at };
  } catch (e) { return fail(e); }
}

/** leave these customers off the launch email, or put them back on it */
export async function setQuiet(ids: string[], quiet: boolean) {
  try {
    await me();
    const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 1000);
    const { error } = await createAdminClient().from("customers").update({ launch_quiet: quiet }).in("id", ok);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  } catch (e) { return fail(e); }
}
