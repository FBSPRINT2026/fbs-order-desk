import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Our Stax payment history (Nov 3, Nick: "in Stax… can you see payment history?"), staff only, read only: the newest
 * charges and refunds, who they were for, the card's last four, what they were for. ?q= narrows to a name, company,
 * memo or reference; ?pages= reads more (50 a page, up to 10).
 */
const STAX = "https://apiprod.fattlabs.com";
type Tx = { id: string; type?: string; total?: number; success?: boolean | number; message?: string | null; method?: string; created_at?: string; is_refundable?: boolean; total_refunded?: number;
  meta?: { reference?: string; memo?: string } | string | null; customer?: { id?: string; firstname?: string; lastname?: string; company?: string; email?: string } | null; payment_method?: { card_type?: string; card_last_four?: string; bank_name?: string; nickname?: string; method?: string } | null; customer_id?: string; payment_method_id?: string };

export async function GET(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const key = process.env.STAX_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Stax isn't connected." }, { status: 400 });
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").trim().toLowerCase();
  const pages = Math.min(10, Math.max(1, +(u.searchParams.get("pages") || 1)));
  const h = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= pages; page++) {
    const r = await fetch(`${STAX}/transaction?${new URLSearchParams({ per_page: "50", page: String(page), sort: "created_at", order: "DESC" })}`, { headers: h, cache: "no-store" });
    if (!r.ok) return NextResponse.json({ error: `Stax answered ${r.status}: ${JSON.stringify(await r.json().catch(() => "")).slice(0, 200)}` }, { status: 502 });
    const j = (await r.json().catch(() => null)) as { data?: Tx[]; last_page?: number } | null;
    for (const t of j?.data || []) {
      const meta = typeof t.meta === "string" ? (() => { try { return JSON.parse(t.meta as string); } catch { return {}; } })() : t.meta || {};
      const c = t.customer || {};
      const row = {
        id: t.id, when: t.created_at || "", type: t.type || "", ok: !!t.success, total: +(t.total || 0), refunded: +(t.total_refunded || 0),
        who: [c.company, [c.firstname, c.lastname].filter(Boolean).join(" ")].filter(Boolean).join(" · "), email: c.email || "", customerId: c.id || t.customer_id || "",
        method: t.method || t.payment_method?.method || "", card: t.payment_method ? `${t.payment_method.card_type || t.payment_method.bank_name || ""} ${t.payment_method.card_last_four || ""}`.trim() : "",
        paymentMethodId: t.payment_method_id || "", reference: String((meta as { reference?: string }).reference || ""), memo: String((meta as { memo?: string }).memo || ""), message: t.message || "",
      };
      if (!q || `${row.who} ${row.email} ${row.memo} ${row.reference} ${row.card}`.toLowerCase().includes(q)) out.push(row);
    }
    if (!j?.data?.length || (j.last_page && page >= j.last_page)) break;
  }
  return NextResponse.json({ q, transactions: out });
}
