import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcOrder, mergeSettings, orderGroups, type Order, type PayTerms, type Payment } from "@/lib/pricing";
import { upFront } from "@/lib/payTerms";
import { requestSeparations } from "@/lib/artGate";

/**
 * Separations ask for themselves (Nov 3, Nick: "if the quote is approved, the invoice is paid, or whatever the customer's
 * terms are… then the separation should automatically… be requested… you don't need to wait on the sales team").
 *
 * The moment an order is ready, its missing separations are requested, the same as pressing Request Separations
 * (lib/artGate.ts requestSeparations, so the same checks): it's an order (the quote approved), the art is approved
 * (every proof, or staff marked it approved another way), each screen-print location has its saved art, and the
 * customer's terms are met: pre-pay paid in full, a deposit paid, nothing needed on receipt or net 30.
 *
 * Called after everything that can make an order ready (an approval of the quote or the proof, staff marking the art
 * approved, a payment, a status change on the order page), so it doesn't matter which comes last. Never throws: a
 * failure here leaves the button for someone to press.
 *
 * Not requested: a location that already had a separation (one that was cancelled stays cancelled; that was someone's
 * choice), and a location printing from films that already exist (the print's film: as printed, or on the shelf).
 */
export async function autoSeparations(admin: SupabaseClient, orderId: string, why = "") {
  try {
    const { data: od } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    const o = od as (Order & { declined_at?: string | null; discarded_at?: string | null }) | null;
    if (!o || o.type !== "invoice" || ["request", "quote", "quote_sent", "completed", "void"].includes(String(o.status)) || o.declined_at || o.discarded_at || o.draft) return { made: 0 };
    const screen = orderGroups(o).flatMap((g) => g.imprints || []).filter((im) => im.method === "screen");
    if (!screen.length) return { made: 0 };
    // the customer's terms
    const [{ data: cu }, { data: s }, { data: pays }, { data: seps }] = await Promise.all([
      o.customer_id ? admin.from("customers").select("payment_terms").eq("id", o.customer_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from("settings").select("data").eq("id", 1).maybeSingle(),
      admin.from("payments").select("*").eq("order_id", orderId),
      admin.from("separations").select("imprint_id").eq("order_id", orderId),
    ]);
    const settings = mergeSettings((s as { data?: unknown } | null)?.data);
    const c = calcOrder(o, settings, (pays || []) as Payment[]);
    const terms = ((cu as { payment_terms?: string } | null)?.payment_terms || null) as PayTerms | null;
    const due = upFront(terms, c.total, settings.depositPct, c.paid);
    if (due.kind !== "none" && due.amount > 0.005) return { made: 0 };
    // which locations: never had a separation, and not printing from films we already have
    const had = new Set(((seps || []) as { imprint_id: string | null }[]).map((x) => x.imprint_id).filter(Boolean));
    const want = screen.filter((im) => !had.has(im.id) && !(im.film && (im.film.state === "asPrinted" || im.film.state === "physical"))).map((im) => im.id);
    if (!want.length) return { made: 0 };
    const r = await requestSeparations(admin, orderId, `Automatic${why ? ` (${why})` : ""}`, want);
    return { made: r.ok ? r.made : 0 };
  } catch {
    return { made: 0 };
  }
}
