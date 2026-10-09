import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ssSkus } from "@/lib/ss";
import { matchColor } from "@/lib/colorMatch";

/** A garment line to buy: style / color / size and how many, matched to an S&S sku with price and stock. */
export type GoodsRow = { key: string; brand: string; style: string; color: string; size: string; qty: number; sku: string; price: number; stock: number; found: boolean; note: string;
  /** from an email only: the color the customer wrote, the style's real colors, and whether the match is a sure one */
  asked?: string; options?: string[]; sure?: boolean; styleID?: number };

/** Match rows to S&S skus (one lookup per style; our catalog remembers the S&S style id). Fills sku, price, stock. */
export async function matchToSS(admin: SupabaseClient, rows: GoodsRow[], opts: { fixColors?: boolean } = {}) {
  const styles = [...new Set(rows.map((r) => `${r.brand}|${r.style}`))];
  for (const st of styles) {
    const [brand, style] = st.split("|");
    if (!style) { for (const r of rows.filter((x) => `${x.brand}|${x.style}` === st)) r.note = "No style number"; continue; }
    const { data: gar } = await admin.from("garments").select("ss_style_id").ilike("style", style).not("ss_style_id", "is", null).limit(1).maybeSingle();
    const info = await ssSkus(gar?.ss_style_id ? +gar.ss_style_id : `${brand} ${style}`.trim()).catch(() => null);
    const colors = info ? [...new Set(info.skus.map((k) => k.colorName))].sort((a, b) => a.localeCompare(b)) : [];
    for (const r of rows.filter((x) => `${x.brand}|${x.style}` === st)) {
      if (!info) { r.note = "Style not found at S&S"; continue; }
      r.styleID = info.styleID;
      // from an email: the customer's color → the style's real color name ("forest green" → "Heather Forest Green")
      if (opts.fixColors) {
        const m = matchColor(r.color, colors);
        r.asked = r.color; r.options = colors;
        if (m) { r.color = m.color; r.sure = m.sure; } else r.sure = false;
      }
      const sku = info.skus.find((k) => k.colorName.toLowerCase() === r.color.toLowerCase() && k.size === r.size);
      if (!sku) { r.note = info.skus.some((k) => k.colorName.toLowerCase() === r.color.toLowerCase()) ? "Size not carried in this color" : "Color not found at S&S"; continue; }
      Object.assign(r, { sku: sku.sku, price: sku.price, stock: sku.qty, found: true, note: sku.qty < r.qty ? `Only ${sku.qty} in stock` : "" });
    }
  }
  return rows;
}

/**
 * Emails that may be the S&S website login our card is saved under: whoever is ordering, the shop's email and its
 * owners, and the connected mailboxes (S&S keeps saved cards per website login).
 */
export async function shopEmails(me?: string | null, admin?: SupabaseClient) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = admin || createAdminClient();
  const [{ data: st }, { data: mb }] = await Promise.all([
    db.from("settings").select("data").eq("id", 1).maybeSingle(),
    db.from("mail_accounts").select("email").limit(20),
  ]);
  const d = (st?.data || {}) as { shop?: { email?: string }; owners?: { email?: string }[]; ship?: { from?: { email?: string } } };
  return [me || "", d.shop?.email || "", d.ship?.from?.email || "", ...(d.owners || []).map((o) => o.email || ""), "nicholas@fbsprint.com", ...((mb || []) as { email: string }[]).map((m) => m.email)]
    .map((e) => e.trim().toLowerCase()).filter((e, i, a) => /@/.test(e) && a.indexOf(e) === i).slice(0, 8);
}

/**
 * The S&S website login our saved card belongs to (an order names the card by that login's email). The one a dry run
 * proved is kept in settings (ss_pay_email); until then a dry run tries the card's own email and then the likely ones.
 * A real order only uses a proven email (or the card's own), never guesses.
 */
export async function ssPayEmail(admin: SupabaseClient, cardEmail: string, me?: string | null, test?: boolean): Promise<{ ok: true; emails: string[] } | { ok: false; error: string }> {
  const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const proven = String((st?.data as { ss_pay_email?: string } | null)?.ss_pay_email || "").trim().toLowerCase();
  if (proven) return { ok: true, emails: [proven] };
  if (!test) {
    if (cardEmail.includes("@")) return { ok: true, emails: [cardEmail.toLowerCase()] };
    return { ok: false, error: "Run the dry run first: it finds which S&S login our card is saved under." };
  }
  const list = [cardEmail, ...(await shopEmails(me, admin))].map((e) => e.trim().toLowerCase()).filter((e, i, a) => e.includes("@") && a.indexOf(e) === i);
  return { ok: true, emails: list };
}

/** Place (or dry-run) the order with each login email in turn while S&S says the email isn't one of ours; keep the one it takes. */
export async function placeWithLogin<T>(emails: string[], place: (email: string) => Promise<T>, admin: SupabaseClient, test: boolean): Promise<T> {
  let last: unknown = null;
  for (const e of emails) {
    try {
      const r = await place(e);
      // remember the login S&S accepted (a dry run proves it)
      const { data: st } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
      const d = (st?.data || {}) as Record<string, unknown>;
      if (d.ss_pay_email !== e) await admin.from("settings").update({ data: { ...d, ss_pay_email: e } }).eq("id", 1);
      return r;
    } catch (err) {
      last = err;
      const m = err instanceof Error ? err.message : String(err);
      // only a wrong login email is worth another try (and only on a dry run)
      if (!test || !/website user email|not assigned to your customer/i.test(m)) throw err;
    }
  }
  const tried = emails.join(", ");
  throw new Error(`S&S didn't accept any of our emails as the login the 5488 card is saved under (tried ${tried}). What email do you sign in to ssactivewear.com with? ${last instanceof Error ? `(${last.message})` : ""}`.trim());
}
