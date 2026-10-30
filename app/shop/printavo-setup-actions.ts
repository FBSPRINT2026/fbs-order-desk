"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewerPerms } from "@/lib/access";
import { storedPath } from "@/lib/archive";

/**
 * "Set up from Printavo" on a customer's Program tab (Oct 15, Nick: Amanda converts her clients herself, "like what we
 * did for Furry Feline"). Reads their Printavo invoices since a year, by design: each order's qty and price per piece,
 * the newest order's front and back mockups; proposes the design prices the Furry Feline way (one price ever → a flat
 * rate; several → price breaks at the smallest qty each price was charged); and a checklist (their contacts and phone
 * numbers from Printavo that aren't in the portal yet, the account owner). Nothing changes until Apply.
 */
async function me() {
  const v = await getViewer(", name");
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const perms = await viewerPerms(v.supabase, v.email, v.role);
  if (!perms.money) throw new Error("Prices aren't on for you.");
  return { v, admin: createAdminClient() };
}
const fail = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." });

type PvFile = { full: string };
type PvLine = { description?: string; category?: string; itemNumber?: string; items?: number; price?: number; mockups?: PvFile[] };
type PvData = { groups?: { lines?: PvLine[] }[]; contact?: { fullName?: string; email?: string; phone?: string }; owner?: string };

export type SetupOrder = { id: string; number: string; date: string; qty: number; price: number; nickname: string };
export type SetupDesign = {
  key: string; name: string; orders: SetupOrder[]; mode: "flat" | "breaks"; tiers: { min: number; price: number }[];
  front: string; back: string; frontUrl: string; backUrl: string; garment: string; extras: string[]; supplied: boolean;
  /** already on their program (same name) */ have: boolean; /** the prices don't go down as the qty goes up: look */ odd: boolean;
};
export type SetupContact = { name: string; email: string; phone: string };

/** the design a job is: its name without "(…)", "reprints", "no apparel tag" and the like */
const FLUFF = /\b(re-?prints?|re-?orders?|no (apparel|neck) (tags?|labels?)|new tag art|no tags?)\b/gi;
const clean = (n: string) => n.replace(/\(.*?\)/g, " ").replace(FLUFF, " ").replace(/[-–—]\s*$/, "").replace(/\s+/g, " ").trim();
const keyOf = (n: string) => clean(n).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** lines that aren't the print itself: tagging, folding, bagging, fees */
const EXTRA = /(tagging|tag (removal|print)|neck (tag|label)|fold|polybag|poly bag|bagging|screen fee|set ?up|art (fee|charge)|shipping|delivery|rush|digitiz)/i;
const SUPPLIED = /(customer|client)[- ]?(supplied|provided)|their (own )?(shirts?|garments?|blanks?|tees?|bags?|totes?)|\bcs\b/i;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function printavoSetup(input: { customerId: string; since: number }) {
  try {
    const { admin } = await me();
    const since = `${Math.max(2015, Math.min(new Date().getFullYear(), Math.round(input.since || 2023)))}-01-01`;
    const [{ data: rows }, { data: prog }, { data: c }, { data: cts }, { data: priv }] = await Promise.all([
      admin.from("archived_orders").select("id, visual_id, nickname, order_date, data, files").eq("customer_id", input.customerId).eq("kind", "invoice").gte("order_date", since).order("order_date", { ascending: false }).limit(1500),
      admin.from("programs").select("id").eq("customer_id", input.customerId).order("created_at").limit(1).maybeSingle(),
      admin.from("customers").select("name, email, phone, contact2_name, contact2_email, contact2_phone").eq("id", input.customerId).maybeSingle(),
      admin.from("customer_contacts").select("name, email, phone").eq("customer_id", input.customerId),
      admin.from("customer_private").select("account_owner").eq("customer_id", input.customerId).maybeSingle(),
    ]);
    const { data: items } = prog ? await admin.from("program_items").select("name").eq("program_id", prog.id).is("archived_at", null) : { data: [] };
    const have = new Set(((items || []) as { name: string }[]).map((x) => keyOf(x.name)));

    const designs = new Map<string, SetupDesign>();
    const contacts = new Map<string, SetupContact>();
    let pvOwner = "";
    for (const o of (rows || []) as { id: string; visual_id: string; nickname: string | null; order_date: string; data: PvData; files: Record<string, string> | null }[]) {
      const d = o.data || {};
      if (!pvOwner && d.owner) pvOwner = d.owner;
      if (d.contact && (d.contact.email || d.contact.phone)) {
        const k = (d.contact.email || d.contact.phone || "").toLowerCase();
        if (!contacts.has(k)) contacts.set(k, { name: d.contact.fullName || "", email: d.contact.email || "", phone: d.contact.phone || "" });
      }
      const name = clean(o.nickname || "");
      if (!name) continue;
      const lines = (d.groups || []).flatMap((g) => g.lines || []).filter((l) => (l.items || 0) > 0);
      const main = lines.filter((l) => !EXTRA.test(`${l.category || ""} ${l.description || ""}`));
      if (!main.length) continue;
      // the price per piece: the price most pieces were charged
      const byPrice = new Map<number, number>();
      for (const l of main) byPrice.set(r2(+(l.price || 0)), (byPrice.get(r2(+(l.price || 0))) || 0) + (l.items || 0));
      const price = [...byPrice].sort((a, b) => b[1] - a[1])[0][0];
      if (!(price > 0)) continue;
      const qty = main.reduce((n, l) => n + (l.items || 0), 0);
      const k = keyOf(name);
      let ds = designs.get(k);
      if (!ds) {
        // the newest order's mockups (orders come newest first): the first two pictures on its lines, front then back
        const pics = main.flatMap((l) => l.mockups || []).map((m) => storedPath((o.files || {})[m.full])).filter(Boolean);
        ds = { key: k, name, orders: [], mode: "flat", tiers: [], front: pics[0] || "", back: pics[1] || "", frontUrl: "", backUrl: "", garment: [main[0].itemNumber, main[0].description].filter(Boolean).join(" ").slice(0, 60), extras: [], supplied: main.some((l) => SUPPLIED.test(`${l.description || ""} ${l.category || ""}`)), have: have.has(k), odd: false };
        designs.set(k, ds);
      }
      ds.orders.push({ id: o.id, number: String(o.visual_id), date: o.order_date, qty, price, nickname: o.nickname || "" });
      for (const l of lines.filter((x) => EXTRA.test(`${x.category || ""} ${x.description || ""}`)))
        if ((l.price || 0) > 0) { const t = `${(l.description || l.category || "Extra").trim().slice(0, 40)} $${(+(l.price || 0)).toFixed(2)}/pc`; if (!ds.extras.includes(t)) ds.extras.push(t); }
    }
    // the proposal: one price → flat; several → a break at the smallest qty each price was charged
    for (const ds of designs.values()) {
      const at = new Map<number, number>();
      for (const x of ds.orders) at.set(x.price, Math.min(at.get(x.price) ?? Infinity, x.qty));
      if (at.size === 1) { ds.mode = "flat"; ds.tiers = [{ min: 0, price: [...at.keys()][0] }]; }
      else {
        ds.mode = "breaks";
        ds.tiers = [...at].map(([price, min]) => ({ min, price })).sort((a, b) => a.min - b.min || b.price - a.price);
        ds.odd = ds.tiers.some((t, i) => i > 0 && t.price > ds.tiers[i - 1].price);
      }
      ds.extras = ds.extras.slice(0, 4);
    }
    // pictures to show (an hour)
    const list = [...designs.values()].sort((a, b) => b.orders[0].date.localeCompare(a.orders[0].date));
    const paths = list.flatMap((d) => [d.front, d.back]).filter(Boolean);
    if (paths.length) {
      const { data: s } = await admin.storage.from("proofs").createSignedUrls(paths, 3600);
      const u = new Map<string, string>(((s || []) as { path: string | null; signedUrl: string }[]).filter((x) => x.path && x.signedUrl).map((x) => [String(x.path), x.signedUrl]));
      for (const d of list) { d.frontUrl = u.get(d.front) || ""; d.backUrl = u.get(d.back) || ""; }
    }
    // the checklist: their Printavo contacts not in the portal yet (by email or phone)
    const digits = (s: string | null | undefined) => String(s || "").replace(/\D/g, "").slice(-10);
    const known = [c?.email, c?.contact2_email, ...((cts || []) as SetupContact[]).map((x) => x.email)].map((x) => String(x || "").toLowerCase()).filter(Boolean);
    const phones = [c?.phone, c?.contact2_phone, ...((cts || []) as SetupContact[]).map((x) => x.phone)].map(digits).filter((x) => x.length === 10);
    const newContacts = [...contacts.values()].filter((x) => !/@fbsprint\.com$/i.test(x.email) && ((x.email && !known.includes(x.email.toLowerCase())) || (digits(x.phone).length === 10 && !phones.includes(digits(x.phone)))));
    return { ok: true as const, designs: list, contacts: newContacts, owner: String(priv?.account_owner || ""), printavoOwner: pvOwner, since: since.slice(0, 4), orders: (rows || []).length };
  } catch (e) { return fail(e); }
}

export async function applyPrintavoSetup(input: { customerId: string; designs: { name: string; mode: "flat" | "breaks"; tiers: { min: number; price: number }[]; supplied: boolean; front: string; back: string; garment: string; orders: number; last: string; extras: string[] }[]; contacts: SetupContact[]; owner?: string }) {
  try {
    const { v, admin } = await me();
    let { data: p } = await admin.from("programs").select("id").eq("customer_id", input.customerId).order("created_at").limit(1).maybeSingle();
    if (!p) {
      const ins = await admin.from("programs").insert({ customer_id: input.customerId, name: "Program", notes: "", active: false, rate_card: null }).select("id").single();
      if (ins.error) return { ok: false as const, error: ins.error.message };
      p = ins.data;
    }
    const { data: have } = await admin.from("program_items").select("id, name, price, min_qty, tiers, image_path, image_back").eq("program_id", p!.id).is("archived_at", null);
    let pos = (have || []).length, added = 0, updated = 0;
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    for (const d of input.designs) {
      const name = d.name.trim().slice(0, 120);
      const tiers = (d.tiers || []).filter((t) => t.price > 0).map((t) => ({ min: Math.max(0, Math.round(t.min || 0)), price: r2(t.price) })).sort((a, b) => a.min - b.min);
      if (!name || !tiers.length) continue;
      const mode = tiers.length === 1 && !tiers[0].min ? "flat" : (d.mode === "flat" ? "flat" : "breaks");
      const list = mode === "flat" ? [{ min: 0, price: tiers[0].price }] : tiers;
      const note = `${d.garment ? `${d.supplied ? "Their" : ""} ${d.garment}. `.trim() + " " : ""}${d.orders} order${d.orders === 1 ? "" : "s"} since the cutoff, last ${d.last}. Set from Printavo by ${v.email.split("@")[0]}, ${today}.${d.extras.length ? ` Billed separately on past orders: ${d.extras.join(", ")}.` : ""}`.replace(/\s+/g, " ").trim().slice(0, 300);
      const old = ((have || []) as { id: string; name: string; image_path: string; image_back: string; price: number; min_qty: number; tiers: unknown }[]).find((x) => keyOf(x.name) === keyOf(name));
      if (old) {
        await admin.from("program_items").update({ tiers: list, price: list[0].price, min_qty: list[0].min, price_mode: mode, supplied: d.supplied, active: true, ...(old.image_path ? {} : { image_path: d.front || "" }), ...(old.image_back ? {} : { image_back: d.back || "" }) }).eq("id", old.id);
        updated++; continue;
      }
      const ins = await admin.from("program_items").insert({ program_id: p!.id, name, style: "", brand: "", garment: d.garment.slice(0, 80), colors: [], sizes: ["S", "M", "L", "XL", "2XL"],
        price: list[0].price, min_qty: list[0].min, tiers: list, price_mode: mode, supplied: d.supplied, imprints: [{ location: "Full Front", method: "screen", colors: 1, inks: "", size: "", notes: "" }],
        design_id: null, image_path: d.front || "", image_back: d.back || "", notes: note, active: true, position: pos++ });
      if (!ins.error) added++;
    }
    // their contacts from Printavo
    let people = 0;
    for (const x of input.contacts || []) {
      if (!x.email && !x.phone) continue;
      const { error } = await admin.from("customer_contacts").insert({ customer_id: input.customerId, name: (x.name || "").slice(0, 120), email: (x.email || "").trim().toLowerCase().slice(0, 200), phone: (x.phone || "").slice(0, 40) });
      if (!error) people++;
    }
    // the account owner
    if (input.owner?.trim()) {
      const { data: pr } = await admin.from("customer_private").select("customer_id").eq("customer_id", input.customerId).maybeSingle();
      if (pr) await admin.from("customer_private").update({ account_owner: input.owner.trim().slice(0, 60), updated_at: new Date().toISOString() }).eq("customer_id", input.customerId);
      else await admin.from("customer_private").insert({ customer_id: input.customerId, account_owner: input.owner.trim().slice(0, 60) });
    }
    return { ok: true as const, added, updated, people };
  } catch (e) { return fail(e); }
}
