"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { testFound } from "@/lib/format";
import { allRows } from "@/lib/readAll";

/**
 * The left search's shortcut (Oct 24, Nick: "if we type in an order number… that should just take us right to the order…
 * a customer name, like 918, it should just take us right to 918… anything else… that's when it should AI"). Returns where
 * to go, or "" to run the full search (and the AI answer). Reads only.
 *  - a number of 4+ digits: our order with that number, else the Printavo job with it;
 *  - a customer's name: the one customer whose company or contact name is that, or starts with it (number words count as
 *    digits, so "918" finds Nine18). Only short queries (up to 4 words): a question goes to the search.
 */
const WORDS: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
const key = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)(?=\d|\b)/g, (w) => WORDS[w] || w).replace(/[^a-z0-9]+/g, "");

export async function quickJump(q: string): Promise<string> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return "";
    const t = (q || "").trim();
    if (!t || t.length > 60) return "";
    const admin = createAdminClient();
    const num = /^#?\d{4,7}$/.test(t) ? +t.replace("#", "") : 0;
    if (num) {
      const { data: o } = await admin.from("orders").select("id").eq("number", num).eq("draft", false).is("discarded_at", null).limit(1).maybeSingle();
      if (o) return `/shop/orders/${o.id}`;
      const { data: a } = await admin.from("archived_orders").select("id, kind").eq("visual_id", String(num)).order("kind", { ascending: true }).limit(2);
      const pick = (a || []).find((x) => x.kind === "invoice") || (a || [])[0];
      return pick ? `/shop/archive/${pick.id}` : "";
    }
    if (t.split(/\s+/).length > 4) return "";
    const k = key(t);
    if (k.length < 3) return "";
    const { data: cs } = await allRows((r0, r1) => admin.from("customers").select("id, company, name, is_test").order("id").range(r0, r1), 10000);
    const list = (cs || []).filter((c) => testFound(c, t)).map((c) => ({ id: c.id as string, keys: [key(String(c.company || "")), key(String(c.name || ""))].filter(Boolean) }));
    const exact = list.filter((c) => c.keys.includes(k));
    if (exact.length === 1) return `/shop/customers/${exact[0].id}`;
    if (exact.length > 1) return "";
    const pre = list.filter((c) => c.keys.some((x) => x.startsWith(k)));
    return pre.length === 1 ? `/shop/customers/${pre[0].id}` : "";
  } catch { return ""; }
}
