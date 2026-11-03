import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The customers and saved cards in our Stax account (Nov 3, Nick: "I have their cards saved online in Stax. Can you see
 * that? Can we pull it in to the customers?"), staff only and read only: each Stax customer with its saved cards and
 * bank accounts as Stax shows them (brand, last four, expiration). No card numbers ever come back from Stax.
 * GET ?q=On Your Left → the customers whose name, company or email matches.
 */
const STAX = "https://apiprod.fattlabs.com";
type PM = { id: string; method?: string; card_type?: string; card_last_four?: string; card_exp?: string; bank_name?: string; bank_type?: string; person_name?: string; nickname?: string; is_default?: number | boolean; created_at?: string; deleted_at?: string | null };
type Cu = { id: string; firstname?: string; lastname?: string; company?: string; email?: string; created_at?: string; deleted_at?: string | null };

export async function GET(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const key = process.env.STAX_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Stax isn't connected." }, { status: 400 });
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 80);
  const h = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  // Stax's search wants keywords[]; when it won't search, their customer list is read a page at a time and matched here
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (c: Cu) => words.every((w) => `${c.firstname || ""} ${c.lastname || ""} ${c.company || ""} ${c.email || ""}`.toLowerCase().includes(w));
  let list: Cu[] = [];
  const sp = new URLSearchParams({ per_page: "50" }); sp.append("keywords[]", q);
  const r = await fetch(`${STAX}/customer?${sp}`, { headers: h, cache: "no-store" });
  const j = (await r.json().catch(() => null)) as { data?: Cu[] } | Cu[] | null;
  if (r.ok) list = (Array.isArray(j) ? j : j?.data || []);
  if (!r.ok || !list.some(hit)) {
    list = [];
    for (let page = 1; page <= 10; page++) {
      const pr = await fetch(`${STAX}/customer?${new URLSearchParams({ per_page: "200", page: String(page) })}`, { headers: h, cache: "no-store" });
      if (!pr.ok) { if (page === 1) return NextResponse.json({ error: `Stax answered ${pr.status}: ${JSON.stringify(await pr.json().catch(() => "")).slice(0, 200)}` }, { status: 502 }); break; }
      const pj = (await pr.json().catch(() => null)) as { data?: Cu[]; last_page?: number } | null;
      list.push(...(pj?.data || []).filter(hit));
      if (!pj?.data?.length || (pj.last_page && page >= pj.last_page)) break;
    }
  }
  list = list.filter((c) => !c.deleted_at && (!words.length || hit(c))).slice(0, 25);
  const out = [];
  for (const c of list) {
    const pr = await fetch(`${STAX}/customer/${encodeURIComponent(c.id)}/payment-method`, { headers: h, cache: "no-store" });
    const pj = (await pr.json().catch(() => [])) as PM[] | { data?: PM[] };
    const pms = (Array.isArray(pj) ? pj : pj?.data || []).filter((p) => !p.deleted_at);
    out.push({
      id: c.id, name: [c.firstname, c.lastname].filter(Boolean).join(" "), company: c.company || "", email: c.email || "", since: c.created_at || "",
      methods: pms.map((p) => ({ id: p.id, method: p.method === "bank" ? "bank" : "card", brand: p.method === "bank" ? p.bank_name || "Bank account" : p.card_type || "Card", last4: p.card_last_four || "", exp: p.card_exp || "", holder: p.person_name || "", nickname: p.nickname || "", default: !!p.is_default, since: p.created_at || "" })),
    });
  }
  return NextResponse.json({ q, customers: out });
}
