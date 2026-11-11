"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountOwners, firstName } from "@/lib/accountOwners";
import { chatKey } from "@/lib/jobChats";
import { accessOf, permsFor } from "@/lib/roles";

/** the "chatPings" permission: the role's default with the person's own change in User Access */
async function canPing(email: string, role: string | null | undefined) {
  const { data } = await createAdminClient().from("settings").select("data").eq("id", 1).maybeSingle();
  return permsFor(role, accessOf(data?.data)[email]).chatPings;
}

/**
 * New customer messages since a moment, for the shop's live pop-up (components/ChatPing.tsx; Nov 2, Nick: "if I'm in there
 * and Logan… said, hey, this doesn't look right, a little blurb on the bottom right corner should pop up"). Only the
 * accounts the viewer owns, when they own any (the Job Center's My accounts rule); otherwise everyone's.
 */
export async function chatPing(since: string) {
  try {
    const v = await getViewer(", name");
    if (!v.user || !v.isStaff) return { ok: false as const, error: "Shop staff only." };
    if (!(await canPing(v.email, v.role))) return { ok: true as const, items: [], at: new Date().toISOString() };
    const admin = createAdminClient();
    const { data } = await admin.from("messages").select("id, order_id, customer_id, topic, author_name, body, created_at").is("hidden_at", null)
      .eq("author_type", "customer").gt("created_at", since).order("created_at").limit(10);
    const rows = (data || []) as { id: string; order_id: string | null; customer_id: string | null; topic: string | null; author_name: string | null; body: string | null; created_at: string }[];
    if (!rows.length) return { ok: true as const, items: [], at: new Date().toISOString() };
    const oids = [...new Set(rows.map((r) => r.order_id).filter(Boolean))] as string[];
    const { data: os } = oids.length ? await admin.from("orders").select("id, number, nickname, customer_id").in("id", oids) : { data: [] };
    const om = new Map(((os || []) as { id: string; number: number; nickname: string | null; customer_id: string | null }[]).map((o) => [o.id, o]));
    const cids = rows.map((r) => (r.order_id ? om.get(r.order_id)?.customer_id : r.customer_id)).filter(Boolean) as string[];
    const owners = await accountOwners(admin, cids);
    const mine = firstName(String((v.staff as { name?: string } | null)?.name || "") || v.email);
    const ownsAny = mine ? [...owners.values()].includes(mine) || (await admin.from("customer_private").select("customer_id", { count: "exact", head: true }).ilike("account_owner", `${mine}%`)).count! > 0 : false;
    const items = rows.map((r) => {
      const o = r.order_id ? om.get(r.order_id) : null;
      const cid = o?.customer_id || r.customer_id || "";
      return { id: r.id, key: chatKey(r), who: r.author_name || "A customer", number: o?.number ?? null, nickname: o?.nickname || "", body: String(r.body || "").slice(0, 120), owner: owners.get(cid) || "" };
    }).filter((x) => !ownsAny || !x.owner || x.owner === mine);
    return { ok: true as const, items, at: rows[rows.length - 1].created_at };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : String(e) }; }
}
